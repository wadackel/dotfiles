#!/usr/bin/env -S deno run --allow-read --allow-env=HOME
/**
 * writing-clarity lint — CLAUDE.md `### Writing` 規範の違反候補を検出する。
 * 対象は和文 Markdown 1ファイル。検出は疑いの提示であり、修正判断は AI/人間が行う。
 *
 * 使い方:
 *   lint.ts <file.md> [--json]
 *
 * exit code は検出件数に関わらず 0（lint であって CI ゲートではない）。
 * 入力エラー（ファイル不在・ディレクトリ指定・辞書検証失敗）のみ 1。
 */
import {
  detectAll,
  loadDictionaries,
  proseStats,
  resolveProtectedTermsPath,
} from "./detectors.ts";

function fail(msg: string): never {
  console.error(`lint.ts: ${msg}`);
  Deno.exit(1);
}

const args = Deno.args.filter((a) => a !== "--json");
const asJson = Deno.args.includes("--json");
if (args.length !== 1) fail("usage: lint.ts <file.md> [--json]");

const path = args[0];
let stat: Deno.FileInfo;
try {
  stat = await Deno.stat(path);
} catch {
  fail(`cannot read: ${path}`);
}
if (stat.isDirectory) {
  fail(`directory given: ${path} (和文 Markdown を1ファイルずつ指定する)`);
}

let dict;
try {
  dict = loadDictionaries(
    await Deno.readTextFile(await resolveProtectedTermsPath()),
  );
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

const text = await Deno.readTextFile(path);
const findings = detectAll(text, dict);
const stats = proseStats(text);

if (asJson) {
  console.log(JSON.stringify({ findings, stats }, null, 2));
} else {
  for (const f of findings) {
    console.log(
      `${f.line}:[${f.severity}] ${f.category}: ${f.matched} — ${f.excerpt}`,
    );
  }
  console.log(
    findings.length === 0
      ? "findings なし"
      : `${findings.length} findings（疑いの提示であり、全修正の指示ではない）`,
  );
  console.log(
    `文平均長 ${
      stats.meanSentenceLength.toFixed(1)
    } 字（${stats.sentences} 文）、ラベル断片 ${stats.labelFragmentLines}/${stats.itemLines} 行（${
      (stats.labelFragmentRatio * 100).toFixed(0)
    }%）`,
  );
}
