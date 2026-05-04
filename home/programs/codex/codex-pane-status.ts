#!/usr/bin/env -S deno run --allow-env=TMUX_PANE --allow-read --allow-run=tmux

// Bridges Codex CLI lifecycle hooks to tmux pane options for the popup picker.
// Invoked as: codex-pane-status.ts <EventName>. Unknown events are no-op exit 0.

type HookData = Record<string, unknown> & {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  prompt?: string;
  source?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_response?: unknown;
  transcript_path?: string | null;
};

export type Op =
  | { kind: "set"; key: string; value: string }
  | { kind: "unset"; key: string };

export interface PaneState {
  status: string;
  currentTool: string;
  currentToolUseId: string;
  agent: string;
  sessionId: string;
}

export const ALL_PANE_OPTIONS = [
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
] as const;

export const CLAUDE_ONLY_KEYS = [
  "@pane_subagents",
  "@pane_pending_teardown",
  "@pane_main_stopped",
  "@pane_worktree_branch",
  "@pane_worktree_path",
  "@pane_last_edit_file",
  "@pane_current_tool_subject",
  "@pane_last_tool_subject",
] as const;

export const RESUME_TRANSIENT_KEYS = [
  "@pane_current_tool",
  "@pane_current_tool_use_id",
  "@pane_wait_reason",
] as const;

const STALE_AT_SESSION_START = ALL_PANE_OPTIONS.filter((key) =>
  key !== "@pane_agent" && key !== "@pane_session_id" && key !== "@pane_cwd"
);

const PROMPT_MAX_CHARS = 40;
const TOOL_ERROR_MAX_CHARS = 40;
const TOKEN_TAIL_BYTES = 64 * 1024;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function truncate(raw: string, max: number): string {
  const clean = raw.replace(/[\x00-\x1f\x7f]+/g, " ");
  return clean.length > max ? clean.slice(0, max) + "..." : clean;
}

export function maskPrompt(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  const flat = raw.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/ {2,}/g, " ")
    .trim();
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
      body.push(...resumeOpsIfStuck(state));
      body.push({ kind: "set", key: "@pane_current_tool", value: toolName });
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
      }
      body.push({ kind: "set", key: "@pane_last_tool", value: toolName });
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

async function main(): Promise<void> {
  const event = Deno.args[0] ?? "";
  if (!event) return;

  const pane = Deno.env.get("TMUX_PANE");
  if (!pane) {
    console.error("codex-pane-status: early_exit=no-tmux-pane");
    return;
  }
  if (!/^%\d+$/.test(pane)) {
    console.error("codex-pane-status: early_exit=invalid-pane-id");
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
      return;
    }
  }

  const stdinEvent = str(data.hook_event_name);
  if (stdinEvent && stdinEvent !== event) {
    console.error(
      `codex-pane-status: argv event (${event}) != stdin event (${stdinEvent}); using argv`,
    );
  }

  const state = await readPaneState(pane);
  const ops = await eventToOps(event, data, state);
  for (const op of ops) await applyOp(pane, op);
}

if (import.meta.main) {
  await main();
}
