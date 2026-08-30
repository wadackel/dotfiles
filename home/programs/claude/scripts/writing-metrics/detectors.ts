/**
 * writing-clarity lint の検出層。
 * CLAUDE.md `### Writing` 規範の違反候補を和文 Markdown から決定的に検出する。
 * 検出は疑いの提示であり、直すかどうかの判断は AI/人間に委ねる。
 * 許可辞書とワークフロー語彙の正本は
 * `home/programs/agents/skills/writing-clarity/references/protected-terms.md`。
 */

export type Severity = "warn" | "info";

export interface Finding {
  category: string;
  severity: Severity;
  line: number;
  matched: string;
  excerpt: string;
}

export interface Dictionaries {
  allow: Set<string>;
  workflow: string[];
}

const HOME = Deno.env.get("HOME") ?? "";

// vocab-inventory.ts と同じ理由: symlink 経由の起動では import.meta.url が
// canonicalize されず相対導出が壊れるため、flake.nix の存在で検証してから使う。
export async function resolveRepoRoot(): Promise<string> {
  const candidates = [
    new URL("../../../../..", import.meta.url).pathname.replace(/\/$/, ""),
    `${HOME}/dotfiles`,
  ];
  for (const c of candidates) {
    try {
      await Deno.stat(`${c}/flake.nix`);
      return c;
    } catch {
      // 次の候補へ
    }
  }
  throw new Error(
    `repo root not found (flake.nix missing in: ${candidates.join(", ")})`,
  );
}

export async function resolveProtectedTermsPath(): Promise<string> {
  const repo = await resolveRepoRoot();
  return `${repo}/home/programs/agents/skills/writing-clarity/references/protected-terms.md`;
}

const WORD_LIST_LINE = /^[A-Za-z][A-Za-z-]*(?:,\s*[A-Za-z-]+)*,?$/;

function sectionLines(lines: string[], heading: string): string[] {
  const start = lines.findIndex((l) => l.trim().startsWith(heading));
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

/**
 * protected-terms.md から許可辞書とワークフロー語彙を読み取る。
 * パース対象は4箇所に限定し、散文のカテゴリ説明（Always original 節の大半）は
 * 語リストとして扱わない — 説明文中の英単語が許可辞書へ混入するため。
 * 節が残ったまま中身が空になる壊れ方は静かに誤検出を増やすので、
 * 語数の下限を満たさない場合は例外を投げる（呼び出し側で exit 1）。
 */
export function loadDictionaries(mdText: string): Dictionaries {
  const lines = mdText.split("\n");
  const allow = new Set<string>();

  for (const l of sectionLines(lines, "## Domain terms")) {
    const t = l.trim();
    if (!WORD_LIST_LINE.test(t)) continue;
    for (const w of t.split(",")) {
      const word = w.trim().toLowerCase();
      if (word) allow.add(word);
    }
  }

  const acronymLine = lines.find((l) =>
    l.trim().startsWith("- Established acronyms:")
  );
  if (!acronymLine) {
    throw new Error(
      "protected-terms.md: 'Established acronyms' line not found",
    );
  }
  for (const w of acronymLine.split(":")[1].split(",")) {
    const word = w.trim().toLowerCase();
    if (word) allow.add(word);
  }

  const workflow: string[] = [];
  for (const l of sectionLines(lines, "## Words that are findings")) {
    const m = l.match(/^\|([^|]+)\|/);
    if (!m) continue;
    const cell = m[1].trim();
    if (cell === "Word" || /^-+$/.test(cell)) continue;
    // 右セルにも「タスク / 作業」のような ` / ` があるため、分割は左セル限定
    for (const w of cell.split("/")) {
      const word = w.trim().toLowerCase();
      if (word) workflow.push(word);
    }
  }

  const fenceSection = sectionLines(lines, "## Additional allowlist");
  const fenceStart = fenceSection.findIndex((l) =>
    l.trim().startsWith("```allowlist")
  );
  if (fenceStart < 0) {
    throw new Error("protected-terms.md: '```allowlist' fence not found");
  }
  for (let i = fenceStart + 1; i < fenceSection.length; i++) {
    const t = fenceSection[i].trim();
    if (t.startsWith("```")) break;
    if (!t || t.startsWith("#")) continue;
    allow.add(t.toLowerCase());
  }

  if (allow.size < 20) {
    throw new Error(
      `protected-terms.md: allowlist too small (${allow.size} < 20) — parse targets may be broken`,
    );
  }
  if (workflow.length !== 11) {
    throw new Error(
      `protected-terms.md: workflow vocabulary must be exactly 11 words, got ${workflow.length}`,
    );
  }
  return { allow, workflow };
}

// ---------------------------------------------------------------------------
// テキスト解析基盤

export type LineKind =
  | "fence"
  | "heading"
  | "table"
  | "boldLabel"
  | "urlOnly"
  | "blank"
  | "prose";

export interface LineInfo {
  no: number;
  raw: string;
  /** インラインコードを ␣ に置換した地の文。fence 行は空文字 */
  prose: string;
  kind: LineKind;
  isListItem: boolean;
}

// baseline-mixing.ts の proseOnly はフェンス全体を1つの改行に潰すため行番号が
// 保存されない。findings は行番号で指すので、ここでは行単位でフェンス状態を
// 追跡して行数を保存する。
export function analyzeLines(text: string): LineInfo[] {
  const out: LineInfo[] = [];
  let inFence = false;
  let fenceMarker = "";
  for (const [i, raw] of text.split("\n").entries()) {
    const no = i + 1;
    const trimmed = raw.trim();
    const fenceOpen = trimmed.match(/^(```|~~~)/);
    if (inFence) {
      if (fenceOpen && trimmed.startsWith(fenceMarker)) inFence = false;
      out.push({ no, raw, prose: "", kind: "fence", isListItem: false });
      continue;
    }
    if (fenceOpen) {
      inFence = true;
      fenceMarker = fenceOpen[1];
      out.push({ no, raw, prose: "", kind: "fence", isListItem: false });
      continue;
    }
    // `[file-state]` のような角括弧タグは機械契約のマーカーとして免除する。
    // リンク記法 `[text](url)` の text は地の文なので、直後に `(` が続く場合は残す
    const prose = raw
      .replace(/`[^`\n]+`/g, "␣")
      .replace(/\[[^\]\n]{1,30}\](?!\()/g, "␣");
    const isListItem = /^\s*(?:[-*+]|\d+\.)\s+/.test(raw);
    let kind: LineKind = "prose";
    if (trimmed === "") kind = "blank";
    else if (/^#{1,6}\s/.test(trimmed)) kind = "heading";
    else if (trimmed.startsWith("|")) kind = "table";
    else if (/^(?:[-*+]\s+|\d+\.\s+)?\*\*[^*]+\*\*\s*[:：]/.test(trimmed)) {
      kind = "boldLabel";
    } else if (/^<?https?:\/\/\S+>?$/.test(trimmed)) kind = "urlOnly";
    out.push({ no, raw, prose, kind, isListItem });
  }
  return out;
}

export function classifyLatin(w: string): "identifier" | "acronym" | "word" {
  if (/[._/]/.test(w)) return "identifier";
  if (/^[A-Za-z][a-z0-9]*[A-Z]/.test(w)) return "identifier"; // camelCase / PascalCase
  if (/^[A-Z]{2,}$/.test(w)) return "acronym";
  if (/\d/.test(w)) return "identifier";
  // `ja-prose-clarity` のようなハイフン2連結以上は kebab-case の名前
  // （`pre-existing` のような1連結の一般語と区別する）
  if ((w.match(/-/g)?.length ?? 0) >= 2) return "identifier";
  return "word";
}

const JA_CHAR = /[぀-ヿ一-鿿]/;
const HIRAGANA = /[ぁ-ゖ]/;

export function splitSentences(prose: string): string[] {
  return prose.split(/(?<=[。．！？])/).map((s) => s.trim()).filter((s) =>
    s.length > 0
  );
}

function excerptOf(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 120 ? t.slice(0, 120) + "…" : t;
}

function latinTokens(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9_.\-/]*/g)) {
    const w = m[0].replace(/[.\-/]+$/, "");
    if (w.length >= 3) out.push(w);
  }
  return out;
}

/**
 * `Task 3` / `Round 1` のような ID 参照と、`Task Outline` / `Patterns to Mirror`
 * のような大文字始まりの複合名は保持対象（protected-terms.md の ID 参照規則の拡張。
 * 試走で節名・見出し名の参照が誤検出の主因と実測されたため）
 */
function isNameReference(text: string, matchEnd: number): boolean {
  return /^\s*(?:\d|[A-Z][a-z])/.test(text.slice(matchEnd));
}

/** `cask(11) / plist(10) / tar(12)` のようなスラッシュ区切りのデータ列挙行 */
function isSlashDataLine(s: string): boolean {
  return (s.match(/ \/ /g)?.length ?? 0) >= 2;
}

/**
 * `observation: …` / `source: …` のようにコロンが直後に続く語はキー・バリュー
 * 記法のフィールドラベル（機械契約）。plan 文書の held-out 測定で誤検出の
 * 最大クラスだったため、語の使用ではなくラベルとして免除する
 */
function isFieldLabel(text: string, matchEnd: number): boolean {
  return /^\s*[:：]/.test(text.slice(matchEnd));
}

// ---------------------------------------------------------------------------
// 検出器

const PROSE_TARGET: LineKind[] = ["prose"];

export function detectWorkflowVocab(
  lines: LineInfo[],
  dict: Dictionaries,
): Finding[] {
  const findings: Finding[] = [];
  // 境界に `/` を含めるのは `step/phase` のようなスラッシュ複合（表記としての参照）
  // を語の使用と区別するため
  const patterns = dict.workflow.map((w) => ({
    word: w,
    re: new RegExp(
      `(?<![A-Za-z/-])${
        w.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
      }(?:e?s)?(?![A-Za-z/-])`,
      "gi",
    ),
  }));
  for (const line of lines) {
    if (!PROSE_TARGET.includes(line.kind)) continue;
    for (const sentence of splitSentences(line.prose)) {
      if (!JA_CHAR.test(sentence)) continue;
      // 鉤括弧内は引用例（「この task は複雑だ」等）として保持対象
      const s = sentence.replace(/「[^」]*」/g, "␣");
      for (const { re } of patterns) {
        re.lastIndex = 0;
        for (const m of s.matchAll(re)) {
          if (isNameReference(s, m.index + m[0].length)) continue;
          if (isFieldLabel(s, m.index + m[0].length)) continue;
          findings.push({
            category: "workflow_vocab",
            severity: "warn",
            line: line.no,
            matched: m[0],
            excerpt: excerptOf(sentence),
          });
        }
      }
    }
  }
  return findings;
}

export function detectMixedLatinWord(
  lines: LineInfo[],
  dict: Dictionaries,
): Finding[] {
  const findings: Finding[] = [];
  const workflowSet = new Set(dict.workflow);
  const allowed = (lower: string): boolean =>
    dict.allow.has(lower) ||
    (lower.endsWith("s") && dict.allow.has(lower.slice(0, -1)));
  for (const line of lines) {
    if (!PROSE_TARGET.includes(line.kind)) continue;
    const seen = new Set<string>();
    for (const sentence of splitSentences(line.prose)) {
      if (!JA_CHAR.test(sentence)) continue;
      for (const m of sentence.matchAll(/[A-Za-z][A-Za-z0-9_.\-/]*/g)) {
        const w = m[0].replace(/[.\-/]+$/, "");
        if (w.length < 3 || classifyLatin(w) !== "word") continue;
        // 和文の文中で大文字始まりの英単語は節名・見出し名・固有名の参照が
        // 大半（試走の実測）。名前参照として保持し、一般語の混在は小文字だけ疑う
        if (/^[A-Z]/.test(w)) continue;
        // `Domain terms` のような複合名の後半トークンも名前の一部として保持
        if (/[A-Z][a-z]+\s*$/.test(sentence.slice(0, m.index))) continue;
        const lower = w.toLowerCase();
        const base = lower.endsWith("s") ? lower.slice(0, -1) : lower;
        // workflow 語は detectWorkflowVocab 側で報告する（二重報告の回避）
        if (workflowSet.has(lower) || workflowSet.has(base)) continue;
        if (allowed(lower)) continue;
        if (isNameReference(sentence, m.index + m[0].length)) continue;
        if (isFieldLabel(sentence, m.index + m[0].length)) continue;
        if (seen.has(lower)) continue;
        seen.add(lower);
        findings.push({
          category: "mixed_latin_word",
          severity: "warn",
          line: line.no,
          matched: w,
          excerpt: excerptOf(sentence),
        });
      }
    }
  }
  return findings;
}

export function detectArrowChain(lines: LineInfo[]): Finding[] {
  const findings: Finding[] = [];
  for (const line of lines) {
    if (!PROSE_TARGET.includes(line.kind)) continue;
    for (const sentence of splitSentences(line.prose)) {
      if (!JA_CHAR.test(sentence)) continue;
      const arrows = sentence.match(/→|->/g);
      if (arrows && arrows.length >= 2) {
        findings.push({
          category: "arrow_chain",
          severity: "warn",
          line: line.no,
          matched: `${arrows[0]} ×${arrows.length}`,
          excerpt: excerptOf(sentence),
        });
      }
    }
  }
  return findings;
}

export function detectTelegraphicFragment(lines: LineInfo[]): Finding[] {
  const findings: Finding[] = [];
  for (const line of lines) {
    if (line.kind !== "prose") continue;
    let s = line.prose.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "");
    // 箇条書きの「ラベル — 説明」形はラベル部を免除し、説明部だけを見る
    if (line.isListItem) {
      const dash = s.search(/\s[—–]\s|\s--\s/);
      if (dash >= 0) s = s.slice(dash).replace(/^\s[—–-]+\s/, "");
    }
    s = s.replace(/␣/g, " ").trim();
    if (s.length < 6) continue;
    if (/^\S+$/.test(s)) continue; // 単語1つだけの行（カタカナ語・漢字熟語単独）
    if (isSlashDataLine(s)) continue; // データ列挙行は電報体でなく一覧
    if (HIRAGANA.test(s)) continue;
    const words = latinTokens(s).filter((w) => classifyLatin(w) === "word");
    if (!JA_CHAR.test(s)) {
      // 日本語文字を含まない行は「idx stable exit 0」型の短い断片だけを疑う。
      // 語数が多い・ピリオドで終わる行は英文（plan の Completion Criteria 等、
      // 言語ポリシー上英語固定の機械契約行）であり電報体ではない
      if (words.length < 2 || words.length > 5) continue;
      if (/[.!?]$/.test(s)) continue;
    }
    findings.push({
      category: "telegraphic_fragment",
      severity: "info",
      line: line.no,
      matched: excerptOf(s).slice(0, 40),
      excerpt: excerptOf(line.prose.replace(/␣/g, " ")),
    });
  }
  return findings;
}

function countParenGroups(s: string): number {
  let depth = 0;
  let groups = 0;
  for (const ch of s) {
    if (ch === "(" || ch === "（") {
      if (depth === 0) groups++;
      depth++;
    } else if (ch === ")" || ch === "）") {
      if (depth > 0) depth--;
    }
  }
  return groups;
}

export function detectParenChain(lines: LineInfo[]): Finding[] {
  const findings: Finding[] = [];
  for (const line of lines) {
    if (!PROSE_TARGET.includes(line.kind)) continue;
    for (const sentence of splitSentences(line.prose)) {
      if (!JA_CHAR.test(sentence)) continue;
      if (isSlashDataLine(sentence)) continue;
      const groups = countParenGroups(sentence);
      if (groups >= 2) {
        findings.push({
          category: "paren_chain",
          severity: "info",
          line: line.no,
          matched: `括弧 ×${groups}`,
          excerpt: excerptOf(sentence),
        });
      }
    }
  }
  return findings;
}

export function detectAll(text: string, dict: Dictionaries): Finding[] {
  const lines = analyzeLines(text);
  return [
    ...detectWorkflowVocab(lines, dict),
    ...detectMixedLatinWord(lines, dict),
    ...detectArrowChain(lines),
    ...detectTelegraphicFragment(lines),
    ...detectParenChain(lines),
  ].sort((a, b) => a.line - b.line || a.category.localeCompare(b.category));
}
