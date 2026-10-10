#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

import {
  callClaude,
  composeLLMInput,
  dailyNotePath,
  debounceStatePath,
  escapeObsidianSyntax,
  formatEntryLines,
  isThrowawaySession,
  nowTimestamp,
  repoNameFor,
  saveDebounceState,
  shouldRunLLM,
  upsertDailyNote,
} from "../../agents/memo/memo-shared.ts";
import type { SessionInput, Turn } from "../../agents/scripts/vocab-propose.ts";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";

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

const LOG_FILE = `${process.env.HOME ?? "."}/.codex/logs/codex-memo.log`;
const HOOK_LOG_PATH = `${process.env.HOME ?? "."}/.codex/logs/hooks.jsonl`;
const MAX_LOG_LINES = 1000;

function stripControls(raw: string): string {
  return Array.from(raw, (ch) => {
    const code = ch.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? " " : ch;
  }).join("");
}

async function ensureLogDir(): Promise<void> {
  await mkdir(`${process.env.HOME ?? "."}/.codex/logs`, {
    recursive: true,
  });
}

async function rotateLog(): Promise<void> {
  try {
    const content = await readFile(LOG_FILE, "utf8");
    const lines = content.split("\n");
    if (lines.length > MAX_LOG_LINES) {
      await writeFile(
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
    await appendFile(LOG_FILE, `[${ts}] ${msg}\n`);
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
    raw = readFileSync(logPath, "utf8");
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

export function extractTurns(entries: HookLogEntry[]): Turn[] {
  const turns: Turn[] = [];
  for (const entry of entries) {
    const payload = entry.payload;
    if (!payload || isTruncated(payload)) continue;
    if (entry.event === "UserPromptSubmit") {
      const prompt = payload.prompt;
      if (typeof prompt === "string" && prompt && !isNoise(prompt)) {
        turns.push({ role: "user", text: prompt });
      }
    } else if (entry.event === "Stop") {
      const msg = payload.last_assistant_message;
      if (typeof msg === "string" && msg) {
        turns.push({ role: "assistant", text: msg });
      }
    }
  }
  return turns;
}

// Loaded only when used, so a missing or broken vocabulary module never stops
// the memo itself.
export async function proposeVocab(
  input: Omit<SessionInput, "home" | "tmpdir">,
  load = () => import("../../agents/scripts/vocab-propose.ts"),
): Promise<void> {
  try {
    const home = process.env.HOME;
    if (!home) return;
    const { proposeFromSession } = await load();
    const r = await proposeFromSession({
      ...input,
      home,
      tmpdir: process.env.TMPDIR ?? "/tmp",
    });
    await log(`WORKER VOCAB: ${r.note}`);
  } catch (e) {
    await log(`WORKER VOCAB ERROR: ${e}`);
  }
}

function toolUseCounts(entries: HookLogEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.event !== "PreToolUse") continue;
    const name = entry.tool_name;
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

export function extractToolSummary(entries: HookLogEntry[]): string {
  return [...toolUseCounts(entries).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ");
}

export function countToolUses(entries: HookLogEntry[]): number {
  let count = 0;
  for (const n of toolUseCounts(entries).values()) count += n;
  return count;
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
  return composeLLMInput(
    extractUserTexts(entries).filter((t) => !isNoise(t)).map(stripControls),
    extractAssistantTexts(entries).map(stripControls),
  );
}

// argv[0] is the script itself, so the worker starts through the same shebang
// as the hook and gets the flags that keep the cwd's bunfig.toml and .env out.
export function buildWorkerArgs(
  scriptPath: string,
  hookData: HookData,
): string[] {
  return [scriptPath, "--worker", JSON.stringify(hookData)];
}

function spawnWorker(hookData: HookData): void {
  const [command, ...args] = buildWorkerArgs(
    fileURLToPath(import.meta.url),
    hookData,
  );
  const child = spawn(command, args, { stdio: "ignore" });
  child.on("error", () => {});
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
  const cwd = input.cwd ?? process.cwd();

  const entries = readHookLogEntriesForSession(HOOK_LOG_PATH, sessionId, {
    types: ["UserPromptSubmit", "Stop", "PreToolUse"],
  });
  if (entries.length === 0) {
    await log(`${logPrefix}SKIP: no session events in hooks.jsonl`);
    return null;
  }

  const userCount = countUserMessages(entries);
  if (isThrowawaySession(userCount, countToolUses(entries))) {
    await log(`${logPrefix}SKIP: throwaway session (userCount=${userCount})`);
    return null;
  }

  const dailyPath = dailyNotePath();
  try {
    await stat(dailyPath);
  } catch {
    await log(`${logPrefix}SKIP: daily note not found: ${dailyPath}`);
    return null;
  }

  const repoName = await repoNameFor(cwd);
  const timestamp = nowTimestamp();

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
  const stdinData = await text(process.stdin);
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

  const dailyContent = readFileSync(ctx.dailyPath, "utf8");
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
  const vocab = proposeVocab({
    agent: "codex",
    sessionId: workerInput.session_id,
    cwd: workerInput.cwd ?? process.cwd(),
    repo: ctx.repoName,
    turns: extractTurns(ctx.entries),
  });
  try {
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

    const llmLines = formatEntryLines(llmResult, ctx);
    upsertDailyNote(ctx.dailyPath, ctx.sessionShort, llmLines);
    await log(`WORKER LLM UPDATED: ${llmLines.join(" | ")}`);
    saveDebounceState(
      debounceStatePath("codex", ctx.sessionShort),
      ctx.userCount,
    );
  } finally {
    await vocab;
  }
}

async function main(): Promise<void> {
  if (process.argv.slice(2)[0] === "--worker") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(process.argv.slice(2)[1] ?? "{}");
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
