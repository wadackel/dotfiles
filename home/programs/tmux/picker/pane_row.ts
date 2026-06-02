// Pure types + `tmux list-panes -F` format + row parser.
// Extracted from picker.tsx so non-TUI tools (picker-doctor, tests) can reuse
// the SSOT without pulling in React / Ink.

export type PaneStatus = "running" | "waiting" | "idle" | "error" | "";

// User-defined session label. Written by the picker itself (not by agent
// hooks) via `set-option -p -t <paneId> @pane_user_label <value>`. Empty
// string means "no label" (= none). The label set takes display priority
// over PaneStatus in row-1: see displayMeta() in components.tsx.
export type UserLabel = "" | "review" | "parked" | "feedback" | "pending";

// Agents whose sessions the picker surfaces. PaneRow.agent stays `string` because
// `@pane_agent` is read verbatim from tmux and may legitimately be empty or any
// other value (a non-claude / non-opencode / non-codex pane). isLivePaneCommand applies the
// allowlist; PaneRow.agent is not narrowed at the parser layer.
export type Agent = "claude" | "opencode" | "codex";

// Per-agent allowlist of `pane_current_command` values that mark a *live* AI
// session pane (vs a stale pane whose AI process has exited and dropped back to
// the login shell). macOS p_comm is capped at 15 chars, so opencode's wrapper
// surfaces as `.opencode-wrapp` empirically; `.opencode-wrapped` is included
// defensively in case the cap changes in a future macOS / kernel.
export function isLivePaneCommand(agent: string, cmd: string): boolean {
  switch (agent) {
    case "claude":
      return cmd === ".claude-wrapped" || cmd === "claude" || cmd === "node";
    case "opencode":
      return cmd === ".opencode-wrapp" || cmd === ".opencode-wrapped" ||
        cmd === "opencode";
    case "codex":
      return cmd === ".codex-wrapped" || cmd === "codex";
    default:
      return false;
  }
}

export interface PaneRow {
  paneId: string;
  target: string;
  currentCommand: string;
  currentPath: string;
  agent: string;
  status: PaneStatus;
  startedAtSec: number | null;
  cwd: string;
  worktreeBranch: string;
  subagents: string;
  prompt: string;
  waitReason: string;
  currentTool: string;
  sessionId: string;
  lastTool: string;
  lastEditFile: string;
  lastActivityAtSec: number | null;
  currentToolSubject: string;
  lastToolSubject: string;
  lastToolError: string;
  contextUsedPct: number | null;
  userLabel: UserLabel;
}

// Status → display metadata. Mirrors bash tmux-window-picker.sh:59-78 (icon + short text).
// Colors are vim-dogrun hex values (see github.com/wadackel/vim-dogrun colors/dogrun.vim):
// Constant (#73c1a9) / Keyword (#ac8b83) / Comment (#545c8c) / Error (#ff9494) / Normal (#9ea3c0).
export const STATUS_META = {
  running: { color: "#73c1a9", short: "run", icon: "●" },
  waiting: { color: "#ac8b83", short: "wait", icon: "◐" },
  idle: { color: "#545c8c", short: "idle", icon: "○" },
  error: { color: "#ff9494", short: "err", icon: "✖" },
  "": { color: "#9ea3c0", short: "", icon: " " },
} as const;

// UserLabel → display metadata. Same shape as STATUS_META so displayMeta() in
// components.tsx can pick from either. Icons are Nerd Font Material Design
// (1 cell wide in CaskaydiaCove Nerd Font Mono); colors are dogrun palette
// hex values matching DOGRUN.* in components.tsx. PUA code points are emitted
// inline here because pane_row.ts ships through the Nix store unmodified;
// the CLAUDE.md "Private Use Area glyphs at runtime" rule applies to files
// generated at install time, not to TypeScript sources read by Deno.
export const USER_LABEL_META = {
  "": { color: "#9ea3c0", short: "", icon: " " },
  review: { color: "#929be5", short: "review", icon: "\u{F0996}" }, // nf-md-comment-eye
  parked: { color: "#a8a384", short: "parked", icon: "\u{F051F}" }, // nf-md-timer-sand — external-blocked / waiting on CI / replies
  feedback: { color: "#ac8b83", short: "feedback", icon: "\u{F0CDE}" }, // nf-md-thumbs-up-down
  pending: { color: "#a6afff", short: "pending", icon: "\u{F00C3}" }, // nf-md-bookmark-outline
} as const;

// Cycling order for `m` keypress in the picker. Length 5 so `(idx + 1) % 5`
// closes the loop back to "" (none). The order is intentional, not derived
// from Object.keys(USER_LABEL_META) — Object.keys order is technically
// guaranteed for string keys in modern JS but the explicit array makes the
// cycle a first-class part of the contract.
export const USER_LABEL_CYCLE: readonly UserLabel[] = [
  "",
  "review",
  "parked",
  "feedback",
  "pending",
] as const;

// Compute the next label in the picker cycle. Unknown / out-of-cycle input
// is treated as "" so the cycle restarts from the head.
export function nextUserLabel(current: UserLabel): UserLabel {
  const idx = USER_LABEL_CYCLE.indexOf(current);
  if (idx < 0) return USER_LABEL_CYCLE[1];
  return USER_LABEL_CYCLE[(idx + 1) % USER_LABEL_CYCLE.length];
}

// Format string passed to `tmux list-panes -a -F ...`. US (\x1f) separates fields
// because tmux format output can contain tabs/spaces and @pane_* values may be empty.
// Field count = 23; parseRow's malformed-check below must match.
export const TMUX_FORMAT = "#{pane_id}\x1f" +
  "#{session_name}:#{window_index}.#{pane_index}\x1f" +
  "#{pane_current_command}\x1f" +
  "#{pane_current_path}\x1f" +
  "#{@pane_agent}\x1f" +
  "#{@pane_status}\x1f" +
  "#{@pane_started_at}\x1f" +
  "#{@pane_cwd}\x1f" +
  "#{@pane_worktree_branch}\x1f" +
  "#{@pane_subagents}\x1f" +
  "#{@pane_prompt}\x1f" +
  "#{@pane_wait_reason}\x1f" +
  "#{@pane_current_tool}\x1f" +
  "#{@pane_session_id}\x1f" +
  "#{@pane_last_tool}\x1f" +
  "#{@pane_last_edit_file}\x1f" +
  "#{@pane_last_activity_at}\x1f" +
  "#{@pane_current_tool_subject}\x1f" +
  "#{@pane_last_tool_subject}\x1f" +
  "#{@pane_last_tool_error}\x1f" +
  "#{@pane_context_used_pct}\x1f" +
  "#{@pane_user_label}\x1f" +
  "#{@pane_user_label_session}";

const NUMERIC = /^\d+$/;

function parseIntOrNull(raw: string): number | null {
  return NUMERIC.test(raw) ? Number.parseInt(raw, 10) : null;
}

function normalizeStatus(raw: string): PaneStatus {
  return Object.hasOwn(STATUS_META, raw) ? (raw as PaneStatus) : "";
}

function normalizeUserLabel(raw: string): UserLabel {
  return Object.hasOwn(USER_LABEL_META, raw) ? (raw as UserLabel) : "";
}

// Reader-side ANSI / control-byte choke point. Defense-in-depth against an
// attacker-controlled directory / branch / path leaking ESC sequences into
// `tmux list-panes -F` output (e.g. `/tmp/$'\x1b]0;pwn\x07'`). Writer-side
// sanitization stays trustless — every text field that flows from the kernel
// or `@pane_*` value into Ink rendering passes through here.
//
// `\x1f` (US, field separator) is intentionally out of scope: it is excluded
// from the strip set so injecting it into a value would still desync the
// 23-field layout (parseRow returns null on `fields.length < 23`).
// deno-lint-ignore no-control-regex
const CONTROL_BYTE_RE = /[\x00-\x1e\x7f]/g;

function stripControlBytes(raw: string): string {
  return raw.replace(CONTROL_BYTE_RE, " ");
}

// Parse one line of `tmux list-panes -a -F TMUX_FORMAT` output into a PaneRow.
// Returns null when the line is malformed (< 23 fields or empty pane_id).
export function parseRow(line: string): PaneRow | null {
  const fields = line.split("\x1f");
  if (fields.length < 23) return null;
  const [
    paneId,
    target,
    currentCommand,
    currentPath,
    agent,
    status,
    startedAt,
    cwd,
    worktreeBranch,
    subagents,
    prompt,
    waitReason,
    currentTool,
    sessionId,
    lastTool,
    lastEditFile,
    lastActivityAt,
    currentToolSubject,
    lastToolSubject,
    lastToolError,
    contextUsedPct,
    userLabel,
    userLabelSession,
  ] = fields;
  if (!paneId) return null;
  // Gate the user label on session identity: only honor it when the session
  // it was attached to is still the pane's current session. A new agent
  // session writes a fresh @pane_session_id, so a label left over from a
  // closed session falls through to "" (none) instead of leaking forward.
  // userLabelSession is consumed here and intentionally NOT exposed on
  // PaneRow — consumers only need the already-normalized userLabel.
  const effectiveUserLabel =
    stripControlBytes(userLabelSession) === stripControlBytes(sessionId)
      ? normalizeUserLabel(userLabel)
      : "";
  return {
    paneId: stripControlBytes(paneId),
    target: stripControlBytes(target),
    currentCommand: stripControlBytes(currentCommand),
    currentPath: stripControlBytes(currentPath),
    agent: stripControlBytes(agent),
    status: normalizeStatus(status),
    startedAtSec: parseIntOrNull(startedAt),
    cwd: stripControlBytes(cwd),
    worktreeBranch: stripControlBytes(worktreeBranch),
    subagents: stripControlBytes(subagents),
    prompt: stripControlBytes(prompt),
    waitReason: stripControlBytes(waitReason),
    currentTool: stripControlBytes(currentTool),
    sessionId: stripControlBytes(sessionId),
    lastTool: stripControlBytes(lastTool),
    lastEditFile: stripControlBytes(lastEditFile),
    lastActivityAtSec: parseIntOrNull(lastActivityAt),
    currentToolSubject: stripControlBytes(currentToolSubject),
    lastToolSubject: stripControlBytes(lastToolSubject),
    lastToolError: stripControlBytes(lastToolError),
    contextUsedPct: parseIntOrNull(contextUsedPct),
    userLabel: effectiveUserLabel,
  };
}
