// Shared memo library used by claude-memo / codex-memo / opencode-memo.
// Each agent script imports from a sibling symlink at <agent>/scripts/memo-shared.ts
// → ../../agents/memo/memo-shared.ts.
//
// Agent-specific concerns (transcript / DB parser, NOISE_PATTERNS,
// heuristicSummary, extracting the texts for buildLLMInput, log path, hook
// entry) stay in the agent script. Shared concerns (Daily Note upsert and entry
// lines, throwaway-session filtering, LLM input composition, Claude call,
// debounce I/O, repo-name resolution, LLM output parsing, Obsidian escape) live
// here.

export interface LLMResult {
  summary: string;
  details: string[];
  learning?: string;
}

export interface DebounceState {
  userMessageCount: number;
}

// --- Repo name resolution ---

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

export async function repoNameFor(cwd: string): Promise<string> {
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

// --- Daily Note path / timestamp ---

export function dailyNotePath(): string {
  const today = new Date().toLocaleDateString("sv-SE");
  return `${Deno.env.get("HOME")}/Documents/Main/99_Tracking/Daily/${today}.md`;
}

export function nowTimestamp(): string {
  return new Date().toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// --- Obsidian escape ---

export function escapeObsidianSyntax(text: string): string {
  return text.replace(/#(?=\w)/g, "＃");
}

// --- LLM output parser ---

const LEARNING_PATTERN = /^\s*(?:[-・]\s*)?学び\s*[:：]\s*(.*)$/;
// haiku は「出さない」と指示しても空欄の学び行を書くことがあり、そのまま残すとデイリーに中身のない行が並ぶ。
const EMPTY_LEARNINGS = new Set(["", "なし", "無し", "特になし", "-", "n/a"]);

export function parseLLMOutput(raw: string): LLMResult | null {
  const lines = raw.trim().split("\n").filter((line) => line.trim());
  if (lines.length === 0) return null;
  const summary = lines[0].replace(/^#+\s*/, "").replace(/\*\*/g, "").slice(
    0,
    200,
  );
  if (!summary) return null;
  let learning: string | undefined;
  const rest: string[] = [];
  for (const line of lines.slice(1)) {
    const match = line.replace(/\*\*/g, "").match(LEARNING_PATTERN);
    if (!match) {
      rest.push(line);
      continue;
    }
    const value = match[1].trim();
    const bare = value.replace(/^[（(]|[)）。．.]+$/g, "").toLowerCase();
    if (!EMPTY_LEARNINGS.has(bare)) learning = value.slice(0, 150);
  }
  const details = rest
    .filter((line) => /^\s*[-・]/.test(line))
    .map((line) =>
      line.replace(/^\s*[-・]\s*/, "").replace(/\*\*/g, "").trim().slice(0, 100)
    )
    .filter((line) => line.length > 0)
    .slice(0, 3);
  return learning ? { summary, details, learning } : { summary, details };
}

// --- Daily Note entry lines ---

export interface EntryOrigin {
  timestamp: string;
  repoName: string;
  sessionShort: string;
}

export function formatEntryLines(
  result: LLMResult,
  { timestamp, repoName, sessionShort }: EntryOrigin,
): string[] {
  const lines = [
    `- ${timestamp} - \`(${repoName}/${sessionShort})\` ${
      escapeObsidianSyntax(result.summary)
    }`,
    ...result.details.map((d) => `    - ${escapeObsidianSyntax(d)}`),
  ];
  if (result.learning) {
    lines.push(`    - 学び: ${escapeObsidianSyntax(result.learning)}`);
  }
  return lines;
}

// --- LLM input ---

// 最後の応答は作業の結論と学びを最も多く含むが、ユーザー発言の後ろに置くと全体の上限で真っ先に切られる。
// そこで先頭に置き、ユーザー発言には別枠を割り当てる。
const LAST_RESPONSE_CHARS = 1500;
const FIRST_RESPONSE_CHARS = 300;
const PROMPT_CHARS = 200;
const PROMPTS_BUDGET = 1000;
const INPUT_CHARS = 3000;

export function composeLLMInput(
  userTexts: string[],
  assistantTexts: string[],
): string {
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  const parts: string[] = [];
  if (assistantTexts.length > 0) {
    parts.push("[Last assistant response]");
    parts.push(flat(assistantTexts.at(-1)!).slice(0, LAST_RESPONSE_CHARS));
  }
  if (assistantTexts.length > 1) {
    parts.push("\n[First assistant response]");
    parts.push(flat(assistantTexts[0]).slice(0, FIRST_RESPONSE_CHARS));
  }
  const prompts = userTexts.map((t) => `- ${flat(t).slice(0, PROMPT_CHARS)}`);
  if (prompts.length > 0) {
    const [first, ...rest] = prompts;
    const recent: string[] = [];
    let used = first.length;
    for (let i = rest.length - 1; i >= 0; i--) {
      if (used + rest[i].length + 1 > PROMPTS_BUDGET) break;
      used += rest[i].length + 1;
      recent.unshift(rest[i]);
    }
    parts.push(parts.length > 0 ? "\n[User prompts]" : "[User prompts]");
    parts.push(first, ...recent);
  }
  return parts.join("\n").slice(0, INPUT_CHARS);
}

// --- Session filtering ---

// ツール 0 件だけを条件にすると、ツールを使わない相談セッションまで落ちる。
// プロンプト 1 件以下を重ねて、動作確認用の使い捨てセッションだけに絞る。
export function isThrowawaySession(
  nonNoiseUserCount: number,
  toolUseCount: number,
): boolean {
  return toolUseCount === 0 && nonNoiseUserCount <= 1;
}

// --- Daily Note upsert ---

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

// --- Debounce ---

export function debounceStatePath(
  prefix: string,
  sessionShort: string,
): string {
  return `${
    Deno.env.get("TMPDIR") ?? "/tmp"
  }/${prefix}-memo-llm-${sessionShort}.json`;
}

export function shouldRunLLM(
  stateFilePath: string,
  currentUserCount: number,
): boolean {
  try {
    const state: DebounceState = JSON.parse(
      Deno.readTextFileSync(stateFilePath),
    );
    return currentUserCount > state.userMessageCount;
  } catch {
    return true;
  }
}

export function saveDebounceState(
  stateFilePath: string,
  userCount: number,
): void {
  Deno.writeTextFileSync(
    stateFilePath,
    JSON.stringify({ userMessageCount: userCount } satisfies DebounceState),
  );
}

// --- Claude call ---

const DEFAULT_CLAUDE_TIMEOUT_MS = 45000;
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

export interface CallClaudeOptions {
  onStderr?: (msg: string) => Promise<void> | void;
  timeoutMs?: number;
  extraEnv?: Record<string, string>;
}

// The summary `claude -p` must not inherit the hook's cwd: Claude Code files the
// child's transcript under the project dir derived from cwd, so every `cd` a
// session made spawned a fake project dir and real project dirs filled up with
// summary sessions. `$HOME/.cache` is used instead of `XDG_CACHE_HOME` because
// codex-memo and opencode-memo run with `--allow-env=HOME,TMPDIR`; reading any
// other variable throws NotCapable. An empty or unset HOME throws instead of
// falling back to /tmp: transcripts written there escape the 30-day cleanup and
// callClaude already reports the failure and inherits the cwd.
export function memoRunDir(home = Deno.env.get("HOME")): string {
  if (!home) {
    throw new Error("HOME is empty or not set; cannot place the memo run dir");
  }
  const dir = `${home}/.cache/claude-memo`;
  Deno.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function callClaude(
  condensed: string,
  agentLabel: string,
  opts: CallClaudeOptions = {},
): Promise<LLMResult | null> {
  const { onStderr, timeoutMs = DEFAULT_CLAUDE_TIMEOUT_MS, extraEnv } = opts;

  let cwd: string | undefined;
  try {
    cwd = memoRunDir();
  } catch (e) {
    try {
      await onStderr?.(
        `memoRunDir failed, falling back to inherited cwd: ${e}`,
      );
    } catch {
      // A failing logger must not turn a cwd fallback into a lost summary.
    }
  }

  const prompt = `以下は${agentLabel}セッションの要約データです。` +
    "このセッションで何が行われたかを日本語で要約してください。\n\n" +
    "出力フォーマット:\n" +
    "1行目: 40〜80文字の要約（意図と結果を含む）\n" +
    "2行目以降: 補足情報を箇条書きで2〜3項目（各項目は「- 」で始め、30〜60文字）\n" +
    "最終行（任意）: 「学び: 」で始まる1行（30〜100文字）。このリポジトリの外でも役立つ知見" +
    "（不具合の原因、ツールや仕様の制約、理由のある設計判断など）が得られたときだけ書く。" +
    "該当しなければこの行は書かない。作業内容、ツールの実行回数、" +
    "「〜が重要」「〜すべき」のような一般論は学びではない。ツール名・設定・挙動など具体的な対象を含めて書く。" +
    "ただしトークン、パスワード、URL、社内のホスト名、個人名は書かない。\n\n" +
    "補足が不要なほど単純なセッションなら1行目だけでもOK。\n" +
    "出力は要約のみ。説明や前置きは不要です。";

  let proc: Deno.ChildProcess | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const cmd = new Deno.Command("claude", {
      args: ["-p", "--safe-mode", "--model", CLAUDE_MODEL],
      cwd,
      // ANTHROPIC_API_KEY を空文字で上書きすることで、親環境にキーが設定されていても
      // API 従量課金ではなくサブスク OAuth 経由の実行を強制する。
      env: { ANTHROPIC_API_KEY: "", ...(extraEnv ?? {}) },
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
    }, timeoutMs);

    const writer = proc.stdin.getWriter();
    await writer.write(new TextEncoder().encode(`${prompt}\n\n${condensed}`));
    await writer.close();

    const { code, stdout, stderr } = await proc.output();
    if (code !== 0) {
      if (onStderr) {
        const msg = new TextDecoder().decode(stderr).trim().slice(0, 500);
        await onStderr(msg);
      }
      return null;
    }
    return parseLLMOutput(new TextDecoder().decode(stdout));
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
