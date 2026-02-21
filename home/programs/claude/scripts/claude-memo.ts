#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=HOME,TMPDIR --allow-run=git,gemini

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
  message?: {
    content: string | ContentBlock[];
  };
  summary?: string;
}

interface DebounceState {
  userMessageCount: number;
}

interface LLMResult {
  summary: string;
  details: string[];
}

// --- Logging ---

const LOG_FILE = `${Deno.env.get("TMPDIR") ?? "/tmp"}/claude-memo.log`;

async function rotateLog(): Promise<void> {
  try {
    const stat = await Deno.stat(LOG_FILE);
    if (stat.size > 200 * 1024) {
      const content = await Deno.readTextFile(LOG_FILE);
      const lines = content.split("\n");
      await Deno.writeTextFile(LOG_FILE, lines.slice(-500).join("\n") + "\n");
    }
  } catch {
    // ignore
  }
}

async function log(msg: string): Promise<void> {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  await Deno.writeTextFile(LOG_FILE, `[${ts}] ${msg}\n`, { append: true });
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

function extractUserTexts(entries: TranscriptEntry[]): string[] {
  const texts: string[] = [];
  for (const e of entries) {
    if (e.type !== "user") continue;
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

function countUserMessages(entries: TranscriptEntry[]): number {
  return entries.filter((e) => e.type === "user").length;
}

// --- Heuristic Summary ---

function heuristicSummary(entries: TranscriptEntry[]): string {
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

  // User prompts (filtered, truncated)
  const userTexts = extractUserTexts(entries).filter((t) => !isNoise(t));
  if (userTexts.length > 0) {
    parts.push("[User prompts]");
    for (const t of userTexts) {
      parts.push(`- ${t.replace(/\n/g, " ").slice(0, 200)}`);
    }
  }

  // First assistant response
  const assistantTexts = extractAssistantTexts(entries);
  if (assistantTexts.length > 0) {
    parts.push("\n[First assistant response]");
    parts.push(assistantTexts[0].replace(/\n/g, " ").slice(0, 300));
  }

  // Last assistant response (if different from first)
  if (assistantTexts.length > 1) {
    parts.push("\n[Last assistant response]");
    parts.push(assistantTexts.at(-1)!.replace(/\n/g, " ").slice(0, 300));
  }

  // Tool usage
  const tools = extractToolSummary(entries);
  if (tools) {
    parts.push("\n[Actions taken]");
    parts.push(tools);
  }

  const result = parts.join("\n");
  // Cap at ~3000 chars
  return result.slice(0, 3000);
}

// --- Gemini Call ---

function parseLLMOutput(raw: string): LLMResult | null {
  const lines = raw.trim().split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;
  const summary = lines[0].replace(/^#+\s*/, "").replace(/\*\*/g, "").slice(0, 200);
  if (!summary) return null;
  const details = lines
    .slice(1)
    .filter((l) => /^\s*[-・]/.test(l))
    .map((l) => l.replace(/^\s*[-・]\s*/, "").replace(/\*\*/g, "").trim().slice(0, 100))
    .filter((l) => l.length > 0)
    .slice(0, 3);
  return { summary, details };
}

async function callGemini(condensed: string): Promise<LLMResult | null> {
  const prompt =
    "以下はClaude Codeセッションの要約データです。" +
    "このセッションで何が行われたかを日本語で要約してください。\n\n" +
    "出力フォーマット:\n" +
    "1行目: 40〜80文字の要約（意図と結果を含む）\n" +
    "2行目以降: 補足情報を箇条書きで2〜3項目（各項目は「- 」で始め、30〜60文字）\n\n" +
    "補足が不要なほど単純なセッションなら1行目だけでもOK。\n" +
    "出力は要約のみ。説明や前置きは不要です。";

  try {
    const cmd = new Deno.Command("gemini", {
      args: ["-p", prompt, "-m", "gemini-2.0-flash"],
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    });
    const proc = cmd.spawn();
    const writer = proc.stdin.getWriter();
    await writer.write(new TextEncoder().encode(condensed));
    await writer.close();

    const { code, stdout } = await proc.output();
    if (code !== 0) return null;

    const raw = new TextDecoder().decode(stdout);
    return parseLLMOutput(raw);
  } catch (e) {
    await log(`GEMINI ERROR: ${e}`);
    return null;
  }
}

// --- Debounce ---

function debounceStatePath(sessionShort: string): string {
  return `${Deno.env.get("TMPDIR") ?? "/tmp"}/claude-memo-llm-${sessionShort}.json`;
}

function shouldRunLLM(sessionShort: string, currentUserCount: number): boolean {
  const statePath = debounceStatePath(sessionShort);
  try {
    const raw = Deno.readTextFileSync(statePath);
    const state: DebounceState = JSON.parse(raw);
    return currentUserCount > state.userMessageCount;
  } catch {
    // No state file → first run
    return true;
  }
}

function saveDebounceState(sessionShort: string, userCount: number): void {
  const statePath = debounceStatePath(sessionShort);
  const state: DebounceState = { userMessageCount: userCount };
  Deno.writeTextFileSync(statePath, JSON.stringify(state));
}

// --- Daily Note Upsert ---

function upsertDailyNote(
  dailyPath: string,
  sessionShort: string,
  entryLines: string[],
): void {
  const content = Deno.readTextFileSync(dailyPath);
  const lines = content.split("\n");

  // Check for existing entry with this session ID
  const existingIdx = lines.findIndex((l) => l.includes(`/${sessionShort})`));
  if (existingIdx >= 0) {
    // Find the full extent of the existing entry (main line + indented detail lines)
    let endIdx = existingIdx + 1;
    while (endIdx < lines.length && lines[endIdx].startsWith("    -")) {
      endIdx++;
    }
    lines.splice(existingIdx, endIdx - existingIdx, ...entryLines);
    Deno.writeTextFileSync(dailyPath, lines.join("\n"));
    return;
  }

  // Find insertion point: before ## 📕 Reading
  const readingIdx = lines.findIndex((l) => /^## 📕 Reading/.test(l));
  if (readingIdx < 0) return;

  // Insert just before the Reading section (no extra blank line added)
  const insertAt = lines[readingIdx - 1]?.trim() === "" ? readingIdx - 1 : readingIdx;
  lines.splice(insertAt, 0, ...entryLines);
  Deno.writeTextFileSync(dailyPath, lines.join("\n"));
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
    await log(`ERROR: failed to parse stdin JSON (len=${stdinData.length}): ${preview}`);
    return;
  }

  const sessionId = hookData.session_id ?? "";
  const transcriptPath = hookData.transcript_path ?? "";
  const cwd = hookData.cwd ?? Deno.cwd();

  await log(`START: session=${sessionId.slice(0, 8)} transcript=${transcriptPath}`);

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

  // Determine repo name
  let repoName: string;
  try {
    const cmd = new Deno.Command("git", {
      args: ["-C", cwd, "rev-parse", "--git-common-dir"],
      stdout: "piped",
      stderr: "null",
    });
    const { stdout } = await cmd.output();
    let gitDir = new TextDecoder().decode(stdout).trim();
    // 通常リポジトリ: ".git"（相対）、worktree: "/path/to/repo/.git"（絶対）
    if (!gitDir.startsWith("/")) {
      gitDir = `${cwd}/${gitDir}`;
    }
    repoName = gitDir.replace(/\/\.git\/?$/, "").split("/").at(-1) ?? "";
  } catch {
    repoName = "";
  }
  if (!repoName) repoName = cwd.split("/").at(-1) ?? "unknown";

  const sessionShort = sessionId.slice(0, 8);
  const timestamp = new Date().toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // Daily note path
  const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD
  const dailyPath = `${Deno.env.get("HOME")}/Documents/Main/99_Tracking/Daily/${today}.md`;
  try {
    await Deno.stat(dailyPath);
  } catch {
    await log(`SKIP: daily note not found: ${dailyPath}`);
    return;
  }

  // Check if entry already exists (from a previous Stop invocation)
  const dailyContent = Deno.readTextFileSync(dailyPath);
  const hasExistingEntry = dailyContent.includes(`/${sessionShort})`);

  // Check debounce: has a new user message arrived since last LLM call?
  const userCount = countUserMessages(entries);
  const runLLM = shouldRunLLM(sessionShort, userCount);

  if (!runLLM && hasExistingEntry) {
    // No new user messages and entry already exists — preserve the existing (likely LLM-generated) entry
    await log(`DEBOUNCE: skip (userCount=${userCount}, entry exists)`);
    return;
  }

  // Phase 1: Heuristic summary — write immediately as placeholder (single line)
  const heuristic = heuristicSummary(entries);
  if (!heuristic) {
    await log("SKIP: no summary extractable");
    return;
  }

  const heuristicLines = [`- ${timestamp} - \`(${repoName}/${sessionShort})\` ${heuristic}`];
  upsertDailyNote(dailyPath, sessionShort, heuristicLines);
  await log(`HEURISTIC: ${heuristicLines[0]}`);

  // Phase 2: LLM summary — runs only when there are new user messages
  if (!runLLM) {
    await log(`DEBOUNCE: skip LLM (userCount=${userCount}, no new messages)`);
    return;
  }

  saveDebounceState(sessionShort, userCount);

  const condensed = buildLLMInput(entries);
  await log(`LLM: calling gemini (userCount=${userCount}, condensed=${condensed.length} chars)`);

  const llmResult = await callGemini(condensed);
  if (!llmResult) {
    await log("LLM: no result, keeping heuristic entry");
    return;
  }

  const mainLine = `- ${timestamp} - \`(${repoName}/${sessionShort})\` ${llmResult.summary}`;
  const detailLines = llmResult.details.map((d) => `    - ${d}`);
  const llmLines = [mainLine, ...detailLines];

  upsertDailyNote(dailyPath, sessionShort, llmLines);
  await log(`LLM UPDATED: ${llmLines.join(" | ")}`);
}

main().catch(async (e) => {
  await log(`FATAL: ${e}`);
});
