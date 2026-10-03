import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import {
  applyPlan,
  PartialWriteError,
  planSplit,
  scan,
  type Spec,
  SplitError,
} from "./split-note.ts";

// 記事タイトルに混じる行区切り。リテラルで書くとエディタや転記で消えるので組み立てる。
const LS = String.fromCharCode(0x2028);

const MOC = `---
aliases:
tags:
description:
type: moc
updated: 2026-01-01
---
[[Home]]

## 知識マップ

- **選び方**
    - [[元ノート]] — 説明
        - [[既存の子]] — x
    - [[他]] — y

## 横断テーマ
`;

const ORIGINAL = `---
aliases:
tags:${" "}
description:
type: synthesis
sources: ["[[記事A]]", "[[記事B]]", "[[記事${LS}L]]", "[[本]]"]
related: ["[[LLM]]", "[[他]]"]
updated: 2026-01-01
---
[[LLM]]

導入。

## 残る節

本文。

\`\`\`md
## フェンス内
\`\`\`

## 動く節

動く本文。

## 次も動く

本文 2。

## 関連ページ

- [[他]] — y

## ソース

- [[記事A]]
`;

const article = (pages: string) =>
  `---
tags:
  - memo/web
date: 2026-01-01
type: source
generated_pages: [${pages}]
---
[記事](https://example.com)
`;

const BASE: Record<string, string> = {
  "Home.md": "[[LLM]]\n",
  "02_Notes/LLM.md": MOC,
  "02_Notes/元ノート.md": ORIGINAL,
  "02_Notes/他.md": "---\ntype: concept\n---\n[[LLM]]\n",
  "02_Notes/既存の子.md": "---\ntype: concept\n---\n[[LLM]]\n",
  "02_Notes/参照元.md":
    "---\ntype: concept\n---\n[[LLM]]\n\n[[元ノート#動く節]] と [[元ノート#動く節|別名]] と [[元ノート#残る節]]\n",
  "04_Literature/記事A.md": article(`"[[元ノート]]"`),
  "04_Literature/sub/記事B.md": article(`"[[元ノート]]"`),
  [`04_Literature/記事${LS}L.md`]: article(
    `"[[元ノート]]", "[[別${LS}ノート]]"`,
  ),
  "03_Books/本/本.md": article(`"[[元ノート]]"`),
  "03_Books/本/章ノート.md": "章の本文\n",
  "98_Maintenance/logs/LLM 操作ログ.md":
    "[[LLM]]\n\n操作ログ。追記専用。\n\n## 2026-01-01\n\n- ingest: x\n",
};

const SPEC: Spec = {
  source: "元ノート",
  target: "新ノート",
  type: "synthesis",
  sections: ["動く節", "次も動く"],
  stub: "要約。[[新ノート]] にまとめた。",
  lead: "新ノートの要旨。",
  sources: ["記事A", "記事B", "記事 L", "本"],
  relatedPages: [{ note: "他", line: "他の説明" }],
  originalLine: "切り出した先",
  backLine: "切り出し元",
  map: { line: "新しい子" },
};

async function vault(over: Record<string, string | null> = {}) {
  const dir = await Deno.makeTempDir();
  for (const d of ["02_Notes", "04_Literature", "03_Books"]) {
    await Deno.mkdir(`${dir}/${d}`, { recursive: true });
  }
  for (const [p, c] of Object.entries({ ...BASE, ...over })) {
    if (c === null) continue;
    await Deno.mkdir(`${dir}/${p.slice(0, p.lastIndexOf("/") + 1) || "."}`, {
      recursive: true,
    });
    await Deno.writeTextFile(`${dir}/${p}`, c);
  }
  return dir;
}
const read = (v: string, p: string) => Deno.readTextFile(`${v}/${p}`);
const split = async (v: string, spec: Spec = SPEC) => {
  const plan = await planSplit(v, spec, "2026-10-03");
  await applyPlan(v, plan, `${v}.backup`);
  return plan;
};
const fails = async (v: string, spec: Spec, needle: string) => {
  const e = await assertRejects(
    () => planSplit(v, spec, "2026-10-03"),
    SplitError,
  );
  assertStringIncludes(e.message, needle);
};

Deno.test("apply: 節を切り出し、周辺を全部更新する", async () => {
  const v = await vault();
  // spec の並びではなく、元のノートでの出現順で移る
  const plan = await split(v, { ...SPEC, sections: ["次も動く", "動く節"] });

  const fresh = await read(v, "02_Notes/新ノート.md");
  assertEquals(
    fresh,
    `---
aliases:
tags:
description:
type: synthesis
sources: ["[[記事A]]", "[[記事B]]", "[[記事${LS}L]]", "[[本]]"]
related: ["[[LLM]]", "[[元ノート]]", "[[他]]"]
updated: 2026-10-03
---
[[LLM]]

新ノートの要旨。[[元ノート]] から切り出した。

## 動く節

動く本文。

## 次も動く

本文 2。

## 関連ページ

- [[元ノート]] — 切り出し元
- [[他]] — 他の説明

## ソース

- [[記事A]]
- [[記事B]]
- [[記事${LS}L]]
- [[本]]
`,
  );

  const orig = await read(v, "02_Notes/元ノート.md");
  assertStringIncludes(orig, "\ntags: \n");
  assertStringIncludes(
    orig,
    `related: ["[[LLM]]", "[[他]]", "[[新ノート]]"]\nupdated: 2026-10-03\n`,
  );
  assertStringIncludes(
    orig,
    "\`\`\`md\n## フェンス内\n\`\`\`\n\n## 動く節\n\n要約。[[新ノート]] にまとめた。\n\n## 関連ページ\n\n- [[他]] — y\n- [[新ノート]] — 切り出した先\n\n## ソース",
  );
  assert(!orig.includes("本文 2。"));

  assertStringIncludes(
    await read(v, "04_Literature/sub/記事B.md"),
    `generated_pages: ["[[元ノート]]", "[[新ノート]]"]`,
  );
  assertStringIncludes(
    await read(v, `04_Literature/記事${LS}L.md`),
    `generated_pages: ["[[元ノート]]", "[[別${LS}ノート]]", "[[新ノート]]"]`,
  );
  assertStringIncludes(
    await read(v, "03_Books/本/本.md"),
    `generated_pages: ["[[元ノート]]", "[[新ノート]]"]`,
  );
  assertEquals(await read(v, "03_Books/本/章ノート.md"), "章の本文\n");

  const moc = await read(v, "02_Notes/LLM.md");
  assertStringIncludes(
    moc,
    "    - [[元ノート]] — 説明\n        - [[既存の子]] — x\n        - [[新ノート]] — 新しい子\n    - [[他]] — y\n",
  );
  assertStringIncludes(moc, "updated: 2026-10-03");

  assertEquals(
    await read(v, "02_Notes/参照元.md"),
    "---\ntype: concept\n---\n[[LLM]]\n\n[[新ノート#動く節]] と [[新ノート#動く節|別名]] と [[元ノート#残る節]]\n",
  );
  assertEquals(plan.headingLinkFiles, ["参照元"]);

  assertEquals(
    await read(v, "98_Maintenance/logs/LLM 操作ログ.md"),
    `[[LLM]]

操作ログ。追記専用。

## 2026-01-01

- ingest: x

## 2026-10-03

- 分割: [[元ノート]] → [[新ノート]]
  - 移した節: 動く節、次も動く。元のノートには要約とリンクを残した
  - 知識マップ更新: [[元ノート]] の下に追加
  - 出典 4 本の \`generated_pages\` に [[新ノート]] を追加
  - 見出しリンクを付け替えた: [[参照元]]
`,
  );

  assertEquals(await read(`${v}.backup`, "02_Notes/元ノート.md"), ORIGINAL);
  assertEquals(await read(`${v}.backup`, "02_Notes/LLM.md"), MOC);
});

Deno.test("apply: stubHeading と quote、同じ日の見出しへの追記", async () => {
  const v = await vault({
    "98_Maintenance/logs/LLM 操作ログ.md":
      "[[LLM]]\n\n操作ログ。追記専用。\n\n## 2026-10-03\n\n- ingest: x\n",
  });
  await split(v, {
    ...SPEC,
    sections: ["次も動く"],
    stubHeading: "まとめ",
    sources: ["記事A"],
    quote: "> [記事](https://example.com)",
    logNotes: ["補足"],
  });
  const orig = await read(v, "02_Notes/元ノート.md");
  assertStringIncludes(orig, "動く本文。\n\n## まとめ\n\n要約。");
  assertStringIncludes(
    await read(v, "02_Notes/新ノート.md"),
    "[[LLM]]\n\n> [記事](https://example.com)\n\n新ノートの要旨。",
  );
  const log = await read(v, "98_Maintenance/logs/LLM 操作ログ.md");
  assertStringIncludes(log, "## 2026-10-03\n\n- ingest: x\n\n- 分割: ");
  assertStringIncludes(log, "  - 補足\n");
  assertEquals(log.match(/## 2026-10-03/g)?.length, 1);
});

Deno.test("apply: related も関連ページも無いノートで作り、ソースの後ろの節は残す", async () => {
  const v = await vault({
    "02_Notes/元ノート.md": `---
type: concept
sources: ["[[記事A]]"]
updated: 2026-01-01
---
[[LLM]]

## 残る節

本文。

## 動く節

動く本文。

## ソース

- [[記事A]]

## Notes

末尾。
`,
  });
  await split(v, {
    ...SPEC,
    sections: ["動く節"],
    sources: ["記事A"],
    quote: "> [記事](https://example.com)",
  });
  const orig = await read(v, "02_Notes/元ノート.md");
  assertStringIncludes(
    orig,
    `related: ["[[LLM]]", "[[新ノート]]"]\nupdated: 2026-10-03\n---`,
  );
  assertStringIncludes(
    orig,
    "要約。[[新ノート]] にまとめた。\n\n## 関連ページ\n\n- [[新ノート]] — 切り出した先\n\n## ソース\n\n- [[記事A]]\n\n## Notes\n\n末尾。\n",
  );
});

Deno.test("apply: タブ字下げの MOC と、ログが無い MOC", async () => {
  const v = await vault({
    "02_Notes/LLM.md": MOC.replaceAll("    ", "\t").replace(
      "updated: 2026-01-01\n",
      "",
    ),
    "98_Maintenance/logs/LLM 操作ログ.md": null,
  });
  await split(v);
  const moc = await read(v, "02_Notes/LLM.md");
  assertStringIncludes(
    moc,
    "\t\t- [[既存の子]] — x\n\t\t- [[新ノート]] — 新しい子\n",
  );
  assert(!moc.includes("updated:"));
  assertEquals(
    await read(v, "98_Maintenance/logs/LLM 操作ログ.md"),
    "[[LLM]]\n\n操作ログ。追記専用。\n\n## 2026-10-03\n\n- 分割: [[元ノート]] → [[新ノート]]\n  - 移した節: 動く節、次も動く。元のノートには要約とリンクを残した\n  - 知識マップ更新: [[元ノート]] の下に追加\n  - 出典 4 本の `generated_pages` に [[新ノート]] を追加\n  - 見出しリンクを付け替えた: [[参照元]]\n",
  );
});

Deno.test("apply: 1 行に複数リンクがある MOC でも最初のリンクだけで照合する", async () => {
  const v = await vault({
    "02_Notes/LLM.md": MOC.replace(
      "    - [[他]] — y",
      "    - [[他]] → [[元ノート]] / [[既存の子]]",
    ),
  });
  await split(v);
  assertStringIncludes(
    await read(v, "02_Notes/LLM.md"),
    "        - [[新ノート]] — 新しい子\n    - [[他]] → [[元ノート]]",
  );
});

Deno.test("apply: map: false は親 MOC のログに書き、知識マップに触らない", async () => {
  const v = await vault();
  await split(v, { ...SPEC, map: false });
  assertEquals(await read(v, "02_Notes/LLM.md"), MOC);
  assert(
    !(await read(v, "98_Maintenance/logs/LLM 操作ログ.md")).includes(
      "知識マップ更新",
    ),
  );
});

Deno.test("apply: 失敗するときは何も書かない", async () => {
  const v = await vault({
    "03_Books/本/衝突.md": "章\n",
    "04_Literature/記事C.md": article(""),
  });
  const snapshot = async () => {
    const out: string[] = [];
    for await (const e of Deno.readDir(`${v}/02_Notes`)) {
      out.push(e.name + (await read(v, `02_Notes/${e.name}`)));
    }
    return out.sort();
  };
  const before = await snapshot();
  await fails(v, { ...SPEC, sections: ["無い節"] }, "節「無い節」");
  await fails(v, { ...SPEC, target: "他" }, "02_Notes に同名");
  await fails(v, { ...SPEC, target: "衝突" }, "03_Books に同名");
  await fails(v, { ...SPEC, target: ".hidden" }, "使えない文字");
  await fails(v, { ...SPEC, target: "あ".repeat(85) }, "長すぎる");
  await fails(
    v,
    { ...SPEC, sections: ["残る節", "動く節", "次も動く"] },
    "全部の節",
  );
  await fails(v, { ...SPEC, sources: ["記事A", "記事C"] }, "sources に無い");
  await fails(v, { ...SPEC, sources: ["記事A", "記事Z"] }, "0 件に解決");
  await fails(v, { ...SPEC, target: "a:b" }, "使えない文字");
  await fails(v, { ...SPEC, sections: ["動く節", "動く節"] }, "2 回ある");
  await fails(v, { ...SPEC, stubHeading: "残る節" }, "stubHeading");
  await fails(v, { ...SPEC, sources: ["記事A"] }, "quote");
  await fails(v, { ...SPEC, stub: "リンク無し" }, "stub に [[新ノート]]");
  await fails(
    v,
    { ...SPEC, map: { line: "x", under: "無いノート" } },
    "map.under が 02_Notes に無い",
  );
  await fails(
    v,
    { ...SPEC, map: { line: "x", under: "参照元" } },
    "知識マップで [[参照元]]",
  );
  await fails(v, { ...SPEC, rewrites: [{ from: "無い", to: "x" }] }, "0 回");
  assertEquals(await snapshot(), before);
  assert(!await Deno.stat(`${v}/02_Notes/新ノート.md`).catch(() => null));
});

Deno.test("apply: 移した節への「上の」参照が元に残れば失敗する", async () => {
  const v = await vault({
    "02_Notes/元ノート.md": ORIGINAL.replace(
      "本文。\n",
      "本文。下の「次も動く」を見る。\n",
    ),
  });
  await fails(v, SPEC, "移した節への参照が残る");
  await split(v, {
    ...SPEC,
    sourceRewrites: [{
      from: "下の「次も動く」",
      to: "[[新ノート]] の「次も動く」",
    }],
  });
  assertStringIncludes(
    await read(v, "02_Notes/元ノート.md"),
    "本文。[[新ノート]] の「次も動く」を見る。",
  );
});

Deno.test("apply: 残る節への『上の』参照が新しいノートに残れば失敗する", async () => {
  const v = await vault({
    "02_Notes/元ノート.md": ORIGINAL.replace(
      "動く本文。",
      "上の『残る節』と同じ。",
    ),
  });
  await fails(v, SPEC, "元のノートの節への参照が残る");
});

Deno.test("apply: 知識マップで 2 つの MOC が当たれば失敗する", async () => {
  const v = await vault({ "02_Notes/LLM2.md": MOC });
  await fails(v, SPEC, "2 件");
});

Deno.test("scan: 閾値、フェンス、判定記録の字数", async () => {
  const long = "あ".repeat(40);
  const v = await vault({
    "02_Notes/元ノート.md": ORIGINAL.replace("動く本文。", long),
    "98_Maintenance/split-mining/分割候補の判定記録 2026.md":
      "### [[元ノート]]\n- 長さ: 本文 1,234 字（…）\n",
  });
  const rows = await scan(v, { minBody: 30, minSection: 40 });
  // 参照元 のような短いノートも minBody 30 なら拾うので、最長の 1 本だけを見る
  const r = rows[0];
  assertEquals(r.note, "元ノート");
  assertEquals(r.recorded, 1234);
  assertEquals(r.sections.map((s) => s.heading), [
    "残る節",
    "動く節",
    "次も動く",
  ]);
  assertEquals(r.sections.map((s) => s.long), [false, true, false]);
  assertEquals(
    await scan(v, { minBody: 1000, minSection: 40 }),
    [],
  );
});

Deno.test("apply: 作成で落ちたら既存のノートは書き換えない", async () => {
  const v = await vault({ "98_Maintenance/logs/LLM 操作ログ.md": null });
  await Deno.mkdir(`${v}/98_Maintenance/logs`, { recursive: true });
  await Deno.chmod(`${v}/98_Maintenance/logs`, 0o555);
  try {
    const plan = await planSplit(v, SPEC, "2026-10-03");
    const e = await assertRejects(
      () => applyPlan(v, plan, `${v}.backup`),
      PartialWriteError,
    );
    assertEquals(e.written, [`${v}/02_Notes/新ノート.md`]);
    assertEquals(e.backup, `${v}.backup`);
    assertEquals(await read(v, "02_Notes/元ノート.md"), ORIGINAL);
    assertEquals(await read(v, "02_Notes/LLM.md"), MOC);
  } finally {
    await Deno.chmod(`${v}/98_Maintenance/logs`, 0o755);
  }
});

Deno.test("apply: 作成先とバックアップ先が既にあれば何も書かない", async () => {
  const v = await vault();
  const plan = await planSplit(v, SPEC, "2026-10-03");
  await Deno.mkdir(`${v}.backup`);
  await assertRejects(() => applyPlan(v, plan, `${v}.backup`), SplitError);
  await Deno.remove(`${v}.backup`);
  await Deno.writeTextFile(`${v}/02_Notes/新ノート.md`, "先に置かれた\n");
  await assertRejects(() => applyPlan(v, plan, `${v}.backup`), SplitError);
  assertEquals(await read(v, "02_Notes/元ノート.md"), ORIGINAL);
  assert(!await Deno.stat(`${v}.backup`).catch(() => null));
});

Deno.test("apply: ブロック形式の related は書き換えずに止まる", async () => {
  const v = await vault({
    "02_Notes/元ノート.md": ORIGINAL.replace(
      `related: ["[[LLM]]", "[[他]]"]`,
      'related:\n  - "[[LLM]]"',
    ),
  });
  await fails(v, SPEC, "ブロック形式");
});

Deno.test("apply: 親 MOC のリンクは実ファイル名で書き戻す", async () => {
  const v = await vault({
    "02_Notes/元ノート.md": ORIGINAL.replace(
      "---\n[[LLM]]\n",
      "---\n[[ LLM ]]\n",
    ),
  });
  await split(v);
  assert(
    (await read(v, "02_Notes/新ノート.md")).includes("---\n[[LLM]]\n"),
  );
  assert(
    !await Deno.stat(`${v}/98_Maintenance/logs/ LLM  操作ログ.md`).catch(() =>
      null
    ),
  );
});
