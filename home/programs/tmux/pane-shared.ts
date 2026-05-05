// Shared contract + pure helpers + transition builders for the agent-status
// SSOT system. Imported by claude-pane-status.ts (Deno script), codex-pane-
// status.ts (Deno script), and opencode/plugin_logic.ts (Bun plugin) via
// in-worktree symlink + per-agent home-manager wiring (see plan
// 20260504T1958-agents-picker-refactor.md "Patterns to Mirror" for the
// 2-stage symlink chain).
//
// Web-standard API ONLY. Do NOT add Deno.* / Bun.* / node:* — Bun must be
// able to import this file in-process.

// --- Op type ---

export type Op =
  | { kind: "set"; key: string; value: string }
  | { kind: "unset"; key: string };

// --- @pane_* key contract ---
//
// PaneOptionKey is the literal union of every key the agents may write. Each
// agent only owns a subset (see ALL_PANE_OPTIONS_FOR_<AGENT> below). The
// picker reads a superset declared in pane_row.ts:TMUX_FORMAT.

export type PaneOptionKey =
  | "@pane_agent"
  | "@pane_status"
  | "@pane_session_id"
  | "@pane_started_at"
  | "@pane_cwd"
  | "@pane_worktree_branch"
  | "@pane_worktree_path"
  | "@pane_subagents"
  | "@pane_pending_teardown"
  | "@pane_prompt"
  | "@pane_wait_reason"
  | "@pane_current_tool"
  | "@pane_current_tool_use_id"
  | "@pane_last_tool"
  | "@pane_last_edit_file"
  | "@pane_last_activity_at"
  | "@pane_current_tool_subject"
  | "@pane_last_tool_subject"
  | "@pane_last_tool_error"
  | "@pane_main_stopped"
  | "@pane_context_used_pct";

// Per-agent flat key arrays. Used by writers for full-teardown unset on
// SessionEnd. Order matches each writer's pre-refactor ALL_PANE_OPTIONS so
// substitution is byte-identical.

export const ALL_PANE_OPTIONS_FOR_CLAUDE = [
  "@pane_agent",
  "@pane_status",
  "@pane_session_id",
  "@pane_started_at",
  "@pane_cwd",
  "@pane_worktree_branch",
  "@pane_worktree_path",
  "@pane_subagents",
  "@pane_pending_teardown",
  "@pane_prompt",
  "@pane_wait_reason",
  "@pane_current_tool",
  "@pane_last_tool",
  "@pane_last_edit_file",
  "@pane_last_activity_at",
  "@pane_current_tool_subject",
  "@pane_last_tool_subject",
  "@pane_last_tool_error",
  "@pane_main_stopped",
  "@pane_context_used_pct",
] as const satisfies readonly PaneOptionKey[];

export const ALL_PANE_OPTIONS_FOR_CODEX = [
  "@pane_agent",
  "@pane_status",
  "@pane_session_id",
  "@pane_started_at",
  "@pane_cwd",
  "@pane_prompt",
  "@pane_wait_reason",
  "@pane_current_tool",
  "@pane_current_tool_use_id",
  "@pane_last_tool",
  "@pane_last_activity_at",
  "@pane_context_used_pct",
  "@pane_last_tool_error",
  "@pane_subagents",
  "@pane_pending_teardown",
  "@pane_main_stopped",
  "@pane_worktree_branch",
  "@pane_worktree_path",
  "@pane_last_edit_file",
  "@pane_current_tool_subject",
  "@pane_last_tool_subject",
] as const satisfies readonly PaneOptionKey[];

export const ALL_PANE_OPTIONS_FOR_OPENCODE = [
  "@pane_agent",
  "@pane_status",
  "@pane_session_id",
  "@pane_started_at",
  "@pane_cwd",
  "@pane_prompt",
  "@pane_wait_reason",
  "@pane_current_tool",
  "@pane_last_tool",
  "@pane_last_activity_at",
] as const satisfies readonly PaneOptionKey[];

// Keys that belong to claude only. codex resume path uses
// `unsetOps(CLAUDE_ONLY_KEYS)` to drop stale claude-attributed pane state
// when the same pane is reused for a codex session.
export const CLAUDE_ONLY_KEYS = [
  "@pane_subagents",
  "@pane_pending_teardown",
  "@pane_main_stopped",
  "@pane_worktree_branch",
  "@pane_worktree_path",
] as const satisfies readonly PaneOptionKey[];

// --- Length constants ---

export const PROMPT_MAX_CHARS = 40;
export const TOOL_SUBJECT_MAX_CHARS = 24;
export const TOOL_ERROR_MAX_CHARS = 40;

// --- Pure formatters ---

// Strip C0/C1 control bytes (ESC/NUL/BEL/TAB/CR/LF/...) and slice to `max`
// chars. Defaults to `…` (U+2026) ellipsis to match claude/opencode; codex
// historically used `...` (3 ASCII dots) — pass ellipsis explicitly to
// preserve that.
//
// `replace(/[\x00-\x1f\x7f]+/g, " ")` collapses runs of controls into a
// single space. This differs from a per-char replace (codex's prior
// `stripControls`) which would emit one space per control. For non-
// adversarial inputs (no embedded NUL/ESC sequences) the two are
// indistinguishable; codex's prior behavior on adversarial inputs converges
// to claude/opencode shape after migration. Documented as an intentional
// behavior unification — see plan Phase B.
// deno-lint-ignore no-control-regex
const CONTROL_RUN_RE = /[\x00-\x1f\x7f]+/g;

export function truncate(raw: string, max: number, ellipsis = "…"): string {
  const clean = raw.replace(CONTROL_RUN_RE, " ");
  return clean.length > max ? clean.slice(0, max) + ellipsis : clean;
}

// Sanitize + truncate a free-form prompt for safe rendering inside
// tmux-list-panes -F output. Strips control bytes, collapses internal runs
// of whitespace into a single space, trims, then slices to PROMPT_MAX_CHARS
// (override via opts.max). Threat model: a crafted prompt containing e.g.
// $'\x1b[2J' could otherwise clear the picker user's screen when tmux
// renders the option value.
export function maskPrompt(
  raw: unknown,
  opts: { max?: number; ellipsis?: string } = {},
): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  const max = opts.max ?? PROMPT_MAX_CHARS;
  const ellipsis = opts.ellipsis ?? "…";
  const flat = raw.replace(CONTROL_RUN_RE, " ").replace(/ {2,}/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max) + ellipsis;
}

// Format a tool error string for @pane_last_tool_error. Mirrors claude's
// extractToolError logic without the response-shape branching — callers
// pass an already-extracted string.
export function formatToolError(
  message: string,
  opts: { max?: number; ellipsis?: string } = {},
): string {
  const max = opts.max ?? TOOL_ERROR_MAX_CHARS;
  const ellipsis = opts.ellipsis ?? "…";
  const stripped = message.replace(/^Error:\s*/, "");
  return truncate(stripped, max, ellipsis);
}

// --- Transition builders (composable Op[] producers) ---

// `unsetOps(keys)` is the building block for full teardown / partial drain
// patterns (e.g. unsetOps(ALL_PANE_OPTIONS_FOR_CLAUDE) on SessionEnd).
export function unsetOps(keys: readonly string[]): Op[] {
  return keys.map((key) => ({ kind: "unset" as const, key }));
}

export interface SessionStartArgs {
  agent: string;
  sessionId: string;
  startedAt: string; // unix seconds as string
  cwd?: string;
}

// Common SessionStart core: writes agent / session_id / status=idle /
// started_at / last_activity_at, plus cwd when provided. Agent-specific
// stale-state cleanup (claude STALE_AT_SESSION_START, codex resume-path
// CLAUDE_ONLY_KEYS / RESUME_TRANSIENT_KEYS unsets) stays in the writer.
// last_activity_at is seeded equal to started_at — every current writer's
// SessionStart path does this; the override knob was speculative.
export function sessionStartOps(args: SessionStartArgs): Op[] {
  const ops: Op[] = [
    { kind: "set", key: "@pane_agent", value: args.agent },
    { kind: "set", key: "@pane_session_id", value: args.sessionId },
    { kind: "set", key: "@pane_status", value: "idle" },
    { kind: "set", key: "@pane_started_at", value: args.startedAt },
    { kind: "set", key: "@pane_last_activity_at", value: args.startedAt },
  ];
  if (args.cwd) {
    ops.push({ kind: "set", key: "@pane_cwd", value: args.cwd });
  }
  return ops;
}

export interface PromptArgs {
  prompt: string; // pre-masked (caller calls maskPrompt)
  nowSec: string;
}

// UserPromptSubmit / chat.message common core: status=running, started_at,
// last_activity_at, and prompt set/unset. Caller adds agent-specific Op
// (e.g. claude's `unset @pane_main_stopped`) separately.
export function promptOps(args: PromptArgs): Op[] {
  const ops: Op[] = [
    { kind: "set", key: "@pane_status", value: "running" },
    { kind: "set", key: "@pane_started_at", value: args.nowSec },
    { kind: "set", key: "@pane_last_activity_at", value: args.nowSec },
  ];
  if (args.prompt) {
    ops.push({ kind: "set", key: "@pane_prompt", value: args.prompt });
  } else {
    ops.push({ kind: "unset", key: "@pane_prompt" });
  }
  return ops;
}

export interface ToolStartArgs {
  tool: string;
  subject?: string;
}

// PreToolUse / tool.execute.before common core: set @pane_current_tool,
// and set/unset @pane_current_tool_subject. Codex adds
// @pane_current_tool_use_id at the call site.
export function toolStartOps(args: ToolStartArgs): Op[] {
  const ops: Op[] = [
    { kind: "set", key: "@pane_current_tool", value: args.tool },
  ];
  if (args.subject) {
    ops.push({
      kind: "set",
      key: "@pane_current_tool_subject",
      value: args.subject,
    });
  } else {
    ops.push({ kind: "unset", key: "@pane_current_tool_subject" });
  }
  return ops;
}

export interface ToolFinishArgs {
  tool: string;
  subject?: string;
  error?: string;
  nowSec: string;
}

// PostToolUse / tool.execute.after common core: bump last_activity_at,
// promote current_tool→last_tool, propagate subject, set/unset error.
// opencode's variant guards `current_tool` clearing on tool match — that
// guard stays in the opencode-local call site.
export function toolFinishOps(args: ToolFinishArgs): Op[] {
  const ops: Op[] = [
    { kind: "set", key: "@pane_last_activity_at", value: args.nowSec },
    { kind: "unset", key: "@pane_current_tool" },
    { kind: "set", key: "@pane_last_tool", value: args.tool },
  ];
  if (args.subject) {
    ops.push({
      kind: "set",
      key: "@pane_last_tool_subject",
      value: args.subject,
    });
  } else {
    ops.push({ kind: "unset", key: "@pane_last_tool_subject" });
  }
  if (args.error) {
    ops.push({
      kind: "set",
      key: "@pane_last_tool_error",
      value: args.error,
    });
  } else {
    ops.push({ kind: "unset", key: "@pane_last_tool_error" });
  }
  return ops;
}
