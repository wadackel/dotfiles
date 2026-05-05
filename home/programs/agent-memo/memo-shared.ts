// Shared memo library used by claude-memo / codex-memo / opencode-memo.
// Each agent script imports from a sibling symlink at <agent>/scripts/memo-shared.ts
// → ../../agent-memo/memo-shared.ts.
//
// Agent-specific concerns (transcript / DB parser, NOISE_PATTERNS,
// heuristicSummary, buildLLMInput, log path, hook entry) stay in the agent
// script. Shared concerns (Daily Note upsert, Gemini call, debounce I/O,
// repo-name resolution, LLM output parsing, Obsidian escape) live here.

export interface LLMResult {
  summary: string;
  details: string[];
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

export function debounceStatePath(prefix: string, sessionShort: string): string {
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

// --- Gemini call ---

const DEFAULT_GEMINI_TIMEOUT_MS = 15000;

export async function callGemini(
  condensed: string,
  agentLabel: string,
  timeoutMs: number = DEFAULT_GEMINI_TIMEOUT_MS,
): Promise<LLMResult | null> {
  const prompt = `以下は${agentLabel}セッションの要約データです。` +
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
    }, timeoutMs);

    const writer = proc.stdin.getWriter();
    await writer.write(new TextEncoder().encode(`${prompt}\n\n${condensed}`));
    await writer.close();

    const { code, stdout } = await proc.output();
    if (code !== 0) return null;
    return parseLLMOutput(new TextDecoder().decode(stdout));
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
