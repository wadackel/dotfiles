// Pure types + `tmux list-panes -F` format + row parser.
// Extracted from picker.tsx so non-TUI tools (picker-doctor, tests) can reuse
// the SSOT without pulling in React / Ink.

export type PaneStatus = "running" | "waiting" | "idle" | "error" | "";

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
}

// Status → display metadata. Mirrors bash tmux-window-picker.sh:59-78 (icon + short text).
export const STATUS_META = {
  running: { color: "green", short: "run", icon: "●" },
  waiting: { color: "yellow", short: "wait", icon: "◐" },
  idle: { color: "gray", short: "idle", icon: "○" },
  error: { color: "red", short: "err", icon: "✖" },
  "": { color: "white", short: "", icon: " " },
} as const;

// Format string passed to `tmux list-panes -a -F ...`. US (\x1f) separates fields
// because tmux format output can contain tabs/spaces and @pane_* values may be empty.
// Field count = 20; parseRow's malformed-check below must match.
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
  "#{@pane_last_tool_error}";

const NUMERIC = /^\d+$/;

function parseIntOrNull(raw: string): number | null {
  return NUMERIC.test(raw) ? Number.parseInt(raw, 10) : null;
}

function normalizeStatus(raw: string): PaneStatus {
  return Object.hasOwn(STATUS_META, raw) ? (raw as PaneStatus) : "";
}

// Parse one line of `tmux list-panes -a -F TMUX_FORMAT` output into a PaneRow.
// Returns null when the line is malformed (< 20 fields or empty pane_id).
export function parseRow(line: string): PaneRow | null {
  const fields = line.split("\x1f");
  if (fields.length < 20) return null;
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
  ] = fields;
  if (!paneId) return null;
  return {
    paneId,
    target,
    currentCommand,
    currentPath,
    agent,
    status: normalizeStatus(status),
    startedAtSec: parseIntOrNull(startedAt),
    cwd,
    worktreeBranch,
    subagents,
    prompt,
    waitReason,
    currentTool,
    sessionId,
    lastTool,
    lastEditFile,
    lastActivityAtSec: parseIntOrNull(lastActivityAt),
    currentToolSubject,
    lastToolSubject,
    lastToolError,
  };
}
