#!/usr/bin/env -S deno run --allow-env=TMUX_PANE --allow-run=tmux

// Bridges Claude Code hook events → tmux pane options (SSOT for the popup picker).
// Invoked as: claude-pane-status.ts <EventName>   (unknown events → no-op exit 0)

// --- Types ---

type HookData = Record<string, unknown> & {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  message?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
};

export type Op =
  | { kind: "set"; key: string; value: string }
  | { kind: "unset"; key: string };

export interface PaneState {
  subagents: string; // pipe-sep "Type:id|Type:id" list; "" = none
  pendingTeardown: boolean;
  currentTool: string;
  status: string;
}

// --- Constants ---

// Every @pane_* option the script may write. Used to drain state on teardown.
export const ALL_PANE_OPTIONS = [
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
] as const;

// Options cleared at SessionStart so stale values from a previous session on the
// same pane do not bleed into the new one.
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
] as const;

const PROMPT_MAX_CHARS = 40;
const TOOL_SUBJECT_MAX_CHARS = 24;
const TOOL_ERROR_MAX_CHARS = 40;

// --- Pure helpers (exported for tests) ---

export function maskPrompt(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  // Strip all C0/C1 control bytes (incl. ESC/NUL/BEL) then collapse runs of
  // whitespace. Control-char stripping blocks terminal-escape injection when
  // the picker renders the option value — a crafted prompt containing e.g.
  // $'\x1b[2J' would otherwise clear the picker user's screen.
  const flat = raw.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/ {2,}/g, " ").trim();
  if (flat.length <= PROMPT_MAX_CHARS) return flat;
  return flat.slice(0, PROMPT_MAX_CHARS) + "…";
}

// Sanitize + truncate for tool subject / error. Strips all C0/C1 control
// bytes (ESC/NUL/BEL/TAB/CR/LF/etc) to a single space before slicing, which
// (a) keeps the value safe for tmux list-panes -F output and (b) prevents
// terminal-escape injection when the picker renders the option value.
// Unlike maskPrompt this does NOT collapse multi-space runs, so Bash command
// "echo  foo" keeps its double space. Separate from maskPrompt because the
// two inputs are semantically different (structured tool_input fields vs
// free-form user prompt).
function truncate(raw: string, max: number): string {
  const clean = raw.replace(/[\x00-\x1f\x7f]+/g, " ");
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

// Per-tool subject extractors. Edit/Write/MultiEdit are intentionally absent:
// they fall through to the "unknown tool" default (empty string), which lets
// the existing @pane_last_edit_file + `file` segment continue to render the
// Edit target instead of duplicating it here.
const SUBJECT_EXTRACTORS: Record<string, (ti: Record<string, unknown>) => string> = {
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
    return truncate(toolResponse.replace(/^Error:\s*/, ""), TOOL_ERROR_MAX_CHARS);
  }
  if (
    toolResponse &&
    typeof toolResponse === "object" &&
    !Array.isArray(toolResponse)
  ) {
    const tr = toolResponse as Record<string, unknown>;
    if (tr.interrupted === true) return truncate("interrupted", TOOL_ERROR_MAX_CHARS);
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

// Append "Type:id" to a pipe-sep list. Returns the new list string.
export function appendSubagent(list: string, type: string, id: string): string {
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

// Flip @pane_status back to running when activity resumes from a stuck
// waiting/error state. No dedicated "permission approved" / "notification
// dismissed" hook exists, so activity-bearing events (PreToolUse, PostToolUse,
// SubagentStart, SubagentStop) are the only signal that Claude has resumed
// work. @pane_wait_reason is cleared so row 1 summary stops showing the stale
// reason.
export function resumeOpsIfStuck(state: PaneState): Op[] {
  if (state.status !== "waiting" && state.status !== "error") return [];
  return [
    { kind: "set", key: "@pane_status", value: "running" },
    { kind: "unset", key: "@pane_wait_reason" },
  ];
}

// Re-assert the pane belongs to a live Claude session. Called at the head of
// every event except drain paths. session_id-guarded so non-Claude events
// (e.g. stray CwdChanged without a session) never create phantom Claude panes.
export function selfHealOps(data: HookData): Op[] {
  const sid = str(data.session_id);
  if (!sid) return [];
  const ops: Op[] = [
    { kind: "set", key: "@pane_agent", value: "claude" },
    { kind: "set", key: "@pane_session_id", value: sid },
  ];
  const cwd = str(data.cwd);
  if (cwd) ops.push({ kind: "set", key: "@pane_cwd", value: cwd });
  return ops;
}

// --- Event → Op mapping (pure, exported for tests) ---

export function eventToOps(
  event: string,
  data: HookData,
  state: PaneState,
): Op[] {
  // Drain paths: full teardown. Short-circuit before self-heal so the teardown
  // is not followed by self-heal reinstating @pane_agent.
  if (event === "SessionEnd" && count(state.subagents) === 0) {
    return ALL_PANE_OPTIONS.map((key) => ({ kind: "unset" as const, key }));
  }
  if (
    event === "SubagentStop" &&
    count(removeSubagent(state.subagents, str(data.agent_id))) === 0 &&
    state.pendingTeardown
  ) {
    return ALL_PANE_OPTIONS.map((key) => ({ kind: "unset" as const, key }));
  }

  const body: Op[] = (() => {
    switch (event) {
      case "SessionStart": {
        // agent / session_id / cwd are set by selfHealOps below.
        const ops: Op[] = STALE_AT_SESSION_START.map((key) => ({
          kind: "unset" as const,
          key,
        }));
        ops.push({ kind: "set", key: "@pane_status", value: "idle" });
        // Seed activity_at so a fresh session shows `idle Ns` in the picker row 2
        // from the moment it starts (otherwise brand-new idle panes display nothing).
        ops.push({
          kind: "set",
          key: "@pane_last_activity_at",
          value: String(Math.floor(Date.now() / 1000)),
        });
        return ops;
      }

      case "SessionEnd": {
        // drain case (count === 0) handled above
        return [{ kind: "set", key: "@pane_pending_teardown", value: "1" }];
      }

      case "UserPromptSubmit": {
        const prompt = maskPrompt(data.prompt);
        const now = String(Math.floor(Date.now() / 1000));
        const ops: Op[] = [
          { kind: "set", key: "@pane_status", value: "running" },
          { kind: "set", key: "@pane_started_at", value: now },
          { kind: "set", key: "@pane_last_activity_at", value: now },
        ];
        if (prompt) {
          ops.push({ kind: "set", key: "@pane_prompt", value: prompt });
        } else ops.push({ kind: "unset", key: "@pane_prompt" });
        return ops;
      }

      case "Stop": {
        if (count(state.subagents) > 0) return []; // pending subagents: defer
        return [{ kind: "set", key: "@pane_status", value: "idle" }];
      }

      case "StopFailure": {
        const reason = maskPrompt(data.message) || "error";
        return [
          { kind: "set", key: "@pane_status", value: "error" },
          { kind: "set", key: "@pane_wait_reason", value: reason },
        ];
      }

      case "Notification": {
        const reason = maskPrompt(data.message) || "notification";
        return [
          { kind: "set", key: "@pane_status", value: "waiting" },
          { kind: "set", key: "@pane_wait_reason", value: reason },
        ];
      }

      case "PermissionDenied": {
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
        const ops: Op[] = [
          ...resumeOpsIfStuck(state),
          { kind: "set", key: "@pane_current_tool", value: toolName },
        ];
        if (subject) {
          ops.push({
            kind: "set",
            key: "@pane_current_tool_subject",
            value: subject,
          });
        } else {
          ops.push({ kind: "unset", key: "@pane_current_tool_subject" });
        }
        return ops;
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
        const ops: Op[] = [
          ...resumeOpsIfStuck(state),
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
              // escapes when picker renders). Picker applies basename().
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

      case "SubagentStart": {
        // Hook stdin field names (verified via /tmp/claude-pane-hook.log dump):
        // `agent_id` (snake_case) and `agent_type` — NOT `subagent_*`.
        const type = str(data.agent_type) || "subagent";
        const id = str(data.agent_id) ||
          crypto.randomUUID().slice(0, 8);
        const next = appendSubagent(state.subagents, type, id);
        return [
          ...resumeOpsIfStuck(state),
          { kind: "set", key: "@pane_subagents", value: next },
        ];
      }

      case "SubagentStop": {
        // drain case (count(next) === 0 && pendingTeardown) handled above
        const id = str(data.agent_id);
        const next = removeSubagent(state.subagents, id);
        const subagentOp: Op = next === ""
          ? { kind: "unset", key: "@pane_subagents" }
          : { kind: "set", key: "@pane_subagents", value: next };
        return [...resumeOpsIfStuck(state), subagentOp];
      }

      case "WorktreeCreate": {
        const branch = str(data.branch) || str(data.worktree_branch);
        const path = str(data.path) || str(data.worktree_path);
        const ops: Op[] = [];
        if (branch) {
          ops.push({
            kind: "set",
            key: "@pane_worktree_branch",
            value: branch,
          });
        }
        if (path) {
          ops.push({ kind: "set", key: "@pane_worktree_path", value: path });
        }
        return ops;
      }

      case "WorktreeRemove": {
        return [
          { kind: "unset", key: "@pane_worktree_branch" },
          { kind: "unset", key: "@pane_worktree_path" },
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

// --- tmux I/O ---

async function tmuxRun(
  args: string[],
): Promise<{ code: number; stderr: string }> {
  const proc = new Deno.Command("tmux", {
    args,
    stdin: "null",
    stdout: "null",
    stderr: "piped",
  });
  const { code, stderr } = await proc.output();
  return { code, stderr: new TextDecoder().decode(stderr).trim() };
}

async function readPaneState(pane: string): Promise<PaneState> {
  // `tmux show -pv <option>` exits non-zero with empty stderr when the option
  // is unset — that's the normal "default" path and must stay silent.
  // Non-zero exit WITH non-empty stderr signals a real tmux failure (pane gone,
  // server down) worth logging so the failure is not silently masked.
  const runShow = async (key: string) => {
    const { code, stdout, stderr } = await new Deno.Command("tmux", {
      args: ["show", "-t", pane, "-pv", key],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    const errText = decoder.decode(stderr).trim();
    if (code !== 0 && errText.length > 0) {
      console.error(
        `claude-pane-status: tmux show -pv ${key} failed: ${errText}`,
      );
    }
    return decoder.decode(stdout);
  };
  const [subagentsStdout, teardownStdout, currentToolStdout, statusStdout] =
    await Promise.all(
      [
        runShow("@pane_subagents"),
        runShow("@pane_pending_teardown"),
        runShow("@pane_current_tool"),
        runShow("@pane_status"),
      ],
    );
  return {
    subagents: subagentsStdout.trim(),
    pendingTeardown: teardownStdout.trim() === "1",
    currentTool: currentToolStdout.trim(),
    status: statusStdout.trim(),
  };
}

async function applyOp(pane: string, op: Op): Promise<void> {
  const args = op.kind === "set"
    ? ["set", "-t", pane, "-p", op.key, op.value]
    : ["set", "-t", pane, "-p", "-u", op.key];
  const { code, stderr } = await tmuxRun(args);
  if (code !== 0) {
    console.error(
      `claude-pane-status: tmux set failed (${op.kind} ${op.key}): ${stderr}`,
    );
  }
}

// --- Main ---

async function main(): Promise<void> {
  const event = Deno.args[0] ?? "";
  if (!event) return; // no event specified — no-op

  const tmuxPane = Deno.env.get("TMUX_PANE");
  if (!tmuxPane) return; // not invoked inside a tmux pane — no-op
  // Guard against a caller that sets TMUX_PANE to e.g. "-L" or ";cmd" —
  // Deno.Command uses argv (no shell), but tmux itself would parse a
  // leading "-" value as an option, so restrict to the pane-id shape.
  if (!/^%\d+$/.test(tmuxPane)) return;

  const raw = await new Response(Deno.stdin.readable).text();
  let hookData: HookData = {};
  if (raw.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      // Narrow: plain object (not array, not primitive) → treat as hook data.
      // `str()` accessors downstream handle all field type-narrowing from unknown.
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        hookData = parsed as Record<string, unknown>;
      }
    } catch {
      console.error("claude-pane-status: failed to parse stdin JSON");
      return;
    }
  }

  const stdinEvent = str(hookData.hook_event_name);
  if (stdinEvent && stdinEvent !== event) {
    console.error(
      `claude-pane-status: argv event (${event}) != stdin event (${stdinEvent}); using argv`,
    );
  }

  const state = await readPaneState(tmuxPane);
  const ops = eventToOps(event, hookData, state);
  if (ops.length === 0) return; // unknown event or no-op case

  for (const op of ops) {
    await applyOp(tmuxPane, op);
  }
}

if (import.meta.main) {
  await main();
}
