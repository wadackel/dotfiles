// E2E test harness for picker.tsx. Spins up an isolated tmux server on a
// PID-suffixed socket so concurrent runs never race. All exported helpers
// target that isolated server only — callers never touch the host tmux.
//
// Scenario skeleton:
//   await setupServer();
//   try {
//     await createClaudePane({ status: "waiting", ... });
//     const picker = await spawnPicker();
//     await waitFor(picker, (o) => o.includes("..."));
//     await sendKey(picker, "Down");
//     await sendKey(picker, "Escape");
//     await waitForExit(picker);
//   } finally {
//     await teardown();
//   }

import { sanitizeAnsi } from "./picker.tsx";

// ---- Constants ----

const SOCKET = `picker-e2e-${Deno.pid}`;
const SESSION = "test";
const PICKER_WINDOW_NAME = "picker";
const POLL_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = (() => {
  const raw = Deno.env.get("PICKER_E2E_TIMEOUT_MS");
  if (!raw) return 5000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
})();

// ---- Types ----

export interface PaneOpts {
  agent?: string;
  status?: "running" | "waiting" | "idle" | "error";
  waitReason?: string;
  prompt?: string;
  currentTool?: string;
  lastTool?: string;
  lastEditFile?: string;
  lastActivityAtSec?: number;
  sessionId?: string;
}

export interface ServerOpts {
  cols?: number;
  rows?: number;
}

// ---- Internal tmux runners ----

// `-f /dev/null` skips loading the user's ~/.config/tmux/tmux.conf on server
// start so the sandbox really is isolated — SKILL.md / CLAUDE.md promise
// "isolated tmux sandbox", and picker's assumptions (default remain-on-exit=off,
// no user hooks firing on pane-mode-changed, etc.) must not depend on current
// user config.
const TMUX_PREFIX = ["-f", "/dev/null", "-L", SOCKET] as const;

// Run a tmux command against the isolated socket. Non-zero exit throws with
// stderr included (fail-fast; differs from picker.tsx:tmuxRun which logs and
// continues — tests want hard failures).
async function tmuxRun(args: string[]): Promise<string> {
  const { code, stdout, stderr } = await new Deno.Command("tmux", {
    args: [...TMUX_PREFIX, ...args],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const out = new TextDecoder().decode(stdout);
  if (code !== 0) {
    const err = new TextDecoder().decode(stderr).trim();
    throw new Error(`tmux ${args.join(" ")} failed (code ${code}): ${err}`);
  }
  return out;
}

// Best-effort tmux call: ignores exit code and all output. Used for cleanup
// commands like kill-server where "server was already gone" is expected.
async function tmuxRunAllowFail(args: string[]): Promise<void> {
  await new Deno.Command("tmux", {
    args: [...TMUX_PREFIX, ...args],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).output();
}

// ---- Public API ----

// Expose a raw tmux runner so scenarios can query side-effects directly
// (e.g. display-message -F "#{pane_active}") without re-plumbing the socket.
export async function tmux(args: string[]): Promise<string> {
  return await tmuxRun(args);
}

// Start a fresh isolated tmux server with an empty detached session. Idempotent
// against stale prior servers on the same socket (kill-server first, then
// has-session to confirm the new session actually exists — R3 mitigation).
export async function setupServer(opts: ServerOpts = {}): Promise<void> {
  const cols = String(opts.cols ?? 200);
  const rows = String(opts.rows ?? 50);
  await tmuxRunAllowFail(["kill-server"]);
  await tmuxRun([
    "new-session",
    "-d",
    "-s",
    SESSION,
    "-x",
    cols,
    "-y",
    rows,
  ]);
  await tmuxRun(["has-session", "-t", SESSION]);
}

// Create a new claude-like pane with the given @pane_* options set. Pane is
// attached to a detached scratch window in the test session; its paneId is
// returned so scenarios can reference it in subsequent tmux queries.
//
// Fields not passed in opts are left unset — picker.tsx reads `#{@pane_foo}`
// as empty string for unset options, which matches the fallback paths in
// parseRow (picker.tsx:75-109).
export async function createClaudePane(opts: PaneOpts = {}): Promise<string> {
  const paneId = (
    await tmuxRun([
      "new-window",
      "-d",
      "-t",
      SESSION,
      "-P",
      "-F",
      "#{pane_id}",
    ])
  ).trim();

  const agent = opts.agent ?? "claude";
  const pairs: Array<[string, string]> = [["@pane_agent", agent]];
  if (opts.status !== undefined) pairs.push(["@pane_status", opts.status]);
  if (opts.waitReason !== undefined) {
    pairs.push(["@pane_wait_reason", opts.waitReason]);
  }
  if (opts.prompt !== undefined) pairs.push(["@pane_prompt", opts.prompt]);
  if (opts.currentTool !== undefined) {
    pairs.push(["@pane_current_tool", opts.currentTool]);
  }
  if (opts.lastTool !== undefined) {
    pairs.push(["@pane_last_tool", opts.lastTool]);
  }
  if (opts.lastEditFile !== undefined) {
    pairs.push(["@pane_last_edit_file", opts.lastEditFile]);
  }
  if (opts.lastActivityAtSec !== undefined) {
    pairs.push(["@pane_last_activity_at", String(opts.lastActivityAtSec)]);
  }
  if (opts.sessionId !== undefined) {
    pairs.push(["@pane_session_id", opts.sessionId]);
  }

  for (const [key, val] of pairs) {
    await tmuxRun(["set-option", "-t", paneId, "-p", key, val]);
  }
  return paneId;
}

// Spawn picker.tsx as the direct command of a new tmux window. tmux passes
// the command to /bin/sh -c; picker.tsx is executable and carries its own
// shebang (`#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=tmux,git`),
// so passing the bare path lets the shebang declare the permission set —
// no drift risk between this string and picker.tsx:1.
//
// When picker exits, the window auto-closes (tmux default remain-on-exit=off),
// which is what waitForExit relies on.
export async function spawnPicker(
  opts: { selfPane?: string } = {},
): Promise<string> {
  // URL.pathname is percent-encoded; decode so paths containing spaces or
  // non-ASCII characters reach tmux/sh as a real filesystem path.
  const pickerPath = decodeURIComponent(
    new URL("./picker.tsx", import.meta.url).pathname,
  );
  if (pickerPath.includes("'")) {
    throw new Error(`picker path contains single quote, unsafe for sh -c: ${pickerPath}`);
  }
  // `tmux new-window -e K=V` sets K in the child's env. Used to simulate the
  // interactive popup path where TMUX_PANE reaches picker despite being
  // launched from another pane — the exact condition that triggered the
  // self-exclusion bug before this regression test existed.
  const envArgs: string[] = [];
  if (opts.selfPane !== undefined) {
    if (!/^%\d+$/.test(opts.selfPane)) {
      throw new Error(`selfPane must match %<digits>, got: ${opts.selfPane}`);
    }
    envArgs.push("-e", `TMUX_PANE=${opts.selfPane}`);
  }
  await tmuxRun([
    "new-window",
    "-d",
    "-t",
    SESSION,
    "-n",
    PICKER_WINDOW_NAME,
    ...envArgs,
    `'${pickerPath}'`,
  ]);
  const target = `${SESSION}:${PICKER_WINDOW_NAME}`;
  await waitFor(
    target,
    (out) =>
      out.includes("Select pane") || out.includes("No panes available."),
  );
  return target;
}

// Send a single key name (Down / Up / Enter / Escape / j / k) to the pane.
// tmux send-keys interprets these as key-name literals when unquoted.
export async function sendKey(target: string, key: string): Promise<void> {
  await tmuxRun(["send-keys", "-t", target, key]);
}

// Capture the target pane's visible text and strip ANSI (SGR-only retained
// via picker's sanitizeAnsi — though capture-pane -p without -e produces
// plain text, stripping is defensive in case the pane emits raw CSI).
export async function captureOutput(target: string): Promise<string> {
  const raw = await tmuxRun(["capture-pane", "-p", "-t", target]);
  return sanitizeAnsi(raw);
}

// Poll capture until predicate holds or timeout elapses. On timeout, the
// thrown error includes the last capture so failures are self-diagnosing.
export async function waitFor(
  target: string,
  predicate: (out: string) => boolean,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = await captureOutput(target);
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `waitFor timeout after ${timeoutMs}ms on ${target}. Last capture:\n${last}`,
  );
}

// Poll list-windows until the picker window disappears (auto-close on picker
// exit). Works because spawnPicker launches picker as the window's direct
// command, not inside a shell. Only one picker runs at a time by design; no
// per-target parameter.
export async function waitForExit(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let windows = "";
  while (Date.now() < deadline) {
    windows = (
      await tmuxRun([
        "list-windows",
        "-t",
        SESSION,
        "-F",
        "#{window_name}",
      ])
    ).trim();
    if (!windows.split("\n").includes(PICKER_WINDOW_NAME)) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `waitForExit timeout after ${timeoutMs}ms; picker window still present. Windows:\n${windows}`,
  );
}

// Kill the isolated server. Best-effort; safe to call multiple times.
export async function teardown(): Promise<void> {
  await tmuxRunAllowFail(["kill-server"]);
}
