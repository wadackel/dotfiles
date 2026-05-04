#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=HOME,TMPDIR,TMUX_PANE --allow-run

interface NotifyPayload {
  "last-assistant-message"?: string;
  last_assistant_message?: string;
  message?: string;
  title?: string;
}

export interface TmuxContext {
  session: string;
  window: string;
  pane: string;
  paneTitle: string;
}

const LOG_FILE = `${Deno.env.get("HOME") ?? "."}/.codex/logs/codex-notify.log`;
const MAX_LOG_LINES = 1000;
const DEFAULT_MESSAGE = "Codex task completed";
const COMMON_COMMAND_PATHS: Record<string, string[]> = {
  "terminal-notifier": [
    "/opt/homebrew/bin/terminal-notifier",
    "/usr/local/bin/terminal-notifier",
  ],
  "tmux": [
    "/opt/homebrew/bin/tmux",
    "/usr/local/bin/tmux",
    "/usr/bin/tmux",
  ],
};

function truncate(raw: string, max: number): string {
  const clean = stripControls(raw).replace(/ {2,}/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "..." : clean;
}

function stripControls(raw: string): string {
  return Array.from(raw, (ch) => {
    const code = ch.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? " " : ch;
  }).join("");
}

export function parsePayload(raw: string | undefined): NotifyPayload {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as NotifyPayload;
    }
  } catch {
    // Codex notify must never fail the session because notification JSON changed.
  }
  return {};
}

export function notificationMessage(payload: NotifyPayload): string {
  return truncate(
    payload["last-assistant-message"] ??
      payload.last_assistant_message ??
      payload.message ??
      DEFAULT_MESSAGE,
    200,
  );
}

export function shellQuote(raw: string): string {
  return `'${raw.replace(/'/g, `'\\''`)}'`;
}

export function buildActivateCommand(
  denoPath: string,
  scriptPath: string,
  ctx: TmuxContext,
  tmuxPath: string,
): string {
  const args = [
    denoPath,
    "run",
    "--allow-run",
    "--allow-write",
    "--allow-env=HOME",
    "--allow-read",
    scriptPath,
    "activate",
    ctx.session,
    ctx.window,
    ctx.pane,
    tmuxPath,
  ];
  return args.map(shellQuote).join(" ");
}

export function buildTerminalNotifierArgs(
  message: string,
  sound: string,
  ctx: TmuxContext | null,
  executeCmd: string | null,
): string[] {
  const title = ctx ? `Codex · ${ctx.paneTitle || "tmux"}` : "Codex";
  const args = [
    "-title",
    title,
    "-subtitle",
    "作業が完了しました",
    "-message",
    message,
    "-sound",
    sound,
  ];
  if (ctx) {
    args.push("-group", `codex-${ctx.session}-${ctx.window}-${ctx.pane}`);
  }
  if (executeCmd) {
    args.push("-execute", executeCmd);
  }
  return args;
}

export function debugOutput(logFile: string, content: string | null): string {
  if (content === null) return `No log file found at ${logFile}\n`;
  const lines = content.split("\n");
  return [
    "=== codex-notify.ts debug log ===",
    `Log file: ${logFile}`,
    "",
    lines.slice(-50).join("\n"),
  ].join("\n");
}

async function ensureLogDir(): Promise<void> {
  await Deno.mkdir(`${Deno.env.get("HOME") ?? "."}/.codex/logs`, {
    recursive: true,
  });
}

async function rotateLog(): Promise<void> {
  try {
    const content = await Deno.readTextFile(LOG_FILE);
    const lines = content.split("\n");
    if (lines.length > MAX_LOG_LINES) {
      await Deno.writeTextFile(
        LOG_FILE,
        lines.slice(-MAX_LOG_LINES).join("\n"),
      );
    }
  } catch {
    // no log yet
  }
}

async function log(message: string): Promise<void> {
  try {
    await ensureLogDir();
    await rotateLog();
    const ts = new Date().toISOString();
    await Deno.writeTextFile(LOG_FILE, `[${ts}] ${message}\n`, {
      append: true,
    });
  } catch {
    // notification logging is best-effort
  }
}

async function runCommand(
  cmd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { code, stdout, stderr } = await new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    return {
      code,
      stdout: new TextDecoder().decode(stdout).trim(),
      stderr: new TextDecoder().decode(stderr).trim(),
    };
  } catch (err) {
    return { code: 127, stdout: "", stderr: String(err) };
  }
}

async function commandPath(name: string): Promise<string> {
  const result = await runCommand("/usr/bin/which", [name]);
  if (result.code === 0 && result.stdout) return result.stdout;
  const home = Deno.env.get("HOME") ?? "";
  const user = home.split("/").filter(Boolean).at(-1) ?? "";
  const perUser = user ? [`/etc/profiles/per-user/${user}/bin/${name}`] : [];
  for (const candidate of [...perUser, ...(COMMON_COMMAND_PATHS[name] ?? [])]) {
    try {
      const stat = await Deno.stat(candidate);
      if (stat.isFile) return candidate;
    } catch {
      // try next common location
    }
  }
  return name;
}

async function tmuxField(
  tmuxPath: string,
  pane: string,
  field: string,
): Promise<string> {
  const result = await runCommand(tmuxPath, [
    "display-message",
    "-t",
    pane,
    "-p",
    `#{${field}}`,
  ]);
  return result.code === 0 ? result.stdout : "";
}

async function tmuxContext(tmuxPath: string): Promise<TmuxContext | null> {
  const pane = Deno.env.get("TMUX_PANE");
  if (!pane || !/^%\d+$/.test(pane)) return null;
  const [session, window, paneIndex, paneTitle] = await Promise.all([
    tmuxField(tmuxPath, pane, "session_name"),
    tmuxField(tmuxPath, pane, "window_index"),
    tmuxField(tmuxPath, pane, "pane_index"),
    tmuxField(tmuxPath, pane, "pane_title"),
  ]);
  if (!session || !window || !paneIndex) return null;
  return { session, window, pane: paneIndex, paneTitle };
}

async function send(
  rawPayload: string | undefined,
  sound: string,
): Promise<void> {
  const payload = parsePayload(rawPayload);
  const message = notificationMessage(payload);
  const tmuxPath = await commandPath("tmux");
  const ctx = await tmuxContext(tmuxPath);
  const scriptPath = `${Deno.env.get("HOME")}/.codex/codex-notify.ts`;
  const executeCmd = ctx
    ? buildActivateCommand(Deno.execPath(), scriptPath, ctx, tmuxPath)
    : null;
  const notifierArgs = buildTerminalNotifierArgs(
    message,
    sound,
    ctx,
    executeCmd,
  );

  await log(
    `send message=${JSON.stringify(message)} tmux=${ctx ? "yes" : "no"}`,
  );
  await log(`tmux_path=${tmuxPath}`);
  if (ctx) {
    await log(
      `tmux_context session=${ctx.session} window=${ctx.window} pane=${ctx.pane} title=${ctx.paneTitle}`,
    );
  } else {
    await log("tmux_context=none");
  }
  if (executeCmd) await log(`execute_cmd=${executeCmd}`);
  const notifier = await commandPath("terminal-notifier");
  await log(`terminal_notifier_path=${notifier}`);
  const notified = await runCommand(notifier, notifierArgs);
  if (notified.code === 0) {
    await log("terminal-notifier success");
    return;
  }

  await log(`terminal-notifier failed: ${notified.stderr}`);
  const escaped = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const fallback = await runCommand("/usr/bin/osascript", [
    "-e",
    `display notification "${escaped}" with title "Codex" sound name "${sound}"`,
  ]);
  await log(
    `osascript fallback code=${fallback.code} stderr=${fallback.stderr}`,
  );
}

async function activate(
  session: string,
  window: string,
  pane: string,
  tmuxPath: string,
): Promise<void> {
  await log(`activate target=${session}:${window}.${pane}`);
  const activateResult = await runCommand("/usr/bin/osascript", [
    "-e",
    'tell application "WezTerm" to activate',
  ]);
  await log(
    `wezterm_activate code=${activateResult.code} stderr=${activateResult.stderr}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const target = `${session}:${window}.${pane}`;
  const clients = await runCommand(tmuxPath || "tmux", [
    "list-clients",
    "-F",
    "#{client_name}",
  ]);
  await log(
    `tmux_clients code=${clients.code} stdout=${
      JSON.stringify(clients.stdout)
    } stderr=${clients.stderr}`,
  );
  for (const client of clients.stdout.split("\n").filter(Boolean)) {
    const result = await runCommand(tmuxPath || "tmux", [
      "switch-client",
      "-c",
      client,
      "-t",
      target,
    ]);
    await log(
      `switch client=${client} code=${result.code} stderr=${result.stderr}`,
    );
  }
}

async function debug(): Promise<void> {
  try {
    const content = await Deno.readTextFile(LOG_FILE);
    console.log(debugOutput(LOG_FILE, content));
  } catch {
    console.log(debugOutput(LOG_FILE, null));
  }
}

async function main(): Promise<void> {
  const [subcommand, ...args] = Deno.args;
  switch (subcommand) {
    case "send":
      await send(args[0], args[1] ?? "Hero");
      break;
    case "activate":
      await activate(
        args[0] ?? "",
        args[1] ?? "",
        args[2] ?? "",
        args[3] ?? "tmux",
      );
      break;
    case "debug":
      await debug();
      break;
    default:
      await send(subcommand, "Hero");
  }
}

if (import.meta.main) {
  await main();
}
