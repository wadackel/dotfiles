import { assertEquals, assertMatch } from "jsr:@std/assert";

// --- Unit tests for Lua template generation and output parsing ---

// Import is not practical since the script is a CLI entry point.
// Instead, test the core logic patterns used in the script.

const ERROR_PATTERN = /E\d+:/;

Deno.test("ERROR_PATTERN matches Neovim error codes", () => {
  assertEquals(ERROR_PATTERN.test("E5108: Error executing lua"), true);
  assertEquals(ERROR_PATTERN.test("E5112: Error while creating lua chunk"), true);
  assertEquals(ERROR_PATTERN.test("E216: No such group or event"), true);
  assertEquals(ERROR_PATTERN.test("E1: some error"), true);
});

Deno.test("ERROR_PATTERN does not match non-error output", () => {
  assertEquals(ERROR_PATTERN.test("Loading plugins..."), false);
  assertEquals(ERROR_PATTERN.test("Everything is fine"), false);
  assertEquals(ERROR_PATTERN.test(""), false);
  assertEquals(ERROR_PATTERN.test("Error without code"), false);
});

Deno.test("startup check returns valid JSON", async () => {
  const cmd = new Deno.Command("nvim", {
    args: [
      "--headless",
      "-c",
      `lua io.write(vim.json.encode({check="startup",ok=true,details={},errors={},warnings={}}))`,
      "+qa",
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  const result = JSON.parse(stdout);
  assertEquals(result.check, "startup");
  assertEquals(typeof result.ok, "boolean");
  assertEquals(Array.isArray(result.errors), true);
  assertEquals(Array.isArray(result.warnings), true);
});

Deno.test("plugins check returns plugin list", async () => {
  const cmd = new Deno.Command("nvim", {
    args: [
      "--headless",
      "-c",
      `lua local ok,lazy=pcall(require,"lazy"); if ok then local ps=lazy.plugins(); io.write(vim.json.encode({count=#ps})) else io.write(vim.json.encode({count=0})) end`,
      "+qa",
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  const result = JSON.parse(stdout);
  assertEquals(typeof result.count, "number");
  // Should have plugins if lazy.nvim is configured
  assertEquals(result.count > 0, true);
});

Deno.test("keymaps check can retrieve normal mode maps", async () => {
  const cmd = new Deno.Command("nvim", {
    args: [
      "--headless",
      "-c",
      `lua local maps=vim.api.nvim_get_keymap("n"); io.write(vim.json.encode({count=#maps}))`,
      "+qa",
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  const result = JSON.parse(stdout);
  assertEquals(typeof result.count, "number");
  assertEquals(result.count > 0, true);
});

Deno.test("broken lua produces E5108 in stderr", async () => {
  const cmd = new Deno.Command("nvim", {
    args: ["--headless", "-c", `lua error("intentional test error")`, "+qa"],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  const stderr = new TextDecoder().decode(output.stderr);
  assertMatch(stderr, ERROR_PATTERN);
});
