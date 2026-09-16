#!/usr/bin/env -S deno run --allow-read --allow-env=HOME
/**
 * 対話履歴の和文応答に writing-clarity 検出器を当て、カテゴリ別の
 * 応答単位発火率と千字あたり件数を測る規範追跡ツール。
 * 比較対象は fire-rate-baseline.md に commit された過去の実測値。
 * transcript は約30日のローリング保持で消えるため、二群比較モードは持たない —
 * 過去の窓は再現できず、`--to` にも用途がない。
 *
 * 使い方:
 *   fire-rate.ts [--from YYYY-MM-DD]
 *
 * `--from` は指定日の 00:00（+09:00 固定、ローカル TZ 非依存）以降を含む。
 */
import {
  detectAll,
  loadDictionaries,
  proseStats,
  resolveProtectedTermsPath,
} from "./detectors.ts";

function fail(msg: string): never {
  console.error(`fire-rate.ts: ${msg}`);
  Deno.exit(1);
}

let fromMs = -Infinity;
{
  const args = [...Deno.args];
  const i = args.indexOf("--from");
  if (i >= 0) {
    const v = args[i + 1];
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      fail(`--from は YYYY-MM-DD 形式で指定する（got: ${v ?? "なし"}）`);
    }
    // Date.parse は "2026-13-45" のような不正値で NaN を返す。NaN との比較は
    // 常に false になり期間指定が黙って無効化されるため、ここで止める
    const ms = Date.parse(`${v}T00:00:00+09:00`);
    if (Number.isNaN(ms)) fail(`--from の日付が不正: ${v}`);
    fromMs = ms;
    args.splice(i, 2);
  }
  if (args.length > 0) {
    fail(
      `未知の引数: ${
        args.join(" ")
      }（usage: fire-rate.ts [--from YYYY-MM-DD]）`,
    );
  }
}

const dict = loadDictionaries(
  await Deno.readTextFile(await resolveProtectedTermsPath()),
);
const HOME = Deno.env.get("HOME")!;

let n = 0;
let chars = 0;
const fired = new Map<string, number>();
const findings = new Map<string, number>();
let sentenceChars = 0;
let sentences = 0;
let itemLines = 0;
let labelFragmentLines = 0;
// 文体の差はスキル文脈に集中していた（plan 790 字 vs 文脈なし 191 字）ので、
// 全体平均だけでは施策の効果が見えない。/plan や /impl が現れた時点から次の
// マーカーまでを同じ文脈として数える: スキル実行中の質問応答も同じ文脈に属する
type Context = "plan" | "impl" | "none";
const byContext: Record<Context, number[]> = { plan: [], impl: [], none: [] };

function userText(r: Record<string, unknown>): string | null {
  const m = r.message as { role?: string; content?: unknown } | undefined;
  if (r.type !== "user" || !m) return null;
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    const texts: string[] = [];
    for (const b of m.content) {
      if (
        b && typeof b === "object" && (b as { type?: unknown }).type === "text"
      ) {
        const text = (b as { text?: unknown }).text;
        if (typeof text === "string") texts.push(text);
      }
    }
    return texts.length ? texts.join("\n") : null;
  }
  return null;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

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
  let context: Context = "none";
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.isSidechain) continue;
    // isMeta のユーザー行は skill 本文の展開で、/plan や /impl の文字列を含むが
    // ユーザーの発話ではない。assistant 行の母集団は 08-30 の baseline と揃えて
    // isMeta を見ない
    if (r.type === "user" && r.isMeta) continue;
    const u = userText(r);
    if (u !== null) {
      if (/(^|\s|>)\/plan(\s|$|<)/.test(u)) context = "plan";
      else if (/(^|\s|>)\/impl(\s|$|<)/.test(u)) context = "impl";
      continue;
    }
    if (r.type !== "assistant") continue;
    const blocks =
      (r.message as { content?: Array<{ type: string; text?: string }> })
        ?.content;
    if (!Array.isArray(blocks)) continue;
    const text = blocks.filter((b) => b.type === "text" && b.text).map((b) =>
      b.text!
    ).join("\n").trim();
    if (text.length < 20) continue;
    // 検出器の契約は和文 Markdown。英語応答を混ぜると telegraphic が総発火する
    const ja = (text.match(/[぀-ヿ一-鿿]/g) ?? []).length;
    if (ja / text.length < 0.1) continue;
    const ts = Date.parse(String(r.timestamp ?? ""));
    if (Number.isNaN(ts) || ts < fromMs) continue;
    n++;
    chars += text.length;
    byContext[context].push(text.length);
    const st = proseStats(text);
    sentences += st.sentences;
    sentenceChars += st.sentenceChars;
    itemLines += st.itemLines;
    labelFragmentLines += st.labelFragmentLines;
    const cats = new Set<string>();
    for (const f of detectAll(text, dict)) {
      cats.add(f.category);
      findings.set(f.category, (findings.get(f.category) ?? 0) + 1);
    }
    for (const c of cats) fired.set(c, (fired.get(c) ?? 0) + 1);
  }
}

if (n === 0) {
  console.log("対象応答 0 件（指定期間に和文のメイン対話応答がない）");
  Deno.exit(0);
}

const CATS = [
  "workflow_vocab",
  "mixed_latin_word",
  "arrow_chain",
  "telegraphic_fragment",
  "paren_chain",
];
console.log(`対象: n=${n} 応答, ${chars.toLocaleString()} 字`);
console.log("\ncategory              発火率   件数/千字");
for (const c of CATS) {
  const rate = ((fired.get(c) ?? 0) / n * 100).toFixed(1);
  const dens = ((findings.get(c) ?? 0) / chars * 1000).toFixed(2);
  console.log(`${c.padEnd(22)} ${rate.padStart(5)}%   ${dens.padStart(8)}`);
}
console.log(
  `\n文平均長 ${
    (sentences ? sentenceChars / sentences : 0).toFixed(1)
  } 字（${sentences.toLocaleString()} 文）、ラベル断片 ${
    itemLines ? (labelFragmentLines / itemLines * 100).toFixed(1) : "0.0"
  }%（${labelFragmentLines.toLocaleString()}/${itemLines.toLocaleString()} 行）`,
);
console.log("\nスキル文脈別 文字数（応答数 / 中央値）");
for (const [ctx, xs] of Object.entries(byContext)) {
  console.log(
    `${ctx.padEnd(6)} ${String(xs.length).padStart(6)} / ${
      median(xs).toFixed(0).padStart(6)
    }`,
  );
}
