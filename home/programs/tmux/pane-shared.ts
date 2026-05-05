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
//
// Builders are sized to the actual common-core observed in claude / codex /
// opencode eventToOps output (the Phase B.1 fixtures define the exact byte
// shape each builder must reproduce). selfHealOps stays per-writer (agent-
// name string is the only diff). PostToolUse-style "finish" ops are NOT
// shared because the agent-specific orderings diverge: codex inserts
// @pane_current_tool_use_id between current_tool and current_tool_subject,
// and orders @pane_last_edit_file BEFORE @pane_last_tool_error, while claude
// orders them in the opposite direction. A single builder that encodes both
// orderings is more parameter overhead than savings; each writer composes
// PostToolUse locally.

// `unsetOps(keys)` is the building block for full teardown / partial drain
// patterns (e.g. `unsetOps(ALL_PANE_OPTIONS_FOR_CLAUDE)` on SessionEnd or
// `unsetOps(STALE_AT_SESSION_START)` on SessionStart).
export function unsetOps(keys: readonly string[]): Op[] {
  return keys.map((key) => ({ kind: "unset" as const, key }));
}

export interface SessionStartBodyArgs {
  staleKeys: readonly string[]; // writer-specific: STALE_AT_SESSION_START
  nowSec: string;
}

// SessionStart common body (without selfHealOps prefix): unsets the writer's
// stale-key list, then sets @pane_status=idle and seeds @pane_last_activity_at.
// claude/codex SessionStart matches this shape exactly; opencode's
// session.created uses promptStartTrio + status="idle" instead.
export function sessionStartBody(args: SessionStartBodyArgs): Op[] {
  return [
    ...unsetOps(args.staleKeys),
    { kind: "set", key: "@pane_status", value: "idle" },
    { kind: "set", key: "@pane_last_activity_at", value: args.nowSec },
  ];
}

export interface PromptStartTrioArgs {
  nowSec: string;
}

// UserPromptSubmit / chat.message common ts trio: status=running +
// started_at + last_activity_at. Caller adds prompt set/unset and any
// agent-specific extras (e.g. claude's `unset @pane_main_stopped`) AFTER
// the trio, in the order the writer's existing fixture asserts.
export function promptStartTrio(args: PromptStartTrioArgs): Op[] {
  return [
    { kind: "set", key: "@pane_status", value: "running" },
    { kind: "set", key: "@pane_started_at", value: args.nowSec },
    { kind: "set", key: "@pane_last_activity_at", value: args.nowSec },
  ];
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
