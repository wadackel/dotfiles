#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=HOME

const DEFAULT_LOG_FILE = `${
  Deno.env.get("HOME") ?? "."
}/.codex/logs/hooks.jsonl`;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_LINES_KEEP = 50_000;
const STRING_MAX = 2000;
const TOTAL_MAX = 8000;

export interface LogEntry {
  ts: string;
  event: string;
  session_id: string;
  cwd: string;
  tool_name: string;
  payload: Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function truncate(raw: string, max = STRING_MAX): string {
  return raw.length > max ? raw.slice(0, max) : raw;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return truncate(value);
  if (
    typeof value === "number" || typeof value === "boolean" || value === null
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map(sanitizeValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (
      const [key, nested] of Object.entries(value as Record<string, unknown>)
    ) {
      if (key === "content" && typeof nested === "string") {
        out.content_length = nested.length;
        continue;
      }
      out[key] = sanitizeValue(nested);
    }
    return out;
  }
  return undefined;
}

export function sanitizePayload(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "transcript_path") {
      out[key] = value;
      continue;
    }
    out[key] = sanitizeValue(value);
  }
  const serialized = JSON.stringify(out);
  if (serialized.length <= TOTAL_MAX) return out;
  return {
    _truncated: true,
    keys: Object.keys(input),
    hook_event_name: input.hook_event_name,
    tool_name: input.tool_name,
    session_id: input.session_id,
    cwd: input.cwd,
  };
}

export function buildLogEntry(
  eventArg: string,
  input: Record<string, unknown>,
  now = new Date(),
): LogEntry {
  const event = eventArg || str(input.hook_event_name) || "unknown";
  return {
    ts: now.toISOString(),
    event,
    session_id: str(input.session_id),
    cwd: str(input.cwd),
    tool_name: str(input.tool_name),
    payload: sanitizePayload(input),
  };
}

export function rotateIfNeeded(logFile: string): void {
  try {
    const stat = Deno.statSync(logFile);
    if (stat.size <= MAX_FILE_SIZE) return;
    const content = Deno.readTextFileSync(logFile);
    const kept = content.split("\n").filter((line) => line.trim()).slice(
      -MAX_LINES_KEEP,
    );
    Deno.writeTextFileSync(logFile, kept.join("\n") + "\n");
  } catch {
    // no log yet
  }
}

async function readJsonFromStdin(): Promise<Record<string, unknown>> {
  try {
    const raw = await new Response(Deno.stdin.readable).text();
    if (!raw.trim()) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // log hook must fail open
  }
  return {};
}

async function appendLog(logFile: string, entry: LogEntry): Promise<void> {
  await Deno.mkdir(logFile.split("/").slice(0, -1).join("/"), {
    recursive: true,
  });
  rotateIfNeeded(logFile);
  await Deno.writeTextFile(logFile, JSON.stringify(entry) + "\n", {
    append: true,
  });
}

if (import.meta.main) {
  try {
    const input = await readJsonFromStdin();
    const entry = buildLogEntry(Deno.args[0] ?? "", input);
    await appendLog(DEFAULT_LOG_FILE, entry);
  } catch {
    // Never break Codex because observability failed.
  }
}
