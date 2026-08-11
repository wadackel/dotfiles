/** 週次ノートの Notes セクションが分量バジェットに収まっているかを判定する */

const LIMIT_S1 = 300;
const LIMIT_S3 = 120;
const LIMIT_S1_MAX = 40;

export type CheckKey = "S1" | "S3" | "S1MAX" | "TOKENS" | "ORPHAN";

export type Check = {
  key: CheckKey;
  value: number;
  limit: number;
  pass: boolean;
};

export type BudgetResult = {
  checks: Check[];
  /** frontmatter と見出しを含む Notes 領域の生の字数 */
  notes: number;
  /** テンプレート由来の足場を差し引いた概算 */
  notesNet: number;
  /** bullet のテキスト部分だけを合計した、足場を含まない字数 */
  bullets: number;
  /** 見つかった番号付きサブセクションの数 */
  sections: number;
  /** 見つからなかった番号付きサブセクションの番号 */
  missingSections: string[];
  /** 検出された禁止トークン（重複を含む） */
  tokens: string[];
  pass: boolean;
  /** Notes 見出しまたは番号付きサブセクションを 1 つも見つけられなかった */
  unparseable: boolean;
};

/**
 * Notes を空にした週（2026-W22 / W26 / W27）を本ファイルの `extractNotes` で測った値。
 * 別定義で数えると 144 になるが、notesNet は記録用で判定には使わない。
 */
const TEMPLATE_OVERHEAD = 143;

// 日本語ノートでは IME 由来の全角数字が普通に混ざるので、数字はどの規則でも全角を見る
const FORBIDDEN: RegExp[] = [
  /[#＃]\s*[0-9０-９]{2,6}/g,
  // 全数字・全英字の連なりを SHA と誤認しないよう、両方を含むものだけに絞る
  /\b(?=[0-9a-f]{7,40}\b)(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi,
  /[0-9０-９]+\s*件/g,
  // 拡張子で終わるものだけをパスとみなす。`AB/CD` のような略語の並記を弾くため
  /[\w.-]+\/[\w./-]*\.[a-z]{1,5}\b/gi,
];

/** テンプレートが必ず生成する番号付きサブセクション */
const REQUIRED_SECTIONS = ["0", "1", "2", "3"];

/**
 * 片方だけ書き換えると `extractNotes` の切り出し範囲と `parseNotes` の孤児判定が
 * ずれ、切り出せたのに全行が孤児という不整合になるので 1 箇所に持つ
 */
const NOTES_HEADING = /^##\s+.*Notes\s*$/;

function codePoints(s: string): number {
  return [...s].length;
}

/** Notes 領域（ファイル先頭から Analysis 見出しの手前まで）を切り出す。見出しが無ければ null */
export function extractNotes(md: string): string | null {
  const lines = md.split("\n");
  let notesHeading = -1;
  for (let i = 0; i < lines.length; i++) {
    if (NOTES_HEADING.test(lines[i])) {
      notesHeading = i;
      break;
    }
  }
  if (notesHeading === -1) return null;
  let end = lines.length;
  for (let i = notesHeading + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(0, end).join("\n");
}

type ParsedNotes = {
  /** 番号付きサブセクションごとの本文行 */
  bySection: Map<string, string[]>;
  /** どのサブセクションにも属さない本文行 */
  orphans: string[];
};

/** 行頭の見出し記号と箇条書きマーカーを剥がす */
function bodyText(line: string): string {
  return line.trim()
    .replace(/^#+\s*/, "")
    .replace(/^(?:[-*+]|\d+\.)\s+/, "")
    .trim();
}

/**
 * Notes 領域を、番号付きサブセクションの本文行と、どこにも属さない孤児行に分ける。
 *
 * 数えた行だけ合計する作りにすると、パーサが認識しない書き方すべてが
 * 「0 字だから PASS」の抜け道になる。認識できなかった本文行は捨てずに
 * orphans へ集め、呼び出し側が失敗として扱えるようにする。
 */
function parseNotes(notes: string): ParsedNotes {
  const bySection = new Map<string, string[]>();
  const orphans: string[] = [];
  let current: string[] | null = null;
  // frontmatter は Notes セクションの外なので孤児行に数えない
  let inNotes = false;
  for (const line of notes.split("\n")) {
    if (!inNotes) {
      if (NOTES_HEADING.test(line)) inNotes = true;
      continue;
    }
    const heading = line.match(/^###\s+(\d)\./);
    if (heading) {
      // `### 4.補足` のような番号外の見出しを作ってそこへ本文を逃がせないよう、
      // 想定外の番号は現在位置を持たせずに孤児行として扱う
      const key = heading[1];
      if (!REQUIRED_SECTIONS.includes(key)) {
        current = null;
        continue;
      }
      let bucket = bySection.get(key);
      if (!bucket) {
        bucket = [];
        bySection.set(key, bucket);
      }
      current = bucket;
      continue;
    }
    // 打ち切るのは h1/h2 だけ。`#### Atlas` に入れ子にすれば数えられずに済む、
    // という抜け道を残さないため、より深い見出しは本文行として数える
    if (/^#{1,2}\s+/.test(line)) {
      current = null;
      continue;
    }
    const text = bodyText(line);
    if (text === "" || text === "tba") continue;
    if (current === null) orphans.push(text);
    else current.push(text);
  }
  return { bySection, orphans };
}

export function checkBudget(md: string): BudgetResult {
  const raw = extractNotes(md);
  const notes = raw ?? "";
  const { bySection, orphans } = parseNotes(notes);
  const s1 = bySection.get("1") ?? [];
  const s3 = bySection.get("3") ?? [];

  const s1Chars = s1.reduce((a, b) => a + codePoints(b), 0);
  const s3Chars = s3.reduce((a, b) => a + codePoints(b), 0);
  const s1Max = s1.reduce((a, b) => Math.max(a, codePoints(b)), 0);

  const tokens: string[] = [];
  let bullets = 0;
  for (const all of bySection.values()) {
    for (const text of all) {
      bullets += codePoints(text);
      for (const re of FORBIDDEN) {
        tokens.push(...(text.match(re) ?? []));
      }
    }
  }

  const checks: Check[] = [
    { key: "S1", value: s1Chars, limit: LIMIT_S1, pass: s1Chars <= LIMIT_S1 },
    { key: "S3", value: s3Chars, limit: LIMIT_S3, pass: s3Chars <= LIMIT_S3 },
    {
      key: "S1MAX",
      value: s1Max,
      limit: LIMIT_S1_MAX,
      pass: s1Max <= LIMIT_S1_MAX,
    },
    {
      key: "TOKENS",
      value: tokens.length,
      limit: 0,
      pass: tokens.length === 0,
    },
    {
      key: "ORPHAN",
      value: orphans.length,
      limit: 0,
      pass: orphans.length === 0,
    },
  ];

  const notesChars = codePoints(notes);
  // 見出しが 1 つでも欠けると、その中身が別セクションへ流れ込むか孤児行になる。
  // 「数えられなかった」を PASS ではなく音の出る失敗にする
  const missingSections = REQUIRED_SECTIONS.filter((k) => !bySection.has(k));
  const unparseable = raw === null || missingSections.length > 0;

  return {
    checks,
    notes: notesChars,
    notesNet: Math.max(0, notesChars - TEMPLATE_OVERHEAD),
    bullets,
    sections: bySection.size,
    missingSections,
    tokens,
    pass: !unparseable && checks.every((c) => c.pass),
    unparseable,
  };
}

export function formatResult(r: BudgetResult): string[] {
  if (r.unparseable) {
    return [
      `SECTIONS:${r.sections} MISSING:${r.missingSections.join(",") || "-"}`,
      "RESULT:UNPARSEABLE",
    ];
  }
  const lines = r.checks.map(
    (c) => `${c.key}:${c.value} LIMIT:${c.limit} ${c.pass ? "PASS" : "FAIL"}`,
  );
  lines.push(`SECTIONS:${r.sections}`);
  lines.push(`NOTES:${r.notes}`);
  lines.push(`NOTESNET:${r.notesNet}`);
  lines.push(`BULLETS:${r.bullets}`);
  if (r.tokens.length > 0) lines.push(`FOUND:${r.tokens.join(" ")}`);
  lines.push(`RESULT:${r.pass ? "PASS" : "FAIL"}`);
  return lines;
}

if (import.meta.main) {
  const path = Deno.args[0];
  if (!path) {
    console.error("usage: check-budget.ts <weekly-note.md>");
    Deno.exit(2);
  }
  let source: string;
  try {
    source = Deno.readTextFileSync(path);
  } catch (e) {
    // 読めなかったことを exit 1 で返すと、呼び出し側が予算 FAIL と取り違えて
    // 本文を書き直す再試行ループに入る
    console.error(`cannot read ${path}: ${e instanceof Error ? e.message : e}`);
    Deno.exit(2);
  }
  const result = checkBudget(source);
  formatResult(result).forEach((l) => console.log(l));
  if (result.unparseable) {
    console.error(
      "Notes 見出しまたは番号付きサブセクションを検出できません。生成物の構造を確認してください。",
    );
    Deno.exit(2);
  }
  Deno.exit(result.pass ? 0 : 1);
}
