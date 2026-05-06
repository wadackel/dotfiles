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

export type TmuxShowResult =
  | { ok: true; value: string }
  | { ok: false; stderr: string };

const LOG_FILE = `${Deno.env.get("HOME") ?? "."}/.codex/logs/codex-notify.log`;
const MAX_LOG_LINES = 1000;
const DEFAULT_MESSAGE = "Codex task completed";
const SUBAGENT_LOCK_PREFIX = "codex-pane-status-subagents";
const PENDING_SUBAGENT_NOTIFICATIONS_KEY =
  "@pane_pending_subagent_notifications";
const TMUX_COORDINATION_TIMEOUT_MS = 2000;
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

export function tmuxPaneId(raw: string | undefined): string | null {
  return raw && /^%\d+$/.test(raw) ? raw : null;
}

export function subagentLockName(pane: string): string {
  return `${SUBAGENT_LOCK_PREFIX}-${pane.replace(/[^A-Za-z0-9_.-]/g, "-")}`;
}

function parsePendingSubagentNotifications(raw: string): number {
  if (!/^\d+$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export function isMissingRequestedUserOption(
  stderr: string,
  key: string,
): boolean {
  return key.startsWith("@") && stderr.trim() === `invalid option: ${key}`;
}

export function normalizeMissingUserOption(
  result: TmuxShowResult,
  key: string,
): TmuxShowResult {
  if (!result.ok && isMissingRequestedUserOption(result.stderr, key)) {
    return { ok: true, value: "" };
  }
  return result;
}

export type PendingConsumeDecision =
  | { kind: "send"; count: number }
  | {
    kind: "skip";
    count: number;
    remaining: number;
    op: { kind: "set"; key: string; value: string } | {
      kind: "unset";
      key: string;
    };
  };

export function pendingSubagentNotificationDecision(
  raw: string,
): PendingConsumeDecision {
  const count = parsePendingSubagentNotifications(raw);
  if (count <= 0) return { kind: "send", count };
  const remaining = count - 1;
  return {
    kind: "skip",
    count,
    remaining,
    op: remaining === 0
      ? { kind: "unset", key: PENDING_SUBAGENT_NOTIFICATIONS_KEY }
      : {
        kind: "set",
        key: PENDING_SUBAGENT_NOTIFICATIONS_KEY,
        value: String(remaining),
      },
  };
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

export async function runCommand(
  cmd: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  let timeout: number | undefined;
  try {
    const child = new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const output = child.output();
    const result = options.timeoutMs === undefined
      ? await output
      : await Promise.race([
        output,
        new Promise<"timeout">((resolve) => {
          timeout = setTimeout(() => resolve("timeout"), options.timeoutMs);
        }),
      ]);
    if (result === "timeout") {
      try {
        child.kill("SIGKILL");
      } catch {
        // process may have exited between the timer and kill
      }
      await output.catch(() => undefined);
      return {
        code: 124,
        stdout: "",
        stderr: `timeout after ${options.timeoutMs}ms`,
      };
    }
    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout).trim(),
      stderr: new TextDecoder().decode(result.stderr).trim(),
    };
  } catch (err) {
    return { code: 127, stdout: "", stderr: String(err) };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
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
  const pane = tmuxPaneId(Deno.env.get("TMUX_PANE"));
  if (!pane) return null;
  const [session, window, paneIndex, paneTitle] = await Promise.all([
    tmuxField(tmuxPath, pane, "session_name"),
    tmuxField(tmuxPath, pane, "window_index"),
    tmuxField(tmuxPath, pane, "pane_index"),
    tmuxField(tmuxPath, pane, "pane_title"),
  ]);
  if (!session || !window || !paneIndex) return null;
  return { session, window, pane: paneIndex, paneTitle };
}

async function tmuxShow(
  tmuxPath: string,
  pane: string,
  key: string,
): Promise<TmuxShowResult> {
  const result = await runCommand(tmuxPath, ["show", "-t", pane, "-pv", key], {
    timeoutMs: TMUX_COORDINATION_TIMEOUT_MS,
  });
  return result.code === 0
    ? { ok: true, value: result.stdout }
    : { ok: false, stderr: result.stderr };
}

async function tmuxShowOptionalUserOption(
  tmuxPath: string,
  pane: string,
  key: string,
): Promise<TmuxShowResult> {
  return normalizeMissingUserOption(await tmuxShow(tmuxPath, pane, key), key);
}

async function tmuxSet(
  tmuxPath: string,
  pane: string,
  op: Extract<PendingConsumeDecision, { kind: "skip" }>["op"],
): Promise<{ ok: boolean; stderr: string }> {
  const args = op.kind === "set"
    ? ["set", "-t", pane, "-p", op.key, op.value]
    : ["set", "-t", pane, "-p", "-u", op.key];
  const result = await runCommand(tmuxPath, args, {
    timeoutMs: TMUX_COORDINATION_TIMEOUT_MS,
  });
  return { ok: result.code === 0, stderr: result.stderr };
}

async function consumePendingSubagentNotification(
  tmuxPath: string,
  pane: string,
): Promise<boolean> {
  const lockName = subagentLockName(pane);
  const lock = await runCommand(tmuxPath, ["wait-for", "-L", lockName], {
    timeoutMs: TMUX_COORDINATION_TIMEOUT_MS,
  });
  if (lock.code !== 0) {
    await log(`subagent_notify_skip lock_failed stderr=${lock.stderr}`);
    return false;
  }
  try {
    const current = await tmuxShowOptionalUserOption(
      tmuxPath,
      pane,
      PENDING_SUBAGENT_NOTIFICATIONS_KEY,
    );
    if (!current.ok) {
      await log(`subagent_notify_skip read_failed stderr=${current.stderr}`);
      return false;
    }
    const decision = pendingSubagentNotificationDecision(current.value);
    if (decision.kind === "send") {
      return false;
    }
    const write = await tmuxSet(tmuxPath, pane, decision.op);
    if (!write.ok) {
      await log(`subagent_notify_skip write_failed stderr=${write.stderr}`);
      return false;
    }
    await log(
      `subagent_notify_skip reason=subagent count=${decision.count} remaining=${decision.remaining}`,
    );
    return true;
  } finally {
    const unlock = await runCommand(tmuxPath, ["wait-for", "-U", lockName], {
      timeoutMs: TMUX_COORDINATION_TIMEOUT_MS,
    });
    if (unlock.code !== 0) {
      await log(`subagent_notify_skip unlock_failed stderr=${unlock.stderr}`);
    }
  }
}

async function send(
  rawPayload: string | undefined,
  sound: string,
): Promise<void> {
  const payload = parsePayload(rawPayload);
  const message = notificationMessage(payload);
  const tmuxPath = await commandPath("tmux");
  const rawPane = tmuxPaneId(Deno.env.get("TMUX_PANE"));
  if (rawPane && await consumePendingSubagentNotification(tmuxPath, rawPane)) {
    return;
  }
  const ctx = await tmuxContext(tmuxPath);
  const scriptPath = `${Deno.env.get("HOME")}/.codex/scripts/codex-notify.ts`;
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
