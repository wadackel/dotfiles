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

// Per-test-run scratch directory holding a compiled `.claude-wrapped` stub
// used by createClaudePane({ liveCommand: true }). Darwin SIP/AMFI blocks
// executing copies of Apple-signed binaries (e.g. /bin/sleep → SIGKILL 137),
// and symlinks resolve to the real basename at execve time, so neither the
// copy-and-rename nor the symlink trick works. Compiling a 3-line C stub
// with /usr/bin/cc is the one path that reliably makes the kernel's p_comm
// (and thus tmux's #{pane_current_command}) match `.claude-wrapped`.
const LIVE_BIN_DIR = `/tmp/picker-e2e-bin-${Deno.pid}`;
const LIVE_BIN_PATH = `${LIVE_BIN_DIR}/.claude-wrapped`;
const LIVE_BIN_SOURCE = `#include <stdlib.h>
#include <unistd.h>
int main(int argc, char **argv) {
  sleep(argc > 1 ? atoi(argv[1]) : 99999);
  return 0;
}
`;
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
  subagents?: string;
  // When undefined or true (default), spawn the pane with a live cc
  // placeholder so `pane_current_command` is `.claude-wrapped` — matching
  // the picker's liveness filter (picker.tsx:CLAUDE_PANE_COMMANDS).
  // Set to false to reproduce a stale pane whose cc has exited and the
  // shell has taken over (pane_current_command becomes the login shell).
  liveCommand?: boolean;
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
  await ensureLiveBin();
}

// Compile the `.claude-wrapped` stub used by liveCommand-mode panes. Idempotent
// across setupServer calls within a single test run: the binary is compiled
// once per process and cached across Deno.test cases on the same PID.
async function ensureLiveBin(): Promise<void> {
  try {
    const st = await Deno.stat(LIVE_BIN_PATH);
    if (st.isFile) return;
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
    // not built yet — fall through
  }
  await Deno.mkdir(LIVE_BIN_DIR, { recursive: true });
  const child = new Deno.Command("cc", {
    args: ["-x", "c", "-o", LIVE_BIN_PATH, "-"],
    stdin: "piped",
    stdout: "null",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(LIVE_BIN_SOURCE));
  await writer.close();
  const { code, stderr } = await child.output();
  if (code !== 0) {
    const err = new TextDecoder().decode(stderr).trim();
    throw new Error(
      `Failed to compile live .claude-wrapped stub with /usr/bin/cc: ${err}`,
    );
  }
}

// Create a new claude-like pane with the given @pane_* options set. Pane is
// attached to a detached scratch window in the test session; its paneId is
// returned so scenarios can reference it in subsequent tmux queries.
//
// Fields not passed in opts are left unset — picker.tsx reads `#{@pane_foo}`
// as empty string for unset options, which matches the fallback paths in
// parseRow (picker.tsx:75-109).
export async function createClaudePane(opts: PaneOpts = {}): Promise<string> {
  const live = opts.liveCommand !== false;
  const newWindowArgs = [
    "new-window",
    "-d",
    "-t",
    SESSION,
    "-P",
    "-F",
    "#{pane_id}",
  ];
  if (live) {
    // Execute the compiled `.claude-wrapped` stub directly so the kernel
    // sets p_comm (and tmux's #{pane_current_command}) to the basename
    // `.claude-wrapped`. See LIVE_BIN_* constants for why argv[0] renaming
    // via `exec -a` or symlinks does not suffice on Darwin.
    newWindowArgs.push(`${LIVE_BIN_PATH} 99999`);
  }
  const paneId = (await tmuxRun(newWindowArgs)).trim();

  if (live) {
    // Poll briefly so tmux reflects the post-execve p_comm rather than the
    // pane's initial foreground pgrp (fork'd cc not yet into execve).
    const deadline = Date.now() + 1000;
    let observed = "";
    while (Date.now() < deadline) {
      observed = (
        await tmuxRun([
          "list-panes",
          "-t",
          paneId,
          "-F",
          "#{pane_current_command}",
        ])
      ).trim();
      if (observed === ".claude-wrapped") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    if (observed !== ".claude-wrapped") {
      throw new Error(
        `createClaudePane liveCommand assertion failed: expected ` +
          `pane_current_command=".claude-wrapped" but got "${observed}". ` +
          `The compiled stub at ${LIVE_BIN_PATH} did not produce the ` +
          `expected p_comm — check /usr/bin/cc availability and macOS ` +
          `code-sign / AMFI policy on ${LIVE_BIN_DIR}.`,
      );
    }
  }

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
  if (opts.subagents !== undefined) {
    pairs.push(["@pane_subagents", opts.subagents]);
  }

  await Promise.all(
    pairs.map(([key, val]) =>
      tmuxRun(["set-option", "-t", paneId, "-p", key, val])
    ),
  );
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
    throw new Error(
      `picker path contains single quote, unsafe for sh -c: ${pickerPath}`,
    );
  }
  // `tmux new-window -e K=V` sets K in the child's env. Mirrors the interactive
  // popup path where tmux.conf's `bind-key w` injects
  // `-e "CC_PICKER_FROM_PANE=#{pane_id}"`. Reserved `TMUX_PANE` is unsuitable —
  // tmux clobbers it with the spawned pane's own id when the process starts,
  // so the originating-pane id has to ride a non-reserved env var name.
  const envArgs: string[] = [];
  if (opts.selfPane !== undefined) {
    if (!/^%\d+$/.test(opts.selfPane)) {
      throw new Error(`selfPane must match %<digits>, got: ${opts.selfPane}`);
    }
    envArgs.push("-e", `CC_PICKER_FROM_PANE=${opts.selfPane}`);
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
      out.includes("Claude Sessions") || out.includes("No panes available."),
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
// The compiled LIVE_BIN_DIR stub is intentionally NOT removed here — it is
// reused across every Deno.test call within the same process (the file is
// only 33 KB and recompiling per-test would add ~50ms * N overhead). The
// `/tmp/picker-e2e-bin-$PID` path is claimed by PID so concurrent test runs
// do not collide; the OS reclaims /tmp on reboot.
export async function teardown(): Promise<void> {
  await tmuxRunAllowFail(["kill-server"]);
}
