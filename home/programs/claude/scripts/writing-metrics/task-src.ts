#!/usr/bin/env -S deno run --allow-read --allow-env=HOME
/**
 * 応答中の「Task」の出現文脈を分類する。
 * スキル語彙起源 (見出し・表・ツール名) と地の文使用を切り分け、語彙規範の効果測定に使う。
 */
const HOME = Deno.env.get("HOME")!;
const ctx = new Map<string, number>();
const samples: string[] = [];
async function* f(d: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(d)) {
    const p = `${d}/${e.name}`;
    if (e.isDirectory) yield* f(p);
    else if (e.name.endsWith(".jsonl")) yield p;
  }
}
for await (const path of f(`${HOME}/.claude/projects`)) {
  let c: string;
  try {
    c = await Deno.readTextFile(path);
  } catch {
    continue;
  }
  for (const line of c.split("\n")) {
    if (!line.trim()) continue;
    let r: any;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.type !== "assistant" || r.isSidechain) continue;
    const t = (r.message?.content ?? []).filter((b: any) =>
      b.type === "text" && b.text
    ).map((b: any) => b.text).join("\n");
    if (!t) continue;
    for (const m of t.matchAll(/[^\n]{0,30}\bTask\b[^\n]{0,40}/g)) {
      const s = m[0];
      let key = "その他";
      if (/^\s*#{1,4}\s*Task/.test(s)) key = "見出し (### Task N)";
      else if (/\|\s*Task/.test(s)) key = "表のセル";
      else if (/^\s*[-*]\s*(\*\*)?Task/.test(s)) key = "箇条書き先頭";
      else if (/Task\s*\d+\s*[:：]/.test(s)) key = "地の文 Task N:";
      else if (/TaskCreate|TaskUpdate|TaskList|TaskGet/.test(s)) {
        key = "ツール名の言及";
      } else if (/Task\s*(tool|ツール)/.test(s)) key = "Task ツール";
      ctx.set(key, (ctx.get(key) ?? 0) + 1);
      if (key === "地の文 Task N:" && samples.length < 8) {
        samples.push(s.trim());
      }
    }
  }
}
console.log("Task の出現文脈:");
for (const [k, v] of [...ctx.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(22, "　")} ${v}`);
}
console.log("\n地の文の実例:");
for (const s of samples) console.log(`  ${s}`);
