#!/usr/bin/env -S deno run --allow-read --allow-env
// wiki-doctor — llm-wiki の構造的な欠陥を決定的に検査する。
//
// ここで見るのは「過去に実際に踏んだ欠陥クラス」だけ。LLM レビューに毎回
// 同じものを再発見させるのは高くつくうえ、見落としが確率的に混じる。
//
//   deno run --allow-read --allow-env wiki-doctor.ts \\
//     [--vault <path>] [--skill <path>] [--baseline <pre-change backup>]
//
// 終了コード: 0 = 全 green、1 = 1 件以上の失敗、2 = vault 未指定。
//
// --baseline を渡すと、privacy 検査の対象が「このスキルが実際に書いたファイル」に絞られる。
// 渡さない場合は 98_Maintenance/ 配下だけが対象になり、生成した概念ノートは検査されない。

const args = Deno.args;
const argOf = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
// 末尾スラッシュを落とす。残っていると rel() が 1 文字ずれて isPrivate() が全て false になる。
const VAULT = argOf("--vault", Deno.env.get("LLM_WIKI_VAULT_ROOT") ?? "")
  .replace(/\/+$/, "");
const SKILL = argOf("--skill", new URL("..", import.meta.url).pathname);
// llm-wiki が書いたファイルを、導入前のバックアップとの差分で特定する。
// 「Vault 全体」を検査対象にすると、ユーザー自身が昔から書いているものまで
// 指摘してしまい、検査が信用されなくなる。責任範囲は自分が書いたものだけ。
const BASELINE_DIR = argOf("--baseline", "");

if (!VAULT) {
  console.error(
    "LLM_WIKI_VAULT_ROOT が未設定。--vault で指定するか環境変数を設定してください。",
  );
  Deno.exit(2);
}

type Check = { name: string; ok: boolean; detail: string[] };
const checks: Check[] = [];
const add = (name: string, bad: string[], okMsg: string) =>
  checks.push({
    name,
    ok: bad.length === 0,
    detail: bad.length ? bad : [okMsg],
  });

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.name === ".obsidian" || e.name === ".git") continue;
      const p = `${dir}/${e.name}`;
      if (e.isDirectory) out.push(...await walk(p));
      else out.push(p);
    }
  } catch { /* 存在しないディレクトリは無視 */ }
  return out;
}

const allFiles = await walk(VAULT);
const rel = (p: string) => p.slice(VAULT.length + 1);
const isPrivate = (p: string) => rel(p).startsWith("05_Private/");

// 05_Private は読まない。ファイル名だけを索引に使う。
const mdFiles = allFiles.filter((p) => p.endsWith(".md") && !isPrivate(p));
const bodies = new Map<string, string>();
for (const p of mdFiles) bodies.set(p, await Deno.readTextFile(p));

const resolvable = new Set<string>();
for (const p of allFiles) {
  const b = p.split("/").pop()!;
  resolvable.add(b);
  resolvable.add(b.replace(/\.md$/, ""));
}

// Obsidian はフェンス内・インラインコード内の [[...]] を解決しない。
const stripCode = (t: string) =>
  t.replace(/^(`{3,})[\s\S]*?^\1\s*$/gm, "").replace(/`[^`\n]*`/g, "");
const LINK = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;

// 記事タイトルに U+2028 が混じるファイルがあり、JS 正規表現の `.` と複数行 `$` は
// そこで途切れる。frontmatter の flow sequence は行分割で読む。
const fmSeq = (fm: string, key: string) => {
  const line = fm.split("\n").find((l) => l.startsWith(`${key}: [`));
  return line ? line.slice(key.length + 2) : "";
};
const fmLinks = (fm: string, key: string) =>
  [...fmSeq(fm, key).matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());

// ---- 1. 未解決 wikilink（日付リンクは仕様上の正常なので除外） ----
{
  const isDate = (t: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(t) || /^\d{4}-W\d{1,2}$/.test(t);
  const isTemplate = (t: string) => t.includes("${") || t.includes("<%");
  const bad: string[] = [];
  for (const [p, body] of bodies) {
    for (const m of stripCode(body).matchAll(LINK)) {
      const t = m[1].trim().split("/").pop()!;
      if (isTemplate(t) || isDate(t)) continue;
      if (resolvable.has(t) || resolvable.has(t.replace(/\.md$/, ""))) continue;
      bad.push(`${rel(p)} -> [[${t}]]`);
    }
  }
  // 既存 Vault の債務なので件数で見る。増えたら失敗。
  const BASELINE = 25;
  checks.push({
    name: `未解決 wikilink が ${BASELINE} 件以下`,
    ok: bad.length <= BASELINE,
    detail: bad.length <= BASELINE
      ? [
        `${bad.length} 件（baseline ${BASELINE}、日付リンクとテンプレート片を除く）`,
      ]
      : [`${bad.length} 件に増加`, ...bad.slice(0, 15)],
  });
}

// ---- 2. 98_Maintenance のファイル名が 02_Notes と衝突していない ----
{
  const notes = new Set(
    mdFiles.filter((p) => rel(p).startsWith("02_Notes/")).map((p) =>
      p.split("/").pop()!
    ),
  );
  const bad = mdFiles
    .filter((p) => rel(p).startsWith("98_Maintenance/"))
    .filter((p) => notes.has(p.split("/").pop()!))
    .map((p) =>
      `${rel(p)} は 02_Notes/ の同名ノートと衝突（wikilink が自己参照になる）`
    );
  add(
    "98_Maintenance と 02_Notes のファイル名が衝突していない",
    bad,
    "衝突なし",
  );
}

// ---- 3. 知識マップがコードフェンスで囲まれていない ----
{
  const bad: string[] = [];
  for (const [p, body] of bodies) {
    if (!rel(p).startsWith("02_Notes/")) continue;
    const map = body.split(/^## 知識マップ$/m)[1]?.split(/^## /m)[0];
    if (!map) continue;
    if (/^```/m.test(map)) {
      bad.push(`${rel(p)} の知識マップがフェンス内（wikilink が不活性）`);
    }
  }
  add("知識マップがフェンスで囲まれていない", bad, "全 MOC で箇条書き");
}

// llm-wiki が書いたファイルの集合。baseline があれば差分で、無ければ
// 「lint の成果物」だけを対象にする（保守的に、確実に自分が書いたものへ）。
const written = new Set<string>();
{
  for (const p of mdFiles) {
    const r = rel(p);
    if (
      r.startsWith("98_Maintenance/lint-report-") ||
      r.startsWith("98_Maintenance/proposals/") ||
      r.startsWith("98_Maintenance/logs/")
    ) written.add(p);
  }
  if (BASELINE_DIR) {
    for (const p of mdFiles) {
      const r = rel(p);
      if (!r.startsWith("02_Notes/") && !r.startsWith("04_Literature/")) {
        continue;
      }
      try {
        const before = await Deno.readTextFile(`${BASELINE_DIR}/${r}`);
        if (before !== bodies.get(p)) written.add(p);
      } catch {
        written.add(p); // baseline に無い = 新規作成
      }
    }
  }
}

// ---- 4. lint の成果物が生の wikilink で監査対象を引用していない ----
{
  const bad: string[] = [];
  for (const [p, body] of bodies) {
    const r = rel(p);
    // 対象は lint が書くレポートと提案のみ。ログの [[...]] は本物のリンクなので除く。
    // 導入前から Vault にある手作業の一覧（ORPHANED_FILES.md 等）も対象外 — 自分が書いたものではない。
    if (
      !r.startsWith("98_Maintenance/lint-report-") &&
      !r.startsWith("98_Maintenance/proposals/")
    ) continue;
    // frontmatter があるときだけ切り落とす。indexOf("---") だけで判定すると、
    // frontmatter の無いファイルの Markdown 表区切り (|---|---|) を終端と誤認して本文を読み飛ばす。
    const hasFm = body.startsWith("---\n");
    const fmEnd = hasFm ? body.indexOf("\n---", 4) : -1;
    const prose = stripCode(fmEnd > 0 ? body.slice(fmEnd + 4) : body);
    const hits = [...prose.matchAll(LINK)].map((m) => m[1]);
    if (hits.length) {
      bad.push(
        `${r} が生の wikilink を ${hits.length} 件含む: ${
          hits.slice(0, 3).join(", ")
        }`,
      );
    }
  }
  add(
    "lint レポートと proposals が生の wikilink を含まない",
    bad,
    "全てコード表記",
  );
}

// ---- 5. 05_Private の名前とパスが、このスキルが書いたものに漏れていない ----
// 検査対象には仕様ファイル自身と Vault の CLAUDE.md も含める。
// 「危険を説明するために実名を挙げる」という形で、最初の実装が実際にここで漏らした。
// 検出結果には名前を出さない — 漏洩検出器が漏洩経路になっては意味がない。
{
  const privateNames = allFiles.filter(isPrivate).map((p) =>
    p.split("/").pop()!.replace(/\.md$/, "")
  );
  const targets = new Map<string, string>();
  for (const p of written) targets.set(rel(p), bodies.get(p)!);
  for (const p of await walk(SKILL)) {
    if (!p.endsWith(".md") && !p.endsWith(".ts")) continue;
    try {
      targets.set(
        `(skill) ${p.slice(SKILL.length)}`,
        await Deno.readTextFile(p),
      );
    } catch { /* 読めなければ飛ばす */ }
  }
  try {
    targets.set("CLAUDE.md", await Deno.readTextFile(`${VAULT}/CLAUDE.md`));
  } catch { /* 無ければ飛ばす */ }

  // ユーザー自身が昔から書いている 05_Private へのリンクは正当（wikilink はリンク先を
  // 明かさないので、リンクを残すこと自体が仕様）。禁じているのはスキルが新たに書くこと。
  // baseline がある場合は、その版に既に含まれていた名前を差し引く。
  const preexisting = async (label: string) => {
    if (!BASELINE_DIR || label.startsWith("(skill) ")) return "";
    try {
      return await Deno.readTextFile(`${BASELINE_DIR}/${label}`);
    } catch {
      return "";
    }
  };

  const bad: string[] = [];
  for (const [label, body] of targets) {
    const before = await preexisting(label);
    let names = 0;
    for (const n of privateNames) {
      if (n.length >= 4 && body.includes(n) && !before.includes(n)) names++;
    }
    if (names) {
      bad.push(
        `${label}: 05_Private のファイル名を ${names} 件含む（名前は伏せる）`,
      );
    }
    // ディレクトリ名そのものは「対象外」という規則を書くのに要るので許す。
    // 禁じるのは特定ファイルを指すパス。
    // 検出器自身のソースは除く — パスを探す正規表現がパスの形をしているのは当然で、
    // ここで自己検出させると検査が永久に赤くなる。実名の検査は上で効いている。
    if (label.endsWith("/scripts/wiki-doctor.ts")) continue;
    const paths = [...body.matchAll(/05_Private\/([^\s`)、。*]+)/g)].length;
    if (paths) {
      bad.push(`${label}: 05_Private 配下の具体パスを ${paths} 件含む`);
    }
  }
  add(
    "05_Private の名前と具体パスが成果物・仕様のどちらにも漏れていない",
    bad,
    `対象 ${targets.size} ファイルに漏洩なし`,
  );
}

// ---- 6. sources / related / generated_pages が JSON として妥当 ----
{
  const bad: string[] = [];
  for (const [p, body] of bodies) {
    const fm = body.match(/^---\n([\s\S]*?)\n---/)?.[1];
    if (!fm) continue;
    for (const key of ["sources", "related", "generated_pages"]) {
      const seq = fmSeq(fm, key);
      if (!seq) continue;
      try {
        JSON.parse(seq);
      } catch {
        bad.push(`${rel(p)} の ${key} が不正な YAML flow sequence`);
      }
    }
  }
  add("frontmatter の flow sequence が全件パース可能", bad, "全件 OK");
}

// ---- 7. 取り込み完了状態の整合（type: source ↔ generated_pages ↔ ログ） ----
{
  const logText = mdFiles.filter((p) =>
    rel(p).startsWith("98_Maintenance/logs/")
  )
    .map((p) => bodies.get(p)!).join("\n");
  const bad: string[] = [];
  for (const [p, body] of bodies) {
    if (!rel(p).startsWith("04_Literature/")) continue;
    const fm = body.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    if (!/^type: source$/m.test(fm)) continue;
    const gp = fmLinks(fm, "generated_pages");
    if (!gp.length) {
      bad.push(`${rel(p)}: type: source だが generated_pages が空`);
      continue;
    }
    if (!gp.some((g) => logText.includes(`[[${g}]]`))) {
      bad.push(`${rel(p)}: generated_pages の宛先がログに無い`);
    }
  }
  add("compile 完了状態が整合している", bad, "type: source の全件が追跡可能");
}

// ---- 8. 双方向リンク（generated_pages ↔ sources） ----
{
  const fwd = new Set<string>(), rev = new Set<string>();
  const unlinkable = /[\[\]`#]/;
  for (const [p, body] of bodies) {
    const fm = body.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const title = p.split("/").pop()!.replace(/\.md$/, "");
    if (rel(p).startsWith("04_Literature/")) {
      if (unlinkable.test(title)) continue; // ファイル名に [ ] ` # を含むと wikilink 不可（# は見出しアンカー扱い）
      for (const g of fmLinks(fm, "generated_pages")) fwd.add(`${title}|${g}`);
    } else if (rel(p).startsWith("02_Notes/")) {
      for (const s of fmLinks(fm, "sources")) rev.add(`${s}|${title}`);
    }
  }
  const onlyFwd = [...fwd].filter((k) => !rev.has(k));
  const onlyRev = [...rev].filter((k) => !fwd.has(k));
  add(
    "generated_pages と sources が双方向で一致",
    [
      ...onlyFwd.map((k) => `generated_pages のみ: ${k}`),
      ...onlyRev.map((k) => `sources のみ: ${k}`),
    ].slice(0, 20),
    `${fwd.size} 対が両方向で一致`,
  );
}

// ---- 9. 本文の 関連ページ / ソース が frontmatter の部分集合 ----
{
  const bad: string[] = [];
  for (const [p, body] of bodies) {
    if (!rel(p).startsWith("02_Notes/")) continue;
    const fm = body.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const setOf = (k: string) => new Set(fmLinks(fm, k));
    const related = setOf("related"), sources = setOf("sources");
    const prose = stripCode(body);
    const sec = (h: string) =>
      prose.split(new RegExp(`^## ${h}$`, "m"))[1]?.split(/^## /m)[0] ?? "";
    for (const m of sec("関連ページ").matchAll(/\[\[([^\]|]+)/g)) {
      if (related.size && !related.has(m[1].trim())) {
        bad.push(`${rel(p)}: 関連ページの ${m[1].trim()} が related に無い`);
      }
    }
    for (const m of sec("ソース").matchAll(/\[\[([^\]|]+)/g)) {
      if (sources.size && !sources.has(m[1].trim())) {
        bad.push(`${rel(p)}: ソースの ${m[1].trim()} が sources に無い`);
      }
    }
  }
  add("本文の 関連ページ / ソース が frontmatter の部分集合", bad, "全件 OK");
}

// ---- 10. load-bearing 文字列のファイル横断整合 ----
// 同じ不変条件が複数ファイルに書かれている以上、片方だけ直す事故が起きる。
{
  const specFiles: string[] = [];
  for (const p of await walk(SKILL)) if (p.endsWith(".md")) specFiles.push(p);
  specFiles.push(`${VAULT}/CLAUDE.md`);
  const bad: string[] = [];
  for (const p of specFiles) {
    let t: string;
    try {
      t = await Deno.readTextFile(p);
    } catch {
      continue;
    }
    // ログのパスは ` 操作ログ` サフィックス付きでなければならない
    for (const m of t.matchAll(/logs\/(<MOC>|<genre>)([^\s`)]*)\.md/g)) {
      if (!m[2].includes("操作ログ")) {
        bad.push(
          `${p.replace(Deno.env.get("HOME") ?? "", "~")}: ログパスが旧形式 (${
            m[0]
          })`,
        );
      }
    }
  }
  add(
    "ログパスの表記が全仕様ファイルで一致",
    bad,
    "全ファイルで ` 操作ログ` 形式",
  );
}

// ---- 11. 概念ノートが Home から辿れる ----
// compile が作ったノートを MOC の知識マップへ足し忘れると、記事の generated_pages
// からしか辿れないノートが残る。frontmatter の related を辿れば繋がって見えてしまうので、
// 本文リンクだけで判定する。レガシーノート（type 無し）は対象外 — 到達率そのものを
// 目標にすると、意味の無い分類リンクを足す圧力になる。
{
  const noteName = (p: string) =>
    p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/, "");
  const notes = new Map<string, string>();
  for (const p of mdFiles) {
    if (rel(p).startsWith("02_Notes/")) {
      notes.set(noteName(p), bodies.get(p)!);
    }
  }
  const bodyLinks = (name: string) => {
    const t = notes.get(name)!.replace(/^---\n[\s\S]*?\n---\n/, "");
    return [...stripCode(t).matchAll(LINK)].map((m) => m[1].trim());
  };

  const home = bodies.get(`${VAULT}/Home.md`) ?? "";
  const queue = [...stripCode(home).matchAll(LINK)].map((m) => m[1].trim())
    .filter((n) => notes.has(n));
  const reached = new Set(queue);
  while (queue.length) {
    for (const l of bodyLinks(queue.shift()!)) {
      if (notes.has(l) && !reached.has(l)) {
        reached.add(l);
        queue.push(l);
      }
    }
  }

  const bad: string[] = [];
  let legacy = 0;
  for (const [name, text] of notes) {
    if (reached.has(name)) continue;
    const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    if (fm.split("\n").some((l) => l === "type: concept")) {
      bad.push(
        `02_Notes/${name}.md: type: concept だが Home から本文リンクで辿れない`,
      );
    } else legacy++;
  }
  add(
    "概念ノートが Home から本文リンクで辿れる",
    bad,
    `${reached.size} 本が到達（type 無しの未到達 ${legacy} 本は対象外）`,
  );
}

// ---- 12. 未コンパイル記事の本数（情報表示） ----
// バックフィルのスクリプトが readDir を非再帰で使い、サブディレクトリの記事 6 本を
// 一度も見ていなかった。件数はここで再帰的に数え、これを唯一の権威とする。
// 失敗にはしない — 未コンパイルの記事が残っていること自体は正常な状態。
{
  let uncompiled = 0;
  const nested = new Set<string>();
  for (const p of mdFiles) {
    const r = rel(p);
    if (!r.startsWith("04_Literature/")) continue;
    const fm = bodies.get(p)!.match(/^---\n([\s\S]*?)\n---/)?.[1];
    if (!fm) continue;
    const ty = fm.split("\n").find((l) => l.startsWith("type: "));
    // parked は「受け皿となる概念が無いので見送る」と判断済みの終端状態。
    // これが無いと、見送った記事が毎回トリアージ候補に戻り続ける。
    if (ty === "type: source" || ty === "type: parked") continue;
    uncompiled++;
    const dir = r.slice("04_Literature/".length, r.lastIndexOf("/"));
    if (dir) nested.add(dir);
  }
  const note = nested.size
    ? `（うちサブディレクトリ: ${[...nested].join(", ")}）`
    : "";
  add(
    "未コンパイル記事の本数を再帰的に数えている",
    [],
    `未コンパイル ${uncompiled} 本${note}`,
  );
}

// ---- 出力 ----
let failed = 0;
console.log("# wiki-doctor\n");
console.log(`vault: ${VAULT}`);
console.log(`skill: ${SKILL}\n`);
for (const c of checks) {
  const mark = c.ok ? "PASS" : "FAIL";
  if (!c.ok) failed++;
  console.log(`[${mark}] ${c.name}`);
  for (const d of c.detail.slice(0, 15)) console.log(`       ${d}`);
  if (c.detail.length > 15) {
    console.log(`       … 他 ${c.detail.length - 15} 件`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} PASS`);
Deno.exit(failed ? 1 : 0);
