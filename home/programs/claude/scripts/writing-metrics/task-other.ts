#!/usr/bin/env -S deno run --allow-read --allow-env=HOME
/**
 * task-src.ts の分類から漏れた「Task」出現の残余を分類する。
 * 定型パターン (見出し・表・箇条書き・ツール名) を除いた後に何が残るかを見る補助スクリプト。
 */
const HOME = Deno.env.get("HOME")!;
const samples: string[] = [];
const kinds = new Map<string, number>();
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
      if (
        /^\s*#{1,4}\s*Task|\|\s*Task|^\s*[-*]\s*(\*\*)?Task|Task\s*\d+\s*[:：]|TaskCreate|TaskUpdate|TaskList|TaskGet|Task\s*(tool|ツール)/
          .test(s)
      ) continue;
      let k = "分類不能";
      if (/Task\s*\d+/.test(s)) k = "Task N（コロンなし・文中）";
      else if (/final[- ]?gate|ゲート|gate/i.test(s)) k = "ゲートタスクの言及";
      else if (/タスク/.test(s)) k = "「Task」と「タスク」の併記";
      else if (/blockedBy|pending|completed|in_progress/.test(s)) {
        k = "タスク状態の言及";
      }
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
      if (samples.length < 10 && k === "分類不能") samples.push(s.trim());
    }
  }
}
for (const [k, v] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(30, "　")} ${v}`);
}
console.log("\n分類不能の実例:");
for (const s of samples) console.log(`  ${s}`);
