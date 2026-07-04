#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-run=git,gemini

import {
  callGemini,
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

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  content?: unknown;
  is_error?: boolean;
}

interface TranscriptEntry {
  type: string;
  subtype?: string;
  isMeta?: boolean;
  message?: {
    content: string | ContentBlock[];
  };
  summary?: string;
}

// --- Logging ---

function logFilePath(): string {
  return `${Deno.env.get("TMPDIR") ?? "/tmp"}/claude-memo.log`;
}

async function rotateLog(): Promise<void> {
  const path = logFilePath();
  try {
    const stat = await Deno.stat(path);
    if (stat.size > 200 * 1024) {
      const content = await Deno.readTextFile(path);
      const lines = content.split("\n");
      await Deno.writeTextFile(path, lines.slice(-500).join("\n") + "\n");
    }
  } catch {
    // ignore
  }
}

async function log(msg: string): Promise<void> {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  await Deno.writeTextFile(logFilePath(), `[${ts}] ${msg}\n`, { append: true });
}

// --- Transcript Parsing ---

function parseTranscript(path: string): TranscriptEntry[] {
  const raw = Deno.readTextFileSync(path);
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as TranscriptEntry];
      } catch {
        return [];
      }
    });
}

// --- Extraction ---

const NOISE_PATTERNS: RegExp[] = [
  /^Implement the following plan/,
  /^<command-(name|message|args)>/,
  /^<local-command-(caveat|stdout|stderr)>/,
  /^<task-notification>/,
  /^<bash-(input|stdout|stderr)>/,
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

export function extractUserTexts(entries: TranscriptEntry[]): string[] {
  const texts: string[] = [];
  for (const e of entries) {
    if (e.type !== "user") continue;
    if (e.isMeta === true) continue;
    const content = e.message?.content;
    if (typeof content === "string") {
      texts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && block.text) {
          texts.push(block.text);
        }
      }
    }
  }
  return texts;
}

function extractAssistantTexts(entries: TranscriptEntry[]): string[] {
  const texts: string[] = [];
  for (const e of entries) {
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const block of e.message!.content as ContentBlock[]) {
      if (block.type === "text" && block.text?.trim()) {
        texts.push(block.text);
      }
    }
  }
  return texts;
}

function extractToolSummary(entries: TranscriptEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const block of e.message!.content as ContentBlock[]) {
      if (block.type === "tool_use" && block.name) {
        counts.set(block.name, (counts.get(block.name) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ");
}

export function countUserMessages(entries: TranscriptEntry[]): number {
  return entries.filter((e) => e.type === "user" && e.isMeta !== true).length;
}

// --- Heuristic Summary ---

export function heuristicSummary(entries: TranscriptEntry[]): string {
  // 1. First non-noise user prompt
  const userTexts = extractUserTexts(entries);
  for (const text of userTexts) {
    if (!isNoise(text)) {
      return text.replace(/\n/g, " ").slice(0, 100).trimEnd();
    }
  }

  // 2. First assistant text (if all user prompts are noise)
  const assistantTexts = extractAssistantTexts(entries);
  if (assistantTexts.length > 0) {
    return assistantTexts[0].replace(/\n/g, " ").slice(0, 100).trimEnd();
  }

  // 3. Tool usage as last resort
  const tools = extractToolSummary(entries);
  if (tools) return `${tools} を使用`;

  return "";
}

// --- LLM Context Builder ---

function buildLLMInput(entries: TranscriptEntry[]): string {
  const parts: string[] = [];

  const userTexts = extractUserTexts(entries).filter((t) => !isNoise(t));
  if (userTexts.length > 0) {
    parts.push("[User prompts]");
    for (const t of userTexts) {
      parts.push(`- ${t.replace(/\n/g, " ").slice(0, 200)}`);
    }
  }

  const assistantTexts = extractAssistantTexts(entries);
  if (assistantTexts.length > 0) {
    parts.push("\n[First assistant response]");
    parts.push(assistantTexts[0].replace(/\n/g, " ").slice(0, 300));
  }

  if (assistantTexts.length > 1) {
    parts.push("\n[Last assistant response]");
    parts.push(assistantTexts.at(-1)!.replace(/\n/g, " ").slice(0, 300));
  }

  const tools = extractToolSummary(entries);
  if (tools) {
    parts.push("\n[Actions taken]");
    parts.push(tools);
  }

  return parts.join("\n").slice(0, 3000);
}

// --- Main ---

async function main(): Promise<void> {
  await rotateLog();

  const stdinData = await new Response(Deno.stdin.readable).text();

  let hookData: { session_id?: string; transcript_path?: string; cwd?: string };
  try {
    hookData = JSON.parse(stdinData);
  } catch {
    const preview = stdinData.slice(0, 200).replace(/\n/g, "\\n");
    await log(
      `ERROR: failed to parse stdin JSON (len=${stdinData.length}): ${preview}`,
    );
    return;
  }

  const sessionId = hookData.session_id ?? "";
  const transcriptPath = hookData.transcript_path ?? "";
  const cwd = hookData.cwd ?? Deno.cwd();

  await log(
    `START: session=${sessionId.slice(0, 8)} transcript=${transcriptPath}`,
  );

  if (!transcriptPath) {
    await log("SKIP: no transcript_path");
    return;
  }

  let entries: TranscriptEntry[];
  try {
    entries = parseTranscript(transcriptPath);
  } catch (e) {
    await log(`SKIP: cannot parse transcript: ${e}`);
    return;
  }

  const repoName = await repoNameFor(cwd);

  const sessionShort = sessionId.slice(0, 8);
  const timestamp = nowTimestamp();
  const dailyPath = dailyNotePath();
  try {
    await Deno.stat(dailyPath);
  } catch {
    await log(`SKIP: daily note not found: ${dailyPath}`);
    return;
  }

  // Check if entry already exists (from a previous Stop invocation)
  const dailyContent = Deno.readTextFileSync(dailyPath);
  const hasExistingEntry = dailyContent.includes(`/${sessionShort})`);

  const userCount = countUserMessages(entries);
  const statePath = debounceStatePath("claude", sessionShort);
  const runLLM = shouldRunLLM(statePath, userCount);

  if (!runLLM && hasExistingEntry) {
    await log(`DEBOUNCE: skip (userCount=${userCount}, entry exists)`);
    return;
  }

  // Phase 1: Heuristic summary — write immediately as placeholder (single line)
  const heuristic = heuristicSummary(entries);
  if (!heuristic) {
    await log("SKIP: no summary extractable");
    return;
  }

  const heuristicLines = [
    `- ${timestamp} - \`(${repoName}/${sessionShort})\` ${
      escapeObsidianSyntax(heuristic)
    }`,
  ];
  upsertDailyNote(dailyPath, sessionShort, heuristicLines);
  await log(`HEURISTIC: ${heuristicLines[0]}`);

  // Phase 2: LLM summary — runs only when there are new user messages
  if (!runLLM) {
    await log(`DEBOUNCE: skip LLM (userCount=${userCount}, no new messages)`);
    return;
  }

  saveDebounceState(statePath, userCount);

  const condensed = buildLLMInput(entries);
  await log(
    `LLM: calling gemini flash (userCount=${userCount}, condensed=${condensed.length} chars)`,
  );

  const llmResult = await callGemini(condensed, "Claude Code");
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
}

if (import.meta.main) {
  main().catch(async (e) => {
    await log(`FATAL: ${e}`);
  });
}
