// Pure event → tmux pane-option op converter for the opencode plugin.
// Mirrors home/programs/claude/scripts/claude-pane-status.ts:eventToOps so the
// picker reads `@pane_*` from both agents through one shared format. Bun-only
// I/O lives in plugin.ts; this file is runtime-agnostic so Deno can test it.

// --- Types ---

export type Op =
  | { kind: "set"; key: string; value: string }
  | { kind: "unset"; key: string };

export interface PaneState {
  status: string;
  currentTool: string;
}

// Hook payloads sent by opencode are heterogenous: generic `event:` callbacks
// surface as `{ type, properties: { sessionID, info?, ... } }`, while named
// hooks (`chat.message`, `tool.execute.before`, `tool.execute.after`,
// `permission.ask`) surface flat `{ sessionID, ... }`. selfHealOps and
// eventToOps accept either shape via duck-typing on this loose type.
export type HookData = Record<string, unknown>;

// --- Constants ---

// Every @pane_* option opencode-pane-status may write. Kept identical to the
// claude-side ALL_PANE_OPTIONS minus the Claude-only subagent / teardown /
// main-stopped keys, since opencode has no subagent concept.
export const ALL_PANE_OPTIONS = [
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
] as const;

const PROMPT_MAX_CHARS = 40;
const TOOL_MAX_CHARS = 24;

// --- Pure helpers ---

export function maskPrompt(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  // Strip C0/C1 control bytes then collapse whitespace runs. Mirrors
  // claude-pane-status.ts:maskPrompt — same threat model (a crafted prompt
  // containing $'\x1b[2J' could otherwise clear the picker user's screen
  // when tmux renders the option value).
  // deno-lint-ignore no-control-regex
  const flat = raw.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/ {2,}/g, " ")
    .trim();
  if (flat.length <= PROMPT_MAX_CHARS) return flat;
  return flat.slice(0, PROMPT_MAX_CHARS) + "…";
}

export function truncate(raw: string, max: number): string {
  // deno-lint-ignore no-control-regex
  const clean = raw.replace(/[\x00-\x1f\x7f]+/g, " ");
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Pull `sessionID` (camelCase, opencode payload convention) or
// `session_id` (snake_case, defensive) from the hook data, regardless of
// whether the payload was a flat named-hook input or a generic event whose
// `properties` carries the id.
function readSessionId(data: HookData): string {
  return str(data.sessionID) || str(data.session_id) ||
    str((data.properties as HookData | undefined)?.sessionID);
}

// Same for cwd — opencode's `session.created` event places it under
// `properties.info.directory`. Named hooks don't carry cwd directly but
// plugin.ts can pass it through if it queries the SDK first.
function readCwd(data: HookData): string {
  const direct = str(data.cwd) || str(data.directory);
  if (direct) return direct;
  const props = data.properties as HookData | undefined;
  if (!props) return "";
  return str(props.cwd) ||
    str((props.info as HookData | undefined)?.directory);
}

// Extract a short tool name. opencode's tool.execute payload carries `tool`
// which is conventionally a string, but plugin runtimes have evolved before:
// fall back to JSON.stringify(slice) when the field is structured so the
// pane option is at least debuggable rather than empty.
function extractToolName(rawTool: unknown): string {
  if (typeof rawTool === "string") return truncate(rawTool, TOOL_MAX_CHARS);
  if (rawTool === null || rawTool === undefined) return "";
  try {
    return truncate(JSON.stringify(rawTool), TOOL_MAX_CHARS);
  } catch {
    return "";
  }
}

// --- selfHealOps (mirror of claude-pane-status.ts:selfHealOps) ---

export function selfHealOps(data: HookData): Op[] {
  const sid = readSessionId(data);
  if (!sid) return [];
  const ops: Op[] = [
    { kind: "set", key: "@pane_agent", value: "opencode" },
    { kind: "set", key: "@pane_session_id", value: sid },
  ];
  const cwd = readCwd(data);
  if (cwd) ops.push({ kind: "set", key: "@pane_cwd", value: cwd });
  return ops;
}

// --- Event → Op mapping (pure, exported for tests) ---

export function eventToOps(
  event: string,
  data: HookData,
  state: PaneState,
): Op[] {
  // Drain on session.deleted regardless of state.
  if (event === "session.deleted") {
    return ALL_PANE_OPTIONS.map((key) => ({ kind: "unset" as const, key }));
  }

  const body: Op[] = (() => {
    switch (event) {
      case "session.created": {
        const now = String(Math.floor(Date.now() / 1000));
        return [
          { kind: "set", key: "@pane_status", value: "idle" },
          { kind: "set", key: "@pane_started_at", value: now },
          { kind: "set", key: "@pane_last_activity_at", value: now },
        ];
      }

      case "session.idle": {
        // Deprecated alias: opencode emits this when a session transitions
        // to idle. Kept for forward-compat with older opencode versions.
        return [{ kind: "set", key: "@pane_status", value: "idle" }];
      }

      case "session.status": {
        // Properties carry { type: "busy" | "idle" } in current opencode.
        // Map busy→running, idle→idle, anything else→no-op so a future
        // status enum addition doesn't regress to the wrong state.
        const props = data.properties as HookData | undefined;
        const t = str(props?.type) || str(data.type);
        if (t === "busy") {
          return [{ kind: "set", key: "@pane_status", value: "running" }];
        }
        if (t === "idle") {
          return [{ kind: "set", key: "@pane_status", value: "idle" }];
        }
        return [];
      }

      case "session.error": {
        const props = data.properties as HookData | undefined;
        const reason = str(props?.error) || str(data.error) || "error";
        return [
          { kind: "set", key: "@pane_status", value: "error" },
          { kind: "set", key: "@pane_wait_reason", value: reason },
        ];
      }

      case "chat.message": {
        // User submitted a prompt — entering the running state. opencode's
        // docs describe `output: { message, parts: Part[] }` where parts is
        // an array of `{ type: "text", text: string }`-like objects (the
        // user message body lives in parts, not in message.content). We
        // accept (a) a top-level `prompt` (debug fixtures), (b) the parts
        // array, (c) `message.content` fallback for older opencode shapes,
        // so the pure function is testable without rebuilding the full
        // message tree and forward-compatible with shape evolution.
        const output = data.output as HookData | undefined;
        const message = output?.message as HookData | undefined;
        const parts = output?.parts as Array<HookData> | undefined;
        const partsText = Array.isArray(parts)
          ? parts.find((p) => str(p.type) === "text" && str(p.text))?.text ??
            ""
          : "";
        const promptText = str(data.prompt) || str(partsText) ||
          str(message?.content);
        const now = String(Math.floor(Date.now() / 1000));
        const ops: Op[] = [
          { kind: "set", key: "@pane_status", value: "running" },
          { kind: "set", key: "@pane_started_at", value: now },
          { kind: "set", key: "@pane_last_activity_at", value: now },
        ];
        const masked = maskPrompt(promptText);
        if (masked) {
          ops.push({ kind: "set", key: "@pane_prompt", value: masked });
        } else {
          ops.push({ kind: "unset", key: "@pane_prompt" });
        }
        return ops;
      }

      case "tool.execute.before": {
        const toolName = extractToolName(data.tool);
        if (!toolName) return [];
        return [{ kind: "set", key: "@pane_current_tool", value: toolName }];
      }

      case "tool.execute.after": {
        const toolName = extractToolName(data.tool);
        const now = String(Math.floor(Date.now() / 1000));
        const ops: Op[] = [
          { kind: "set", key: "@pane_last_activity_at", value: now },
        ];
        if (!toolName) return ops;
        if (toolName === state.currentTool) {
          ops.push({ kind: "unset", key: "@pane_current_tool" });
        }
        ops.push({ kind: "set", key: "@pane_last_tool", value: toolName });
        return ops;
      }

      case "permission.ask": {
        return [
          { kind: "set", key: "@pane_status", value: "waiting" },
          { kind: "set", key: "@pane_wait_reason", value: "permission" },
        ];
      }

      default:
        return [];
    }
  })();

  if (body.length === 0) return [];
  return [...selfHealOps(data), ...body];
}
