#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=HOME

// PermissionRequest hook: logs all permission requests to JSONL for later analysis.
// IMPORTANT: stdout output is strictly forbidden — it would be interpreted as a
// hook decision and break the approve-piped-commands.ts hook chain.

// --- Constants ---

const LOG_DIR = `${Deno.env.get("HOME")}/.claude/logs`;
const LOG_FILE = `${LOG_DIR}/permission-requests.jsonl`;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_LINES_KEEP = 50_000;

// --- Types ---

interface HookInput {
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  permission_suggestions?: unknown[];
}

interface LogEntry {
  ts: string;
  sid: string;
  tool: string;
  input: Record<string, unknown>;
  cwd: string;
  project: string;
  permission_suggestions?: unknown[];
}

// --- Sanitization ---

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

export function sanitizeInput(
  toolName: string,
  toolInput: Record<string, unknown>,
): Record<string, unknown> {
  const input = { ...toolInput };

  switch (toolName) {
    case "Bash": {
      const cmd = input.command;
      if (typeof cmd === "string" && cmd.length > 2000) {
        input.command = truncate(cmd, 2000);
        input.truncated = cmd.length;
      }
      break;
    }
    case "Write": {
      if (typeof input.content === "string") {
        input.content_length = (input.content as string).length;
        delete input.content;
      }
      break;
    }
    case "Edit": {
      if (typeof input.old_string === "string") {
        input.old_string = truncate(input.old_string, 500);
      }
      if (typeof input.new_string === "string") {
        input.new_string = truncate(input.new_string, 500);
      }
      break;
    }
    case "WebFetch": {
      if (typeof input.prompt === "string") {
        input.prompt = truncate(input.prompt, 500);
      }
      break;
    }
    default: {
      for (const key of Object.keys(input)) {
        if (typeof input[key] === "string") {
          input[key] = truncate(input[key] as string, 2000);
        }
      }
      break;
    }
  }

  // Total size guard for deeply nested MCP tool inputs
  const serialized = JSON.stringify(input);
  if (serialized.length > 4000) {
    return { _truncated: true, tool: toolName, keys: Object.keys(toolInput) };
  }

  return input;
}

// --- Log Rotation ---

export function rotateIfNeeded(logFile: string): void {
  try {
    const stat = Deno.statSync(logFile);
    if (stat.size <= MAX_FILE_SIZE) return;

    const content = Deno.readTextFileSync(logFile);
    const lines = content.split("\n").filter((l) => l.trim());
    const kept = lines.slice(-MAX_LINES_KEEP);
    Deno.writeTextFileSync(logFile, kept.join("\n") + "\n");
  } catch {
    // File doesn't exist or other error — nothing to rotate
  }
}

// --- Project Derivation ---

export function deriveProject(cwd: string): string {
  const parts = cwd.split("/");
  return parts[parts.length - 1] || "unknown";
}

// --- Main ---

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await new Response(Deno.stdin.readable).text();
  } catch {
    return;
  }

  let hookData: HookInput;
  try {
    hookData = JSON.parse(raw);
  } catch {
    console.error(`permission-logger: failed to parse stdin JSON`);
    return;
  }

  const toolName = hookData.tool_name ?? "";
  const toolInput = hookData.tool_input ?? {};
  const cwd = hookData.cwd ?? "";
  const sessionId = hookData.session_id ?? "";

  try {
    Deno.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // Directory may already exist
  }

  try {
    rotateIfNeeded(LOG_FILE);
  } catch {
    // Non-fatal
  }

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    sid: sessionId.slice(0, 8),
    tool: toolName,
    input: sanitizeInput(toolName, toolInput),
    cwd,
    project: deriveProject(cwd),
  };

  if (
    hookData.permission_suggestions &&
    hookData.permission_suggestions.length > 0
  ) {
    entry.permission_suggestions = hookData.permission_suggestions;
  }

  try {
    Deno.writeTextFileSync(LOG_FILE, JSON.stringify(entry) + "\n", {
      append: true,
    });
  } catch (e) {
    console.error(`permission-logger: write failed: ${e}`);
  }

  // Exit 0, no stdout — critical for hook chain integrity
}

main().catch((e) => {
  console.error(`permission-logger: ${e}`);
});
