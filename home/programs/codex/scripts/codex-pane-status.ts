#!/usr/bin/env -S deno run --allow-env=HOME,TMUX_PANE --allow-read --allow-write --allow-run=tmux,ps

// Bridges Codex CLI lifecycle hooks to tmux pane options for the popup picker.
// Invoked as: codex-pane-status.ts <EventName>. Unknown events are no-op exit 0.

import { isEmbedded, parsePsLine, type PsRow } from "../agent-presence.ts";
import {
  ALL_PANE_OPTIONS_FOR_CODEX,
  CLAUDE_ONLY_KEYS,
  formatToolError,
  maskPrompt,
  type Op,
  type PaneOptionKey,
  promptStartTrio,
  SESSION_ID_RE,
  sessionStartBody,
  TOOL_SUBJECT_MAX_CHARS,
  toolStartOps,
  truncate,
  unsetOps as sharedUnsetOps,
} from "../pane-shared.ts";

export type SubagentMutation =
  | { action: "add"; type: string; id: string }
  | { action: "remove"; id: string };
type SubagentMutationOp = {
  kind: "set";
  key: "@pane_subagents";
  value: string;
  subagentMutation: SubagentMutation;
};
type ChildSessionStartOp = {
  kind: "set";
  key: "@pane_subagents";
  value: string;
  childSessionStart: { id: string; type: string; cwd: string; source: string };
};
type ParentStopOp = {
  kind: "set";
  key: "@pane_status";
  value: "idle";
  parentStop: { contextPct: string | null };
};
export type PaneOp =
  | Op
  | SubagentMutationOp
  | ChildSessionStartOp
  | ParentStopOp;

type HookData = Record<string, unknown> & {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  prompt?: string;
  source?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_use_id?: string;
  tool_response?: unknown;
  transcript_path?: string | null;
};

export interface PaneState {
  status: string;
  currentTool: string;
  currentToolUseId: string;
  agent: string;
  sessionId: string;
  subagents: string;
  mainStopped: boolean;
}

export type TmuxShowResult =
  | { ok: true; value: string }
  | { ok: false; stderr: string };

// codex-only resume path key set — no parallel concept in claude/opencode.
export const RESUME_TRANSIENT_KEYS = [
  "@pane_current_tool",
  "@pane_current_tool_use_id",
  "@pane_wait_reason",
  "@pane_pending_subagent_notifications",
] as const satisfies readonly PaneOptionKey[];

// Derived (codex-shape) — diverges from claude's manually enumerated equivalent;
// not unified into pane-shared.ts (Intentional Convention: per-writer local).
// `.filter()` widens the readonly literal tuple back to a mutable string-element
// array, so `as const` is unavailable here. The explicit `as readonly
// PaneOptionKey[]` cast preserves the typo gate provided by the parent
// constant's `satisfies readonly PaneOptionKey[]`.
const STALE_AT_SESSION_START = ALL_PANE_OPTIONS_FOR_CODEX.filter((key) =>
  key !== "@pane_agent" && key !== "@pane_session_id" && key !== "@pane_cwd"
) as readonly PaneOptionKey[];

const TOKEN_TAIL_BYTES = 64 * 1024;
const LOG_MAX_LINES = 1000;
const TMUX_COORDINATION_TIMEOUT_MS = 2000;
const SUBAGENT_LOCK_PREFIX = "codex-pane-status-subagents";
const PENDING_SUBAGENT_NOTIFICATIONS_KEY =
  "@pane_pending_subagent_notifications";
const LOG_FILE = `${
  Deno.env.get("HOME") ?? "."
}/.codex/logs/codex-pane-status.log`;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function sanitizeListToken(raw: string): string {
  return raw.replace(/[|:]/g, "-");
}

export function appendSubagent(
  list: string,
  type: string,
  id: string,
): string {
  const entry = `${sanitizeListToken(type)}:${sanitizeListToken(id)}`;
  if (list.split("|").filter(Boolean).includes(entry)) return list;
  return list ? `${list}|${entry}` : entry;
}

export function removeSubagent(list: string, id: string): string {
  if (!list) return "";
  const target = sanitizeListToken(id);
  const entries = list.split("|");
  const filtered: string[] = [];
  let removed = false;
  for (const entry of entries) {
    if (!removed && entry.endsWith(`:${target}`)) {
      removed = true;
      continue;
    }
    if (entry) filtered.push(entry);
  }
  return filtered.join("|");
}

export function countSubagents(list: string): number {
  return list.split("|").filter(Boolean).length;
}

function hasSubagent(list: string, id: string): boolean {
  const target = sanitizeListToken(id);
  return list.split("|").some((entry) => entry.endsWith(`:${target}`));
}

function parsePendingSubagentNotifications(raw: string): number {
  if (!/^\d+$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export function incrementPendingSubagentNotifications(raw: string): string {
  return String(parsePendingSubagentNotifications(raw) + 1);
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

export function shouldIncrementPendingSubagentNotification(
  mutation: SubagentMutation,
  ops: Op[],
): boolean {
  return mutation.action === "remove" && ops.length > 0;
}

export function subagentMutationOps(
  current: string,
  mutation: SubagentMutation,
  mainStopped: boolean,
  now: string = nowSec(),
): Op[] {
  const next = mutation.action === "add"
    ? appendSubagent(current, mutation.type, mutation.id)
    : removeSubagent(current, mutation.id);
  if (next === current) return [];

  const ops: Op[] = [
    next
      ? { kind: "set", key: "@pane_subagents", value: next }
      : { kind: "unset", key: "@pane_subagents" },
  ];
  if (mutation.action === "remove" && next === "" && mainStopped) {
    ops.push({ kind: "set", key: "@pane_status", value: "idle" });
    ops.push({ kind: "set", key: "@pane_last_activity_at", value: now });
    ops.push({ kind: "unset", key: "@pane_main_stopped" });
  }
  return ops;
}

export function parentStopOps(
  currentSubagents: string,
  contextPct: string | null,
  now: string = nowSec(),
): Op[] {
  if (countSubagents(currentSubagents) > 0) {
    return [
      { kind: "set", key: "@pane_main_stopped", value: "1" },
      { kind: "set", key: "@pane_last_activity_at", value: now },
      contextPct === null
        ? { kind: "unset", key: "@pane_context_used_pct" }
        : { kind: "set", key: "@pane_context_used_pct", value: contextPct },
    ];
  }
  return [
    { kind: "set", key: "@pane_status", value: "idle" },
    { kind: "set", key: "@pane_last_activity_at", value: now },
    contextPct === null
      ? { kind: "unset", key: "@pane_context_used_pct" }
      : { kind: "set", key: "@pane_context_used_pct", value: contextPct },
    { kind: "unset", key: "@pane_main_stopped" },
  ];
}

export function childSessionStartOps(
  latest: Pick<PaneState, "status" | "agent" | "sessionId" | "subagents">,
  child: { id: string; type: string; cwd: string; source: string },
  now: string = nowSec(),
): Op[] {
  const latestParentRunning = latest.status === "running" &&
    latest.agent === "codex" &&
    SESSION_ID_RE.test(latest.sessionId) &&
    child.id !== latest.sessionId;
  if (latestParentRunning) {
    return subagentMutationOps(
      latest.subagents,
      { action: "add", type: child.type, id: child.id },
      false,
      now,
    );
  }

  const sameCodexSession = latest.agent === "codex" &&
    latest.sessionId === child.id;
  const staleKeys = (child.source === "resume" && sameCodexSession)
    ? [...CLAUDE_ONLY_KEYS, ...RESUME_TRANSIENT_KEYS]
    : STALE_AT_SESSION_START;
  return [
    ...selfHealOps({ session_id: child.id, cwd: child.cwd }),
    ...sessionStartBody({ staleKeys, nowSec: now }),
  ];
}

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
};

export function extractToolSubject(
  toolName: string,
  toolInput: unknown,
): string {
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return "";
  }
  const ti = toolInput as Record<string, unknown>;
  const extractor = SUBJECT_EXTRACTORS[toolName];
  let subject = extractor ? extractor(ti) : "";
  if (!subject && toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    if (parts.length >= 3) subject = `mcp: ${parts[1]}`;
  }
  return subject ? truncate(subject, TOOL_SUBJECT_MAX_CHARS, "...") : "";
}

export function extractEditFile(toolName: string, toolInput: unknown): string {
  if (toolName !== "Edit" && toolName !== "Write" && toolName !== "MultiEdit") {
    return "";
  }
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return "";
  }
  const filePath = (toolInput as Record<string, unknown>).file_path;
  // Strip C0/C1 control bytes — converges to the shared run-collapse behavior
  // (see pane-shared.ts:138-141 "intentional behavior unification" comment).
  // Adversarial inputs (embedded NUL/ESC) collapse runs to a single space
  // instead of one-space-per-byte; non-adversarial inputs are indistinguishable.
  return typeof filePath === "string"
    // deno-lint-ignore no-control-regex
    ? filePath.replace(/[\x00-\x1f\x7f]+/g, " ")
    : "";
}

export function selfHealOps(data: HookData): Op[] {
  const sid = str(data.session_id);
  if (!sid) return [];
  // Defense-in-depth path-traversal guard; mirrors claude/opencode + picker.
  if (!SESSION_ID_RE.test(sid)) return [];
  const ops: Op[] = [
    { kind: "set", key: "@pane_agent", value: "codex" },
    { kind: "set", key: "@pane_session_id", value: sid },
  ];
  const cwd = str(data.cwd);
  if (cwd) ops.push({ kind: "set", key: "@pane_cwd", value: cwd });
  return ops;
}

export function resumeOpsIfStuck(state: PaneState): Op[] {
  if (state.status !== "waiting") return [];
  return [
    { kind: "set", key: "@pane_status", value: "running" },
    { kind: "unset", key: "@pane_wait_reason" },
  ];
}

export function isChildCodexEvent(
  data: HookData,
  state: PaneState,
  event: string = "",
): boolean {
  const sid = str(data.session_id);
  const knownChild = sid ? hasSubagent(state.subagents, sid) : false;
  return Boolean(
    sid &&
      SESSION_ID_RE.test(sid) &&
      state.agent === "codex" &&
      SESSION_ID_RE.test(state.sessionId) &&
      sid !== state.sessionId &&
      (state.status === "running" ||
        (event !== "SessionStart" && knownChild &&
          (state.status === "waiting" || state.status === "error" ||
            state.mainStopped))),
  );
}

function isInvalidChildLikeSessionStart(
  event: string,
  data: HookData,
  state: PaneState,
): boolean {
  if (event !== "SessionStart") return false;
  if (state.agent !== "codex" || state.status !== "running") return false;
  if (!SESSION_ID_RE.test(state.sessionId)) return false;
  const sid = str(data.session_id);
  return !sid || !SESSION_ID_RE.test(sid);
}

export function extractToolError(toolResponse: unknown): string | null {
  if (typeof toolResponse !== "string") return null;
  if (!toolResponse.startsWith("Error")) return null;
  // codex preserves 3-dot ellipsis at this site; formatToolError handles the
  // "Error: " prefix strip + truncate internally.
  return formatToolError(toolResponse, { ellipsis: "..." });
}

function numberAt(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function extractTokenPct(
  transcriptPath: string | null | undefined,
): Promise<number | null> {
  if (!transcriptPath) return null;
  let file: Deno.FsFile | null = null;
  try {
    const stat = await Deno.stat(transcriptPath);
    if (!stat.isFile || stat.size <= 0) return null;
    const start = Math.max(0, stat.size - TOKEN_TAIL_BYTES);
    const length = stat.size - start;
    file = await Deno.open(transcriptPath, { read: true });
    await file.seek(start, Deno.SeekMode.Start);
    const buf = new Uint8Array(length);
    const read = await file.read(buf);
    if (read === null || read <= 0) return null;
    const text = new TextDecoder().decode(buf.subarray(0, read));
    for (const line of text.split("\n").reverse()) {
      if (!line.trim()) continue;
      try {
        const payload = JSON.parse(line) as Record<string, unknown>;
        if (payload.type !== "token_count") continue;
        const info = payload.info as Record<string, unknown> | undefined;
        const totalUsage = info?.total_token_usage;
        const totalTokens = numberAt(totalUsage, "total_tokens");
        const contextWindow = numberAt(info, "model_context_window");
        if (
          totalTokens === null || contextWindow === null || contextWindow <= 0
        ) {
          return null;
        }
        const pct = Math.round((totalTokens / contextWindow) * 100);
        return Math.max(0, Math.min(100, pct));
      } catch {
        // tolerate partial tail lines / malformed historical records
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    try {
      file?.close();
    } catch {
      // ignore close failure in hook context
    }
  }
}

function nowSec(): string {
  return String(Math.floor(Date.now() / 1000));
}

// Local alias so the existing call sites read naturally; delegates to the
// shared partial-drain primitive.
const unsetOps = sharedUnsetOps;

export async function eventToOps(
  event: string,
  data: HookData,
  state: PaneState,
): Promise<PaneOp[]> {
  if (isInvalidChildLikeSessionStart(event, data, state)) return [];

  if (isChildCodexEvent(data, state, event)) {
    const childId = str(data.session_id);
    switch (event) {
      case "SessionStart": {
        return [{
          kind: "set",
          key: "@pane_subagents",
          value: childId,
          childSessionStart: {
            id: childId,
            type: "Codex",
            cwd: str(data.cwd),
            source: str(data.source),
          },
        }];
      }

      case "Stop": {
        return [{
          kind: "set",
          key: "@pane_subagents",
          value: childId,
          subagentMutation: { action: "remove", id: childId },
        }];
      }

      case "PreToolUse": {
        const toolName = str(data.tool_name);
        if (!toolName) return [];
        const subject = extractToolSubject(toolName, data.tool_input);
        const ops: PaneOp[] = [
          ...toolStartOps({ tool: toolName, subject: subject || undefined }),
        ];
        const toolUseId = str(data.tool_use_id);
        ops.push(
          toolUseId
            ? {
              kind: "set",
              key: "@pane_current_tool_use_id",
              value: toolUseId,
            }
            : { kind: "unset", key: "@pane_current_tool_use_id" },
        );
        return ops;
      }

      case "PostToolUse": {
        const toolName = str(data.tool_name);
        const now = nowSec();
        const ops: PaneOp[] = [
          { kind: "set", key: "@pane_last_activity_at", value: now },
        ];
        if (!toolName) return ops;
        const toolUseId = str(data.tool_use_id);
        if (toolUseId && toolUseId === state.currentToolUseId) {
          ops.push({ kind: "unset", key: "@pane_current_tool" });
          ops.push({ kind: "unset", key: "@pane_current_tool_use_id" });
          ops.push({ kind: "unset", key: "@pane_current_tool_subject" });
        }
        ops.push({ kind: "set", key: "@pane_last_tool", value: toolName });
        const subject = extractToolSubject(toolName, data.tool_input);
        ops.push(
          subject
            ? { kind: "set", key: "@pane_last_tool_subject", value: subject }
            : { kind: "unset", key: "@pane_last_tool_subject" },
        );
        const editFile = extractEditFile(toolName, data.tool_input);
        ops.push(
          editFile
            ? { kind: "set", key: "@pane_last_edit_file", value: editFile }
            : { kind: "unset", key: "@pane_last_edit_file" },
        );
        const error = extractToolError(data.tool_response);
        ops.push(
          error
            ? { kind: "set", key: "@pane_last_tool_error", value: error }
            : { kind: "unset", key: "@pane_last_tool_error" },
        );
        return ops;
      }

      case "PermissionRequest":
        return [];

      case "UserPromptSubmit":
        return [];

      default:
        return [];
    }
  }

  const body: PaneOp[] = [];

  switch (event) {
    case "SessionStart": {
      const source = str(data.source);
      const sameCodexSession = state.agent === "codex" &&
        state.sessionId === str(data.session_id);
      // Resume path drops claude-attributed + transient state; fresh path
      // drops the full STALE list. Both paths share the status=idle +
      // last_activity_at tail via sessionStartBody.
      const staleKeys = (source === "resume" && sameCodexSession)
        ? [...CLAUDE_ONLY_KEYS, ...RESUME_TRANSIENT_KEYS]
        : STALE_AT_SESSION_START;
      body.push(...sessionStartBody({ staleKeys, nowSec: nowSec() }));
      break;
    }

    case "UserPromptSubmit": {
      // codex preserves 3-dot ellipsis (`...`) — pane-shared default is `…`.
      // See pane-shared.ts:131-132 for the documented intent.
      const prompt = maskPrompt(data.prompt, { ellipsis: "..." });
      body.push(...promptStartTrio({ nowSec: nowSec() }));
      body.push(
        prompt
          ? { kind: "set", key: "@pane_prompt", value: prompt }
          : { kind: "unset", key: "@pane_prompt" },
      );
      body.push({ kind: "unset", key: "@pane_main_stopped" });
      break;
    }

    case "PreToolUse": {
      const toolName = str(data.tool_name);
      if (!toolName) return [];
      const subject = extractToolSubject(toolName, data.tool_input);
      body.push(...resumeOpsIfStuck(state));
      body.push(
        ...toolStartOps({ tool: toolName, subject: subject || undefined }),
      );
      const toolUseId = str(data.tool_use_id);
      if (toolUseId) {
        body.push({
          kind: "set",
          key: "@pane_current_tool_use_id",
          value: toolUseId,
        });
      } else {
        body.push({ kind: "unset", key: "@pane_current_tool_use_id" });
      }
      break;
    }

    case "PostToolUse": {
      const toolName = str(data.tool_name);
      const now = nowSec();
      body.push(...resumeOpsIfStuck(state));
      body.push({ kind: "set", key: "@pane_last_activity_at", value: now });
      if (!toolName) break;
      const toolUseId = str(data.tool_use_id);
      if (toolUseId && toolUseId === state.currentToolUseId) {
        body.push({ kind: "unset", key: "@pane_current_tool" });
        body.push({ kind: "unset", key: "@pane_current_tool_use_id" });
        body.push({ kind: "unset", key: "@pane_current_tool_subject" });
      }
      body.push({ kind: "set", key: "@pane_last_tool", value: toolName });
      const subject = extractToolSubject(toolName, data.tool_input);
      body.push(
        subject
          ? { kind: "set", key: "@pane_last_tool_subject", value: subject }
          : { kind: "unset", key: "@pane_last_tool_subject" },
      );
      const editFile = extractEditFile(toolName, data.tool_input);
      body.push(
        editFile
          ? { kind: "set", key: "@pane_last_edit_file", value: editFile }
          : { kind: "unset", key: "@pane_last_edit_file" },
      );
      const error = extractToolError(data.tool_response);
      body.push(
        error
          ? { kind: "set", key: "@pane_last_tool_error", value: error }
          : { kind: "unset", key: "@pane_last_tool_error" },
      );
      break;
    }

    case "Stop": {
      const pct = await extractTokenPct(
        typeof data.transcript_path === "string" ? data.transcript_path : null,
      );
      body.push({
        kind: "set",
        key: "@pane_status",
        value: "idle",
        parentStop: { contextPct: pct === null ? null : String(pct) },
      });
      break;
    }

    case "PermissionRequest": {
      body.push({ kind: "set", key: "@pane_status", value: "waiting" });
      body.push({ kind: "set", key: "@pane_wait_reason", value: "permission" });
      break;
    }

    default:
      return [];
  }

  return [...selfHealOps(data), ...body];
}

async function fetchParent(pid: number): Promise<PsRow | null> {
  try {
    const { stdout, code } = await new Deno.Command("ps", {
      args: ["-p", String(pid), "-o", "ppid=,comm="],
      stdin: "null",
      stdout: "piped",
      stderr: "null",
    }).output();
    if (code !== 0) return null;
    return parsePsLine(new TextDecoder().decode(stdout));
  } catch {
    return null;
  }
}

export async function commandOutput(
  cmd: string,
  args: string[],
  options: {
    stdout: "piped" | "null";
    stderr: "piped" | "null";
    timeoutMs?: number;
  },
): Promise<{ code: number; stdout: string; stderr: string }> {
  let timeout: number | undefined;
  try {
    const child = new Deno.Command(cmd, {
      args,
      stdin: "null",
      stdout: options.stdout,
      stderr: options.stderr,
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
      stdout: options.stdout === "piped"
        ? new TextDecoder().decode(result.stdout).trim()
        : "",
      stderr: options.stderr === "piped"
        ? new TextDecoder().decode(result.stderr).trim()
        : "",
    };
  } catch (err) {
    return { code: 127, stdout: "", stderr: String(err) };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function tmuxRun(
  args: string[],
): Promise<{ code: number; stderr: string }> {
  const result = await commandOutput("tmux", args, {
    stdout: "null",
    stderr: "piped",
    timeoutMs: TMUX_COORDINATION_TIMEOUT_MS,
  });
  return { code: result.code, stderr: result.stderr };
}

function subagentLockName(pane: string): string {
  return `${SUBAGENT_LOCK_PREFIX}-${pane.replace(/[^A-Za-z0-9_.-]/g, "-")}`;
}

async function tmuxShow(
  pane: string,
  key: string,
): Promise<TmuxShowResult> {
  const result = await commandOutput("tmux", ["show", "-t", pane, "-pv", key], {
    stdout: "piped",
    stderr: "piped",
    timeoutMs: TMUX_COORDINATION_TIMEOUT_MS,
  });
  return result.code === 0
    ? { ok: true, value: result.stdout }
    : { ok: false, stderr: result.stderr };
}

async function tmuxShowOptionalUserOption(
  pane: string,
  key: string,
): Promise<TmuxShowResult> {
  return normalizeMissingUserOption(await tmuxShow(pane, key), key);
}

async function tmuxShowValue(pane: string, key: string): Promise<string> {
  const result = await tmuxShow(pane, key);
  return result.ok ? result.value : "";
}

async function readPaneState(pane: string): Promise<PaneState> {
  const [
    status,
    currentTool,
    currentToolUseId,
    agent,
    sessionId,
    subagents,
    mainStopped,
  ] = await Promise.all([
    tmuxShowValue(pane, "@pane_status"),
    tmuxShowValue(pane, "@pane_current_tool"),
    tmuxShowValue(pane, "@pane_current_tool_use_id"),
    tmuxShowValue(pane, "@pane_agent"),
    tmuxShowValue(pane, "@pane_session_id"),
    tmuxShowValue(pane, "@pane_subagents"),
    tmuxShowValue(pane, "@pane_main_stopped"),
  ]);
  return {
    status,
    currentTool,
    currentToolUseId,
    agent,
    sessionId,
    subagents,
    mainStopped: mainStopped === "1",
  };
}

async function applyRegularOp(pane: string, op: Op): Promise<boolean> {
  const value = op.kind === "set" ? op.value : "";
  const args = op.kind === "set"
    ? ["set", "-t", pane, "-p", op.key, value]
    : ["set", "-t", pane, "-p", "-u", op.key];
  const { code, stderr } = await tmuxRun(args);
  if (code !== 0) {
    console.error(`codex-pane-status: tmux set ${op.key} failed: ${stderr}`);
    return false;
  }
  return true;
}

async function applySubagentMutation(
  pane: string,
  op: SubagentMutationOp,
): Promise<void> {
  const lockName = subagentLockName(pane);
  const lock = await tmuxRun(["wait-for", "-L", lockName]);
  if (lock.code !== 0) {
    console.error(
      `codex-pane-status: tmux wait-for lock failed: ${lock.stderr}`,
    );
    return;
  }
  try {
    const current = await tmuxShowOptionalUserOption(pane, op.key);
    const mainStopped = await tmuxShowOptionalUserOption(
      pane,
      "@pane_main_stopped",
    );
    if (!current.ok || !mainStopped.ok) {
      let stderr = "";
      if (!current.ok) {
        stderr = current.stderr;
      } else if (!mainStopped.ok) {
        stderr = mainStopped.stderr;
      }
      console.error(`codex-pane-status: tmux show failed: ${stderr}`);
      return;
    }
    const ops = subagentMutationOps(
      current.value,
      op.subagentMutation,
      mainStopped.value === "1",
    );
    let appliedRemoval = false;
    for (const nextOp of ops) {
      const applied = await applyRegularOp(pane, nextOp);
      if (nextOp.key === "@pane_subagents") appliedRemoval = applied;
    }
    if (
      appliedRemoval &&
      shouldIncrementPendingSubagentNotification(op.subagentMutation, ops)
    ) {
      const pending = await tmuxShowOptionalUserOption(
        pane,
        PENDING_SUBAGENT_NOTIFICATIONS_KEY,
      );
      if (!pending.ok) {
        console.error(`codex-pane-status: tmux show failed: ${pending.stderr}`);
        return;
      }
      await applyRegularOp(pane, {
        kind: "set",
        key: PENDING_SUBAGENT_NOTIFICATIONS_KEY,
        value: incrementPendingSubagentNotifications(pending.value),
      });
    }
  } finally {
    const unlock = await tmuxRun(["wait-for", "-U", lockName]);
    if (unlock.code !== 0) {
      console.error(
        `codex-pane-status: tmux wait-for unlock failed: ${unlock.stderr}`,
      );
    }
  }
}

async function applyChildSessionStart(
  pane: string,
  op: ChildSessionStartOp,
): Promise<void> {
  const lockName = subagentLockName(pane);
  const lock = await tmuxRun(["wait-for", "-L", lockName]);
  if (lock.code !== 0) {
    console.error(
      `codex-pane-status: tmux wait-for lock failed: ${lock.stderr}`,
    );
    return;
  }
  try {
    const [status, agent, sessionId, subagents] = await Promise.all([
      tmuxShow(pane, "@pane_status"),
      tmuxShow(pane, "@pane_agent"),
      tmuxShow(pane, "@pane_session_id"),
      tmuxShowOptionalUserOption(pane, "@pane_subagents"),
    ]);
    if (!status.ok || !agent.ok || !sessionId.ok || !subagents.ok) {
      const failed = [status, agent, sessionId, subagents].find((r) => !r.ok);
      console.error(
        `codex-pane-status: tmux show failed: ${
          failed && !failed.ok ? failed.stderr : ""
        }`,
      );
      return;
    }
    const ops = childSessionStartOps(
      {
        status: status.value,
        agent: agent.value,
        sessionId: sessionId.value,
        subagents: subagents.value,
      },
      op.childSessionStart,
    );
    for (const nextOp of ops) await applyRegularOp(pane, nextOp);
  } finally {
    const unlock = await tmuxRun(["wait-for", "-U", lockName]);
    if (unlock.code !== 0) {
      console.error(
        `codex-pane-status: tmux wait-for unlock failed: ${unlock.stderr}`,
      );
    }
  }
}

async function applyParentStop(pane: string, op: ParentStopOp): Promise<void> {
  const lockName = subagentLockName(pane);
  const lock = await tmuxRun(["wait-for", "-L", lockName]);
  if (lock.code !== 0) {
    console.error(
      `codex-pane-status: tmux wait-for lock failed: ${lock.stderr}`,
    );
    return;
  }
  try {
    const current = await tmuxShowOptionalUserOption(pane, "@pane_subagents");
    if (!current.ok) {
      console.error(`codex-pane-status: tmux show failed: ${current.stderr}`);
      return;
    }
    const ops = parentStopOps(current.value, op.parentStop.contextPct);
    for (const nextOp of ops) await applyRegularOp(pane, nextOp);
  } finally {
    const unlock = await tmuxRun(["wait-for", "-U", lockName]);
    if (unlock.code !== 0) {
      console.error(
        `codex-pane-status: tmux wait-for unlock failed: ${unlock.stderr}`,
      );
    }
  }
}

async function applyOp(pane: string, op: PaneOp): Promise<void> {
  if (op.kind === "set" && "childSessionStart" in op) {
    await applyChildSessionStart(pane, op);
    return;
  }
  if (op.kind === "set" && "subagentMutation" in op) {
    await applySubagentMutation(pane, op);
    return;
  }
  if (op.kind === "set" && "parentStop" in op) {
    await applyParentStop(pane, op);
    return;
  }
  await applyRegularOp(pane, op);
}

export interface RunLog {
  ts: string;
  argv_event: string;
  stdin_event: string | null;
  session_id: string | null;
  tmux_pane: string | null;
  cwd: string | null;
  pre_state: PaneState | null;
  ops: Array<{ kind: "set" | "unset"; key: string }>;
  early_exit: string | null;
  stdin_event_mismatch: boolean;
}

export function buildRunLog(args: {
  event: string;
  data: HookData;
  pane: string | null;
  state: PaneState | null;
  ops: Op[];
  earlyExit: string | null;
  stdinEventMismatch: boolean;
  now?: Date;
}): RunLog {
  return {
    ts: (args.now ?? new Date()).toISOString(),
    argv_event: args.event,
    stdin_event: str(args.data.hook_event_name) || null,
    session_id: str(args.data.session_id) || null,
    tmux_pane: args.pane,
    cwd: str(args.data.cwd) || null,
    pre_state: args.state,
    ops: args.ops.map((op) => ({ kind: op.kind, key: op.key })),
    early_exit: args.earlyExit,
    stdin_event_mismatch: args.stdinEventMismatch,
  };
}

async function appendRunLog(record: RunLog): Promise<void> {
  try {
    await Deno.mkdir(`${Deno.env.get("HOME") ?? "."}/.codex/logs`, {
      recursive: true,
    });
    try {
      const content = await Deno.readTextFile(LOG_FILE);
      const lines = content.split("\n");
      if (lines.length > LOG_MAX_LINES) {
        await Deno.writeTextFile(
          LOG_FILE,
          lines.slice(-LOG_MAX_LINES).join("\n"),
        );
      }
    } catch {
      // no log yet
    }
    await Deno.writeTextFile(LOG_FILE, JSON.stringify(record) + "\n", {
      append: true,
    });
  } catch {
    // picker state is more important than diagnostics
  }
}

async function main(): Promise<void> {
  const event = Deno.args[0] ?? "";
  if (!event) {
    await appendRunLog(buildRunLog({
      event,
      data: {},
      pane: Deno.env.get("TMUX_PANE") ?? null,
      state: null,
      ops: [],
      earlyExit: "no-event",
      stdinEventMismatch: false,
    }));
    return;
  }

  const pane = Deno.env.get("TMUX_PANE");
  if (!pane) {
    console.error("codex-pane-status: early_exit=no-tmux-pane");
    await appendRunLog(buildRunLog({
      event,
      data: {},
      pane: null,
      state: null,
      ops: [],
      earlyExit: "no-tmux-pane",
      stdinEventMismatch: false,
    }));
    return;
  }
  if (!/^%\d+$/.test(pane)) {
    console.error("codex-pane-status: early_exit=invalid-pane-id");
    await appendRunLog(buildRunLog({
      event,
      data: {},
      pane,
      state: null,
      ops: [],
      earlyExit: "invalid-pane-id",
      stdinEventMismatch: false,
    }));
    return;
  }

  if (await isEmbedded(Deno.pid, fetchParent)) {
    await appendRunLog(buildRunLog({
      event,
      data: {},
      pane,
      state: null,
      ops: [],
      earlyExit: "embedded",
      stdinEventMismatch: false,
    }));
    return;
  }

  let data: HookData = {};
  const raw = await new Response(Deno.stdin.readable).text();
  if (raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed as HookData;
      }
    } catch {
      console.error("codex-pane-status: failed to parse stdin JSON");
      await appendRunLog(buildRunLog({
        event,
        data,
        pane,
        state: null,
        ops: [],
        earlyExit: "json-parse-error",
        stdinEventMismatch: false,
      }));
      return;
    }
  }

  const stdinEvent = str(data.hook_event_name);
  const mismatch = Boolean(stdinEvent && stdinEvent !== event);
  if (stdinEvent && stdinEvent !== event) {
    console.error(
      `codex-pane-status: argv event (${event}) != stdin event (${stdinEvent}); using argv`,
    );
  }

  const state = await readPaneState(pane);
  const ops = await eventToOps(event, data, state);
  for (const op of ops) await applyOp(pane, op);
  await appendRunLog(buildRunLog({
    event,
    data,
    pane,
    state,
    ops,
    earlyExit: ops.length === 0 ? "no-ops" : null,
    stdinEventMismatch: mismatch,
  }));
}

if (import.meta.main) {
  await main();
}
