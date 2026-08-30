import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  analyzeLines,
  detectAll,
  detectArrowChain,
  detectMixedLatinWord,
  detectParenChain,
  detectTelegraphicFragment,
  detectWorkflowVocab,
  type Dictionaries,
  loadDictionaries,
  resolveProtectedTermsPath,
} from "./detectors.ts";

const realDict = loadDictionaries(
  await Deno.readTextFile(await resolveProtectedTermsPath()),
);

function lines(text: string) {
  return analyzeLines(text);
}

// --- 辞書ローダ -------------------------------------------------------------

Deno.test("loadDictionaries: 実ファイルからワークフロー語彙11語が得られる", () => {
  assertEquals(realDict.workflow.length, 11);
  assert(realDict.workflow.includes("step"));
  assert(realDict.workflow.includes("phase"));
  assert(realDict.workflow.includes("self-audit"));
});

Deno.test("loadDictionaries: 表の右セルの訳語が混入しない", () => {
  for (const w of realDict.workflow) {
    assert(/^[a-z-]+$/.test(w), `non-ascii workflow word leaked: ${w}`);
  }
});

Deno.test("loadDictionaries: 許可語が20語以上あり、散文が混入しない", () => {
  assert(realDict.allow.size >= 20);
  assert(realDict.allow.has("diff"));
  assert(realDict.allow.has("nix"));
  assert(realDict.allow.has("api"));
  // Domain terms 節の導入文 "Keep these as-is; ..." が語として混入していない
  assert(!realDict.allow.has("keep"));
  assert(!realDict.allow.has("these"));
});

Deno.test("loadDictionaries: allowlist フェンス欠落は例外", () => {
  assertThrows(
    () =>
      loadDictionaries(
        "## Domain terms x\n\ndiff, commit\n\n- Established acronyms: API\n\n## Words that are findings\n\n| Word | x |\n|---|---|\n| task | タスク |\n",
      ),
    Error,
    "allowlist",
  );
});

Deno.test("loadDictionaries: 語数不足は例外（節はあるが中身が薄い）", () => {
  const md = [
    "## Domain terms x",
    "",
    "diff, commit",
    "",
    "- Established acronyms: API",
    "",
    "## Words that are findings",
    "",
    "| Word | x |",
    "|---|---|",
    "| task | タスク / 作業 |",
    "",
    "## Additional allowlist",
    "",
    "```allowlist",
    "nix",
    "```",
  ].join("\n");
  assertThrows(() => loadDictionaries(md), Error, "too small");
});

// --- analyzeLines -----------------------------------------------------------

Deno.test("analyzeLines: コードフェンスで行番号が保存される", () => {
  const ls = lines("a\n```\ncode1\ncode2\n```\nb");
  assertEquals(ls.length, 6);
  assertEquals(ls[5].no, 6);
  assertEquals(ls[5].kind, "prose");
  assertEquals(ls[1].kind, "fence");
  assertEquals(ls[3].kind, "fence");
});

Deno.test("analyzeLines: 見出し・表・太字ラベル・URL単独行を分類する", () => {
  const ls = lines(
    "## 見出し\n| a | b |\n- **設計判断**: 中身\nhttps://example.com/x\n地の文です",
  );
  assertEquals(ls.map((l) => l.kind), [
    "heading",
    "table",
    "boldLabel",
    "urlOnly",
    "prose",
  ]);
});

// --- workflow_vocab ---------------------------------------------------------

Deno.test("workflow_vocab: 地の文の語を検出し、複数形・大文字も同一視する", () => {
  const f1 = detectWorkflowVocab(lines("この task を進める。"), realDict);
  assertEquals(f1.length, 1);
  assertEquals(f1[0].matched, "task");
  const f2 = detectWorkflowVocab(lines("複数の tasks を管理する。"), realDict);
  assertEquals(f2.length, 1);
  assertEquals(f2[0].matched, "tasks");
  const f3 = detectWorkflowVocab(lines("この Task を確認する。"), realDict);
  assertEquals(f3.length, 1);
});

Deno.test("workflow_vocab: ID 参照・鉤括弧引用・見出し・インラインコードは免除", () => {
  const cases = [
    "Task 3 を実装した。",
    "「この task は複雑だ」という例を示す。",
    "## task の一覧",
    "この `task` はコード参照だ。",
    "the task is done",
  ];
  for (const c of cases) {
    assertEquals(
      detectWorkflowVocab(lines(c), realDict).length,
      0,
      `should not fire: ${c}`,
    );
  }
});

Deno.test("workflow_vocab: 複合語の内側では発火しない", () => {
  assertEquals(
    detectWorkflowVocab(lines("task-planning の話をする。"), realDict).length,
    0,
  );
});

Deno.test("workflow_vocab: 大文字複合名・スラッシュ複合・角括弧タグは免除", () => {
  const cases = [
    "plan の Task Outline が分解の正本になる。", // 大文字始まりの複合名
    "表の11語（step/phase 分割）に限定する。", // スラッシュ複合
    "- [orchestrator-only] 検証コマンドが通ること。", // 角括弧タグ
    "- task: 対象を列挙する", // フィールドラベル
  ];
  for (const c of cases) {
    assertEquals(
      detectWorkflowVocab(lines(c), realDict).length,
      0,
      `should not fire: ${c}`,
    );
  }
});

// --- mixed_latin_word -------------------------------------------------------

Deno.test("mixed_latin_word: 許可外の一般語を検出する", () => {
  const f = detectMixedLatinWord(lines("この build は再現できる。"), realDict);
  assertEquals(f.length, 1);
  assertEquals(f[0].matched, "build");
});

Deno.test("mixed_latin_word: 許可語・略語・識別子・workflow語・ID参照は免除", () => {
  const cases = [
    "deno で実装する。", // allowlist
    "複数の fixtures を使う。", // allowlist の複数形
    "API を呼び出す。", // acronym
    "foo.ts を編集する。", // identifier
    "proseOnly を移植する。", // camelCase
    "TaskCreate ツールを使う。", // PascalCase
    "この task を進める。", // workflow 側で報告
    "Round 1 の指摘を反映した。", // ID 参照
    "Auditing 節を書き換える。", // 大文字始まりの名前参照
    "Domain terms 行を確認する。", // 複合名の後半トークン
    "ja-prose-clarity 規則に従う。", // ハイフン2連結以上は kebab-case 名
    "- [file-state] settings.json に許可がある。", // 角括弧タグ
    "- observation: 対象は2ファイルのみ / source: 実測", // フィールドラベル
  ];
  for (const c of cases) {
    assertEquals(
      detectMixedLatinWord(lines(c), realDict).length,
      0,
      `should not fire: ${c}`,
    );
  }
});

Deno.test("mixed_latin_word: 同一行の同一語は1件に集約する", () => {
  const f = detectMixedLatinWord(
    lines("この build と build を比べる。"),
    realDict,
  );
  assertEquals(f.length, 1);
});

// --- arrow_chain ------------------------------------------------------------

Deno.test("arrow_chain: 1文中の矢印2回以上で検出、1回は許容", () => {
  assertEquals(
    detectArrowChain(lines("入力 → 検証 → 保存の順で進む。")).length,
    1,
  );
  assertEquals(
    detectArrowChain(lines("A -> B -> C の流れになる。")).length,
    1,
  );
  assertEquals(detectArrowChain(lines("入力 → 検証だけ行う。")).length, 0);
  assertEquals(detectArrowChain(lines("a -> b -> c")).length, 0); // 和文でない
});

// --- telegraphic_fragment ---------------------------------------------------

Deno.test("telegraphic_fragment: ひらがなゼロの電報体を検出する", () => {
  assertEquals(detectTelegraphicFragment(lines("idx stable exit 0")).length, 1);
  assertEquals(
    detectTelegraphicFragment(lines("設定変更完了 (再起動不要)")).length,
    1,
  );
});

Deno.test("telegraphic_fragment: 免除規則", () => {
  const cases = [
    "設定を変更した (再起動は不要)", // ひらがなを含む
    "リファクタリング", // 単語1つだけ
    "## 環境構築手順", // 見出し
    "https://example.com/path", // URL 単独
    "- **設計判断**: 辞書構成", // 太字ラベル
    "- SOURCE `x.ts:1-2` — proseOnly の構造を移植する", // ラベル—説明形（説明部にひらがな）
    "完了。", // 6字未満
    "cask(11) / plist(10) / tar(12) / gitignore(12)", // スラッシュ区切りのデータ列挙
    "- The regression script reports zero regressions across both files.", // 英文（機械契約行）
    "All tests pass and the gate returns green results now.", // 英文（語数6以上）
  ];
  for (const c of cases) {
    assertEquals(
      detectTelegraphicFragment(lines(c)).length,
      0,
      `should not fire: ${c}`,
    );
  }
});

// --- paren_chain ------------------------------------------------------------

Deno.test("paren_chain: 1文中の括弧2グループで検出、入れ子は1つと数える", () => {
  assertEquals(
    detectParenChain(lines("この機能（試験）は環境（macOS）で動く。")).length,
    1,
  );
  assertEquals(
    detectParenChain(lines("外側（内側（さらに内側））の構造だ。")).length,
    0,
  );
  assertEquals(detectParenChain(lines("補足（詳細は後述）を書く。")).length, 0);
  assertEquals(
    detectParenChain(
      lines("ファイル(277) / テスト(222) / コミット(187) / エラー(80)"),
    )
      .length,
    0, // データ列挙行
  );
});

// --- fixture 回帰 -----------------------------------------------------------

const bad = await Deno.readTextFile(
  new URL("./fixtures/bad.md", import.meta.url),
);
const good = await Deno.readTextFile(
  new URL("./fixtures/good.md", import.meta.url),
);

function countBy(text: string, dict: Dictionaries): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of detectAll(text, dict)) {
    counts[f.category] = (counts[f.category] ?? 0) + 1;
  }
  return counts;
}

Deno.test("fixture: bad.md のカテゴリ別期待件数", () => {
  assertEquals(countBy(bad, realDict), {
    workflow_vocab: 6,
    mixed_latin_word: 1,
    arrow_chain: 1,
    telegraphic_fragment: 2,
    paren_chain: 1,
  });
});

Deno.test("fixture: bad.md の行番号がフェンスを跨いで正しい", () => {
  const fs = detectAll(bad, realDict);
  assertEquals(
    fs.filter((f) => f.category === "workflow_vocab").map((f) => f.line),
    [7, 7, 13, 13, 21, 21],
  );
  assertEquals(
    fs.filter((f) => f.category === "telegraphic_fragment").map((f) => f.line),
    [17, 19],
  );
});

Deno.test("fixture: good.md は全カテゴリ0件（誤検出4形を含む）", () => {
  assertEquals(countBy(good, realDict), {});
});
