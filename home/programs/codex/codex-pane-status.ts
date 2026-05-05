#!/usr/bin/env -S deno run --allow-env=HOME,TMUX_PANE --allow-read --allow-write --allow-run=tmux,ps

// Bridges Codex CLI lifecycle hooks to tmux pane options for the popup picker.
// Invoked as: codex-pane-status.ts <EventName>. Unknown events are no-op exit 0.

import { isEmbedded, parsePsLine, type PsRow } from "./agent-presence.ts";
import {
  ALL_PANE_OPTIONS_FOR_CODEX,
  CLAUDE_ONLY_KEYS as SHARED_CLAUDE_ONLY_KEYS,
  type Op,
  PROMPT_MAX_CHARS,
  TOOL_ERROR_MAX_CHARS,
  TOOL_SUBJECT_MAX_CHARS,
} from "./pane-shared.ts";

// Re-export for legacy test imports + downstream consumers.
export { type Op };

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
}

export const ALL_PANE_OPTIONS = ALL_PANE_OPTIONS_FOR_CODEX;

export const CLAUDE_ONLY_KEYS = SHARED_CLAUDE_ONLY_KEYS;

// codex-only resume path key set — no parallel concept in claude/opencode.
export const RESUME_TRANSIENT_KEYS = [
  "@pane_current_tool",
  "@pane_current_tool_use_id",
  "@pane_wait_reason",
] as const;

// Derived (codex-shape) — diverges from claude's manually enumerated equivalent;
// not unified into pane-shared.ts (Intentional Convention: per-writer local).
const STALE_AT_SESSION_START = ALL_PANE_OPTIONS.filter((key) =>
  key !== "@pane_agent" && key !== "@pane_session_id" && key !== "@pane_cwd"
);

const TOKEN_TAIL_BYTES = 64 * 1024;
const LOG_MAX_LINES = 1000;
const LOG_FILE = `${
  Deno.env.get("HOME") ?? "."
}/.codex/logs/codex-pane-status.log`;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function truncate(raw: string, max: number): string {
  const clean = stripControls(raw);
  return clean.length > max ? clean.slice(0, max) + "..." : clean;
}

function stripControls(raw: string): string {
  return Array.from(raw, (ch) => {
    const code = ch.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? " " : ch;
  }).join("");
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
  return subject ? truncate(subject, TOOL_SUBJECT_MAX_CHARS) : "";
}

export function extractEditFile(toolName: string, toolInput: unknown): string {
  if (toolName !== "Edit" && toolName !== "Write" && toolName !== "MultiEdit") {
    return "";
  }
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return "";
  }
  const filePath = (toolInput as Record<string, unknown>).file_path;
  return typeof filePath === "string" ? stripControls(filePath) : "";
}

export function maskPrompt(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  const flat = stripControls(raw).replace(/ {2,}/g, " ").trim();
  return flat.length > PROMPT_MAX_CHARS
    ? flat.slice(0, PROMPT_MAX_CHARS) + "..."
    : flat;
}

export function selfHealOps(data: HookData): Op[] {
  const sid = str(data.session_id);
  if (!sid) return [];
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

export function extractToolError(toolResponse: unknown): string | null {
  if (typeof toolResponse !== "string") return null;
  if (!toolResponse.startsWith("Error")) return null;
  return truncate(toolResponse.replace(/^Error:\s*/, ""), TOOL_ERROR_MAX_CHARS);
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

function unsetOps(keys: readonly string[]): Op[] {
  return keys.map((key) => ({ kind: "unset" as const, key }));
}

export async function eventToOps(
  event: string,
  data: HookData,
  state: PaneState,
): Promise<Op[]> {
  const body: Op[] = [];

  switch (event) {
    case "SessionStart": {
      const source = str(data.source);
      const sameCodexSession = state.agent === "codex" &&
        state.sessionId === str(data.session_id);
      if (source === "resume" && sameCodexSession) {
        body.push(...unsetOps(CLAUDE_ONLY_KEYS));
        body.push(...unsetOps(RESUME_TRANSIENT_KEYS));
      } else {
        body.push(...unsetOps(STALE_AT_SESSION_START));
      }
      body.push({ kind: "set", key: "@pane_status", value: "idle" });
      body.push({
        kind: "set",
        key: "@pane_last_activity_at",
        value: nowSec(),
      });
      break;
    }

    case "UserPromptSubmit": {
      const prompt = maskPrompt(data.prompt);
      const now = nowSec();
      body.push({ kind: "set", key: "@pane_status", value: "running" });
      body.push({ kind: "set", key: "@pane_started_at", value: now });
      body.push({ kind: "set", key: "@pane_last_activity_at", value: now });
      body.push(
        prompt
          ? { kind: "set", key: "@pane_prompt", value: prompt }
          : { kind: "unset", key: "@pane_prompt" },
      );
      break;
    }

    case "PreToolUse": {
      const toolName = str(data.tool_name);
      if (!toolName) return [];
      const subject = extractToolSubject(toolName, data.tool_input);
      body.push(...resumeOpsIfStuck(state));
      body.push({ kind: "set", key: "@pane_current_tool", value: toolName });
      body.push(
        subject
          ? { kind: "set", key: "@pane_current_tool_subject", value: subject }
          : { kind: "unset", key: "@pane_current_tool_subject" },
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
      body.push({ kind: "set", key: "@pane_status", value: "idle" });
      body.push({
        kind: "set",
        key: "@pane_last_activity_at",
        value: nowSec(),
      });
      const pct = await extractTokenPct(
        typeof data.transcript_path === "string" ? data.transcript_path : null,
      );
      body.push(
        pct === null
          ? { kind: "unset", key: "@pane_context_used_pct" }
          : { kind: "set", key: "@pane_context_used_pct", value: String(pct) },
      );
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

async function tmuxRun(
  args: string[],
): Promise<{ code: number; stderr: string }> {
  const { code, stderr } = await new Deno.Command("tmux", {
    args,
    stdin: "null",
    stdout: "null",
    stderr: "piped",
    signal: AbortSignal.timeout(2000),
  }).output();
  return { code, stderr: new TextDecoder().decode(stderr).trim() };
}

async function tmuxShow(pane: string, key: string): Promise<string> {
  try {
    const { stdout } = await new Deno.Command("tmux", {
      args: ["show", "-t", pane, "-pv", key],
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      signal: AbortSignal.timeout(2000),
    }).output();
    return new TextDecoder().decode(stdout).trim();
  } catch {
    return "";
  }
}

async function readPaneState(pane: string): Promise<PaneState> {
  const [status, currentTool, currentToolUseId, agent, sessionId] =
    await Promise.all([
      tmuxShow(pane, "@pane_status"),
      tmuxShow(pane, "@pane_current_tool"),
      tmuxShow(pane, "@pane_current_tool_use_id"),
      tmuxShow(pane, "@pane_agent"),
      tmuxShow(pane, "@pane_session_id"),
    ]);
  return { status, currentTool, currentToolUseId, agent, sessionId };
}

async function applyOp(pane: string, op: Op): Promise<void> {
  const args = op.kind === "set"
    ? ["set", "-t", pane, "-p", op.key, op.value]
    : ["set", "-t", pane, "-p", "-u", op.key];
  const { code, stderr } = await tmuxRun(args);
  if (code !== 0) {
    console.error(`codex-pane-status: tmux set ${op.key} failed: ${stderr}`);
  }
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
