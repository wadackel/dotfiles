#!/usr/bin/env -S deno run --allow-read --allow-env=HOME --allow-run=fd,rg
/**
 * 和文に混ざる語の棚卸し。
 * 頻度を全件出したうえで、機械で判定できる signal（リポジトリの識別子・パス名・
 * スキル名に由来するか）を各語に付ける。最終的な「訳すべきか」の判断は人間が行う前提で、
 * ここでは判断材料だけを揃える。
 */

const HOME = Deno.env.get("HOME")!;
// リポジトリルートはまずスクリプト位置から5階層上で導出するが、~/.claude/scripts/ の
// symlink 経由で起動すると import.meta.url は canonicalize されず導出が壊れるため、
// flake.nix の存在で検証し、ダメなら ~/dotfiles へフォールバックする。
async function resolveRepo(): Promise<string> {
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
  console.error(
    `repo root not found (flake.nix missing in: ${candidates.join(", ")})`,
  );
  Deno.exit(1);
}
const REPO = await resolveRepo();

async function runOrExit(
  cmd: Deno.Command,
  name: string,
  okCodes: number[],
): Promise<string> {
  const { code, stdout, stderr } = await cmd.output();
  if (!okCodes.includes(code)) {
    console.error(
      `${name} failed (exit ${code}): ${new TextDecoder().decode(stderr)}`,
    );
    Deno.exit(1);
  }
  return new TextDecoder().decode(stdout);
}

const proseOnly = (t: string) =>
  t.replace(/```[\s\S]*?```/g, "\n").replace(/~~~[\s\S]*?~~~/g, "\n").replace(
    /`[^`\n]+`/g,
    "␣",
  );

function isIdentifierLike(w: string): boolean {
  return /[._/]/.test(w) || /^[a-z]+[A-Z]/.test(w) || /^[A-Z]{2,}$/.test(w) ||
    /\d/.test(w);
}

// --- signal 1: リポジトリのファイル名・ディレクトリ名 -------------------------
const pathTokens = new Set<string>();
{
  const cmd = new Deno.Command("fd", {
    args: ["--type", "f", "--type", "d", ".", REPO],
    stdout: "piped",
    stderr: "piped",
  });
  const out = await runOrExit(cmd, "fd", [0]);
  for (const line of out.split("\n")) {
    for (const seg of line.replace(REPO, "").split(/[/\\]/)) {
      for (const t of seg.split(/[.\-_]/)) {
        if (t.length >= 3) pathTokens.add(t.toLowerCase());
      }
    }
  }
}

// --- signal 2: コード内の識別子（宣言に現れる名前だけを拾って一般語の混入を抑える）---
const declTokens = new Set<string>();
{
  const cmd = new Deno.Command("rg", {
    args: [
      "--no-filename",
      "--no-line-number",
      "-o",
      "-e",
      String
        .raw`(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_][A-Za-z0-9_]*)`,
      "-e",
      String.raw`^\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*=`,
      // 複数 -e は1本の選択に結合されるため2本目のキャプチャはグループ2になる。
      // "$1" だけだと2本目のマッチが空文字に置換され静かに欠落する
      "-r",
      "$1$2",
      REPO,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  // rg は「マッチなし」を exit 1 で返すため 0/1 を正常扱いにする
  const out = await runOrExit(cmd, "rg", [0, 1]);
  for (const t of out.split("\n")) {
    const s = t.trim().toLowerCase();
    if (s.length >= 3) declTokens.add(s);
  }
}

// --- signal 3: スキル名・コマンド名 -----------------------------------------
const skillTokens = new Set<string>();
for (
  const dir of [`${HOME}/.claude/skills`, `${REPO}/home/programs/agents/skills`]
) {
  try {
    for await (const e of Deno.readDir(dir)) {
      for (const t of e.name.split(/[-_.]/)) {
        if (t.length >= 3) skillTokens.add(t.toLowerCase());
      }
    }
  } catch { /* 無ければ skip */ }
}

// --- 対話からの語彙抽出 -------------------------------------------------------
const latin = new Map<string, { n: number; capitalized: number }>();
const kata = new Map<string, number>();

async function* files(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) yield* files(p);
    else if (e.name.endsWith(".jsonl")) yield p;
  }
}

for await (const path of files(`${HOME}/.claude/projects`)) {
  let content: string;
  try {
    content = await Deno.readTextFile(path);
  } catch {
    continue;
  }
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.type !== "assistant" || r.isSidechain) continue;
    const blocks =
      (r.message as { content?: Array<{ type: string; text?: string }> })
        ?.content;
    if (!Array.isArray(blocks)) continue;
    const raw = blocks.filter((b) => b.type === "text" && b.text).map((b) =>
      b.text!
    ).join("\n").trim();
    if (raw.length < 20) continue;
    const prose = proseOnly(raw);

    for (const m of prose.matchAll(/[A-Za-z][A-Za-z0-9_.\-/]*/g)) {
      const w = m[0].replace(/[.\-/]+$/, "");
      if (w.length < 3 || isIdentifierLike(w)) continue;
      const key = w.toLowerCase();
      const e = latin.get(key) ?? { n: 0, capitalized: 0 };
      e.n++;
      if (/^[A-Z]/.test(w)) e.capitalized++;
      latin.set(key, e);
    }
    for (const m of prose.matchAll(/[ァ-ヺー]{3,}/g)) {
      kata.set(m[0], (kata.get(m[0]) ?? 0) + 1);
    }
  }
}

const MIN = 10;
const rows = [...latin.entries()]
  .filter(([, v]) => v.n >= MIN)
  .sort((a, b) => b[1].n - a[1].n);

console.log(`# 和文に混ざる英単語（${MIN}回以上 / ${rows.length}語）\n`);
console.log(
  `signal 列: P=リポジトリのパス名に由来  D=コード内の宣言名に由来  S=スキル名に由来  C=大文字始まりが過半`,
);
console.log(`いずれも立たない語は「一般語が英語のまま残っている」候補\n`);
console.log(`  ${"語".padEnd(18)} ${"回数".padStart(5)}  signal`);

const plain: Array<[string, number]> = [];
for (const [w, v] of rows) {
  const sig: string[] = [];
  if (pathTokens.has(w)) sig.push("P");
  if (declTokens.has(w)) sig.push("D");
  if (skillTokens.has(w)) sig.push("S");
  if (v.capitalized / v.n > 0.5) sig.push("C");
  if (sig.length === 0) plain.push([w, v.n]);
  console.log(
    `  ${w.padEnd(18)} ${String(v.n).padStart(5)}  ${sig.join("") || "-"}`,
  );
}

console.log(`\n\n# signal が立たない語（訳すべき候補・${plain.length}語）\n`);
for (let i = 0; i < plain.length; i += 5) {
  console.log(
    "  " +
      plain.slice(i, i + 5).map(([w, n]) => `${w}(${n})`.padEnd(20)).join(""),
  );
}

const kataRows = [...kata.entries()].filter(([, n]) => n >= MIN).sort((a, b) =>
  b[1] - a[1]
);
console.log(`\n\n# カタカナ語（${MIN}回以上 / ${kataRows.length}語）\n`);
for (let i = 0; i < kataRows.length; i += 5) {
  console.log(
    "  " +
      kataRows.slice(i, i + 5).map(([w, n]) => `${w}(${n})`.padEnd(20)).join(
        "",
      ),
  );
}

const totalLatin = [...latin.values()].reduce((a, b) => a + b.n, 0);
const coveredByTop = rows.reduce((a, [, v]) => a + v.n, 0);
const plainSum = plain.reduce((a, [, n]) => a + n, 0);
console.log(`\n\n# 集計`);
console.log(
  `英単語トークン総数 ${totalLatin}  うち ${MIN}回以上の語で ${
    ((coveredByTop / totalLatin) * 100).toFixed(1)
  }% をカバー`,
);
console.log(
  `signal なしの語だけで ${plainSum} トークン = 全体の ${
    ((plainSum / totalLatin) * 100).toFixed(1)
  }%`,
);
