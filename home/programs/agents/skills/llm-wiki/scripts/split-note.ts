#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null
// split-note — 長くなった概念ノートの節を新しいノートへ切り出す、機械的な部分。
// どの節を、何という名前で、どう要約して残すかは判断なので spec に書かれて渡ってくる。
// ここが受け持つのは、手でやると毎回どこかを書き漏らす周辺の更新だけ。
//
//   split-note.ts scan [--min-body 6000] [--min-section 1500]
//   split-note.ts apply --today YYYY-MM-DD [--dry-run]
//
// apply の入力は $LLM_WIKI_VAULT_ROOT/98_Maintenance/split-mining/apply-spec.json。
// タイトルは記事由来なので、シェルの引数に載せずにファイルで受ける。
//
// 終了コード: 0 = 成功、1 = 検証失敗（何も書いていない）、2 = 引数・環境の不備、
// 3 = 書き込みの途中で失敗（書けたファイルとバックアップ先を出力する）。

import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";

export type Spec = {
  source: string;
  target: string;
  type: string;
  sections: string[];
  stubHeading?: string | null;
  stub: string;
  lead: string;
  quote?: string | null;
  rewrites?: { from: string; to: string }[];
  sourceRewrites?: { from: string; to: string }[];
  sources: string[];
  relatedPages?: { note: string; line: string }[];
  originalLine: string;
  backLine: string;
  map: false | { line: string; moc?: string | null; under?: string | null };
  logNotes?: string[];
};

export type Write = { path: string; content: string; existed: boolean };
export type Plan = {
  writes: Write[];
  headingLinkFiles: string[];
  logPath: string;
};

export class SplitError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join("\n"));
    this.problems = problems;
  }
}

export class PartialWriteError extends Error {
  readonly backup: string;
  readonly written: string[];
  readonly reason: unknown;
  constructor(backup: string, written: string[], reason: unknown) {
    super(`書き込みの途中で失敗: ${(reason as Error)?.message ?? reason}`);
    this.backup = backup;
    this.written = written;
    this.reason = reason;
  }
}

const NOTE_TYPES = new Set(["concept", "entity", "comparison", "synthesis"]);
const BACK_SECTIONS = new Set(["関連ページ", "ソース"]);
export const SPEC_PATH = "98_Maintenance/split-mining/apply-spec.json";
const RECORD_DIR = "98_Maintenance/split-mining";

// 記事タイトルには U+2028 や空白の連続が混じり、書き写したタイトルとは一致しない。
// `\s` は U+2028 も含むので、畳み込んだ鍵で照合して実ファイル名を書き戻す。
const key = (s: string) => s.replace(/\s+/gu, " ").trim();

// ---- frontmatter ----
// flow sequence は行分割で読む。正規表現の `.` と複数行 `$` は U+2028 で途切れ、
// 行ごと取りこぼす（ingest.md の注意と同じ罠）。

type Doc = { fm: string[]; body: string };

const parseDoc = (text: string): Doc | null => {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 3);
  if (end < 0) return null;
  return { fm: text.slice(4, end).split("\n"), body: text.slice(end + 5) };
};
const renderDoc = (d: Doc) => `---\n${d.fm.join("\n")}\n---\n${d.body}`;

const fmLine = (fm: string[], k: string) =>
  fm.findIndex((l) => l === `${k}:` || l.startsWith(`${k}: `));
const fmScalar = (fm: string[], k: string) => {
  const i = fmLine(fm, k);
  return i < 0 ? "" : fm[i].slice(k.length + 1).trim();
};
const fmLinks = (fm: string[], k: string) => {
  const i = fmLine(fm, k);
  if (i < 0 || !fm[i].startsWith(`${k}: [`)) return [];
  return [...fm[i].matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());
};
const seq = (k: string, names: string[]) =>
  `${k}: [${names.map((n) => JSON.stringify(`[[${n}]]`)).join(", ")}]`;

// 既存の行はバイトを保ったまま末尾に足す。書き直すと引用符や空白の揺れまで変わり、
// 人が見る差分が膨らむ。
const appendLink = (fm: string[], k: string, name: string): string | null => {
  const i = fmLine(fm, k);
  if (i < 0) return `${k} が無い`;
  const line = fm[i].trimEnd();
  if (!line.startsWith(`${k}: [`) || !line.endsWith("]")) {
    return `${k} が 1 行の flow sequence ではない`;
  }
  if (fmLinks(fm, k).some((n) => key(n) === key(name))) return null;
  const inner = line.slice(k.length + 3, -1).trim();
  fm[i] = inner
    ? `${line.slice(0, -1)}, ${JSON.stringify(`[[${name}]]`)}]`
    : `${k}: [${JSON.stringify(`[[${name}]]`)}]`;
  return null;
};
const setScalar = (fm: string[], k: string, v: string, insert: boolean) => {
  const i = fmLine(fm, k);
  if (i >= 0) fm[i] = `${k}: ${v}`;
  else if (insert) fm.push(`${k}: ${v}`);
};

// ---- 本文の節 ----
// フェンス内の `## ` は見出しではない。数えると ADR のテンプレートを載せたノートが
// 見出しだらけに見え、切り出し位置もずれる。

type Section = { heading: string | null; start: number; end: number };

export const sectionsOf = (lines: string[]): Section[] => {
  const out: Section[] = [{ heading: null, start: 0, end: lines.length }];
  let fence: { ch: string; len: number } | null = null;
  lines.forEach((l, i) => {
    const m = l.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (
        m && m[1][0] === fence.ch && m[1].length >= fence.len &&
        l.trim() === m[1]
      ) fence = null;
      return;
    }
    if (m) {
      fence = { ch: m[1][0], len: m[1].length };
      return;
    }
    if (l.startsWith("## ")) {
      out[out.length - 1].end = i;
      out.push({ heading: l.slice(3).trim(), start: i, end: lines.length });
    }
  });
  return out;
};

const visible = (s: string) => s.replace(/\s/gu, "").length;
const parentOf = (body: string) =>
  body.split("\n").find((l) => l.trim())?.match(/^\[\[([^\]|#]+)\]\]/)?.[1]
    .trim() ?? null;

// ---- ファイル一覧 ----
// vault のルートは走査しない。Bash の層は隔離ディレクトリを守らないので、
// 読む範囲はここで閉じる。

async function listMd(dir: string, recursive: boolean): Promise<string[]> {
  const out: string[] = [];
  try {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink() || e.name.startsWith(".")) continue;
      const p = `${dir}/${e.name}`;
      if (e.isDirectory() && recursive) out.push(...await listMd(p, true));
      else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
    }
  } catch { /* 無いディレクトリは空として扱う */ }
  return out;
}
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1, -3);

async function bookFiles(vault: string) {
  const all = await listMd(`${vault}/03_Books`, true);
  const isIndex = (p: string) => {
    const seg = p.slice(vault.length + 1).split("/");
    return seg.length === 2 ||
      (seg.length === 3 && seg[2] === `${seg[1]}.md`);
  };
  return { all, index: all.filter(isIndex) };
}

export async function checkVault(vault: string): Promise<string | null> {
  if (!vault.startsWith("/")) return "LLM_WIKI_VAULT_ROOT が絶対パスではない";
  for (const p of ["Home.md", "02_Notes", "04_Literature", "03_Books"]) {
    if (!await stat(`${vault}/${p}`).catch(() => null)) {
      return `vault に ${p} が無い: ${vault}`;
    }
  }
  return null;
}

// ---- scan ----

export type ScanRow = {
  note: string;
  body: number;
  sections: { heading: string; chars: number; long: boolean }[];
  recorded: number | null;
};

export async function scan(
  vault: string,
  opt: { minBody: number; minSection: number },
): Promise<ScanRow[]> {
  const recorded = new Map<string, number>();
  // 年の昇順に読み、新しい年の字数で上書きする
  for (const p of (await listMd(`${vault}/${RECORD_DIR}`, false)).sort()) {
    if (!baseName(p).startsWith("分割候補の判定記録")) continue;
    let note = "";
    for (const l of (await readFile(p, "utf8")).split("\n")) {
      const h = l.match(/^### \[\[([^\]|#]+)/);
      if (h) note = key(h[1]);
      const n = l.match(/^- 長さ: 本文 ([\d,]+) 字/);
      if (n && note) recorded.set(note, Number(n[1].replaceAll(",", "")));
    }
  }
  const rows: ScanRow[] = [];
  for (const p of await listMd(`${vault}/02_Notes`, false)) {
    const doc = parseDoc(await readFile(p, "utf8"));
    if (!doc || !NOTE_TYPES.has(fmScalar(doc.fm, "type"))) continue;
    const lines = doc.body.split("\n");
    const secs = sectionsOf(lines);
    const cut = secs.findIndex((s) =>
      s.heading && BACK_SECTIONS.has(s.heading)
    );
    const main = cut < 0 ? secs : secs.slice(0, cut);
    const size = (s: Section) =>
      visible(lines.slice(s.start, s.end).join("\n"));
    const body = main.reduce((n, s) => n + size(s), 0);
    if (body < opt.minBody) continue;
    rows.push({
      note: baseName(p),
      body,
      sections: main.filter((s) => s.heading).map((s) => ({
        heading: s.heading!,
        chars: size(s),
        long: size(s) >= opt.minSection,
      })),
      recorded: recorded.get(key(baseName(p))) ?? null,
    });
  }
  return rows.sort((a, b) => b.body - a.body);
}

// ---- apply ----

const REF = /([上下])の[「『]([^」』\n]+)[」』]/g;

export async function planSplit(
  vault: string,
  spec: Spec,
  today: string,
): Promise<Plan> {
  const bad: string[] = [];
  const fail = () => {
    if (bad.length) throw new SplitError(bad);
  };
  const notesDir = `${vault}/02_Notes`;
  const notePaths = await listMd(notesDir, false);
  const noteByKey = new Map(notePaths.map((p) => [key(baseName(p)), p]));
  const contents = new Map<string, string>();
  const read = async (p: string) => {
    if (!contents.has(p)) contents.set(p, await readFile(p, "utf8"));
    return contents.get(p)!;
  };

  // spec の形
  for (
    const k of [
      "source",
      "target",
      "type",
      "stub",
      "lead",
      "originalLine",
      "backLine",
    ] as const
  ) {
    if (typeof spec[k] !== "string" || !spec[k].trim()) {
      bad.push(`spec.${k} が空`);
    }
  }
  if (!Array.isArray(spec.sections) || !spec.sections.length) {
    bad.push("spec.sections が空");
  }
  if (!Array.isArray(spec.sources) || !spec.sources.length) {
    bad.push("spec.sources が空");
  }
  if (spec.map !== false && (typeof spec.map !== "object" || !spec.map?.line)) {
    bad.push("spec.map は false か、line を持つオブジェクト");
  }
  fail();
  if (!NOTE_TYPES.has(spec.type)) {
    bad.push(`spec.type は ${[...NOTE_TYPES].join(" | ")} のどれか`);
  }

  // 新しいノートの名前は wikilink とファイル名の両方になる
  const target = spec.target;
  if (
    /[/\\[\]|#^:*?"<>]|\.\./.test(target) || target.startsWith(".") ||
    /[\p{Cc}\u2028\u2029]/u.test(target) || target !== target.trim()
  ) {
    bad.push(`target に使えない文字がある: ${target}`);
  }
  // 日本語は 1 文字 3 バイトなので、85 文字前後で 1 要素の上限 255 バイトに届く
  if (new TextEncoder().encode(`${target}.md`).length > 255) {
    bad.push(`target が長すぎる（ファイル名が 255 バイトを超える）: ${target}`);
  }
  if (noteByKey.has(key(target))) bad.push(`02_Notes に同名がある: ${target}`);
  const books = await bookFiles(vault);
  if (books.all.some((p) => key(baseName(p)) === key(target))) {
    bad.push(`03_Books に同名がある: ${target}`);
  }

  const sourcePath = noteByKey.get(key(spec.source));
  if (!sourcePath) {
    bad.push(`02_Notes に元のノートが無い: ${spec.source}`);
    fail();
  }
  const source = baseName(sourcePath!);
  const orig = parseDoc(await read(sourcePath!));
  if (!orig) {
    bad.push(`元のノートの frontmatter が読めない: ${source}`);
    fail();
  }
  // リンクの表記揺れのまま使うと、ログが別名のファイルとして新しく作られる
  const parentLink = parentOf(orig!.body);
  const parentPath = parentLink ? noteByKey.get(key(parentLink)) : undefined;
  if (!parentPath) {
    bad.push(
      `元のノートの 1 行目が 02_Notes の親 MOC を指していない: ${source}`,
    );
  }
  const parent = parentPath ? baseName(parentPath) : "";

  // 節
  const lines = orig!.body.split("\n");
  const secs = sectionsOf(lines);
  const moved: Section[] = [];
  if (new Set(spec.sections).size !== spec.sections.length) {
    bad.push("sections に同じ節が 2 回ある");
  }
  for (const h of new Set(spec.sections)) {
    const hits = secs.filter((s) => s.heading === h);
    if (hits.length !== 1) {
      bad.push(
        `節「${h}」が元のノートに ${hits.length} 回ある（1 回であること）`,
      );
    } else if (BACK_SECTIONS.has(h)) bad.push(`節「${h}」は移せない`);
    else moved.push(hits[0]);
  }
  moved.sort((a, b) => a.start - b.start);
  const remaining = secs.filter((s) =>
    s.heading && !BACK_SECTIONS.has(s.heading) &&
    !spec.sections.includes(s.heading)
  );
  if (moved.length === spec.sections.length && !remaining.length) {
    bad.push("全部の節を移そうとしている。元のノートに 1 節は残すこと");
  }
  if (!spec.stub.includes(`[[${target}]]`)) {
    bad.push(`stub に [[${target}]] が無い`);
  }
  const movedOrder = moved.map((s) => s.heading!);
  const stubHeading = spec.stubHeading?.trim() || movedOrder[0];
  if (
    stubHeading?.startsWith("#") ||
    secs.some((s) =>
      s.heading === stubHeading && !movedOrder.includes(stubHeading)
    )
  ) {
    bad.push(`stubHeading が残る節と重なるか # で始まる: ${stubHeading}`);
  }

  // 出典
  const lit = await listMd(`${vault}/04_Literature`, true);
  const srcByKey = new Map<string, string[]>();
  for (const p of [...lit, ...books.index]) {
    const k = key(baseName(p));
    srcByKey.set(k, [...(srcByKey.get(k) ?? []), p]);
  }
  const origSources = new Set(fmLinks(orig!.fm, "sources").map(key));
  const sourceFiles: string[] = [];
  for (const s of spec.sources) {
    const hits = srcByKey.get(key(s)) ?? [];
    if (hits.length !== 1) {
      bad.push(`出典「${s}」が ${hits.length} 件に解決した（1 件であること）`);
    } else if (!origSources.has(key(s))) {
      bad.push(`出典「${s}」が元のノートの sources に無い`);
    } else sourceFiles.push(hits[0]);
  }
  if (spec.sources.length === 1 && !spec.quote?.trim()) {
    bad.push("単一出典のノートには quote（> [タイトル](URL)）が要る");
  }

  const related: string[] = [];
  for (const r of spec.relatedPages ?? []) {
    const p = noteByKey.get(key(r.note));
    if (!p) bad.push(`relatedPages のノートが 02_Notes に無い: ${r.note}`);
    else related.push(baseName(p));
  }
  fail();

  // 書き換え（各 from はちょうど 1 回）
  const rewrite = (
    text: string,
    rules: { from: string; to: string }[] | undefined,
    where: string,
  ) => {
    for (const r of rules ?? []) {
      const n = text.split(r.from).length - 1;
      if (n !== 1) bad.push(`${where}の書き換え「${r.from}」が ${n} 回ある`);
      else text = text.replace(r.from, () => r.to);
    }
    return text;
  };
  const block = (s: Section) =>
    lines.slice(s.start, s.end).join("\n").trimEnd();
  const movedText = rewrite(
    moved.map(block).join("\n\n"),
    spec.rewrites,
    "新しいノート",
  );

  // 元のノート: 移す節を抜き、最初の位置に要約を置く
  const firstStart = Math.min(...moved.map((s) => s.start));
  const kept: string[] = [];
  for (const s of secs) {
    if (moved.includes(s)) {
      if (s.start === firstStart) {
        kept.push(`## ${stubHeading}`, "", "\u0000STUB", "");
      }
      continue;
    }
    kept.push(...lines.slice(s.start, s.end));
  }
  let origBody = rewrite(kept.join("\n"), spec.sourceRewrites, "元のノート");
  origBody = origBody.replace("\u0000STUB", () => spec.stub.trim());

  const movedNames = new Set(spec.sections);
  const keptNames = new Set(remaining.map((s) => s.heading!));
  for (const m of origBody.matchAll(REF)) {
    if (movedNames.has(m[2]) && m[2] !== stubHeading) {
      bad.push(`元のノートに移した節への参照が残る: ${m[0]}`);
    }
  }
  for (const m of movedText.matchAll(REF)) {
    if (keptNames.has(m[2]) && !movedNames.has(m[2])) {
      bad.push(`新しいノートに元のノートの節への参照が残る: ${m[0]}`);
    }
  }
  fail();

  // 元のノートの関連ページと related
  const oLines = origBody.split("\n");
  const oSecs = sectionsOf(oLines);
  const rel = oSecs.find((s) => s.heading === "関連ページ");
  const relLine = `- [[${target}]] — ${spec.originalLine.trim()}`;
  const existingRelated = rel
    ? [
      ...oLines.slice(rel.start, rel.end).join("\n").matchAll(
        /\[\[([^\]|#]+)/g,
      ),
    ]
      .map((m) => m[1].trim())
    : [];
  if (rel) {
    let at = rel.end;
    while (at > rel.start + 1 && !oLines[at - 1].trim()) at--;
    oLines.splice(at, 0, relLine);
  } else {
    const src = oSecs.find((s) => s.heading === "ソース");
    const at = src ? src.start : oLines.length;
    const pad = at > 0 && oLines[at - 1].trim() ? [""] : [];
    oLines.splice(
      at,
      0,
      ...pad,
      "## 関連ページ",
      "",
      relLine,
      "",
    );
  }
  const ofm = [...orig!.fm];
  const relIdx = fmLine(ofm, "related");
  if (
    relIdx >= 0 && ofm[relIdx].trim() !== "related:" &&
    !ofm[relIdx].startsWith("related: [")
  ) {
    bad.push("元のノートの related が 1 行の flow sequence ではない");
  }
  if (relIdx >= 0 && /^\s+-/.test(ofm[relIdx + 1] ?? "")) {
    bad.push(
      "元のノートの related がブロック形式で、書き換えると YAML が壊れる",
    );
  }
  // related が空のまま 1 本だけ足すと、既存の関連ページの全行が部分集合検査に落ちる
  if (!fmLinks(ofm, "related").length) {
    const seed = [...new Set([parent!, ...existingRelated, target])];
    const i = fmLine(ofm, "related");
    if (i >= 0) ofm[i] = seq("related", seed);
    else {
      const u = fmLine(ofm, "updated");
      ofm.splice(u < 0 ? ofm.length : u, 0, seq("related", seed));
    }
  } else {
    const e = appendLink(ofm, "related", target);
    if (e) bad.push(`元のノートの ${e}`);
  }
  setScalar(ofm, "updated", today, true);

  const writes: Write[] = [];
  const put = (path: string, content: string, existed = true) => {
    const w = writes.find((x) => x.path === path);
    if (w) w.content = content;
    else writes.push({ path, content, existed });
    contents.set(path, content);
  };
  put(sourcePath!, renderDoc({ fm: ofm, body: oLines.join("\n") }));

  // 新しいノート
  const srcNames = sourceFiles.map(baseName);
  const newBody = [
    `[[${parent}]]`,
    "",
    ...(spec.quote?.trim() ? [spec.quote.trim(), ""] : []),
    `${spec.lead.trim()}[[${source}]] から切り出した。`,
    "",
    movedText,
    "",
    "## 関連ページ",
    "",
    `- [[${source}]] — ${spec.backLine.trim()}`,
    ...(spec.relatedPages ?? []).flatMap((r, i) =>
      related[i] === source || related[i] === parent
        ? []
        : [`- [[${related[i]}]] — ${r.line.trim()}`]
    ),
    "",
    "## ソース",
    "",
    ...srcNames.map((s) => `- [[${s}]]`),
    "",
  ].join("\n");
  const newFm = [
    "aliases:",
    "tags:",
    "description:",
    `type: ${spec.type}`,
    seq("sources", srcNames),
    seq("related", [...new Set([parent!, source, ...related])]),
    `updated: ${today}`,
  ];
  const newPath = `${notesDir}/${target}.md`;
  put(newPath, renderDoc({ fm: newFm, body: newBody }), false);

  // 出典の generated_pages
  for (const p of sourceFiles) {
    const d = parseDoc(await read(p));
    if (!d) {
      bad.push(`出典の frontmatter が読めない: ${baseName(p)}`);
      continue;
    }
    const e = appendLink(d.fm, "generated_pages", target);
    if (e) bad.push(`出典「${baseName(p)}」の ${e}`);
    else put(p, renderDoc(d));
  }

  // 知識マップ
  let logMoc = parent!;
  let mapNote = "";
  if (spec.map !== false) {
    const underPath = noteByKey.get(key(spec.map.under?.trim() || source));
    if (!underPath) bad.push(`map.under が 02_Notes に無い: ${spec.map.under}`);
    const under = underPath ? baseName(underPath) : source;
    const mocs: string[] = [];
    if (spec.map.moc) {
      const p = noteByKey.get(key(spec.map.moc));
      if (!p) bad.push(`map.moc が 02_Notes に無い: ${spec.map.moc}`);
      else mocs.push(p);
    } else {
      for (const p of notePaths) {
        const d = parseDoc(await read(p));
        if (d && fmScalar(d.fm, "type") === "moc") mocs.push(p);
      }
    }
    const hits: {
      path: string;
      doc: Doc;
      lines: string[];
      i: number;
      start: number;
      end: number;
    }[] = [];
    for (const p of mocs) {
      const d = parseDoc(contents.get(p) ?? await read(p));
      if (!d) continue;
      const ls = d.body.split("\n");
      const map = sectionsOf(ls).find((s) => s.heading === "知識マップ");
      if (!map) continue;
      for (let i = map.start + 1; i < map.end; i++) {
        const b = ls[i].match(/^\s*[-*+] .*?\[\[([^\]|#]+)/);
        if (b && key(b[1]) === key(under)) {
          hits.push({
            path: p,
            doc: d,
            lines: ls,
            i,
            start: map.start,
            end: map.end,
          });
        }
      }
    }
    if (hits.length !== 1) {
      bad.push(
        `知識マップで [[${under}]] を最初のリンクに持つ行が ${hits.length} 件（1 件であること。map.moc / map.under で指定するか map: false）`,
      );
    } else {
      const h = hits[0];
      const width = (ws: string) =>
        [...ws].reduce((n, c) => n + (c === "\t" ? 4 : 1), 0);
      const indentOf = (l: string) => l.match(/^\s*/)![0];
      const mapLines = h.lines.slice(h.start, h.end);
      const firstIndented = mapLines.find((l) =>
        /^\s+[-*+] /.test(l) && width(indentOf(l)) > 0
      );
      const unit = firstIndented
        ? (indentOf(firstIndented).includes("\t")
          ? "\t"
          : " ".repeat(width(indentOf(firstIndented))))
        : "    ";
      const base = indentOf(h.lines[h.i]);
      let at = h.i + 1;
      while (
        at < h.end && h.lines[at].trim() &&
        width(indentOf(h.lines[at])) > width(base)
      ) at++;
      h.lines.splice(
        at,
        0,
        `${base}${unit}- [[${target}]] — ${spec.map.line.trim()}`,
      );
      setScalar(h.doc.fm, "updated", today, false);
      put(h.path, renderDoc({ fm: h.doc.fm, body: h.lines.join("\n") }));
      logMoc = baseName(h.path);
      mapNote = under;
    }
  }

  // 移した節への見出しリンク
  const headingLinkFiles: string[] = [];
  for (const p of [...notePaths, newPath]) {
    let t = contents.get(p) ?? await read(p);
    const before = t;
    for (const h of spec.sections) {
      for (const tail of ["]]", "|"]) {
        t = t.replaceAll(`[[${source}#${h}${tail}`, `[[${target}#${h}${tail}`);
      }
    }
    if (t !== before) {
      put(p, t, writes.find((w) => w.path === p)?.existed ?? true);
      if (p !== newPath) headingLinkFiles.push(baseName(p));
    }
  }

  // 操作ログ
  const logPath = `${vault}/98_Maintenance/logs/${logMoc} 操作ログ.md`;
  const entry = [
    `- 分割: [[${source}]] → [[${target}]]`,
    `  - 移した節: ${
      movedOrder.join("、")
    }。元のノートには要約とリンクを残した`,
    ...(mapNote ? [`  - 知識マップ更新: [[${mapNote}]] の下に追加`] : []),
    `  - 出典 ${sourceFiles.length} 本の \`generated_pages\` に [[${target}]] を追加`,
    ...(headingLinkFiles.length
      ? [
        `  - 見出しリンクを付け替えた: ${
          headingLinkFiles.map((n) => `[[${n}]]`).join(", ")
        }`,
      ]
      : []),
    ...(spec.logNotes ?? []).map((n) => `  - ${n.trim()}`),
  ].join("\n");
  const log = await readFile(logPath, "utf8").catch(() => null);
  if (log === null) {
    put(
      logPath,
      `[[${logMoc}]]\n\n操作ログ。追記専用。\n\n## ${today}\n\n${entry}\n`,
      false,
    );
  } else {
    const heads = [...log.matchAll(/^## (.+)$/gm)];
    const base = log.trimEnd();
    put(
      logPath,
      heads.at(-1)?.[1].trim() === today
        ? `${base}\n\n${entry}\n`
        : `${base}\n\n## ${today}\n\n${entry}\n`,
    );
  }

  fail();
  for (const w of writes) {
    if (!isWritable(vault, w.path, books.index)) {
      throw new SplitError([`書き込み範囲の外: ${w.path}`]);
    }
  }
  return { writes, headingLinkFiles, logPath };
}

const isWritable = (vault: string, p: string, bookIndex: string[]) =>
  !p.includes("/../") && (
    ["02_Notes/", "04_Literature/", "98_Maintenance/"].some((d) =>
      p.startsWith(`${vault}/${d}`)
    ) || bookIndex.includes(p)
  );

const missing = async (p: string) => {
  try {
    await lstat(p);
    return false;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw e;
  }
};

export async function applyPlan(
  vault: string,
  plan: Plan,
  backupRoot: string,
): Promise<string> {
  for (const w of plan.writes) {
    if (!w.existed && !await missing(w.path)) {
      throw new SplitError([`作成先が既にある: ${w.path}`]);
    }
  }
  if (!await missing(backupRoot)) {
    throw new SplitError([`バックアップ先が既にある: ${backupRoot}`]);
  }
  for (const w of plan.writes) {
    if (!w.existed) continue;
    const to = `${backupRoot}/${w.path.slice(vault.length + 1)}`;
    await mkdir(to.slice(0, to.lastIndexOf("/")), { recursive: true });
    await copyFile(w.path, to);
  }
  // 作成を先に書く。新しいファイルのほうが失敗しやすく、そこで落ちれば既存のノートは
  // 節を抜かれる前のまま残る。更新を先にすると、移した節が vault から消えた状態で止まる。
  const order = [
    ...plan.writes.filter((w) => !w.existed),
    ...plan.writes.filter((w) => w.existed),
  ];
  const written: string[] = [];
  try {
    for (const w of order) {
      await mkdir(w.path.slice(0, w.path.lastIndexOf("/")), {
        recursive: true,
      });
      await writeFile(w.path, w.content);
      written.push(w.path);
    }
  } catch (e) {
    throw new PartialWriteError(backupRoot, written, e);
  }
  return backupRoot;
}

// ---- CLI ----

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0) return null;
    const v = args[i + 1];
    if (!v || v.startsWith("--")) {
      console.error(`${name} に値が無い`);
      process.exit(2);
    }
    return v;
  };
  const vault = (process.env.LLM_WIKI_VAULT_ROOT ?? "").replace(/\/+$/, "");
  const vaultError = await checkVault(vault);
  if (vaultError) {
    console.error(vaultError);
    process.exit(2);
  }
  const cmd = args[0];
  if (cmd === "scan") {
    const minBody = Number(opt("--min-body") ?? 6000);
    const minSection = Number(opt("--min-section") ?? 1500);
    if (!Number.isFinite(minBody) || !Number.isFinite(minSection)) {
      console.error("--min-body / --min-section は数値");
      process.exit(2);
    }
    const rows = await scan(vault, { minBody, minSection });
    console.log(JSON.stringify(rows, null, 2));
  } else if (cmd === "apply") {
    const today = opt("--today");
    if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
      console.error("--today YYYY-MM-DD が要る（date +%Y-%m-%d の値）");
      process.exit(2);
    }
    let spec: Spec;
    try {
      spec = JSON.parse(await readFile(`${vault}/${SPEC_PATH}`, "utf8"));
    } catch (e) {
      console.error(`spec を読めない: ${SPEC_PATH}: ${(e as Error).message}`);
      process.exit(2);
    }
    try {
      const plan = await planSplit(vault, spec, today);
      const r = (p: string) => p.slice(vault.length + 1);
      const dry = args.includes("--dry-run");
      if (!dry) {
        const home = process.env.HOME;
        if (!home) {
          console.error("HOME が未設定");
          process.exit(2);
        }
        const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(
          0,
          18,
        );
        const dir = await applyPlan(
          vault,
          plan,
          `${home}/.cache/llm-wiki/split-backup/${stamp}`,
        );
        console.log(`backup\t${dir}`);
      }
      for (const w of plan.writes) {
        console.log(
          `${dry ? "dry-run " : ""}${w.existed ? "update" : "create"}\t${
            r(w.path)
          }`,
        );
      }
    } catch (e) {
      if (e instanceof PartialWriteError) {
        console.log(`FAILED\t${e.message}`);
        console.log(`backup\t${e.backup}`);
        for (const p of e.written) {
          console.log(`written\t${p.slice(vault.length + 1)}`);
        }
        process.exit(3);
      }
      if (!(e instanceof SplitError)) throw e;
      for (const p of e.problems) console.log(`NG\t${p}`);
      process.exit(1);
    }
  } else {
    console.error(
      "usage: split-note.ts scan | apply --today YYYY-MM-DD [--dry-run]",
    );
    process.exit(2);
  }
}
