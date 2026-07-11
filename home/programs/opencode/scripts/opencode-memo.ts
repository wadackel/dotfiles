#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=HOME,TMPDIR --allow-run=git,claude,sqlite3

// opencode session-end memo: bridges opencode sessions → Obsidian Daily Note.
// Invoked by home/programs/opencode/plugin.ts on session.idle /
// session.status:idle, via Bun.spawn with stdin = JSON {session_id, cwd}.
// Plugin already detaches the worker (unref + ignored stdio), so this script
// runs the heuristic-write → debounce → Claude → upsert flow inline rather
// than the two-stage mainHook/mainWorker structure used by codex-memo.

import {
  callClaude,
  dailyNotePath,
  debounceStatePath,
  escapeObsidianSyntax,
  nowTimestamp,
  repoNameFor,
  saveDebounceState,
  shouldRunLLM,
  upsertDailyNote,
} from "./memo-shared.ts";

// --- Types ---

interface HookData {
  session_id: string;
  cwd?: string;
}

export interface MessageRow {
  id: string;
  role: "user" | "assistant" | string;
}

export interface PartRow {
  message_id: string;
  type: string;
  text: string | null;
  tool: string | null;
}

export interface ParseResult {
  user: string[];
  assistant: string[];
  toolCounts: Map<string, number>;
}

// --- Logging ---

const LOG_FILE = `${Deno.env.get("TMPDIR") ?? "/tmp"}/opencode-memo.log`;
const MAX_LOG_BYTES = 200 * 1024;

async function rotateLog(): Promise<void> {
  try {
    const stat = await Deno.stat(LOG_FILE);
    if (stat.size > MAX_LOG_BYTES) {
      const content = await Deno.readTextFile(LOG_FILE);
      const lines = content.split("\n");
      await Deno.writeTextFile(LOG_FILE, lines.slice(-500).join("\n") + "\n");
    }
  } catch {
    // no log yet
  }
}

async function log(msg: string): Promise<void> {
  try {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    await Deno.writeTextFile(LOG_FILE, `[${ts}] ${msg}\n`, { append: true });
  } catch {
    // memo logging must not break opencode plugin
  }
}

// --- Hook validation ---

// Format documented and validated empirically against opencode 1.14.30 SQLite
// (`SELECT id FROM session;` returns rows like ses_207e2d5c2ffeuGCp036WZmtae3).
const SESSION_ID_RE = /^ses_[A-Za-z0-9]+$/;

export function validateHookData(raw: unknown): HookData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const sessionId = r.session_id;
  const cwd = r.cwd;
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
    return null;
  }
  if (cwd !== undefined && typeof cwd !== "string") return null;
  return {
    session_id: sessionId,
    cwd: cwd as string | undefined,
  };
}

// --- Noise patterns + heuristic ---

const NOISE_PATTERNS: RegExp[] = [
  /^# AGENTS\.md/,
  /^<skill>/,
  /^<command-message>/,
  /^@\S+:\d+\s*$/,
  /^\/\w/,
  /^\[Request interrupted/,
  /^ok$/i,
  /^はい$/,
  /^いいね$/,
  /^yes$/i,
  /^no$/i,
  /^done$/i,
  /^continue$/i,
  /^続けて$/,
];

export function isNoise(text: string): boolean {
  const t = text.trim();
  if (t.length <= 5) return true;
  return NOISE_PATTERNS.some((p) => p.test(t));
}

function stripControls(raw: string): string {
  return Array.from(raw, (ch) => {
    const code = ch.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? " " : ch;
  }).join("");
}

// --- SQLite I/O (impure; tested only via integration) ---

function dbPath(): string {
  return `${Deno.env.get("HOME")}/.local/share/opencode/opencode-stable.db`;
}

async function runSqliteJson(query: string): Promise<unknown[]> {
  const cmd = new Deno.Command("sqlite3", {
    args: ["-json", dbPath(), query],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    const errMsg = new TextDecoder().decode(stderr).trim().slice(0, 200);
    throw new Error(`sqlite3 exit=${code}: ${errMsg}`);
  }
  const out = new TextDecoder().decode(stdout).trim();
  if (!out) return [];
  return JSON.parse(out) as unknown[];
}

async function getRowsForSession(
  sessionId: string,
): Promise<{ messages: MessageRow[]; parts: PartRow[] }> {
  // session_id was already validated against SESSION_ID_RE before reaching
  // here, so direct interpolation is injection-safe.
  const messageQuery =
    `SELECT id, json_extract(data, '$.role') AS role FROM message WHERE session_id = '${sessionId}' ORDER BY time_created`;
  const partQuery =
    `SELECT message_id, json_extract(data, '$.type') AS type, json_extract(data, '$.text') AS text, json_extract(data, '$.tool') AS tool FROM part WHERE session_id = '${sessionId}' ORDER BY time_created`;
  const messages = await runSqliteJson(messageQuery) as MessageRow[];
  const parts = await runSqliteJson(partQuery) as PartRow[];
  return { messages, parts };
}

// --- Pure parser (tested directly) ---

export function parseRows(
  messages: MessageRow[],
  parts: PartRow[],
): ParseResult {
  const roleByMessageId = new Map<string, string>();
  for (const m of messages) {
    roleByMessageId.set(m.id, m.role);
  }
  const user: string[] = [];
  const assistant: string[] = [];
  const toolCounts = new Map<string, number>();
  for (const p of parts) {
    const role = roleByMessageId.get(p.message_id);
    if (p.type === "text" && p.text) {
      if (role === "user") user.push(p.text);
      else if (role === "assistant") assistant.push(p.text);
    } else if (p.type === "tool" && p.tool) {
      toolCounts.set(p.tool, (toolCounts.get(p.tool) ?? 0) + 1);
    }
  }
  return { user, assistant, toolCounts };
}

export function formatToolSummary(
  toolCounts: Map<string, number>,
): string {
  return [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ");
}

// --- Heuristic + LLM input ---

export function heuristicSummary(parsed: ParseResult): string {
  for (const text of parsed.user) {
    if (!isNoise(text)) {
      return stripControls(text).replace(/\s+/g, " ").slice(0, 100).trimEnd();
    }
  }
  if (parsed.assistant.length > 0) {
    return stripControls(parsed.assistant[0]).replace(/\s+/g, " ").slice(0, 100)
      .trimEnd();
  }
  const tools = formatToolSummary(parsed.toolCounts);
  if (tools) return `${tools} を使用`;
  return "";
}

export function buildLLMInput(parsed: ParseResult): string {
  const parts: string[] = [];
  const userTexts = parsed.user.filter((t) => !isNoise(t));
  if (userTexts.length > 0) {
    parts.push("[User prompts]");
    for (const t of userTexts) {
      parts.push(`- ${stripControls(t).replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }
  if (parsed.assistant.length > 0) {
    parts.push("\n[First assistant response]");
    parts.push(
      stripControls(parsed.assistant[0]).replace(/\s+/g, " ").slice(0, 300),
    );
  }
  if (parsed.assistant.length > 1) {
    parts.push("\n[Last assistant response]");
    parts.push(
      stripControls(parsed.assistant.at(-1)!).replace(/\s+/g, " ").slice(0, 300),
    );
  }
  const tools = formatToolSummary(parsed.toolCounts);
  if (tools) {
    parts.push("\n[Actions taken]");
    parts.push(tools);
  }
  return parts.join("\n").slice(0, 3000);
}

export function countUserMessages(parsed: ParseResult): number {
  return parsed.user.filter((t) => !isNoise(t)).length;
}

// --- Main ---

async function main(): Promise<void> {
  await rotateLog();

  const stdinData = await new Response(Deno.stdin.readable).text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdinData);
  } catch {
    await log(`ERROR: failed to parse stdin JSON len=${stdinData.length}`);
    return;
  }
  const hookData = validateHookData(parsed);
  if (!hookData) {
    await log("ERROR: invalid hook data");
    return;
  }

  const sessionId = hookData.session_id;
  const sessionShort = sessionId.slice(0, 8);
  const cwd = hookData.cwd ?? Deno.cwd();
  await log(`START: session=${sessionShort} cwd=${cwd}`);

  let rows: { messages: MessageRow[]; parts: PartRow[] };
  try {
    rows = await getRowsForSession(sessionId);
  } catch (e) {
    await log(`SKIP: cannot read SQLite: ${e}`);
    return;
  }

  const dailyPath = dailyNotePath();
  try {
    await Deno.stat(dailyPath);
  } catch {
    await log(`SKIP: daily note not found: ${dailyPath}`);
    return;
  }

  const parsedRows = parseRows(rows.messages, rows.parts);
  const heuristic = heuristicSummary(parsedRows);
  if (!heuristic) {
    await log("SKIP: no summary extractable");
    return;
  }

  const repoName = await repoNameFor(cwd);
  const timestamp = nowTimestamp();
  const userCount = countUserMessages(parsedRows);
  const statePath = debounceStatePath("opencode", sessionShort);

  const dailyContent = Deno.readTextFileSync(dailyPath);
  const hasExistingEntry = dailyContent.includes(`/${sessionShort})`);
  const runLLM = shouldRunLLM(statePath, userCount);

  if (!runLLM && hasExistingEntry) {
    await log(`DEBOUNCE: skip (userCount=${userCount}, entry exists)`);
    return;
  }

  const heuristicLines = [
    `- ${timestamp} - \`(${repoName}/${sessionShort})\` ${
      escapeObsidianSyntax(heuristic)
    }`,
  ];
  upsertDailyNote(dailyPath, sessionShort, heuristicLines);
  await log(`HEURISTIC: ${heuristicLines[0]}`);

  if (!runLLM) {
    await log(`DEBOUNCE: skip LLM (userCount=${userCount}, no new messages)`);
    return;
  }

  const condensed = buildLLMInput(parsedRows);
  await log(
    `LLM: calling claude -p (haiku) (userCount=${userCount}, condensed=${condensed.length} chars)`,
  );
  const llmResult = await callClaude(
    condensed,
    "opencode",
    { onStderr: (msg) => log(`LLM ERROR: ${msg}`) },
  );
  if (!llmResult) {
    await log("LLM: no result, keeping heuristic entry");
    return;
  }

  const mainLine = `- ${timestamp} - \`(${repoName}/${sessionShort})\` ${
    escapeObsidianSyntax(llmResult.summary)
  }`;
  const detailLines = llmResult.details.map((d) =>
    `    - ${escapeObsidianSyntax(d)}`
  );
  const llmLines = [mainLine, ...detailLines];
  upsertDailyNote(dailyPath, sessionShort, llmLines);
  await log(`LLM UPDATED: ${llmLines.join(" | ")}`);
  saveDebounceState(statePath, userCount);
}

if (import.meta.main) {
  main().catch(async (e) => {
    await log(`FATAL: ${e}`);
  });
}
