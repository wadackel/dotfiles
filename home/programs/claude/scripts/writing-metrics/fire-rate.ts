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
    if (r.isSidechain || r.type !== "assistant") continue;
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
