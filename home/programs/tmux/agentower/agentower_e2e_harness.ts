// E2E test harness for agentower.tsx. Spins up an isolated tmux server on a
// PID-suffixed socket so concurrent runs never race. All exported helpers
// target that isolated server only — callers never touch the host tmux.
//
// Scenario skeleton:
//   await setupServer();
//   try {
//     await createClaudePane({ status: "waiting", ... });
//     const agentower = await spawnAgentower();
//     await waitFor(agentower, (o) => o.includes("..."));
//     await sendKey(agentower, "Down");
//     await sendKey(agentower, "Escape");
//     await waitForExit();
//   } finally {
//     await teardown();
//   }

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../../agents/lib/proc.ts";
import { sanitizeAnsi } from "./ansi.ts";
import type { UserLabel } from "./pane_row.ts";

// ---- Constants ----

const SOCKET = `agentower-e2e-${process.pid}`;
const SESSION = "test";
const AGENTOWER_WINDOW_NAME = "agentower";
const POLL_INTERVAL_MS = 50;

// Per-test-run scratch directory holding compiled stubs used by
// createClaudePane({ liveCommand: true }). One stub per agent (claude,
// opencode, codex) so each pane's `pane_current_command` surfaces the value
// `isLivePaneCommand` expects. Darwin SIP/AMFI blocks executing copies of
// Apple-signed binaries (e.g. /bin/sleep → SIGKILL 137) and symlinks resolve
// to the real basename at execve time, so compiling a 3-line C stub with
// /usr/bin/cc is the one path that reliably makes the kernel's p_comm match
// the binary's basename. The opencode stub uses the 15-char form
// `.opencode-wrapp` so MAXCOMLEN truncation is a no-op.
const LIVE_BIN_DIR = `/tmp/agentower-e2e-bin-${process.pid}`;
const LIVE_BIN_PATHS: Record<string, string> = {
  claude: `${LIVE_BIN_DIR}/.claude-wrapped`,
  opencode: `${LIVE_BIN_DIR}/.opencode-wrapp`,
  "codex": `${LIVE_BIN_DIR}/.codex-wrapped`,
};
const LIVE_BIN_BASENAMES: Record<string, string> = {
  claude: ".claude-wrapped",
  opencode: ".opencode-wrapp",
  "codex": ".codex-wrapped",
};
const LIVE_BIN_SOURCE = `#include <stdlib.h>
#include <unistd.h>
int main(int argc, char **argv) {
  sleep(argc > 1 ? atoi(argv[1]) : 99999);
  return 0;
}
`;
const DEFAULT_TIMEOUT_MS = (() => {
  const raw = process.env.AGENTOWER_E2E_TIMEOUT_MS;
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
  lastToolError?: string;
  lastEditFile?: string;
  lastActivityAtSec?: number;
  sessionId?: string;
  subagents?: string;
  cwd?: string;
  // User-defined session label set via agentower.tsx's `m` keypress, stored
  // in the @pane_user_label tmux pane option. When set (non-empty),
  // Agentower's row-1 display swaps icon/text/color from PaneStatus to the
  // label's meta. Leave unset (or set to "") to test the unlabeled path.
  userLabel?: UserLabel;
  // Session id the user label is bound to, stored in @pane_user_label_session.
  // agentower.tsx writes the pane's current session id alongside the label;
  // Agentower only honors the label when this matches @pane_session_id. Set it
  // different from sessionId to reproduce a stale label left by a closed
  // session, which Agentower must drop.
  userLabelSession?: string;
  // When undefined or true (default), spawn the pane with a live cc
  // placeholder so `pane_current_command` is `.claude-wrapped` — matching
  // Agentower's liveness filter (agentower.tsx:CLAUDE_PANE_COMMANDS).
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
// "isolated tmux sandbox", and Agentower's assumptions (default remain-on-exit=off,
// no user hooks firing on pane-mode-changed, etc.) must not depend on current
// user config.
const TMUX_PREFIX = ["-f", "/dev/null", "-L", SOCKET] as const;

// Run a tmux command against the isolated socket. Non-zero exit throws with
// stderr included (fail-fast; differs from agentower.tsx:tmuxRun which logs and
// continues — tests want hard failures).
async function tmuxRun(args: string[]): Promise<string> {
  const { code, stdout, stderr } = await run("tmux", [
    ...TMUX_PREFIX,
    ...args,
  ]);
  if (code !== 0) {
    const err = stderr.trim();
    throw new Error(`tmux ${args.join(" ")} failed (code ${code}): ${err}`);
  }
  return stdout;
}

function runSilent(cmd: string, args: string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

// Best-effort tmux call: ignores exit code and all output. Used for cleanup
// commands like kill-server where "server was already gone" is expected.
async function tmuxRunAllowFail(args: string[]): Promise<void> {
  await runSilent("tmux", [...TMUX_PREFIX, ...args]);
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

// Compile per-agent stubs used by liveCommand-mode panes. Idempotent across
// setupServer calls within a single test run: each binary is compiled once
// per process and cached across test cases on the same PID.
async function ensureLiveBin(): Promise<void> {
  const mkdir = await run("mkdir", ["-p", LIVE_BIN_DIR]);
  if (mkdir.code !== 0) {
    const err = mkdir.stderr.trim();
    throw new Error(`Failed to create ${LIVE_BIN_DIR}: ${err}`);
  }
  for (const path of Object.values(LIVE_BIN_PATHS)) {
    if (await runSilent("test", ["-f", path]) === 0) continue;

    const { code, stderr } = await run("cc", ["-x", "c", "-o", path, "-"], {
      stdin: LIVE_BIN_SOURCE,
    });
    if (code !== 0) {
      const err = stderr.trim();
      throw new Error(
        `Failed to compile live stub ${path} with /usr/bin/cc: ${err}`,
      );
    }
  }
}

// Create a new claude-like pane with the given @pane_* options set. Pane is
// attached to a detached scratch window in the test session; its paneId is
// returned so scenarios can reference it in subsequent tmux queries.
//
// Fields not passed in opts are left unset — agentower.tsx reads `#{@pane_foo}`
// as empty string for unset options, which matches the fallback paths in
// parseRow (agentower.tsx:75-109).
export async function createClaudePane(opts: PaneOpts = {}): Promise<string> {
  const live = opts.liveCommand !== false;
  const agent = opts.agent ?? "claude";
  // Pick the per-agent live stub. Unknown agents fall back to the claude
  // stub so existing scenarios that pass `agent: "shell"` (negative tests)
  // still spawn a non-shell live pane — `isLivePaneCommand("shell", ...)`
  // returns false anyway so Agentower filters it out.
  const liveBinPath = LIVE_BIN_PATHS[agent] ?? LIVE_BIN_PATHS["claude"];
  const liveBinBasename = LIVE_BIN_BASENAMES[agent] ??
    LIVE_BIN_BASENAMES["claude"];
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
    // Execute the compiled stub directly so the kernel sets p_comm (and
    // tmux's #{pane_current_command}) to the basename matching the agent.
    // See LIVE_BIN_* constants for why argv[0] renaming via `exec -a` or
    // symlinks does not suffice on Darwin.
    newWindowArgs.push(`${liveBinPath} 99999`);
  }
  const paneId = (await tmuxRun(newWindowArgs)).trim();

  if (live) {
    // Poll briefly so tmux reflects the post-execve p_comm rather than the
    // pane's initial foreground pgrp (fork'd stub not yet into execve).
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
      if (observed === liveBinBasename) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    if (observed !== liveBinBasename) {
      throw new Error(
        `createClaudePane liveCommand assertion failed: expected ` +
          `pane_current_command="${liveBinBasename}" but got "${observed}". ` +
          `The compiled stub at ${liveBinPath} did not produce the ` +
          `expected p_comm — check /usr/bin/cc availability and macOS ` +
          `code-sign / AMFI policy on ${LIVE_BIN_DIR}.`,
      );
    }
  }

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
  if (opts.lastToolError !== undefined) {
    pairs.push(["@pane_last_tool_error", opts.lastToolError]);
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
  if (opts.cwd !== undefined) {
    pairs.push(["@pane_cwd", opts.cwd]);
  }
  if (opts.userLabel !== undefined) {
    pairs.push(["@pane_user_label", opts.userLabel]);
  }
  if (opts.userLabelSession !== undefined) {
    pairs.push(["@pane_user_label_session", opts.userLabelSession]);
  }

  await Promise.all(
    pairs.map(([key, val]) =>
      tmuxRun(["set-option", "-t", paneId, "-p", key, val])
    ),
  );
  return paneId;
}

// Scenarios that name their own HOME keep it; everything else runs against
// this empty one. Without it Agentower reads the developer's real
// ~/.local/state/agent-usage and paints live account numbers into the usage
// footer — a value that differs per machine and is absent on CI, so any layout
// assertion taken here would not reproduce anywhere else.
let sandboxHome: string | null = null;

// Exposed so a scenario can seed fixtures into the same HOME Agentower will
// read, without having to invent its own temp dir.
export async function sandboxHomePath(): Promise<string> {
  if (sandboxHome === null) {
    sandboxHome = await mkdtemp("/tmp/agentower-e2e-home-");
  }
  return sandboxHome;
}

async function sandboxEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = {
    HOME: await sandboxHomePath(),
    // A value left in the developer's shell collides with sandbox pane ids —
    // every fresh tmux server reissues %0, %1, … — and silently moves the
    // initial selection off the first row.
    AGENTOWER_FROM_PANE: "",
  };
  // Bun keeps its transpiler cache under HOME, so a replaced HOME would start
  // every scenario cold and collect cache files; aim it back at the real one.
  // An inherited value passes through as it is, since an empty one is how the
  // cache is turned off. S8/S8b/S55 inject it inline for the same reason, and
  // S8's HOME is a tracked fixture directory.
  const realHome = process.env.HOME;
  const cacheDir = process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH ??
    (realHome ? `${realHome}/Library/Caches/bun/@t@` : undefined);
  if (cacheDir !== undefined) env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = cacheDir;
  return env;
}

// Spawn Agentower as the direct command of a new tmux window. tmux passes the
// command to /bin/sh -c; agentower-main.ts is executable and carries its own
// shebang (`#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null`),
// so passing the bare path lets the shebang declare the flags — no drift risk
// between this string and agentower-main.ts:1.
//
// AGENTOWER_E2E_BIN swaps in a compiled binary instead. It is read here rather
// than taken as an option because most scenarios call spawnAgentower() with no
// arguments, so an option would never reach them; the env var lets one run of
// the suite exercise the shipped artifact.
//
// When Agentower exits, the window auto-closes (tmux default remain-on-exit=off),
// which is what waitForExit relies on.
export async function spawnAgentower(
  opts: {
    selfPane?: string;
    env?: Record<string, string>;
    // Skip the readiness wait so the caller can send keys before the first
    // frame. Pair it with startDelayMs, or the send races the spawn.
    waitForReady?: boolean;
    // Delay the exec by this many seconds' worth of milliseconds, so keys sent
    // in the meantime are already sitting in the pane's tty when the process
    // starts — the real prefix+w symptom, made deterministic.
    startDelayMs?: number;
    // Redirect the process's stderr here. agentower-bench.ts pairs it with
    // AGENTOWER_TRACE, whose marks would otherwise land in the pane and be
    // captured as part of the frame.
    traceFile?: string;
    args?: string[];
  } = {},
): Promise<string> {
  const agentowerPath = process.env.AGENTOWER_E2E_BIN ??
    join(import.meta.dirname, "agentower-main.ts");
  // The path is interpolated into an sh -c string that tmux hands to /bin/sh,
  // so anything sh would re-read there is refused rather than escaped.
  if (/['"$`\\]/.test(agentowerPath)) {
    throw new Error(
      `Agentower path contains shell metacharacters, unsafe for sh -c: ${agentowerPath}`,
    );
  }
  // `tmux new-window -e K=V` sets K in the child's env (literal value, no
  // format expansion). Mirrors the interactive popup path where tmux.conf's
  // `bind-key w` writes `AGENTOWER_FROM_PANE` to session env via
  // `set-environment` before `display-popup` (the popup inherits session env
  // at spawn). Reserved `TMUX_PANE` is unsuitable — tmux clobbers it with
  // the spawned pane's own id when the process starts, so the originating-
  // pane id has to ride a non-reserved env var name.
  const env: Record<string, string> = {
    ...await sandboxEnv(),
    ...opts.env,
  };
  if (opts.selfPane !== undefined) {
    if (!/^%\d+$/.test(opts.selfPane)) {
      throw new Error(`selfPane must match %<digits>, got: ${opts.selfPane}`);
    }
    env.AGENTOWER_FROM_PANE = opts.selfPane;
  }
  const envArgs: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`invalid env key for tmux new-window: ${key}`);
    }
    if (value.includes("\n")) {
      throw new Error(`env value for ${key} contains newline`);
    }
    envArgs.push("-e", `${key}=${value}`);
  }
  const delayMs = opts.startDelayMs ?? 0;
  if (!Number.isInteger(delayMs) || delayMs < 0) {
    throw new Error(
      `startDelayMs must be a non-negative integer, got: ${delayMs}`,
    );
  }
  const traceFile = opts.traceFile ?? "";
  if (traceFile && /['"$`\\]/.test(traceFile)) {
    throw new Error(`traceFile contains shell metacharacters: ${traceFile}`);
  }
  const args = opts.args ?? [];
  for (const arg of args) {
    if (!/^--[a-z-]+$/.test(arg)) {
      throw new Error(`args must match --<lowercase>, got: ${arg}`);
    }
  }
  const argSuffix = args.map((a) => " " + a).join("");
  // `exec` rather than a plain call: the pane's tty is already open while sh
  // sleeps, so keys sent during the delay are buffered by the line discipline
  // and inherited by the real process — which is exactly what happens when a
  // user types while the popup binary is still loading.
  const command = delayMs === 0 && !traceFile
    ? `'${agentowerPath}'${argSuffix}`
    : `sh -c '${
      delayMs === 0 ? "" : `sleep ${delayMs / 1000}; `
    }exec "${agentowerPath}"${argSuffix}${
      traceFile ? ` 2>>"${traceFile}"` : ""
    }'`;
  await tmuxRun([
    "new-window",
    "-d",
    "-t",
    SESSION,
    "-n",
    AGENTOWER_WINDOW_NAME,
    ...envArgs,
    command,
  ]);
  const target = `${SESSION}:${AGENTOWER_WINDOW_NAME}`;
  if (opts.waitForReady === false) return target;
  await waitFor(
    target,
    // "jump" leads the bottom key-hint bar, which is clipped from the right,
    // so it survives the narrowest scenario width.
    (out) => out.includes("jump") || out.includes("No panes available."),
  );
  return target;
}

// Attach a real tmux client to `session` from a pane of its own host session
// on the same server, so the harness needs no pty; TMUX is unset there because
// tmux refuses to attach from inside a pane otherwise. The host is sized like
// setupServer's session so a client switching in does not shrink the Agentower
// window under `window-size latest`. Input sent to the returned hostPane
// reaches the client as keystrokes and counts as its activity.
let clientHosts = 0;
export async function attachClient(
  session: string,
): Promise<{ clientName: string; hostPane: string }> {
  const before = new Set(
    (await tmuxRun(["list-clients", "-F", "#{client_name}"]))
      .split("\n").filter(Boolean),
  );
  const hostPane = (await tmuxRun([
    "new-session",
    "-d",
    "-s",
    `clienthost-${++clientHosts}`,
    "-x",
    "200",
    "-y",
    "50",
    "-P",
    "-F",
    "#{pane_id}",
    `env -u TMUX tmux -L ${SOCKET} attach -t ${session}`,
  ])).trim();
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const added = (await tmuxRun(["list-clients", "-F", "#{client_name}"]))
      .split("\n").filter((name) => name && !before.has(name));
    if (added.length === 1) return { clientName: added[0], hostPane };
    if (added.length > 1) {
      throw new Error(`attachClient: expected one new client, got ${added}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`attachClient timeout: no client attached to ${session}`);
}

// Send raw bytes as one write, so several events land in a single stdin read
// the way a pty releases a buffered burst or a trackpad fling arrives. sendKey
// issues one write per call and cannot produce that.
export async function sendBurst(target: string, seq: string): Promise<void> {
  const hex = [...new TextEncoder().encode(seq)].map((b) =>
    b.toString(16).padStart(2, "0")
  );
  await tmuxRun(["send-keys", "-t", target, "-H", ...hex]);
}

// Send a single key name (Down / Up / Enter / Escape / j / k) to the pane.
// tmux send-keys interprets these as key-name literals when unquoted.
export async function sendKey(target: string, key: string): Promise<void> {
  await tmuxRun(["send-keys", "-t", target, key]);
}

// Capture the target pane's visible text and strip ANSI (SGR-only retained
// via Agentower's sanitizeAnsi — though capture-pane -p without -e produces
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

// Poll list-windows until the Agentower window disappears (auto-close on
// Agentower exit). Works because spawnAgentower launches Agentower as the
// window's direct command, not inside a shell. Only one Agentower runs at a
// time by design; no per-target parameter.
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
    if (!windows.split("\n").includes(AGENTOWER_WINDOW_NAME)) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `waitForExit timeout after ${timeoutMs}ms; Agentower window still present. Windows:\n${windows}`,
  );
}

// Kill the isolated server. Best-effort; safe to call multiple times.
// The compiled LIVE_BIN_DIR stub is intentionally NOT removed here — it is
// reused across every test within the same process (the file is
// only 33 KB and recompiling per-test would add ~50ms * N overhead). The
// `/tmp/agentower-e2e-bin-$PID` path is claimed by PID so concurrent test runs
// do not collide; the OS reclaims /tmp on reboot.
export async function teardown(): Promise<void> {
  await tmuxRunAllowFail(["kill-server"]);
  if (sandboxHome !== null) {
    const dir = sandboxHome;
    sandboxHome = null;
    await rm(dir, { recursive: true }).catch(() => {});
  }
}
