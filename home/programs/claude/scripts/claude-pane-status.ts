#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

// Bridges Claude Code hook events → tmux pane options (SSOT for Agentower).
// Invoked as: claude-pane-status.ts <EventName>   (unknown events → no-op exit 0)
//
// Observability: every invocation appends one JSONL record to
// $HOME/.claude/logs/claude-pane-status.log so invisible-in-Agentower cases can be
// diagnosed after the fact (which event fired, early-exit reason, tmux set
// results per op). Log I/O errors are swallowed — hook must never break the
// session when the log destination is unavailable.

import { spawn } from "node:child_process";
import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { constants } from "node:os";
import { text } from "node:stream/consumers";
import { run } from "../../agents/lib/proc.ts";
import {
  isEmbedded,
  parsePsLine,
  type PsRow,
} from "../../tmux/shared/agent-presence.ts";
import {
  ALL_PANE_OPTIONS_FOR_CLAUDE,
  formatToolError,
  maskPrompt,
  type Op,
  type PaneOptionKey,
  PROMPT_MAX_CHARS,
  promptStartTrio,
  SESSION_ID_RE,
  sessionStartBody,
  TOOL_SUBJECT_MAX_CHARS,
  toolStartOps,
  truncate,
  unsetOps,
} from "../../tmux/shared/pane-shared.ts";

// --- Types ---

type HookData = Record<string, unknown> & {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  // Notification: discriminator per official schema (no `message` field).
  notification_type?: string;
  // StopFailure: discriminator per official schema (no `message` field).
  error_type?: string;
};

export interface PaneState {
  subagents: string; // pipe-sep "Type:id|Type:id" list; "" = none
  pendingTeardown: boolean;
  currentTool: string;
  status: string;
  // true when the main agent has already Stop'd but subagents were still
  // running at that moment. Consumed by SubagentStop to transition status to
  // idle once the last subagent drains; cleared by UserPromptSubmit and
  // SessionStart. Separates main-agent lifecycle from subagent activity so
  // status no longer conflates the two.
  mainStopped: boolean;
  // @pane_wait_reason mirror. status="waiting" alone cannot distinguish
  // user-blocking waits (permission / question / plan review) from an
  // idle_prompt wait — only the latter may be overridden by subagent activity.
  waitReason: string;
  // @pane_last_activity_at mirror (epoch seconds, "" when unset). Freshness
  // input for the subagent liveness heuristic in the idle_prompt branch.
  lastActivityAt: string;
  // @pane_background mirror: what the pane waits for after Stop, "" = nothing.
  background: string;
  // @pane_background_until mirror (epoch seconds), "" = the wait has no cap.
  backgroundUntil: string;
  // @pane_permission_agents mirror: pipe-sep agent ids ("main" for the main
  // thread) whose permission dialog is open, "" = none.
  permissionAgents: string;
}

// --- Constants ---

// Options cleared at SessionStart so stale values from a previous session on the
// same pane do not bleed into the new one. Manually enumerated (claude-shape);
// codex's parallel constant is derived via .filter() — the two shapes diverge
// intentionally so neither moves to pane-shared.ts.
const STALE_AT_SESSION_START = [
  "@pane_started_at",
  "@pane_subagents",
  "@pane_pending_teardown",
  "@pane_worktree_branch",
  "@pane_worktree_path",
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
  "@pane_background",
  "@pane_background_until",
  "@pane_permission_agents",
] as const satisfies readonly PaneOptionKey[];

// Prompts Claude Code submits on its own: a background task reporting back, a
// message from another agent or teammate.
const SELF_RESUME_RE =
  /^\s*<(?:task-notification|agent-message|teammate-message)\b/;

// Tools that pause for user input. PreToolUse for these flips status to
// "waiting" so Agentower no longer shows "run" while the agent is paused.
// PostToolUse's resumeOpsIfStuck handles the waiting→running transition.
// EnterPlanMode is intentionally absent: it declares plan-mode entry; the
// actual approval pause happens at ExitPlanMode.
const WAITING_TOOL_REASONS: Record<string, string> = {
  AskUserQuestion: "question",
  ExitPlanMode: "plan review",
};

// Per-tool subject extractors. Edit/Write/MultiEdit are intentionally absent:
// they fall through to the "unknown tool" default (empty string), which lets
// the existing @pane_last_edit_file + `file` segment continue to render the
// Edit target instead of duplicating it here.
const SUBJECT_EXTRACTORS: Record<
  string,
  (ti: Record<string, unknown>) => string
> = {
  Bash: (ti) => str(ti.command),
  Read: (ti) => str(ti.file_path).split("/").pop() ?? "",
  Grep: (ti) => str(ti.pattern),
  Glob: (ti) => str(ti.pattern),
  WebFetch: (ti) => {
    try {
      return new URL(str(ti.url)).host;
    } catch {
      return "";
    }
  },
  Task: (ti) => {
    const type = str(ti.subagent_type);
    const desc = str(ti.description);
    return type && desc ? `${type}/${desc}` : type || desc;
  },
  Skill: (ti) => str(ti.skill),
};

export function extractToolSubject(
  toolName: string,
  toolInput: unknown,
): string {
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return "";
  }
  const ti = toolInput as Record<string, unknown>;
  const fn = SUBJECT_EXTRACTORS[toolName];
  let result = "";
  if (fn) {
    result = fn(ti);
  } else if (toolName.startsWith("mcp__")) {
    // MCP tool_name: mcp__<server>__<tool> → show "mcp: <server>"
    const parts = toolName.split("__");
    if (parts.length >= 3) result = `mcp: ${parts[1]}`;
  }
  return truncate(result, TOOL_SUBJECT_MAX_CHARS);
}

// Empirically-derived (see plan log.md "Empirical observation"):
// - success: tool_response is a structured object ({stdout,...} / {filePath,...})
// - failure: tool_response is a plain STRING prefixed with "Error: "
// - interrupted Bash (Ctrl+C) can surface as object with interrupted=true
// Fields like is_error / exit_code / error are NOT in the object form — they
// live at the tool_result content-block level, not in tool_response itself.
export function extractToolError(toolResponse: unknown): string {
  if (typeof toolResponse === "string" && toolResponse.length > 0) {
    // formatToolError strips a leading "Error: " prefix and truncates to
    // TOOL_ERROR_MAX_CHARS with the default `…` ellipsis — same shape as the
    // prior inline `truncate(replace(...), TOOL_ERROR_MAX_CHARS)`.
    return formatToolError(toolResponse);
  }
  if (
    toolResponse &&
    typeof toolResponse === "object" &&
    !Array.isArray(toolResponse)
  ) {
    const tr = toolResponse as Record<string, unknown>;
    if (tr.interrupted === true) {
      // No "Error:" prefix to strip on this synthetic value, but routing
      // through formatToolError keeps both branches on the same SSOT helper.
      return formatToolError("interrupted");
    }
  }
  return "";
}

export function formatElapsed(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "-";
  const s = Math.floor(sec);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

// `|` and `:` are reserved by the list encoding, so strip them from caller-
// supplied values to keep the list parsable. Input comes from Claude Code hook
// data, not user free-text, so collision is rare — defensive only.
function sanitizeListToken(raw: string): string {
  return raw.replace(/[|:]/g, "-");
}

// Same ":id" suffix convention as removeSubagent. Matching the full "Type:id"
// entry instead would let SubagentStart and tool-event self-heal register the
// same agent under different types (e.g. "Explore:a1" vs "subagent:a1"), and
// removeSubagent only deletes one entry per id — the leftover would keep
// count() > 0 and Stop deferring forever.
export function hasSubagent(list: string, id: string): boolean {
  if (!list || !id) return false;
  const target = sanitizeListToken(id);
  return list.split("|").some((e) => e.endsWith(`:${target}`));
}

// Append "Type:id" to a pipe-sep list. Returns the new list string.
// Dedupe is id-based (see hasSubagent) so a sequential re-append — a
// named agent re-Started under the same id, or SubagentStart arriving after
// tool-event self-heal already registered the id — cannot double-register.
export function appendSubagent(list: string, type: string, id: string): string {
  if (hasSubagent(list, id)) return list;
  const t = sanitizeListToken(type);
  const i = sanitizeListToken(id);
  const entry = `${t}:${i}`;
  return list ? `${list}|${entry}` : entry;
}

// Remove the first entry matching id from a pipe-sep list.
export function removeSubagent(list: string, id: string): string {
  if (!list) return "";
  const target = sanitizeListToken(id);
  const entries = list.split("|");
  const filtered: string[] = [];
  let removed = false;
  for (const e of entries) {
    if (!removed && e.endsWith(`:${target}`)) {
      removed = true;
      continue;
    }
    filtered.push(e);
  }
  return filtered.join("|");
}

// Count entries in a pipe-sep list. Empty list = 0.
export function count(list: string): number {
  return list ? list.split("|").filter(Boolean).length : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Flip @pane_status back to running when main-agent activity resumes from a
// stuck waiting/error state. Callers must restrict invocation to events that
// are attributable to the main agent:
//   - PreToolUse / PostToolUse / PostToolUseFailure: only when the payload's
//     `agent_id` is absent (subagent-origin events carry it; main-origin
//     events do not — schema-defined discriminator). The previous
//     `state.subagents === ""` gate was over-conservative: it blocked main
//     resume whenever any subagent was alive, even if the current event was
//     unambiguously main.
//   - SubagentStart / SubagentStop and subagent-origin tool events: never —
//     subagent activity cannot be proxied as main-agent resume. Pane-level
//     recovery from idle-like states is subagentActivityStatusOps' job, which
//     deliberately excludes user-blocking waits this helper would clear.
// UserPromptSubmit already sets status directly and does not go through this
// helper. @pane_wait_reason is cleared so row 1 summary stops showing the stale
// reason.
// idle is included in the resume set: teammate agents run as full sibling
// sessions multiplexed onto the same pane, and their tool events are
// main-shaped (no agent_id) with no preceding UserPromptSubmit — a tool event
// arriving at status=idle proves the display is stale. The teammate's own
// Stop (empty list) returns the pane to idle, so this cannot stick at running.
export function resumeOpsIfStuck(state: PaneState): Op[] {
  if (
    state.status !== "waiting" && state.status !== "error" &&
    state.status !== "idle"
  ) return [];
  return [
    { kind: "set", key: "@pane_status", value: "running" },
    { kind: "unset", key: "@pane_wait_reason" },
  ];
}

// Threshold for the idle_prompt liveness check. A subagent inside one tool
// call longer than this looks stale and drops out of the list until its next
// PostToolUse self-heals it (toolStartOps does not bump activity_at). Kept
// under the 60–66 s observed between Stop and idle_prompt: at 120 the main
// agent's own last tool event always looked fresh, and the cleanup never ran.
const SUBAGENT_STALE_SECONDS = 45;

// Observed subagent activity flips the pane back to running only from
// idle-like states. waiting for permission / elicitation / question /
// plan review and error are user-blocking — a busy subagent must not hide
// them, so resumeOpsIfStuck cannot be reused here (it clears any waiting).
export function subagentActivityStatusOps(state: PaneState): Op[] {
  const idleLike = state.status === "idle" ||
    (state.status === "waiting" && state.waitReason === "idle prompt");
  if (!idleLike) return [];
  return [
    { kind: "set", key: "@pane_status", value: "running" },
    { kind: "unset", key: "@pane_wait_reason" },
    // idle-like implies the main agent already stopped. Rebuild the marker so
    // the last SubagentStop's existing drain logic can transition back to
    // idle — without it the pane would stick at running forever.
    { kind: "set", key: "@pane_main_stopped", value: "1" },
  ];
}

// SubagentStart frequently never fires (observed 4 Starts vs 55 Stops in
// production logs), leaving @pane_subagents empty while subagents run — Stop
// then writes idle immediately. Any agent_id-carrying tool event proves the
// subagent is alive, so repair the list from it.
export function subagentSelfHealOps(state: PaneState, data: HookData): Op[] {
  const id = str(data.agent_id);
  const ops: Op[] = [];
  if (!hasSubagent(state.subagents, id)) {
    ops.push({
      kind: "set",
      key: "@pane_subagents",
      value: appendSubagent(
        state.subagents,
        str(data.agent_type) || "subagent",
        id,
      ),
    });
  }
  ops.push(...subagentActivityStatusOps(state));
  return ops;
}

// --- Background wait ---

// A background shell or monitor, as the process table shows it at Stop.
export interface ShellProbe {
  // TCP ports the shell's process tree listens on.
  ports: readonly number[];
  // A headless browser in the tree that does not listen itself: a client the
  // job drives, as Playwright's browsers are for its webServer.
  headlessClient: boolean;
  startedAtSec: number;
}
export interface BackgroundProbe {
  // Keyed by the background task id from the Stop payload.
  shells: ReadonlyMap<string, ShellProbe>;
  // The next fire time (epoch seconds) per cron id, for the schedules that
  // parsed.
  cronNextSec: ReadonlyMap<string, number>;
}
export const NO_PROBE: BackgroundProbe = {
  shells: new Map(),
  cronNextSec: new Map(),
};

// A cron counts when it fires within this long. A shell or monitor has no
// such limit: Claude Code lists it until it ends, and it resumes Claude then.
// A four-hour cap from its start cut real waits (CI runs of 4 to 13 hours, 27
// of 1779 background jobs over 36 days) to guard against a forgotten process
// without a listener, which came up at most twice in that time.
export const CRON_HORIZON_SECONDS = 4 * 3600;

// macOS answers a bind to port 0 from net.inet.ip.portrange.first (49152) up;
// servers started for the user name a port below it.
const EPHEMERAL_PORT_FIRST = 49152;

// A cron fires once Claude is idle and can fire minutes late, so its wait
// outlasts the scheduled time by this much before Agentower gives up on it.
const CRON_GRACE_SECONDS = 15 * 60;

const BACKGROUND_LABELS: Record<string, string> = {
  shell: "shell",
  monitor: "monitor",
  subagent: "agent",
  workflow: "workflow",
  teammate: "teammate",
};
const TERMINAL_TASK_STATUSES = new Set([
  "completed",
  "failed",
  "killed",
  "stopped",
]);

// Publishing an artifact arms a comment watch that the payload lists as a
// monitor with no command, server or tool. It resumes Claude only when the
// user comments, so the pane is waiting for the user, not for work. A ws
// Monitor looks the same and goes with it: only the description text, which
// Claude Code does not promise, would tell the two apart.
function isArtifactWatch(task: Record<string, unknown>): boolean {
  return str(task.type) === "monitor" && !str(task.command) &&
    !str(task.server) && !str(task.tool);
}

// A dev server or preview keeps listening on the port it was given, and
// Claude waits for nobody while it runs. A job that serves itself binds port
// 0 or drives a headless browser, and ends.
function leftForUser(p: ShellProbe): boolean {
  return !p.headlessClient &&
    p.ports.some((port) => port < EPHEMERAL_PORT_FIRST);
}

// A question at the end of the turn wants the user even while work runs on.
function asksUser(message: string): boolean {
  return /[?？][\s*_`」』)）]*$/.test(message);
}

// How one background task or cron was judged at Stop. It goes to the hook log
// as well, without the command text, so a pane in the wrong state can be
// traced from the log alone.
export interface BackgroundDecision {
  id: string;
  kind: string;
  status: string;
  counted: boolean;
  why: string;
  // When this entry stops holding the pane; null = no limit.
  untilSec: number | null;
  ports?: readonly number[];
  headlessClient?: boolean;
  startedAtSec?: number;
}

export function backgroundDecisions(
  data: HookData,
  probe: BackgroundProbe,
  nowSec: number,
): BackgroundDecision[] {
  const tasks = Array.isArray(data.background_tasks)
    ? data.background_tasks
    : [];
  const crons = Array.isArray(data.session_crons) ? data.session_crons : [];
  const out: BackgroundDecision[] = [];
  for (const raw of tasks) {
    if (!raw || typeof raw !== "object") continue;
    const task = raw as Record<string, unknown>;
    const base = {
      id: str(task.id),
      kind: BACKGROUND_LABELS[str(task.type)] ?? "task",
      status: str(task.status),
    };
    const skip = (why: string): BackgroundDecision => ({
      ...base,
      counted: false,
      why,
      untilSec: null,
    });
    if (TERMINAL_TASK_STATUSES.has(base.status)) {
      out.push(skip("finished"));
      continue;
    }
    if (isArtifactWatch(task)) {
      out.push(skip("artifact watch"));
      continue;
    }
    const type = str(task.type);
    if (type !== "shell" && type !== "monitor") {
      out.push({ ...base, counted: true, why: "no limit", untilSec: null });
      continue;
    }
    const p = probe.shells.get(base.id);
    const seen = p
      ? {
        ports: p.ports,
        headlessClient: p.headlessClient,
        startedAtSec: p.startedAtSec,
      }
      : {};
    if (p && leftForUser(p)) {
      out.push({ ...skip("server"), ...seen });
    } else {
      out.push({
        ...base,
        ...seen,
        counted: true,
        why: p ? "job" : "not in the process table",
        untilSec: null,
      });
    }
  }
  for (const raw of crons) {
    const cron = raw && typeof raw === "object"
      ? raw as Record<string, unknown>
      : {};
    const id = str(cron.id);
    const base = { id, kind: "cron", status: "" };
    const next = probe.cronNextSec.get(id);
    if (next === undefined) {
      out.push({
        ...base,
        counted: true,
        why: "schedule not parsed",
        untilSec: nowSec + CRON_HORIZON_SECONDS,
      });
    } else if (next > nowSec + CRON_HORIZON_SECONDS) {
      out.push({ ...base, counted: false, why: "fires later", untilSec: null });
    } else {
      out.push({
        ...base,
        counted: true,
        why: "fires soon",
        untilSec: next + CRON_GRACE_SECONDS,
      });
    }
  }
  return out;
}

// What the pane waits for after Stop, or null when Claude waits for nobody
// but the user. `untilSec` is when the last counted entry with a limit runs
// out; null when an entry without one (an agent) is counted.
export function backgroundWait(
  data: HookData,
  probe: BackgroundProbe,
  nowSec: number,
): { summary: string; untilSec: number | null } | null {
  const counted = backgroundDecisions(data, probe, nowSec).filter((d) =>
    d.counted
  );
  if (counted.length === 0) return null;
  const counts = new Map<string, number>();
  for (const d of counted) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
  const limits = counted.map((d) => d.untilSec);
  return {
    summary: [...counts].map(([label, n]) => `${label} ${n}`).join(" · "),
    untilSec: limits.includes(null) ? null : Math.max(...limits as number[]),
  };
}

export function inBackgroundWait(state: PaneState): boolean {
  return state.status === "running" && state.background !== "";
}

// SubagentStop carries the session's background_tasks too, so the summary
// follows shells a subagent started after the main Stop. When nothing is
// left, the main agent is about to be notified, and the wait stays until it
// resumes.
function refreshBackgroundOps(
  data: HookData,
  state: PaneState,
  probe: BackgroundProbe,
  nowSec: number,
): Op[] {
  if (!inBackgroundWait(state)) return [];
  const wait = backgroundWait(data, probe, nowSec);
  if (!wait) return [];
  return [
    { kind: "set", key: "@pane_background", value: wait.summary },
    wait.untilSec === null
      ? { kind: "unset", key: "@pane_background_until" }
      : {
        kind: "set",
        key: "@pane_background_until",
        value: String(wait.untilSec),
      },
  ];
}

// Re-assert the pane belongs to a live Claude session. Called at the head of
// every event except drain paths. session_id-guarded so non-Claude events
// (e.g. stray CwdChanged without a session) never create phantom Claude panes.
export function selfHealOps(data: HookData): Op[] {
  const sid = str(data.session_id);
  if (!sid) return [];
  // Defense-in-depth: drop the entire event if session_id is outside the
  // SESSION_ID_RE allowlist (path-traversal class). Agentower re-validates the
  // same regex at its boundary, so this hard-fails malformed events at the
  // writer too rather than relying on a single consumer.
  if (!SESSION_ID_RE.test(sid)) return [];
  const ops: Op[] = [
    { kind: "set", key: "@pane_agent", value: "claude" },
    { kind: "set", key: "@pane_session_id", value: sid },
  ];
  const cwd = str(data.cwd);
  if (cwd) ops.push({ kind: "set", key: "@pane_cwd", value: cwd });
  return ops;
}

// --- Permission wait ---

// Notification(permission_prompt) carries no agent_id, but PermissionRequest
// does, so the dialogs still open are tracked per agent. A subagent's dialog
// stays open while the main thread starts and ends turns of its own.
const MAIN_PERMISSION_KEY = "main";

function permissionKey(data: HookData): string {
  return sanitizeListToken(str(data.agent_id)) || MAIN_PERMISSION_KEY;
}

function withoutPermissionKey(list: string, key: string): string {
  return list.split("|").filter((k) => k && k !== key).join("|");
}

// What closes a dialog: the agent's tool finishing (allowed), its next tool
// call (denied with "No", which fires no tool event of its own), an auto-mode
// denial, or the subagent ending (Escape stops it). The main thread's turn
// starting or ending closes its own. A Stop that leaves the pane idle means
// no agent is alive to hold one. PermissionRequest has no tool_use_id, so two
// dialogs of one agent count as one.
export function nextPermissionAgents(
  event: string,
  data: HookData,
  state: PaneState,
  ops: Op[],
): string {
  const list = state.permissionAgents;
  switch (event) {
    case "PermissionRequest": {
      const key = permissionKey(data);
      return list.split("|").includes(key)
        ? list
        : list
        ? `${list}|${key}`
        : key;
    }
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
    case "PermissionDenied":
      return withoutPermissionKey(list, permissionKey(data));
    case "SubagentStop":
      return withoutPermissionKey(list, sanitizeListToken(str(data.agent_id)));
    case "UserPromptSubmit":
      return withoutPermissionKey(list, MAIN_PERMISSION_KEY);
    case "Stop":
      return ops.some((o) =>
          o.kind === "set" && o.key === "@pane_status" && o.value === "idle"
        )
        ? ""
        : withoutPermissionKey(list, MAIN_PERMISSION_KEY);
    case "SessionStart":
      return str(data.source) === "compact" ? list : "";
    default:
      return list;
  }
}

// While a dialog is open nothing else an event writes proves it closed, so
// the writes that would show the pane running are held back; a wait the event
// starts itself (a question, an error) still shows. Once the last dialog
// closes and the event writes no status, the pane runs again.
export function permissionWaitOps(
  event: string,
  data: HookData,
  state: PaneState,
  ops: Op[],
): Op[] {
  if (ops.some((o) => o.kind === "unset" && o.key === "@pane_agent")) {
    return ops;
  }
  // The notification repeats a dialog PermissionRequest already recorded;
  // overwriting another open wait with it would let the dialog's close end
  // that wait too. With none showing it still restores the wait, which a
  // concurrent Stop may have overwritten. An idle prompt says nothing while
  // a dialog waits for the user.
  if (
    event === "Notification" &&
    str(data.notification_type) === "idle_prompt" &&
    state.permissionAgents !== ""
  ) return [];
  if (
    event === "Notification" &&
    str(data.notification_type) === "permission_prompt" &&
    state.permissionAgents !== "" &&
    (state.status === "error" ||
      (state.status === "waiting" && state.waitReason !== "permission"))
  ) {
    return ops.filter((o) =>
      o.key !== "@pane_status" && o.key !== "@pane_wait_reason"
    );
  }
  const before = state.permissionAgents;
  const after = nextPermissionAgents(event, data, state, ops);
  const touchesList = ops.some((o) => o.key === "@pane_permission_agents");
  const listOps: Op[] = after === before || touchesList
    ? []
    : after
    ? [{ kind: "set", key: "@pane_permission_agents", value: after }]
    : [{ kind: "unset", key: "@pane_permission_agents" }];
  if (after) {
    const kept = ops.filter((o) =>
      !(o.key === "@pane_status" &&
        (o.kind === "unset" || o.value === "running" || o.value === "idle")) &&
      !(o.key === "@pane_wait_reason" && o.kind === "unset")
    );
    const ownWait = kept.some((o) => o.key === "@pane_status");
    const released = kept.length !== ops.length;
    const showsWait = state.status === "waiting" || state.status === "error";
    const showsPermission = state.status === "waiting" &&
      state.waitReason === "permission";
    const show = !ownWait && !showsPermission && (released || !showsWait);
    return [
      ...kept,
      ...listOps,
      ...(show
        ? [
          { kind: "set", key: "@pane_status", value: "waiting" } as const,
          {
            kind: "set",
            key: "@pane_wait_reason",
            value: "permission",
          } as const,
        ]
        : []),
    ];
  }
  const resume = before !== "" && state.status === "waiting" &&
    state.waitReason === "permission" &&
    !ops.some((o) => o.key === "@pane_status");
  return [
    ...ops,
    ...listOps,
    ...(resume
      ? [
        { kind: "set", key: "@pane_status", value: "running" } as const,
        { kind: "unset", key: "@pane_wait_reason" } as const,
      ]
      : []),
  ];
}

// --- Event → Op mapping (pure, exported for tests) ---

export function eventToOps(
  rawEvent: string,
  data: HookData,
  state: PaneState,
  probe: BackgroundProbe = NO_PROBE,
): Op[] {
  const ops = statusEventOps(rawEvent, data, state, probe);
  // The handback ends the subagent like SubagentStop does.
  const event = rawEvent === "PostToolUse" && str(data.agent_id) &&
      str(data.tool_name) === "SubagentHandback"
    ? "SubagentStop"
    : rawEvent;
  return permissionWaitOps(event, data, state, ops);
}

function statusEventOps(
  rawEvent: string,
  data: HookData,
  state: PaneState,
  probe: BackgroundProbe = NO_PROBE,
): Op[] {
  // Every subagent ends with a SubagentHandback call, but web-fetch fires no
  // SubagentStop: waiting for SubagentStop alone left its self-healed entry
  // in the list for good, and every later Stop deferred on it.
  const event = rawEvent === "PostToolUse" && str(data.agent_id) &&
      str(data.tool_name) === "SubagentHandback"
    ? "SubagentStop"
    : rawEvent;
  // SubagentStop also follows the handback for most agent types. The entry is
  // gone by then, and running the body would self-heal @pane_agent back onto
  // a pane the handback already tore down.
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    event === "SubagentStop" &&
    !hasSubagent(state.subagents, str(data.agent_id))
  ) {
    return refreshBackgroundOps(data, state, probe, nowSec);
  }
  // Drain paths: full teardown. Short-circuit before self-heal so the teardown
  // is not followed by self-heal reinstating @pane_agent.
  if (event === "SessionEnd" && count(state.subagents) === 0) {
    return unsetOps(ALL_PANE_OPTIONS_FOR_CLAUDE);
  }
  if (
    event === "SubagentStop" &&
    count(removeSubagent(state.subagents, str(data.agent_id))) === 0 &&
    state.pendingTeardown
  ) {
    return unsetOps(ALL_PANE_OPTIONS_FOR_CLAUDE);
  }

  const body: Op[] = (() => {
    switch (event) {
      case "SessionStart": {
        // Compaction keeps the session and its turn or background wait going.
        if (str(data.source) === "compact") return [];
        // agent / session_id / cwd are set by selfHealOps below.
        // sessionStartBody = unsetOps(STALE) + status=idle + last_activity_at=now.
        // Seed activity_at so a fresh session shows `idle Ns` in Agentower's row 2
        // from the moment it starts (otherwise brand-new idle panes display nothing).
        return sessionStartBody({
          staleKeys: STALE_AT_SESSION_START,
          nowSec: String(Math.floor(Date.now() / 1000)),
        });
      }

      case "SessionEnd": {
        // drain case (count === 0) handled above
        return [{ kind: "set", key: "@pane_pending_teardown", value: "1" }];
      }

      case "UserPromptSubmit": {
        const now = String(Math.floor(Date.now() / 1000));
        const endWait: Op[] = [
          { kind: "unset", key: "@pane_background" },
          { kind: "unset", key: "@pane_background_until" },
        ];
        // A finished background task or another agent's message resumes the
        // turn through this event too; the row keeps the user's own prompt
        // and the time it was sent.
        if (SELF_RESUME_RE.test(str(data.prompt))) {
          return [
            { kind: "set", key: "@pane_status", value: "running" },
            { kind: "set", key: "@pane_last_activity_at", value: now },
            { kind: "unset", key: "@pane_main_stopped" },
            ...endWait,
          ];
        }
        const prompt = maskPrompt(data.prompt);
        const ops: Op[] = [
          ...endWait,
          ...promptStartTrio({ nowSec: now }),
          // New main invocation — clear any pending main-stopped marker so
          // the next SubagentStop does not spuriously flip us to idle.
          { kind: "unset", key: "@pane_main_stopped" },
        ];
        if (prompt) {
          ops.push({ kind: "set", key: "@pane_prompt", value: prompt });
        } else ops.push({ kind: "unset", key: "@pane_prompt" });
        return ops;
      }

      case "Stop": {
        const wait = backgroundWait(data, probe, nowSec);
        const endWait: Op[] = [
          { kind: "unset", key: "@pane_background" },
          { kind: "unset", key: "@pane_background_until" },
        ];
        // Work left running does not answer the question. The reason is one
        // subagent activity cannot turn back to running, and no main_stopped
        // marker lets the last SubagentStop drop it to idle.
        if (
          asksUser(str(data.last_assistant_message)) &&
          (wait || count(state.subagents) > 0)
        ) {
          return [
            { kind: "set", key: "@pane_status", value: "waiting" },
            { kind: "set", key: "@pane_wait_reason", value: "question" },
            { kind: "unset", key: "@pane_main_stopped" },
            ...endWait,
          ];
        }
        if (wait) {
          // Claude resumes on its own when this work reports, so the pane is
          // still running. main_stopped stays unset: a SubagentStop draining
          // the list must not flip the pane to idle while shells still run.
          return [
            { kind: "set", key: "@pane_status", value: "running" },
            { kind: "unset", key: "@pane_wait_reason" },
            { kind: "unset", key: "@pane_main_stopped" },
            { kind: "set", key: "@pane_background", value: wait.summary },
            wait.untilSec === null
              ? { kind: "unset", key: "@pane_background_until" }
              : {
                kind: "set",
                key: "@pane_background_until",
                value: String(wait.untilSec),
              },
          ];
        }
        if (count(state.subagents) > 0) {
          // Main stopped but subagents are still running. Status must stay
          // `running` so the pane does not falsely report idle. Mark
          // main_stopped=1 so the last SubagentStop can transition to idle.
          return [
            { kind: "set", key: "@pane_main_stopped", value: "1" },
            ...endWait,
          ];
        }
        return [
          ...endWait,
          { kind: "set", key: "@pane_status", value: "idle" },
          // Defensive: in the normal running→Stop path main_stopped is already
          // unset, but explicitly unset so a stale `1` from an earlier race
          // never survives into the next session.
          { kind: "unset", key: "@pane_main_stopped" },
        ];
      }

      case "StopFailure": {
        // Schema: error_type enum (rate_limit | authentication_failed |
        // billing_error | invalid_request | server_error | max_output_tokens |
        // unknown). Older code read `data.message` which the schema does not
        // provide — wait_reason silently degraded to the default "error".
        const errorType = str(data.error_type);
        const reason = errorType || "error";
        return [
          { kind: "set", key: "@pane_status", value: "error" },
          { kind: "set", key: "@pane_wait_reason", value: reason },
        ];
      }

      case "Notification": {
        // Schema: notification_type discriminator. No `message` / `title`
        // fields. Branches:
        //   permission_prompt   → waiting / "permission"
        //   idle_prompt         → waiting / "idle prompt", but deferred while
        //                          subagents are alive (see branch body)
        //   elicitation_dialog  → waiting / "elicitation"
        //   elicitation_complete | elicitation_response → unset wait_reason
        //                          (status preserved; resume is the next
        //                          PreToolUse / Stop's job)
        //   auth_success        → no-op (must not flip status to waiting)
        //   unknown / absent    → no-op
        // permission_prompt / elicitation_dialog stay unconditional: they
        // block on user input, so a busy subagent must not suppress them.
        const nt = str(data.notification_type);
        switch (nt) {
          case "permission_prompt":
            return [
              { kind: "set", key: "@pane_status", value: "waiting" },
              { kind: "set", key: "@pane_wait_reason", value: "permission" },
            ];
          case "idle_prompt": {
            // The notification comes once, about 60 s after Stop. While the
            // pane waits for background work it must not read as waiting.
            if (state.background && state.status === "running") return [];
            // A question asked while work runs is still unanswered.
            if (state.status === "waiting" && state.waitReason === "question") {
              return [];
            }
            if (count(state.subagents) === 0) {
              return [
                { kind: "set", key: "@pane_status", value: "waiting" },
                { kind: "set", key: "@pane_wait_reason", value: "idle prompt" },
              ];
            }
            // Subagents alive: the main agent being idle does not make the
            // pane idle — defer, like Stop does. But an entry whose
            // SubagentStop never fired would defer forever, and the old
            // unconditional overwrite was the accidental recovery path for
            // exactly that leak. Keep the recovery: no recent activity means
            // the list is a ghost — discard it and fall through to waiting.
            const last = Number(state.lastActivityAt);
            const fresh = Number.isFinite(last) && last > 0 &&
              nowSec - last < SUBAGENT_STALE_SECONDS;
            if (fresh) return [];
            return [
              { kind: "unset", key: "@pane_subagents" },
              { kind: "unset", key: "@pane_main_stopped" },
              { kind: "set", key: "@pane_status", value: "waiting" },
              { kind: "set", key: "@pane_wait_reason", value: "idle prompt" },
            ];
          }
          case "elicitation_dialog":
            return [
              { kind: "set", key: "@pane_status", value: "waiting" },
              { kind: "set", key: "@pane_wait_reason", value: "elicitation" },
            ];
          case "elicitation_complete":
          case "elicitation_response":
            return [{ kind: "unset", key: "@pane_wait_reason" }];
          default:
            return [];
        }
      }

      case "PermissionDenied": {
        // An auto-mode denial goes back to the agent, which carries on. The
        // main agent's next tool call clears the wait; a subagent's never
        // does while the main agent waits on it.
        if (str(data.agent_id)) return [];
        return [
          { kind: "set", key: "@pane_status", value: "waiting" },
          {
            kind: "set",
            key: "@pane_wait_reason",
            value: "permission-denied",
          },
        ];
      }

      case "CwdChanged": {
        const cwd = str(data.cwd);
        return cwd ? [{ kind: "set", key: "@pane_cwd", value: cwd }] : [];
      }

      case "PreToolUse": {
        const toolName = str(data.tool_name);
        if (!toolName) return [];
        const subject = extractToolSubject(toolName, data.tool_input);
        // Resume only when this event is main-attributable. Schema: payload
        // carries `agent_id` only for subagent-origin tool events; main-origin
        // events have no `agent_id`. Replaces the older `state.subagents===""`
        // gate which over-blocked main resume whenever any subagent was alive.
        const isMain = !str(data.agent_id);
        // Tools in WAITING_TOOL_REASONS pause the agent for user input
        // (AskUserQuestion, ExitPlanMode). Flip status to waiting immediately
        // instead of waiting for a delayed Notification(elicitation_dialog).
        // Subagents cannot invoke these tools in normal flow; guard with
        // isMain so a stray subagent-origin event cannot mis-flip waiting.
        const waitReason = isMain ? WAITING_TOOL_REASONS[toolName] : undefined;
        if (waitReason) {
          return [
            { kind: "set", key: "@pane_status", value: "waiting" },
            { kind: "set", key: "@pane_wait_reason", value: waitReason },
            ...toolStartOps({ tool: toolName, subject: subject || undefined }),
          ];
        }
        // Subagent-origin Pre also bumps activity_at (toolStartOps does not):
        // without it a single long-running subagent tool call looks stale to
        // the idle_prompt liveness check for its entire duration.
        const statusOps: Op[] = isMain ? resumeOpsIfStuck(state) : [
          ...subagentSelfHealOps(state, data),
          {
            kind: "set",
            key: "@pane_last_activity_at",
            value: String(Math.floor(Date.now() / 1000)),
          },
        ];
        return [
          ...statusOps,
          ...toolStartOps({ tool: toolName, subject: subject || undefined }),
        ];
      }

      case "PostToolUse": {
        // Move @pane_current_tool → @pane_last_tool so row 2 always shows either
        // an in-flight tool or the most recently completed one.
        //
        // Concurrent-tool handling: @pane_current_tool is last-wins on PreToolUse,
        // so under parallel invocations it holds whichever tool's Pre fired most
        // recently. Only unset current_tool when payload tool_name matches the
        // recorded value — otherwise a different tool is still running and its
        // display must not be cleared.
        //
        // Degraded client (missing tool_name): update activity_at only, leave
        // last_tool / last_edit_file / current_tool untouched. Attributing the
        // completion by guessing (via state.currentTool) would mis-label which
        // tool actually finished when the client runs parallel tools.
        //
        // last_edit_file freshness: always clear or set on every PostToolUse
        // where tool_name is present, so row 2 never carries a stale basename
        // into a non-edit tool's display.
        const toolName = str(data.tool_name);
        const now = String(Math.floor(Date.now() / 1000));
        // Resume only when main-attributable — matches PreToolUse policy.
        const isMain = !str(data.agent_id);
        const statusOps = isMain
          ? resumeOpsIfStuck(state)
          : subagentSelfHealOps(state, data);
        const ops: Op[] = [
          ...statusOps,
          { kind: "set", key: "@pane_last_activity_at", value: now },
        ];
        if (!toolName) return ops;
        if (toolName === state.currentTool) {
          ops.push({ kind: "unset", key: "@pane_current_tool" });
          ops.push({ kind: "unset", key: "@pane_current_tool_subject" });
        }
        ops.push({ kind: "set", key: "@pane_last_tool", value: toolName });

        // Subject: Edit-family returns "" so last_tool_subject is unset and the
        // existing @pane_last_edit_file + `file` segment continues to show
        // the target path. Other tools get their subject from tool_input.
        const lastSubject = extractToolSubject(toolName, data.tool_input);
        if (lastSubject) {
          ops.push({
            kind: "set",
            key: "@pane_last_tool_subject",
            value: lastSubject,
          });
        } else {
          ops.push({ kind: "unset", key: "@pane_last_tool_subject" });
        }

        // Error: string-shape tool_response signals failure ("Error: ..." prefix).
        // Success responses are objects with no dedicated error field.
        const errorText = extractToolError(data.tool_response);
        if (errorText) {
          ops.push({
            kind: "set",
            key: "@pane_last_tool_error",
            value: errorText,
          });
        } else {
          ops.push({ kind: "unset", key: "@pane_last_tool_error" });
        }

        if (
          toolName === "Edit" || toolName === "Write" ||
          toolName === "MultiEdit"
        ) {
          let filePath = "";
          const ti = data.tool_input;
          if (ti && typeof ti === "object" && !Array.isArray(ti)) {
            const fp = (ti as Record<string, unknown>).file_path;
            if (typeof fp === "string" && fp.length > 0) {
              // Strip C0/C1 control bytes to keep the value safe for tmux
              // list-panes -F output (NL would split the row, TAB could
              // collide with delimiter formats, ESC could inject terminal
              // escapes when Agentower renders). Agentower applies basename().
              filePath = fp.replace(/[\x00-\x1f\x7f]/g, " ");
            }
          }
          if (filePath) {
            ops.push({
              kind: "set",
              key: "@pane_last_edit_file",
              value: filePath,
            });
          } else {
            ops.push({ kind: "unset", key: "@pane_last_edit_file" });
          }
        } else {
          // Non-edit tool finished — clear any stale basename so row 2 does
          // not show misleading file metadata next to an unrelated tool.
          ops.push({ kind: "unset", key: "@pane_last_edit_file" });
        }
        return ops;
      }

      case "PostToolUseFailure": {
        // Schema: tool_name + tool_input + error (string) + tool_use_id +
        //         optional agent_id/agent_type. Fires for tool failures.
        // Whether this fires INSTEAD of PostToolUse or alongside it is not
        // documented. The handler is intentionally idempotent against
        // PostToolUse: same set ops (last_tool / last_tool_error /
        // last_activity_at / unset current_tool*) so the order/duplication
        // does not matter for correctness — last write wins.
        const toolName = str(data.tool_name);
        const now = String(Math.floor(Date.now() / 1000));
        const isMain = !str(data.agent_id);
        const statusOps = isMain
          ? resumeOpsIfStuck(state)
          : subagentSelfHealOps(state, data);
        const ops: Op[] = [
          ...statusOps,
          { kind: "set", key: "@pane_last_activity_at", value: now },
        ];
        if (!toolName) return ops;
        // Mirror PostToolUse current_tool clearing: only unset when the
        // failed tool name matches the recorded current. With concurrent
        // tools, an unrelated tool may still be in-flight.
        if (toolName === state.currentTool) {
          ops.push({ kind: "unset", key: "@pane_current_tool" });
          ops.push({ kind: "unset", key: "@pane_current_tool_subject" });
        }
        ops.push({ kind: "set", key: "@pane_last_tool", value: toolName });
        const lastSubject = extractToolSubject(toolName, data.tool_input);
        if (lastSubject) {
          ops.push({
            kind: "set",
            key: "@pane_last_tool_subject",
            value: lastSubject,
          });
        } else {
          ops.push({ kind: "unset", key: "@pane_last_tool_subject" });
        }
        // PostToolUseFailure carries `error` as a raw string; formatToolError
        // is a no-op on the prefix strip when no "Error: " prefix is present
        // and yields the same truncated form as the prior inline call.
        const errorText = formatToolError(str(data.error));
        if (errorText) {
          ops.push({
            kind: "set",
            key: "@pane_last_tool_error",
            value: errorText,
          });
        } else {
          ops.push({ kind: "unset", key: "@pane_last_tool_error" });
        }
        return ops;
      }

      case "SubagentStart": {
        // Hook stdin field names (verified via /tmp/claude-pane-hook.log dump):
        // `agent_id` (snake_case) and `agent_type` — NOT `subagent_*`.
        // No main-agent resume here — but a subagent starting while the pane
        // sits at idle (or idle-prompt waiting) is pane-level activity, so
        // recover via subagentActivityStatusOps. A permission wait survives.
        const type = str(data.agent_type) || "subagent";
        const id = str(data.agent_id) ||
          crypto.randomUUID().slice(0, 8);
        const next = appendSubagent(state.subagents, type, id);
        return [
          ...subagentActivityStatusOps(state),
          { kind: "set", key: "@pane_subagents", value: next },
        ];
      }

      case "SubagentStop": {
        // drain case (count(next) === 0 && pendingTeardown) handled above.
        // Subagent activity is never main-attributable — no resume op.
        const id = str(data.agent_id);
        const next = removeSubagent(state.subagents, id);
        const subagentOp: Op = next === ""
          ? { kind: "unset", key: "@pane_subagents" }
          : { kind: "set", key: "@pane_subagents", value: next };
        // If main had Stop'd earlier and this is the last subagent, transition
        // to idle and clear the main_stopped marker. Drain (pendingTeardown)
        // already short-circuited above, so it cannot be reached here.
        if (next === "" && state.mainStopped) {
          return [
            subagentOp,
            { kind: "set", key: "@pane_status", value: "idle" },
            { kind: "unset", key: "@pane_main_stopped" },
          ];
        }
        return [
          subagentOp,
          ...refreshBackgroundOps(data, state, probe, nowSec),
        ];
      }

      default:
        return [];
    }
  })();

  // Empty body = unknown event or defer case (e.g. Stop with live subagents).
  // Skip self-heal so a defer/unknown call stays a true no-op.
  if (body.length === 0) return [];

  return [...selfHealOps(data), ...body];
}

// --- Observability (JSONL log) ---

export interface ApplyResult {
  key: string;
  code: number;
  stderr?: string;
}

export type EarlyExit =
  | "no-event"
  | "no-tmux-pane"
  | "invalid-pane-id"
  | "embedded"
  | "json-parse-error"
  | "no-ops"
  | null;

export interface RunContext {
  argv_event: string;
  stdin_event: string | null;
  session_id: string | null;
  // `agent_id` from the hook payload (subagent-origin events only). Recorded
  // so post-deploy log inspection can verify the schema-stated invariant
  // ("payload carries agent_id only for subagent events") that the
  // resumeOpsIfStuck attribution logic relies on. null = main-origin or
  // pre-payload-parse early exit.
  agent_id: string | null;
  tmux_pane: string | null;
  cwd: string | null;
  pre_state: PaneState | null;
  ops: Op[];
  apply_results: ApplyResult[];
  early_exit: EarlyExit;
  stdin_event_mismatch: boolean;
  // How each background task and cron was judged, on Stop and on a
  // SubagentStop during a background wait; null on other events.
  background: BackgroundDecision[] | null;
}

export interface LogRecord {
  ts: string;
  pid: number;
  argv_event: string;
  stdin_event: string | null;
  session_id: string | null;
  agent_id: string | null;
  tmux_pane: string | null;
  cwd: string | null;
  pre_state: PaneState | null;
  ops: Array<{ kind: "set" | "unset"; key: string }>;
  apply_results: ApplyResult[];
  early_exit: EarlyExit;
  stdin_event_mismatch: boolean;
  background: BackgroundDecision[] | null;
}

// Pure, for test. Values in `ops` are intentionally dropped — @pane_prompt and
// subject fields can carry user prompt content we don't want persisted in logs.
// `agent_id` is included verbatim because it is a non-PII opaque identifier
// (subagent UUID prefix); needed to validate the resumeOpsIfStuck attribution
// invariant from production logs.
export function buildLogRecord(
  ctx: RunContext,
  now: Date,
  pid: number,
): LogRecord {
  return {
    ts: now.toISOString(),
    pid,
    argv_event: ctx.argv_event,
    stdin_event: ctx.stdin_event,
    session_id: ctx.session_id,
    agent_id: ctx.agent_id,
    tmux_pane: ctx.tmux_pane,
    cwd: ctx.cwd,
    pre_state: ctx.pre_state,
    ops: ctx.ops.map((o) => ({ kind: o.kind, key: o.key })),
    apply_results: ctx.apply_results,
    early_exit: ctx.early_exit,
    stdin_event_mismatch: ctx.stdin_event_mismatch,
    background: ctx.background,
  };
}

const LOG_MAX_BYTES = 10 * 1024 * 1024;

function logPath(): string | null {
  const home = process.env.HOME;
  if (!home) return null;
  return `${home}/.claude/logs/claude-pane-status.log`;
}

async function writeLogRecord(record: LogRecord): Promise<void> {
  const path = logPath();
  if (!path) return;
  const dir = path.substring(0, path.lastIndexOf("/"));
  try {
    await mkdir(dir, { recursive: true });
    // Rotate: when file exceeds cap, move current → .old (drops the older .old)
    // so a single prior segment is retained for debugging.
    try {
      const info = await stat(path);
      if (info.size > LOG_MAX_BYTES) {
        await rename(path, `${path}.old`);
      }
    } catch {
      // no existing file — append will create it
    }
    const line = JSON.stringify(record) + "\n";
    await appendFile(path, line);
  } catch {
    // Log destination unavailable — hook must not fail because of this.
  }
}

// --- Process ancestry ---

// Captures one of the child's output streams and discards the other, which run()
// cannot express: it pipes both.
function capture(
  cmd: string,
  args: string[],
  stream: "stdout" | "stderr",
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: [
        "ignore",
        stream === "stdout" ? "pipe" : "ignore",
        stream === "stderr" ? "pipe" : "ignore",
      ],
    });
    const chunks: Buffer[] = [];
    child[stream]!.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        code: code ?? 128 + (signal ? constants.signals[signal] : 0),
        output: Buffer.concat(chunks).toString("utf8"),
      });
    });
  });
}

// One `ps` for the whole table: a `ps -p` per ancestor cost a spawn per level
// on every tool call.
let psTable: Promise<Map<number, PsRow>> | undefined;

async function fetchParent(pid: number): Promise<PsRow | null> {
  psTable ??= capture("ps", ["-A", "-o", "pid=,ppid=,comm="], "stdout")
    .then(({ code, output }) => {
      const rows = new Map<number, PsRow>();
      if (code !== 0) return rows;
      for (const line of output.split("\n")) {
        const m = line.trim().match(/^(\d+)\s+(.+)$/);
        const row = m ? parsePsLine(m[2]) : null;
        if (m && row) rows.set(Number(m[1]), row);
      }
      return rows;
    })
    .catch(() => new Map<number, PsRow>());
  return (await psTable).get(pid) ?? null;
}

// --- Background shells ---

export interface ProcRow {
  pid: number;
  ppid: number;
  etimeSec: number;
  name: string;
  command: string;
}

// `ps -o etime`: [[dd-]hh:]mm:ss.
export function parseEtime(raw: string): number | null {
  const m = raw.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return null;
  const [, d, h, min, s] = m.map((v) => Number(v ?? 0));
  return ((d * 24 + h) * 60 + min) * 60 + s;
}

export function parseProcRows(output: string): ProcRow[] {
  return output.split("\n").flatMap((line) => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s?(.*)$/);
    const etimeSec = m ? parseEtime(m[3]) : null;
    if (!m || etimeSec === null) return [];
    const name = m[4].replace(/^\.(.+)-wrapp(?:ed)?$/, "$1");
    return [{
      pid: Number(m[1]),
      ppid: Number(m[2]),
      etimeSec,
      name,
      command: m[5],
    }];
  });
}

// Claude Code runs a background command as `eval '<command>'` in a zsh child,
// re-quoted (a quote becomes '"'"', a newline shows as \012 in ps). Comparing
// with quotes, backslashes and whitespace removed survives a change in that
// quoting; commands that differ only in quoting collide, which costs a wrong
// start time or listener, not a lost task.
export function commandKey(command: string): string {
  return command.replace(/\\012/g, " ").replace(/['"\\\s]/g, "");
}

export function matchShells(
  tasks: ReadonlyArray<{ id: string; command: string }>,
  procs: readonly ProcRow[],
  claudePid: number,
  listeners: ReadonlyMap<number, readonly number[]>,
  nowSec: number,
): Map<string, ShellProbe> {
  const children = new Map<number, ProcRow[]>();
  for (const p of procs) {
    children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);
  }
  const tree = (root: ProcRow): ProcRow[] => {
    const out = [root];
    for (let i = 0; i < out.length && i < 4096; i++) {
      out.push(...(children.get(out[i].pid) ?? []));
    }
    return out;
  };
  // One wrapper per task, the longest command first and the shortest wrapper
  // that contains it: `pnpm build` must not take the wrapper of
  // `pnpm build && pnpm preview`, nor two runs of one command the same start.
  const free = (children.get(claudePid) ?? []).map((w) => ({
    w,
    key: commandKey(w.command),
  }));
  const keyed = tasks.map((t) => ({ id: t.id, key: commandKey(t.command) }))
    .filter((t) => t.key)
    .sort((a, b) => b.key.length - a.key.length);
  const probe = new Map<string, ShellProbe>();
  for (const task of keyed) {
    let best = -1;
    free.forEach((f, i) => {
      if (
        f.key.includes(task.key) &&
        (best < 0 || f.key.length < free[best].key.length)
      ) best = i;
    });
    if (best < 0) continue;
    const [{ w }] = free.splice(best, 1);
    const members = tree(w);
    probe.set(task.id, {
      ports: members.flatMap((p) => listeners.get(p.pid) ?? []),
      headlessClient: members.some((p) =>
        p !== w && !listeners.has(p.pid) && /headless/i.test(p.command)
      ),
      startedAtSec: nowSec - w.etimeSec,
    });
  }
  return probe;
}

// `lsof -F pn`: a `p<pid>` line, then an `n<addr>:<port>` line per socket.
export function parseListeners(output: string): Map<number, number[]> {
  const out = new Map<number, number[]>();
  let pid = 0;
  for (const line of output.split("\n")) {
    if (/^p\d+$/.test(line)) pid = Number(line.slice(1));
    const port = line.startsWith("n") ? line.match(/:(\d+)$/) : null;
    if (pid && port) out.set(pid, [...(out.get(pid) ?? []), Number(port[1])]);
  }
  return out;
}

async function probeShells(
  data: HookData,
): Promise<ReadonlyMap<string, ShellProbe>> {
  const tasks =
    (Array.isArray(data.background_tasks) ? data.background_tasks : []).flatMap(
      (raw) => {
        const t = raw && typeof raw === "object"
          ? raw as Record<string, unknown>
          : {};
        return (t.type === "shell" || t.type === "monitor") && str(t.command)
          ? [{ id: str(t.id), command: str(t.command) }]
          : [];
      },
    );
  if (tasks.length === 0) return new Map();
  try {
    const ps = await capture(
      "ps",
      ["-ww", "-A", "-o", "pid=,ppid=,etime=,ucomm=,command="],
      "stdout",
    );
    if (ps.code !== 0) return new Map();
    const procs = parseProcRows(ps.output);
    const byPid = new Map(procs.map((p) => [p.pid, p]));
    let claude = byPid.get(process.pid);
    for (let i = 0; claude && claude.name !== "claude" && i < 32; i++) {
      claude = byPid.get(claude.ppid);
    }
    if (claude?.name !== "claude") return new Map();
    const candidates = [claude.pid];
    for (let i = 0; i < candidates.length && i < 4096; i++) {
      for (const p of procs) {
        if (p.ppid === candidates[i]) candidates.push(p.pid);
      }
    }
    candidates.shift();
    if (candidates.length === 0) return new Map();
    // lsof exits 1 when nothing listens; the output is still the answer.
    const lsof = await capture("lsof", [
      "-nP",
      "-a",
      "-iTCP",
      "-sTCP:LISTEN",
      "-p",
      candidates.join(","),
      "-Fpn",
    ], "stdout");
    return matchShells(
      tasks,
      procs,
      claude.pid,
      parseListeners(lsof.output),
      Math.floor(Date.now() / 1000),
    );
  } catch {
    return new Map();
  }
}

// croner is loaded only for a Stop that lists a cron: every hook event
// starts this script.
async function probeCrons(
  data: HookData,
): Promise<ReadonlyMap<string, number>> {
  const crons = Array.isArray(data.session_crons) ? data.session_crons : [];
  const out = new Map<string, number>();
  if (crons.length === 0) return out;
  try {
    const { Cron } = await import("croner");
    for (const raw of crons) {
      const cron = raw && typeof raw === "object"
        ? raw as Record<string, unknown>
        : {};
      try {
        const next = new Cron(str(cron.schedule), { paused: true }).nextRun();
        if (next) out.set(str(cron.id), Math.floor(next.getTime() / 1000));
      } catch {
        // An unparsed schedule is counted for the cron horizon.
      }
    }
  } catch {
    // Without the parser every cron is counted for the cron horizon.
  }
  return out;
}

export async function probeBackground(
  data: HookData,
): Promise<BackgroundProbe> {
  const [shells, cronNextSec] = await Promise.all([
    probeShells(data),
    probeCrons(data),
  ]);
  return { shells, cronNextSec };
}

// --- tmux I/O ---

async function tmuxRun(
  args: string[],
): Promise<{ code: number; stderr: string }> {
  const { code, output } = await capture("tmux", args, "stderr");
  return { code, stderr: output.trim() };
}

const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  e: "\x1b",
};

/**
 * `tmux show-options -p` prints `@key value`, with the value bare, in double
 * quotes (\" \$ \\ escaped), in single quotes, or with control characters
 * as \n / \t / \ooo. Read in one call instead of one `show -pv` per key; a
 * `display -p '#{@key}'` would also be one call but falls back to window,
 * session and server options of the same name.
 */
export function parseShowOptions(output: string): Map<string, string> {
  const options = new Map<string, string>();
  for (const line of output.split("\n")) {
    const space = line.indexOf(" ");
    if (space <= 0) continue;
    const raw = line.slice(space + 1);
    let value = "";
    let quote: "'" | '"' | null = null;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (quote === "'") {
        if (c === "'") quote = null;
        else value += c;
      } else if (c === "\\" && i + 1 < raw.length) {
        const octal = raw.slice(i + 1, i + 4);
        if (/^[0-7]{3}$/.test(octal)) {
          value += String.fromCharCode(parseInt(octal, 8));
          i += 3;
        } else {
          value += ESCAPES[raw[i + 1]] ?? raw[i + 1];
          i += 1;
        }
      } else if (c === '"' || (c === "'" && quote === null)) {
        quote = quote === c ? null : c;
      } else {
        value += c;
      }
    }
    options.set(line.slice(0, space), value);
  }
  return options;
}

async function readPaneState(pane: string): Promise<PaneState> {
  // A pane that has none of the options set prints nothing and exits 0;
  // a non-zero exit with stderr is a real failure (pane gone, server down).
  const { code, stdout, stderr } = await run(
    "tmux",
    ["show-options", "-p", "-t", pane],
  );
  if (code !== 0 && stderr.trim().length > 0) {
    console.error(
      `claude-pane-status: tmux show-options failed: ${stderr.trim()}`,
    );
  }
  const options = parseShowOptions(stdout);
  const get = (key: string) => (options.get(key) ?? "").trim();
  return {
    subagents: get("@pane_subagents"),
    pendingTeardown: get("@pane_pending_teardown") === "1",
    currentTool: get("@pane_current_tool"),
    status: get("@pane_status"),
    mainStopped: get("@pane_main_stopped") === "1",
    waitReason: get("@pane_wait_reason"),
    lastActivityAt: get("@pane_last_activity_at"),
    background: get("@pane_background"),
    backgroundUntil: get("@pane_background_until"),
    permissionAgents: get("@pane_permission_agents"),
  };
}

/**
 * All ops as one tmux invocation. tmux ends a command at an argv element that
 * ends in `;`, so the separator is its own element and a value ending in `;`
 * (a prompt, a tool subject) has it escaped; unescaped, the old per-op `set`
 * silently dropped that character.
 */
export function chainSetArgs(pane: string, ops: Op[]): string[] {
  return ops.flatMap((op, i) => [
    ...(i === 0 ? [] : [";"]),
    ...(op.kind === "set"
      ? [
        "set",
        "-t",
        pane,
        "-p",
        op.key,
        op.value.endsWith(";") ? `${op.value.slice(0, -1)}\\;` : op.value,
      ]
      : ["set", "-t", pane, "-p", "-u", op.key]),
  ]);
}

async function applyOps(pane: string, ops: Op[]): Promise<ApplyResult[]> {
  const { code, stderr } = await tmuxRun(chainSetArgs(pane, ops));
  if (code !== 0) {
    console.error(
      `claude-pane-status: tmux set failed (${
        ops.map((op) => `${op.kind} ${op.key}`).join(", ")
      }): ${stderr}`,
    );
  }
  return ops.map((op) =>
    code === 0 ? { key: op.key, code } : { key: op.key, code, stderr }
  );
}

// --- Main ---

async function main(): Promise<void> {
  const ctx: RunContext = {
    argv_event: process.argv[2] ?? "",
    stdin_event: null,
    session_id: null,
    agent_id: null,
    tmux_pane: null,
    cwd: null,
    pre_state: null,
    ops: [],
    apply_results: [],
    early_exit: null,
    stdin_event_mismatch: false,
    background: null,
  };

  try {
    if (!ctx.argv_event) {
      ctx.early_exit = "no-event";
      return;
    }

    const tmuxPane = process.env.TMUX_PANE;
    if (!tmuxPane) {
      ctx.early_exit = "no-tmux-pane";
      return;
    }
    ctx.tmux_pane = tmuxPane;
    // Guard against a caller that sets TMUX_PANE to e.g. "-L" or ";cmd" —
    // spawn passes argv (no shell), but tmux itself would parse a
    // leading "-" value as an option, so restrict to the pane-id shape.
    if (!/^%\d+$/.test(tmuxPane)) {
      ctx.early_exit = "invalid-pane-id";
      return;
    }

    if (await isEmbedded(process.pid, fetchParent)) {
      ctx.early_exit = "embedded";
      return;
    }

    const raw = await text(process.stdin);
    let hookData: HookData = {};
    if (raw.trim().length > 0) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
        ) {
          hookData = parsed as Record<string, unknown>;
        }
      } catch {
        console.error("claude-pane-status: failed to parse stdin JSON");
        ctx.early_exit = "json-parse-error";
        return;
      }
    }

    const stdinEvent = str(hookData.hook_event_name);
    ctx.stdin_event = stdinEvent || null;
    ctx.session_id = str(hookData.session_id) || null;
    ctx.agent_id = str(hookData.agent_id) || null;
    ctx.cwd = str(hookData.cwd) || null;
    if (stdinEvent && stdinEvent !== ctx.argv_event) {
      ctx.stdin_event_mismatch = true;
      console.error(
        `claude-pane-status: argv event (${ctx.argv_event}) != stdin event (${stdinEvent}); using argv`,
      );
    }

    const state = await readPaneState(tmuxPane);
    ctx.pre_state = state;
    const probed = ctx.argv_event === "Stop" ||
      (ctx.argv_event === "SubagentStop" && inBackgroundWait(state));
    const probe = probed ? await probeBackground(hookData) : NO_PROBE;
    if (probed) {
      ctx.background = backgroundDecisions(
        hookData,
        probe,
        Math.floor(Date.now() / 1000),
      );
    }
    const ops = eventToOps(ctx.argv_event, hookData, state, probe);
    ctx.ops = ops;
    if (ops.length === 0) {
      ctx.early_exit = "no-ops";
      return;
    }

    ctx.apply_results.push(...await applyOps(tmuxPane, ops));
  } finally {
    await writeLogRecord(buildLogRecord(ctx, new Date(), process.pid));
  }
}

if (import.meta.main) {
  await main();
}
