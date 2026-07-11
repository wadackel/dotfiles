#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=HOME,TMPDIR --allow-run=git,claude,deno

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

export interface HookLogEntry {
  ts: string;
  event: string;
  session_id: string;
  cwd: string;
  tool_name: string;
  payload: Record<string, unknown>;
}

interface HookData {
  session_id: string;
  cwd?: string;
}

const LOG_FILE = `${Deno.env.get("HOME") ?? "."}/.codex/logs/codex-memo.log`;
const HOOK_LOG_PATH = `${Deno.env.get("HOME") ?? "."}/.codex/logs/hooks.jsonl`;
const MAX_LOG_LINES = 1000;

function stripControls(raw: string): string {
  return Array.from(raw, (ch) => {
    const code = ch.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? " " : ch;
  }).join("");
}

async function ensureLogDir(): Promise<void> {
  await Deno.mkdir(`${Deno.env.get("HOME") ?? "."}/.codex/logs`, {
    recursive: true,
  });
}

async function rotateLog(): Promise<void> {
  try {
    const content = await Deno.readTextFile(LOG_FILE);
    const lines = content.split("\n");
    if (lines.length > MAX_LOG_LINES) {
      await Deno.writeTextFile(
        LOG_FILE,
        lines.slice(-MAX_LOG_LINES).join("\n"),
      );
    }
  } catch {
    // no log yet
  }
}

async function log(msg: string): Promise<void> {
  try {
    await ensureLogDir();
    await rotateLog();
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    await Deno.writeTextFile(LOG_FILE, `[${ts}] ${msg}\n`, { append: true });
  } catch {
    // memo logging must not break Codex hooks
  }
}

function isHookLogEntry(v: unknown): v is HookLogEntry {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return typeof r.ts === "string" &&
    typeof r.event === "string" &&
    typeof r.session_id === "string" &&
    typeof r.cwd === "string" &&
    typeof r.tool_name === "string" &&
    !!r.payload && typeof r.payload === "object" && !Array.isArray(r.payload);
}

export function readHookLogEntriesForSession(
  logPath: string,
  sessionId: string,
  options?: { types?: string[] },
): HookLogEntry[] {
  let raw: string;
  try {
    raw = Deno.readTextFileSync(logPath);
  } catch {
    return [];
  }
  const types = options?.types;
  const out: HookLogEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isHookLogEntry(parsed)) continue;
    if (parsed.session_id !== sessionId) continue;
    if (types && !types.includes(parsed.event)) continue;
    out.push(parsed);
  }
  return out;
}

const NOISE_PATTERNS: RegExp[] = [
  /^# AGENTS\.md instructions/,
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

function isNoise(text: string): boolean {
  const t = text.trim();
  if (t.length <= 5) return true;
  return NOISE_PATTERNS.some((p) => p.test(t));
}

function isTruncated(payload: Record<string, unknown>): boolean {
  return payload._truncated === true;
}

export function extractUserTexts(entries: HookLogEntry[]): string[] {
  const texts: string[] = [];
  for (const entry of entries) {
    if (entry.event !== "UserPromptSubmit") continue;
    const payload = entry.payload;
    if (!payload || isTruncated(payload)) continue;
    const prompt = payload.prompt;
    if (typeof prompt !== "string" || !prompt) continue;
    texts.push(prompt);
  }
  return texts;
}

export function extractAssistantTexts(entries: HookLogEntry[]): string[] {
  const texts: string[] = [];
  for (const entry of entries) {
    if (entry.event !== "Stop") continue;
    const payload = entry.payload;
    if (!payload || isTruncated(payload)) continue;
    const msg = payload.last_assistant_message;
    if (typeof msg !== "string" || !msg) continue;
    texts.push(msg);
  }
  return texts;
}

export function extractToolSummary(entries: HookLogEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.event !== "PreToolUse") continue;
    const name = entry.tool_name;
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ");
}

function countUserMessages(entries: HookLogEntry[]): number {
  return extractUserTexts(entries).filter((t) => !isNoise(t)).length;
}

export function heuristicSummary(entries: HookLogEntry[]): string {
  for (const text of extractUserTexts(entries)) {
    if (!isNoise(text)) {
      return stripControls(text).replace(/\s+/g, " ").slice(0, 100).trimEnd();
    }
  }

  const assistantTexts = extractAssistantTexts(entries);
  if (assistantTexts.length > 0) {
    return stripControls(assistantTexts[0]).replace(/\s+/g, " ").slice(0, 100)
      .trimEnd();
  }

  const tools = extractToolSummary(entries);
  if (tools) return `${tools} を使用`;

  return "";
}

export function buildLLMInput(entries: HookLogEntry[]): string {
  const parts: string[] = [];
  const userTexts = extractUserTexts(entries).filter((t) => !isNoise(t));
  if (userTexts.length > 0) {
    parts.push("[User prompts]");
    for (const t of userTexts) {
      parts.push(`- ${stripControls(t).replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }

  const assistantTexts = extractAssistantTexts(entries);
  if (assistantTexts.length > 0) {
    parts.push("\n[First assistant response]");
    parts.push(
      stripControls(assistantTexts[0]).replace(/\s+/g, " ").slice(0, 300),
    );
  }
  if (assistantTexts.length > 1) {
    parts.push("\n[Last assistant response]");
    parts.push(
      stripControls(assistantTexts.at(-1)!).replace(/\s+/g, " ").slice(0, 300),
    );
  }

  const tools = extractToolSummary(entries);
  if (tools) {
    parts.push("\n[Actions taken]");
    parts.push(tools);
  }

  return parts.join("\n").slice(0, 3000);
}

export function buildWorkerArgs(
  scriptPath: string,
  hookData: HookData,
): string[] {
  return [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-env=HOME,TMPDIR",
    "--allow-run=git,claude,deno",
    scriptPath,
    "--worker",
    JSON.stringify(hookData),
  ];
}

function spawnWorker(hookData: HookData): void {
  const scriptPath = new URL(import.meta.url).pathname;
  const child = new Deno.Command(Deno.execPath(), {
    args: buildWorkerArgs(scriptPath, hookData),
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  child.status.catch(() => {});
  child.unref();
}

export function validateHookData(raw: unknown): HookData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const sessionId = r.session_id;
  const cwd = r.cwd;
  if (typeof sessionId !== "string" || !sessionId) return null;
  if (cwd !== undefined && typeof cwd !== "string") return null;
  return {
    session_id: sessionId,
    cwd: cwd as string | undefined,
  };
}

interface PreparedContext {
  entries: HookLogEntry[];
  dailyPath: string;
  repoName: string;
  timestamp: string;
  sessionShort: string;
  userCount: number;
}

async function prepareContext(
  input: HookData,
  logPrefix: "" | "WORKER ",
): Promise<PreparedContext | null> {
  const sessionId = input.session_id;
  const sessionShort = sessionId.slice(0, 8);
  const cwd = input.cwd ?? Deno.cwd();

  const entries = readHookLogEntriesForSession(HOOK_LOG_PATH, sessionId, {
    types: ["UserPromptSubmit", "Stop", "PreToolUse"],
  });
  if (entries.length === 0) {
    await log(`${logPrefix}SKIP: no session events in hooks.jsonl`);
    return null;
  }

  const dailyPath = dailyNotePath();
  try {
    await Deno.stat(dailyPath);
  } catch {
    await log(`${logPrefix}SKIP: daily note not found: ${dailyPath}`);
    return null;
  }

  const repoName = await repoNameFor(cwd);
  const timestamp = nowTimestamp();
  const userCount = countUserMessages(entries);

  return {
    entries,
    dailyPath,
    repoName,
    timestamp,
    sessionShort,
    userCount,
  };
}

async function mainHook(): Promise<void> {
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

  await log(
    `START: session=${hookData.session_id.slice(0, 8)} cwd=${
      hookData.cwd ?? ""
    }`,
  );

  const ctx = await prepareContext(hookData, "");
  if (!ctx) return;

  const heuristic = heuristicSummary(ctx.entries);
  if (!heuristic) {
    await log("SKIP: no summary extractable");
    return;
  }

  const dailyContent = Deno.readTextFileSync(ctx.dailyPath);
  const hasExistingEntry = dailyContent.includes(`/${ctx.sessionShort})`);
  const statePath = debounceStatePath("codex", ctx.sessionShort);
  const runLLM = shouldRunLLM(statePath, ctx.userCount);

  if (!runLLM && hasExistingEntry) {
    await log(`DEBOUNCE: skip (userCount=${ctx.userCount}, entry exists)`);
    return;
  }

  const heuristicLines = [
    `- ${ctx.timestamp} - \`(${ctx.repoName}/${ctx.sessionShort})\` ${
      escapeObsidianSyntax(heuristic)
    }`,
  ];
  upsertDailyNote(ctx.dailyPath, ctx.sessionShort, heuristicLines);
  await log(`HEURISTIC: ${heuristicLines[0]}`);

  if (!runLLM) {
    await log(
      `DEBOUNCE: skip LLM (userCount=${ctx.userCount}, no new messages)`,
    );
    return;
  }

  spawnWorker(hookData);
  await log(
    `WORKER SPAWNED: session=${ctx.sessionShort} userCount=${ctx.userCount}`,
  );
}

async function mainWorker(workerInput: HookData): Promise<void> {
  await log(
    `WORKER START: session=${workerInput.session_id.slice(0, 8)}`,
  );

  const ctx = await prepareContext(workerInput, "WORKER ");
  if (!ctx) return;

  const condensed = buildLLMInput(ctx.entries);
  await log(
    `WORKER LLM: calling claude -p (haiku) (userCount=${ctx.userCount}, condensed=${condensed.length} chars)`,
  );
  const llmResult = await callClaude(
    condensed,
    "Codex",
    { onStderr: (msg) => log(`WORKER LLM ERROR: ${msg}`) },
  );
  if (!llmResult) {
    await log("WORKER LLM: no result, keeping heuristic entry");
    return;
  }

  const mainLine =
    `- ${ctx.timestamp} - \`(${ctx.repoName}/${ctx.sessionShort})\` ${
      escapeObsidianSyntax(llmResult.summary)
    }`;
  const detailLines = llmResult.details.map((detail) =>
    `    - ${escapeObsidianSyntax(detail)}`
  );
  const llmLines = [mainLine, ...detailLines];
  upsertDailyNote(ctx.dailyPath, ctx.sessionShort, llmLines);
  await log(`WORKER LLM UPDATED: ${llmLines.join(" | ")}`);
  saveDebounceState(debounceStatePath("codex", ctx.sessionShort), ctx.userCount);
}

async function main(): Promise<void> {
  if (Deno.args[0] === "--worker") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Deno.args[1] ?? "{}");
    } catch (e) {
      await log(`WORKER ERROR: invalid argv JSON: ${e}`);
      return;
    }
    const workerInput = validateHookData(parsed);
    if (!workerInput) {
      await log("WORKER ERROR: invalid argv data");
      return;
    }
    await mainWorker(workerInput);
    return;
  }
  await mainHook();
}

if (import.meta.main) {
  main().catch(async (e) => {
    await log(`FATAL: ${e}`);
  });
}
