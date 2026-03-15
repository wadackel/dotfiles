#!/usr/bin/env -S deno run --allow-run=nvim --allow-write --allow-read --allow-env

// --- Types ---

interface CheckResult {
  check: string;
  ok: boolean;
  details: Record<string, unknown>;
  errors: string[];
  warnings: string[];
}

// --- Constants ---

const TMPDIR = Deno.env.get("TMPDIR") ?? "/tmp";
const NVIM_TIMEOUT_MS = 15_000;
const ERROR_PATTERN = /E\d+:/;
const ALL_MODES = ["n", "v", "i", "c", "x", "s", "o", "t"];

// --- Lua Templates ---

function startupLua(): string {
  return `
local result = {check = "startup", ok = true, details = {}, errors = {}, warnings = {}}
result.details.errmsg = vim.v.errmsg
local msgs = vim.api.nvim_exec2("messages", {output = true})
local msg_lines = vim.split(msgs.output or "", "\\n", {trimempty = true})
result.details.message_count = #msg_lines
if msg_lines and #msg_lines > 0 then
  result.details.messages = msg_lines
end
if vim.v.errmsg ~= "" then
  table.insert(result.warnings, vim.v.errmsg)
end
io.write(vim.json.encode(result))
vim.cmd("qa!")
`;
}

function pluginsLua(target?: string): string {
  const targetStr = target ? `"${target.replace(/"/g, '\\"')}"` : "nil";
  return `
local result = {check = "plugins", ok = true, details = {}, errors = {}, warnings = {}}
local lazy_ok, lazy = pcall(require, "lazy")
if not lazy_ok then
  result.ok = false
  table.insert(result.errors, "lazy.nvim not available")
  io.write(vim.json.encode(result))
  vim.cmd("qa!")
  return
end

local plugins = lazy.plugins()
local target = ${targetStr}

if target then
  local found = false
  for _, p in ipairs(plugins) do
    if p.name == target then
      found = true
      local load_ok, load_err = pcall(function() lazy.load({plugins = {target}}) end)
      result.details.name = target
      result.details.found = true
      result.details.load_ok = load_ok
      if not load_ok then
        result.ok = false
        table.insert(result.errors, "Failed to load: " .. tostring(load_err))
      end
      break
    end
  end
  if not found then
    result.ok = false
    result.details.name = target
    result.details.found = false
    table.insert(result.errors, "Plugin not found: " .. target)
  end
else
  local plugin_list = {}
  local loaded_count = 0
  for _, p in ipairs(plugins) do
    local loaded = p._.loaded ~= nil
    if loaded then loaded_count = loaded_count + 1 end
    table.insert(plugin_list, {name = p.name, loaded = loaded})
  end
  result.details.plugin_count = #plugins
  result.details.loaded_count = loaded_count
  result.details.plugins = plugin_list
end

io.write(vim.json.encode(result))
vim.cmd("qa!")
`;
}

function keymapsLua(target?: string): string {
  const targetStr = target ? `"${target.replace(/"/g, '\\"')}"` : "nil";
  return `
local result = {check = "keymaps", ok = true, details = {}, errors = {}, warnings = {}}
local modes = {"n","v","i","c","x","s","o","t"}
local target = ${targetStr}

if target then
  local found = {}
  for _, mode in ipairs(modes) do
    local maps = vim.api.nvim_get_keymap(mode)
    for _, m in ipairs(maps) do
      if m.lhs == target then
        table.insert(found, {mode = mode, lhs = m.lhs, rhs = m.rhs or "", desc = m.desc or ""})
      end
    end
  end
  result.details.target = target
  result.details.matches = found
  result.details.match_count = #found
  if #found == 0 then
    result.ok = false
    table.insert(result.errors, "Keymap not found: " .. target)
  end
else
  local all_maps = {}
  local total = 0
  for _, mode in ipairs(modes) do
    local maps = vim.api.nvim_get_keymap(mode)
    total = total + #maps
    for _, m in ipairs(maps) do
      table.insert(all_maps, {mode = mode, lhs = m.lhs, rhs = m.rhs or "", desc = m.desc or ""})
    end
  end
  result.details.total_count = total
  result.details.keymaps = all_maps
end

io.write(vim.json.encode(result))
vim.cmd("qa!")
`;
}

function optionsLua(names: string[]): string {
  const namesJson = JSON.stringify(names);
  return `
local result = {check = "options", ok = true, details = {}, errors = {}, warnings = {}}
local names = vim.json.decode('${namesJson}')
local values = {}
for _, name in ipairs(names) do
  local ok, val = pcall(function() return vim.o[name] end)
  if ok then
    values[name] = val
  else
    result.ok = false
    table.insert(result.errors, "Unknown option: " .. name)
  end
end
result.details.options = values
io.write(vim.json.encode(result))
vim.cmd("qa!")
`;
}

// --- Runner ---

async function runHeadlessCheck(luaCode: string): Promise<CheckResult> {
  const tmpFile = `${TMPDIR}/nvim-verify-${Deno.pid}-${Date.now()}.lua`;
  try {
    await Deno.writeTextFile(tmpFile, luaCode);

    const cmd = new Deno.Command("nvim", {
      args: ["--headless", "-c", `luafile ${tmpFile}`],
      stdout: "piped",
      stderr: "piped",
    });

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), NVIM_TIMEOUT_MS);

    let proc;
    try {
      proc = cmd.spawn();
      const output = await proc.output();
      clearTimeout(timeoutId);

      const stdout = new TextDecoder().decode(output.stdout).trim();
      const stderr = new TextDecoder().decode(output.stderr).trim();

      // Layer 1: exit code
      if (output.code !== 0 && !stdout) {
        return {
          check: "unknown",
          ok: false,
          details: { exit_code: output.code },
          errors: stderr ? stderr.split("\n") : [`nvim exited with code ${output.code}`],
          warnings: [],
        };
      }

      // Parse JSON from stdout
      let result: CheckResult;
      try {
        result = JSON.parse(stdout);
      } catch {
        return {
          check: "unknown",
          ok: false,
          details: { raw_stdout: stdout },
          errors: ["Failed to parse nvim output as JSON"],
          warnings: [],
        };
      }

      // Layer 2: stderr error patterns
      if (stderr) {
        const stderrLines = stderr.split("\n");
        for (const line of stderrLines) {
          if (ERROR_PATTERN.test(line)) {
            result.ok = false;
            result.errors.push(line.trim());
          } else if (line.trim()) {
            result.warnings.push(line.trim());
          }
        }
      }

      return result;
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof DOMException && e.name === "AbortError") {
        return {
          check: "unknown",
          ok: false,
          details: { timeout_ms: NVIM_TIMEOUT_MS },
          errors: [`nvim timed out after ${NVIM_TIMEOUT_MS}ms`],
          warnings: [],
        };
      }
      throw e;
    }
  } finally {
    try {
      await Deno.remove(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

// --- Subcommands ---

async function checkStartup(): Promise<CheckResult> {
  return await runHeadlessCheck(startupLua());
}

async function checkPlugins(target?: string): Promise<CheckResult> {
  return await runHeadlessCheck(pluginsLua(target));
}

async function checkKeymaps(target?: string): Promise<CheckResult> {
  return await runHeadlessCheck(keymapsLua(target));
}

async function checkOptions(names: string[]): Promise<CheckResult> {
  if (names.length === 0) {
    return {
      check: "options",
      ok: false,
      details: {},
      errors: ["No option names specified. Usage: nvim-verify.ts options <name> [name...]"],
      warnings: [],
    };
  }
  return await runHeadlessCheck(optionsLua(names));
}

async function checkAll(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  results.push(await checkStartup());
  results.push(await checkPlugins());
  results.push(await checkKeymaps());
  return results;
}

// --- Main ---

async function main(): Promise<void> {
  const [subcommand, ...args] = Deno.args;

  if (!subcommand) {
    console.error(
      "Usage: nvim-verify.ts <startup|plugins [name]|keymaps [lhs]|options <name...>|all>",
    );
    Deno.exit(1);
  }

  let output: CheckResult | CheckResult[];

  switch (subcommand) {
    case "startup":
      output = await checkStartup();
      break;
    case "plugins":
      output = await checkPlugins(args[0]);
      break;
    case "keymaps":
      output = await checkKeymaps(args[0]);
      break;
    case "options":
      output = await checkOptions(args);
      break;
    case "all": {
      output = await checkAll();
      break;
    }
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      Deno.exit(1);
  }

  console.log(JSON.stringify(output, null, 2));

  if (Array.isArray(output)) {
    const hasError = output.some((r) => !r.ok);
    if (hasError) Deno.exit(1);
  } else {
    if (!output.ok) Deno.exit(1);
  }
}

main();
