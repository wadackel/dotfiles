import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  checkBudget,
  type CheckKey,
  extractNotes,
  formatResult,
} from "./check-budget.ts";

const rep = (n: number) => "あ".repeat(n);

function note(
  opts: { s0?: string[]; s1?: string[]; s2?: string[]; s3?: string[] },
): string {
  const section = (heading: string, bullets: string[] | undefined) => [
    `### ${heading}`,
    "",
    ...(bullets ?? []).map((b) => `- ${b}`),
    "",
  ];
  return [
    "---",
    "tags:",
    "  - weekly",
    "---",
    "",
    "## 🦄 Notes",
    "",
    ...section("0.今週やること", opts.s0),
    ...section("1.今週やったこと", opts.s1),
    ...section("2.来週やること", opts.s2),
    ...section("3.感想", opts.s3),
    "## 📊 Analysis",
    "",
    "```dataviewjs",
    "// ＃999 と 12 件 は Notes の外なので数えない",
    "```",
  ].join("\n");
}

/** 行をそのまま置く版。マーカーの有無を含めて書式を検証したいとき用 */
function rawNote(
  opts: { s0?: string[]; s1?: string[]; s2?: string[]; s3?: string[] },
): string {
  const section = (heading: string, lines: string[] | undefined) => [
    `### ${heading}`,
    "",
    ...(lines ?? []),
    "",
  ];
  return [
    "---",
    "tags:",
    "  - weekly",
    "---",
    "",
    "## 🦄 Notes",
    "",
    "- tba",
    "",
    ...section("0.今週やること", opts.s0),
    ...section("1.今週やったこと", opts.s1),
    ...section("2.来週やること", opts.s2),
    ...section("3.感想", opts.s3),
    "## 📊 Analysis",
    "",
  ].join("\n");
}

const checkOf = (md: string, key: CheckKey) =>
  checkBudget(md).checks.find((c) => c.key === key)!;

Deno.test("S1 は 300 字ちょうどで PASS", () => {
  const c = checkOf(
    note({ s1: [...Array.from({ length: 7 }, () => rep(40)), rep(20)] }),
    "S1",
  );
  assertEquals(c.value, 300);
  assert(c.pass);
});

Deno.test("S1 は 301 字で FAIL", () => {
  const c = checkOf(
    note({ s1: [...Array.from({ length: 7 }, () => rep(40)), rep(21)] }),
    "S1",
  );
  assertEquals(c.value, 301);
  assert(!c.pass);
});

Deno.test("S3 は 120 字ちょうどで PASS、121 字で FAIL", () => {
  assert(checkOf(note({ s3: [rep(120)] }), "S3").pass);
  assert(!checkOf(note({ s3: [rep(121)] }), "S3").pass);
});

Deno.test("S1MAX は 40 字ちょうどで PASS、41 字で FAIL", () => {
  const ok = checkOf(note({ s1: [rep(40)] }), "S1MAX");
  assertEquals(ok.value, 40);
  assert(ok.pass);
  assert(!checkOf(note({ s1: [rep(41)] }), "S1MAX").pass);
});

Deno.test("禁止トークンを 4 種とも検出する", () => {
  for (
    const t of ["対応 ＃276", "対応 #276", "commit 3fe8ee9b", "テスト 5 件"]
  ) {
    const r = checkBudget(note({ s1: [t] }));
    assertEquals(r.checks.find((c) => c.key === "TOKENS")!.value, 1, t);
    assert(!r.pass, t);
  }
});

Deno.test("全角数字・大文字でも取りこぼさない", () => {
  assertEquals(checkOf(note({ s1: ["テスト ５件"] }), "TOKENS").value, 1);
  assertEquals(checkOf(note({ s1: ["テスト １２ 件"] }), "TOKENS").value, 1);
  assertEquals(checkOf(note({ s1: ["対応 ＃２７６"] }), "TOKENS").value, 1);
  assertEquals(checkOf(note({ s1: ["対応 #２７６"] }), "TOKENS").value, 1);
  assertEquals(checkOf(note({ s1: ["対応 ＃  276"] }), "TOKENS").value, 1);
  assertEquals(checkOf(note({ s1: ["commit 3FE8EE9B"] }), "TOKENS").value, 1);
  assertEquals(
    checkOf(note({ s1: ["docs/README.MD を更新"] }), "TOKENS").value,
    1,
  );
  // 大文字対応で全数字・全英字の除外が壊れていないこと
  assertEquals(
    checkOf(note({ s1: ["ラベル DEADBEEF を付与"] }), "TOKENS").value,
    0,
  );
  assertEquals(
    checkOf(note({ s1: ["日付 20260803 の記録"] }), "TOKENS").value,
    0,
  );
});

Deno.test("禁止トークンは §0 / §2 でも検出する", () => {
  assertEquals(checkOf(note({ s0: ["対応 ＃276"] }), "TOKENS").value, 1);
  assertEquals(checkOf(note({ s2: ["対応 ＃276"] }), "TOKENS").value, 1);
});

Deno.test("パスは拡張子付きのみ検出し、略語の並記は誤検出しない", () => {
  assertEquals(
    checkOf(note({ s1: ["app/routes/foo.tsx を修正"] }), "TOKENS").value,
    1,
  );
  assertEquals(
    checkOf(note({ s1: [".claude/settings.json を更新"] }), "TOKENS").value,
    1,
  );
  assertEquals(
    checkOf(note({ s1: ["AB/CD 形式の略語を含む見出し"] }), "TOKENS").value,
    0,
  );
  assertEquals(checkOf(note({ s1: ["設計 A / B を比較"] }), "TOKENS").value, 0);
});

Deno.test("SHA は英数が混在するものだけ検出する", () => {
  assertEquals(
    checkOf(note({ s1: ["日付 20260803 の記録"] }), "TOKENS").value,
    0,
  );
  assertEquals(
    checkOf(note({ s1: ["ラベル deadbeef を付与"] }), "TOKENS").value,
    0,
  );
  assertEquals(checkOf(note({ s1: ["commit 3fe8ee9b"] }), "TOKENS").value, 1);
});

Deno.test("空セクションと tba は 0 字として PASS", () => {
  const r = checkBudget(note({}));
  assertEquals(checkOf(note({}), "S1").value, 0);
  assert(r.pass);

  const tba = note({ s1: ["tba"], s3: ["tba"] });
  assertEquals(checkOf(tba, "S1").value, 0);
  assert(checkBudget(tba).pass);
});

Deno.test("番号付き見出しが 1 つでも欠けたら UNPARSEABLE", () => {
  // 欠けた見出しの中身は別セクションへ流れ込むか孤児行になるため、0 字 PASS にしない
  const md = ["## 🦄 Notes", "", "### 1.今週やったこと", "", "- 短い", ""].join(
    "\n",
  );
  assert(checkBudget(md).unparseable);
  assert(!checkBudget(md).pass);

  // `### 1)` のように書式が化けると §1 の中身が §0 に流れ込む
  const drifted = [
    "## 🦄 Notes",
    "",
    "### 0.今週やること",
    "",
    "### 1) 今週やったこと",
    "",
    rep(500),
    "",
    "### 2.来週やること",
    "",
    "### 3.感想",
    "",
  ].join("\n");
  assert(checkBudget(drifted).unparseable);
});

Deno.test("サブセクションの外に置いた本文行は孤児として FAIL", () => {
  const md = [
    "---",
    "tags:",
    "  - weekly",
    "---",
    "",
    "## 🦄 Notes",
    "",
    "- tba",
    rep(500),
    "",
    "### 0.今週やること",
    "",
    "### 1.今週やったこと",
    "",
    "### 2.来週やること",
    "",
    "### 3.感想",
    "",
  ].join("\n");
  const r = checkBudget(md);
  // frontmatter は Notes の外なので孤児に数えない。長文 1 行だけが孤児
  assertEquals(r.checks.find((c) => c.key === "ORPHAN")!.value, 1);
  assertEquals(r.checks.find((c) => c.key === "S1")!.value, 0);
  assert(!r.pass);
  assert(!r.unparseable);
});

Deno.test("Analysis 以降は集計にも禁止トークン検出にも含めない", () => {
  const r = checkBudget(note({ s1: ["短い成果"] }));
  assertEquals(r.checks.find((c) => c.key === "TOKENS")!.value, 0);
  assert(!extractNotes(note({}))!.includes("dataviewjs"));
});

Deno.test("構造を検出できない入力は PASS にせず UNPARSEABLE にする", () => {
  // 見出しが `### 1.` から `## 1.` へ化けた生成事故を、沈黙の PASS で通さない
  const drifted = ["## 🦄 Notes", "", "## 1.今週やったこと", "", "- 何か", ""]
    .join("\n");
  const r = checkBudget(drifted);
  assert(r.unparseable);
  assert(!r.pass);
  assertEquals(r.sections, 0);
  assertEquals(formatResult(r), [
    "SECTIONS:0 MISSING:0,1,2,3",
    "RESULT:UNPARSEABLE",
  ]);

  const noNotesHeading = checkBudget("### 1.今週やったこと\n\n- 何か\n");
  assert(noNotesHeading.unparseable);
  assertEquals(checkBudget("").unparseable, true);
});

Deno.test("formatResult は SKILL.md が依存する契約どおりの行を返す", () => {
  const r = checkBudget(note({ s1: ["対応 ＃276"], s3: ["短い感想"] }));
  const lines = formatResult(r);
  assert(lines.includes("S1:7 LIMIT:300 PASS"));
  assert(lines.includes("TOKENS:1 LIMIT:0 FAIL"));
  assert(lines.some((l) => l.startsWith("FOUND:＃276")));
  assertEquals(lines.at(-1), "RESULT:FAIL");
  assert(!r.pass);

  const ok = formatResult(checkBudget(note({ s1: ["短い成果"] })));
  assertEquals(ok.at(-1), "RESULT:PASS");
  assert(!ok.some((l) => l.startsWith("FOUND:")));
});

Deno.test("bullet をやめて散文にしても字数から逃げられない", () => {
  // マーカーなしの素の行と、`*` / `1.` の別マーカーを混ぜる
  const r = checkBudget(
    rawNote({ s1: [rep(200)], s3: ["* 別マーカーの行", "1. 番号付きの行"] }),
  );
  assert(!r.unparseable);
  // マーカーが無くても 0 字にはならず、そのまま計上される
  assertEquals(r.checks.find((c) => c.key === "S1")!.value, 200);
  // マーカーを剥がした「別マーカーの行」7 字 + 「番号付きの行」6 字
  assertEquals(r.checks.find((c) => c.key === "S3")!.value, 13);
  assert(!r.checks.find((c) => c.key === "S1MAX")!.pass);
  assert(!r.pass);
});

Deno.test("番号外の見出しを作ってもそこへ本文を逃がせない", () => {
  const escaped = note({ s1: ["短い成果"] }).replace(
    "### 3.感想",
    ["### 4.補足", "", "- " + rep(500), "", "### 3.感想"].join("\n"),
  );
  const r = checkBudget(escaped);
  // `### 4.` 配下は S1 にも S3 にも入らないので、孤児行として失敗させる
  assertEquals(r.checks.find((c) => c.key === "ORPHAN")!.value, 1);
  assert(!r.pass);
});

Deno.test("深い見出しに入れ子にしても字数から逃げられない", () => {
  const nested = rawNote({ s1: ["#### Atlas", rep(60)] });
  const r = checkBudget(nested);
  assert(!r.unparseable);
  // "Atlas"(5) + 本文 60 字
  assertEquals(r.checks.find((c) => c.key === "S1")!.value, 65);
  assert(!r.checks.find((c) => c.key === "S1MAX")!.pass);
  assert(!r.pass);
});

Deno.test("§0 / §2 の長文は S1 / S3 に混ざらない", () => {
  const r = checkBudget(note({ s0: [rep(500)], s2: [rep(500)] }));
  assertEquals(r.checks.find((c) => c.key === "S1")!.value, 0);
  assertEquals(r.checks.find((c) => c.key === "S3")!.value, 0);
  assertEquals(r.bullets, 1000);
  assert(r.pass);
});

Deno.test("グループラベル行も字数に含める", () => {
  const grouped = rawNote({ s1: ["- Atlas", "    - 認証基盤を移行"] });
  assert(!checkBudget(grouped).unparseable);
  // "Atlas"(5) + "認証基盤を移行"(7)
  assertEquals(checkOf(grouped, "S1").value, 12);
});

Deno.test("bullets は足場を除いた字数、notes は生の字数", () => {
  const r = checkBudget(note({ s1: [rep(200)], s3: [rep(5)] }));
  assertEquals(r.bullets, 205);
  assert(r.notes > r.bullets);
  assert(r.notesNet > 0 && r.notesNet < r.notes);
});
