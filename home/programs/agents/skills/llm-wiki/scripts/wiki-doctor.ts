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
// フラグはあるのに値が無い場合に fallback へ落ちると、--baseline を渡したつもりの
// 実行が黙って SKIP になる。渡し忘れと渡し損ねは実行者から区別できないので落とす。
const argOf = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`${name} に値が指定されていません。`);
    Deno.exit(2);
  }
  return v;
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

// 存在しない baseline を黙って受けると、全ファイルが「baseline に無い = 新規作成」
// に落ちる。パスの打ち間違いが「ユーザーの手書きノートが改変された」という
// 最も深刻な報告に化けるので、ここで止める。
if (BASELINE_DIR) {
  const st = await Deno.stat(BASELINE_DIR).catch(() => null);
  if (!st?.isDirectory) {
    console.error(
      `--baseline のパスが存在しないかディレクトリではない: ${BASELINE_DIR}`,
    );
    Deno.exit(2);
  }
  // baseline に vault 自身を渡されると全比較が自明に一致し、検査 4b も 5 も
  // 無言で green になる。誤ったパスより危険なのはこちら — 騒がずに通るため。
  const [bp, vp] = await Promise.all([
    Deno.realPath(BASELINE_DIR),
    Deno.realPath(VAULT),
  ]);
  if (bp === vp || bp.startsWith(`${vp}/`)) {
    console.error(
      `--baseline が vault 自身かその配下を指している: ${BASELINE_DIR}`,
    );
    Deno.exit(2);
  }
}

type Check = {
  name: string;
  ok: boolean;
  detail: string[];
  skipped?: boolean;
};
const checks: Check[] = [];
const add = (name: string, bad: string[], okMsg: string) =>
  checks.push({
    name,
    ok: bad.length === 0,
    detail: bad.length ? bad : [okMsg],
  });
// 実行しなかった検査を PASS に混ぜない。比較していないのに「一致」と読める
// 出力は、この検査が守っている不変条件そのものを嘘にする。
const skip = (name: string, reason: string) =>
  checks.push({ name, ok: true, detail: [reason], skipped: true });

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.name === ".obsidian" || e.name === ".git") continue;
      // symlink は isDirectory が false になるためファイルとして拾われ、
      // 02_Notes/x.md -> 05_Private/... のようなリンクがあるとパス判定を
      // すり抜けて実体が読まれる。隔離はパスで判定している以上ここで落とす。
      if (e.isSymlink) continue;
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

// 03_Books のコンパイル単位はインデックスノートだけ。章ノートは読み取り専用の本文。
// 判定はパスで行う — 「frontmatter を持たないものが章ノート」は今たまたま成り立って
// いるだけで、ユーザーが章ノートに 1 つプロパティを足した瞬間に壊れる。
const isBookIndex = (p: string) => {
  const seg = rel(p).split("/");
  if (seg[0] !== "03_Books" || !seg[seg.length - 1].endsWith(".md")) {
    return false;
  }
  if (seg.length === 2) return true;
  return seg.length === 3 && seg[2] === `${seg[1]}.md`;
};
const isSource = (p: string) =>
  rel(p).startsWith("04_Literature/") || isBookIndex(p);

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
// 検査結果はエージェントが「決定的な事実」として読む。リンクターゲットは記事本文
// 由来で改行を含みうるので、そのまま出すと [PASS] を騙る行を注入できてしまう。
const oneLine = (s: string) => {
  const flat = s.replace(/[\r\n\t\p{Cc}]/gu, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
};

// 記事タイトルに U+2028 が混じるファイルがあり、JS 正規表現の `.` と複数行 `$` は
// そこで途切れる。frontmatter の flow sequence は行分割で読む。
const fmSeq = (fm: string, key: string) => {
  const line = fm.split("\n").find((l) => l.startsWith(`${key}: [`));
  return line ? line.slice(key.length + 2) : "";
};
const fmLinks = (fm: string, key: string) =>
  [...fmSeq(fm, key).matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());

// aliases / tags は YAML のブロックリストでもインラインでも書かれる。
// 素朴な 1 行正規表現で読むと、ブロックリスト形式のノートを丸ごと取りこぼす
// （孤立検出でこれを踏み、Obsidian/plugins タグの 7 本を見落とした）。
const fmList = (fm: string, key: string): string[] => {
  const out: string[] = [];
  let inBlock = false;
  for (const line of fm.split("\n")) {
    const head = line.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (head) {
      const inline = head[1].trim();
      if (inline) {
        for (const part of inline.replace(/^\[|\]$/g, "").split(",")) {
          const v = part.trim().replace(/^["']|["']$/g, "");
          if (v) out.push(v);
        }
      } else inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item) {
      const v = item[1].trim().replace(/^["']|["']$/g, "");
      if (v) out.push(v);
      continue;
    }
    if (/^\S/.test(line)) inBlock = false;
  }
  return out;
};
const aliasesOf = (fm: string) => fmList(fm, "aliases");
const tagsOf = (fm: string) => fmList(fm, "tags");

// Obsidian は [[X]] を、X という alias を宣言しているノートにも解決する。
// ファイル名だけで解決可能集合を作ると、alias 経由のリンクを全て「未解決」と
// 誤検出する。スタブを吸収して alias に寄せた直後に 17 件の偽陽性が出た。
for (const [, body] of bodies) {
  const fm = body.match(/^---\n([\s\S]*?)\n---/)?.[1];
  if (fm) { for (const a of aliasesOf(fm)) resolvable.add(a); }
}

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
      bad.push(`${rel(p)} -> [[${oneLine(t)}]]`);
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

// ---- 2b. 02_Notes のファイル名が 03_Books と衝突していない ----
// 危険なのは既存の章ノートではなく、ingest が新規に作る概念ノートの方。章ノート名は
// 「解像度を上げる 4 つの視点」のように概念的で、本から生成するノートと名前空間が
// 近い。Obsidian は wikilink を vault 全域で解決するので、衝突すると本文リンクが
// リンク先の分からないまま片方へ倒れる。
// 範囲を vault 全域に広げないのは、02_Notes と 04_Literature に既存の衝突
// （Figma.md）があり、全域検査にすると毎回それを踏むため。
{
  const books = new Map<string, string[]>();
  for (const p of mdFiles) {
    if (!rel(p).startsWith("03_Books/")) continue;
    const name = p.split("/").pop()!;
    const list = books.get(name) ?? [];
    list.push(rel(p));
    books.set(name, list);
  }
  const bad = mdFiles
    .filter((p) => rel(p).startsWith("02_Notes/"))
    .flatMap((p) => {
      const hit = books.get(p.split("/").pop()!);
      return hit
        ? [`${rel(p)} は ${hit.join(", ")} と同名（wikilink の解決先が不定）`]
        : [];
    });
  add("02_Notes と 03_Books のファイル名が衝突していない", bad, "衝突なし");
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
      // 03_Books はインデックスノートだけ。章ノートはこのスキルが構造上一度も
      // 書かないので、差分が出たならそれはユーザー自身の加筆であって成果物ではない。
      const inScope = r.startsWith("02_Notes/") ||
        r.startsWith("04_Literature/") || isBookIndex(p);
      if (!inScope) continue;
      try {
        const before = await Deno.readTextFile(`${BASELINE_DIR}/${r}`);
        if (before !== bodies.get(p)) written.add(p);
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
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

// ---- 4b. 03_Books の章ノートが baseline とバイト一致 ----
// 章ノートはユーザー自身の文章で、Vault に Git 履歴は無く、他所にも存在しない。
// 散文の禁止事項では強制できないが、この不変条件は決定可能なので機械で見る。
// インデックスノートは frontmatter が変わるので対象外。
// written 側が同じ差分を「ユーザーの加筆」として除外するのと逆の判定に見えるが、
// --baseline はスキル実行直前のスナップショットなので、その間に差分が出たなら
// 書いたのはスキルしかいない。
if (!BASELINE_DIR) {
  skip(
    "03_Books の章ノートが baseline とバイト一致",
    "--baseline 未指定のため未検証",
  );
} else {
  const bad: string[] = [];
  const isChapter = (r: string, p: string) =>
    r.startsWith("03_Books/") && !isBookIndex(p);
  const now = new Set<string>();
  for (const p of mdFiles) {
    const r = rel(p);
    if (!isChapter(r, p)) continue;
    now.add(r);
    try {
      const before = await Deno.readTextFile(`${BASELINE_DIR}/${r}`);
      if (before !== bodies.get(p)) bad.push(`${r} が baseline と一致しない`);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
      bad.push(`${r} は baseline に存在しない（章ノートが新規作成された）`);
    }
  }
  // 現存ファイル側から走査するだけでは削除に気づけない。Vault に Git 履歴が
  // 無い以上、削除は改変より復旧が難しく、この検査が本来守るべき筆頭にあたる。
  const gone: string[] = [];
  for (const b of await walk(`${BASELINE_DIR}/03_Books`)) {
    const r = b.slice(BASELINE_DIR.length + 1);
    if (!b.endsWith(".md") || isBookIndex(`${VAULT}/${r}`)) continue;
    if (!now.has(r)) {
      gone.push(`${r} が baseline にあるが Vault から消えている`);
    }
  }
  bad.push(...gone);
  add(
    "03_Books の章ノートが baseline とバイト一致",
    bad,
    `${now.size} 本の章ノートすべて無傷（削除も無し）`,
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
    if (!isSource(p)) continue;
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
    if (isSource(p)) {
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
  let books = 0;
  const nested = new Set<string>();
  for (const p of mdFiles) {
    const r = rel(p);
    const book = isBookIndex(p);
    if (!r.startsWith("04_Literature/") && !book) continue;
    const fm = bodies.get(p)!.match(/^---\n([\s\S]*?)\n---/)?.[1];
    // frontmatter ブロックそのものが無い本が 03_Books に実在する。読み飛ばすと
    // 「数えていない対象は完了扱い」という最悪の壊れ方をするので未コンパイルに数える。
    const ty = fm?.split("\n").find((l) => l.startsWith("type: "));
    // parked は「受け皿となる概念が無いので見送る」と判断済みの終端状態。
    // これが無いと、見送った記事が毎回トリアージ候補に戻り続ける。
    if (ty === "type: source" || ty === "type: parked") continue;
    if (book) {
      books++;
      continue;
    }
    uncompiled++;
    const dir = r.slice("04_Literature/".length, r.lastIndexOf("/"));
    if (dir) nested.add(dir);
  }
  const note = nested.size
    ? `（うちサブディレクトリ: ${[...nested].join(", ")}）`
    : "";
  add(
    "未コンパイルのソース本数を再帰的に数えている",
    [],
    `未コンパイル: 記事 ${uncompiled} 本${note} / 書籍 ${books} 冊`,
  );
}

// ---- 13. alias が既存ファイル名を shadow していない ----
// Obsidian は [[X]] を完全一致するファイル名へ優先的に解決するので、X.md が
// 実在するのに別ノートが X を aliases に持つと、その alias は永久に到達しない。
// 書いた本人は効いているつもりでいる、という壊れ方をする。
// aliases は人間フィールドなので修正はユーザーの手に委ねるしかないが、
// 検出まで人に任せると 8 件溜まってから気づくことになる（実際そうなった）。
{
  const noteNames = new Set(
    mdFiles
      .filter((p) => rel(p).startsWith("02_Notes/"))
      .map((p) => p.split("/").pop()!.replace(/\.md$/, "")),
  );
  const bad: string[] = [];
  for (const p of mdFiles) {
    if (!rel(p).startsWith("02_Notes/")) continue;
    const self = p.split("/").pop()!.replace(/\.md$/, "");
    const fm = bodies.get(p)!.match(/^---\n([\s\S]*?)\n---/)?.[1];
    if (!fm) continue;
    for (const a of aliasesOf(fm)) {
      if (a !== self && noteNames.has(a)) {
        bad.push(`${a}: ${self} の alias だが 02_Notes/${a}.md が実在する`);
      }
    }
  }
  add(
    "alias が既存ファイル名を shadow していない",
    bad,
    `alias 衝突なし`,
  );
}

// ---- 14. 孤立ノートの本数（情報表示） ----
// 孤立検出は毎回書き捨てのスクリプトでやっていて、同じバグを 2 回踏んだ。
// 1 回目は Bases ビューを見ておらず、2 回目は frontmatter のタグ解析が不完全で、
// 数字が 117 → 74 → 59 と動いた。優先順位をその数字の上で決めていたので、
// ここへ移して唯一の権威とする。失敗にはしない — 旧資産の棚卸しは進行中の作業。
//
// 「辿れる」の判定は 3 経路。本文の wikilink、Bases の hasTag ビュー、
// Bases の file.name ビュー。ログと proposals はリンク元から除く —
// ログは ingest が触った全ノートを列挙するので、含めると孤立が永久に消える。
{
  const notesOf = (pred: (r: string) => boolean) =>
    mdFiles.filter((p) => pred(rel(p)));

  const incoming = new Set<string>();
  for (const p of mdFiles) {
    const r = rel(p);
    if (r.startsWith("98_Maintenance/")) continue;
    const self = p.split("/").pop()!.replace(/\.md$/, "");
    for (const m of stripCode(bodies.get(p)!).matchAll(LINK)) {
      const t = m[1].trim().split("/").pop()!.replace(/\.md$/, "");
      if (t !== self) incoming.add(t);
    }
  }

  // MOC が Bases で絞っているタグと名前キーを集める。
  const viewTags = new Set<string>();
  const viewNameKeys = new Set<string>();
  for (const p of notesOf((r) => r.startsWith("02_Notes/"))) {
    const t = bodies.get(p)!;
    for (const m of t.matchAll(/hasTag\("([^"]+)"\)/g)) viewTags.add(m[1]);
    for (
      const m of t.matchAll(
        /file\.name(?:\.lower\(\))?\.contains(?:Any)?\(([^)]*)\)/g,
      )
    ) {
      for (const q of m[1].match(/"([^"]+)"/g) ?? []) {
        viewNameKeys.add(q.replace(/"/g, "").toLowerCase());
      }
    }
  }

  let unreachable = 0;
  let byView = 0;
  const byType = new Map<string, number>();
  for (const p of notesOf((r) => r.startsWith("02_Notes/"))) {
    const name = p.split("/").pop()!.replace(/\.md$/, "");
    if (incoming.has(name)) continue;
    const fm = bodies.get(p)!.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const ty = fm.split("\n").find((l) => l.startsWith("type: "))?.slice(6) ??
      "(なし)";
    // MOC は Home 側から辿る前提なので被リンク 0 でも孤立ではない。
    // record は規約上「知識パスから恒久的に除外」なので同じく対象外。
    if (ty === "moc" || ty === "record") continue;
    const tags = tagsOf(fm);
    const hitTag = tags.some((tg) =>
      [...viewTags].some((f) => tg === f || tg.startsWith(`${f}/`))
    );
    const hitName = [...viewNameKeys].some((k) =>
      k.length >= 2 && name.toLowerCase().includes(k)
    );
    if (hitTag || hitName) {
      byView++;
      continue;
    }
    unreachable++;
    byType.set(ty, (byType.get(ty) ?? 0) + 1);
  }
  const breakdown = [...byType].sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t} ${c}`).join(" / ");
  add(
    "どこからも辿れない概念ノートの本数",
    [],
    `${unreachable} 本（${
      breakdown || "なし"
    }）。Bases ビュー経由のみで辿れるものが別に ${byView} 本`,
  );
}

// ---- 出力 ----
let failed = 0;
let skipped = 0;
console.log("# wiki-doctor\n");
console.log(`vault: ${VAULT}`);
console.log(`skill: ${SKILL}\n`);
for (const c of checks) {
  const mark = c.skipped ? "SKIP" : c.ok ? "PASS" : "FAIL";
  if (c.skipped) skipped++;
  else if (!c.ok) failed++;
  console.log(`[${mark}] ${c.name}`);
  for (const d of c.detail.slice(0, 15)) console.log(`       ${d}`);
  if (c.detail.length > 15) {
    console.log(`       … 他 ${c.detail.length - 15} 件`);
  }
}
const graded = checks.length - skipped;
console.log(
  `\n${graded - failed}/${graded} PASS${skipped ? ` (${skipped} SKIP)` : ""}`,
);
Deno.exit(failed ? 1 : 0);
