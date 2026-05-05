#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=HOME,TMPDIR --allow-run=git,gemini,deno

interface TranscriptEnvelope {
  type: string;
  payload?: Record<string, unknown>;
}

interface HookData {
  session_id?: string;
  transcript_path?: string | null;
  cwd?: string;
}

interface DebounceState {
  userMessageCount: number;
}

interface LLMResult {
  summary: string;
  details: string[];
}

const LOG_FILE = `${Deno.env.get("HOME") ?? "."}/.codex/logs/codex-memo.log`;
const MAX_LOG_LINES = 1000;
const GEMINI_TIMEOUT_MS = 15000;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

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

export function parseTranscript(path: string): TranscriptEnvelope[] {
  const raw = Deno.readTextFileSync(path);
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as TranscriptEnvelope];
      } catch {
        return [];
      }
    });
}

export function resolveRepoName(cwd: string, gitCommonDir: string): string {
  let gitDir = gitCommonDir;
  if (!gitDir.startsWith("/")) {
    gitDir = `${cwd}/${gitDir}`;
  }
  const segments: string[] = [];
  for (const s of gitDir.split("/")) {
    if (s === "..") segments.pop();
    else if (s !== ".") segments.push(s);
  }
  gitDir = segments.join("/");
  return gitDir.replace(/\/\.git\/?$/, "").split("/").at(-1) ?? "";
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

function messageText(payload: Record<string, unknown>): string {
  const content = payload.content;
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const b = block as Record<string, unknown>;
    const text = str(b.text) || str(b.input_text) || str(b.output_text);
    if (text) texts.push(text);
  }
  return texts.join("\n");
}

export function extractUserTexts(entries: TranscriptEnvelope[]): string[] {
  const texts: string[] = [];
  const seen = new Set<string>();
  const pushText = (text: string): void => {
    if (!text || seen.has(text)) return;
    seen.add(text);
    texts.push(text);
  };
  for (const entry of entries) {
    const payload = entry.payload ?? {};
    if (entry.type === "event_msg" && payload.type === "user_message") {
      pushText(str(payload.message));
      continue;
    }
    if (
      entry.type === "response_item" &&
      payload.type === "message" &&
      payload.role === "user"
    ) {
      pushText(messageText(payload));
    }
  }
  return texts;
}

export function extractAssistantTexts(entries: TranscriptEnvelope[]): string[] {
  const texts: string[] = [];
  for (const entry of entries) {
    const payload = entry.payload ?? {};
    if (
      entry.type === "response_item" &&
      payload.type === "message" &&
      payload.role === "assistant"
    ) {
      const text = messageText(payload).trim();
      if (text) texts.push(text);
    }
  }
  return texts;
}

export function extractToolSummary(entries: TranscriptEnvelope[]): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const payload = entry.payload ?? {};
    if (entry.type !== "response_item" || payload.type !== "function_call") {
      continue;
    }
    const name = str(payload.name);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ");
}

function countUserMessages(entries: TranscriptEnvelope[]): number {
  return extractUserTexts(entries).filter((t) => !isNoise(t)).length;
}

export function heuristicSummary(entries: TranscriptEnvelope[]): string {
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

export function buildLLMInput(entries: TranscriptEnvelope[]): string {
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

export function parseLLMOutput(raw: string): LLMResult | null {
  const lines = raw.trim().split("\n").filter((line) => line.trim());
  if (lines.length === 0) return null;
  const summary = lines[0].replace(/^#+\s*/, "").replace(/\*\*/g, "").slice(
    0,
    200,
  );
  if (!summary) return null;
  const details = lines
    .slice(1)
    .filter((line) => /^\s*[-・]/.test(line))
    .map((line) =>
      line.replace(/^\s*[-・]\s*/, "").replace(/\*\*/g, "").trim().slice(0, 100)
    )
    .filter((line) => line.length > 0)
    .slice(0, 3);
  return { summary, details };
}

async function callGemini(condensed: string): Promise<LLMResult | null> {
  const prompt = "以下はCodexセッションの要約データです。" +
    "このセッションで何が行われたかを日本語で要約してください。\n\n" +
    "出力フォーマット:\n" +
    "1行目: 40〜80文字の要約（意図と結果を含む）\n" +
    "2行目以降: 補足情報を箇条書きで2〜3項目（各項目は「- 」で始め、30〜60文字）\n\n" +
    "補足が不要なほど単純なセッションなら1行目だけでもOK。\n" +
    "出力は要約のみ。説明や前置きは不要です。";

  let proc: Deno.ChildProcess | null = null;
  let timer: number | undefined;
  try {
    const cmd = new Deno.Command("gemini", {
      args: ["-m", "gemini-2.5-flash", "-o", "text"],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    proc = cmd.spawn();
    timer = setTimeout(() => {
      try {
        proc?.kill("SIGTERM");
      } catch {
        // process may already have exited
      }
    }, GEMINI_TIMEOUT_MS);

    const writer = proc.stdin.getWriter();
    await writer.write(new TextEncoder().encode(`${prompt}\n\n${condensed}`));
    await writer.close();

    const { code, stdout, stderr } = await proc.output();
    if (code !== 0) {
      const errMsg = new TextDecoder().decode(stderr).trim().slice(0, 200);
      await log(`GEMINI ERROR: exit=${code} ${errMsg}`);
      return null;
    }
    return parseLLMOutput(new TextDecoder().decode(stdout));
  } catch (e) {
    await log(`GEMINI ERROR: ${e}`);
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function debounceStatePath(sessionShort: string): string {
  return `${
    Deno.env.get("TMPDIR") ?? "/tmp"
  }/codex-memo-llm-${sessionShort}.json`;
}

function shouldRunLLM(sessionShort: string, currentUserCount: number): boolean {
  try {
    const state: DebounceState = JSON.parse(
      Deno.readTextFileSync(debounceStatePath(sessionShort)),
    );
    return currentUserCount > state.userMessageCount;
  } catch {
    return true;
  }
}

function saveDebounceState(sessionShort: string, userCount: number): void {
  Deno.writeTextFileSync(
    debounceStatePath(sessionShort),
    JSON.stringify({ userMessageCount: userCount } satisfies DebounceState),
  );
}

export function escapeObsidianSyntax(text: string): string {
  return text.replace(/#(?=\w)/g, "＃");
}

export function upsertDailyNote(
  dailyPath: string,
  sessionShort: string,
  entryLines: string[],
): void {
  const content = Deno.readTextFileSync(dailyPath);
  const lines = content.split("\n");
  const existingIdx = lines.findIndex((line) =>
    line.includes(`/${sessionShort})`)
  );
  if (existingIdx >= 0) {
    let endIdx = existingIdx + 1;
    while (endIdx < lines.length && lines[endIdx].startsWith("    -")) {
      endIdx++;
    }
    lines.splice(existingIdx, endIdx - existingIdx, ...entryLines);
    Deno.writeTextFileSync(dailyPath, lines.join("\n"));
    return;
  }

  const readingIdx = lines.findIndex((line) => /^## 📕 Reading/.test(line));
  if (readingIdx < 0) return;
  const insertAt = lines[readingIdx - 1]?.trim() === ""
    ? readingIdx - 1
    : readingIdx;
  lines.splice(insertAt, 0, ...entryLines);
  Deno.writeTextFileSync(dailyPath, lines.join("\n"));
}

async function repoNameFor(cwd: string): Promise<string> {
  try {
    const cmd = new Deno.Command("git", {
      cwd,
      args: ["rev-parse", "--git-common-dir"],
      stdout: "piped",
      stderr: "null",
    });
    const { stdout } = await cmd.output();
    const repoName = resolveRepoName(
      cwd,
      new TextDecoder().decode(stdout).trim(),
    );
    if (repoName) return repoName;
  } catch {
    // fall through
  }
  return cwd.split("/").at(-1) ?? "unknown";
}

function dailyNotePath(): string {
  const today = new Date().toLocaleDateString("sv-SE");
  return `${Deno.env.get("HOME")}/Documents/Main/99_Tracking/Daily/${today}.md`;
}

function nowTimestamp(): string {
  return new Date().toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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
    "--allow-run=git,gemini",
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
  const transcriptPath = r.transcript_path;
  const cwd = r.cwd;
  if (typeof sessionId !== "string" || !sessionId) return null;
  if (typeof transcriptPath !== "string" || !transcriptPath) return null;
  if (cwd !== undefined && typeof cwd !== "string") return null;
  return {
    session_id: sessionId,
    transcript_path: transcriptPath,
    cwd: cwd as string | undefined,
  };
}

interface PreparedContext {
  entries: TranscriptEnvelope[];
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
  const sessionId = input.session_id ?? "";
  const sessionShort = sessionId.slice(0, 8);
  const transcriptPath = input.transcript_path ?? "";
  const cwd = input.cwd ?? Deno.cwd();

  if (!sessionShort || !transcriptPath) {
    await log(`${logPrefix}SKIP: missing session_id or transcript_path`);
    return null;
  }

  let entries: TranscriptEnvelope[];
  try {
    entries = parseTranscript(transcriptPath);
  } catch (e) {
    await log(`${logPrefix}SKIP: cannot parse transcript: ${e}`);
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
    `START: session=${
      (hookData.session_id ?? "").slice(0, 8)
    } transcript=${hookData.transcript_path}`,
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
  const runLLM = shouldRunLLM(ctx.sessionShort, ctx.userCount);

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
    `WORKER START: session=${(workerInput.session_id ?? "").slice(0, 8)}`,
  );

  const ctx = await prepareContext(workerInput, "WORKER ");
  if (!ctx) return;

  const condensed = buildLLMInput(ctx.entries);
  await log(
    `WORKER LLM: calling gemini flash (userCount=${ctx.userCount}, condensed=${condensed.length} chars)`,
  );
  const llmResult = await callGemini(condensed);
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
  saveDebounceState(ctx.sessionShort, ctx.userCount);
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
