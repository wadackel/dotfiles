#!/usr/bin/env -S deno run --allow-read --allow-env=HOME
/**
 * 対話履歴から「そのターンの agent テキスト全体 → 次のユーザー発話」の組を作り、
 * 次の発話が直前の出力への聞き返し（分かりやすく / どういう意味 / 何をしたら /
 * 具体的に / 短い疑問 / 整理して / わからない）かを和文の正規表現で拾う。
 * 正規表現は粗い（人手判定の約 2 倍を拾う）ので、率は傾向、判定は `--list` の
 * 候補を人手で分類 1〜4（状態不明 / 決定埋没 / 参照語未定義 / 工程混入）に
 * 仕分けて行う。比較対象は reask-baseline.md。
 *
 * 使い方:
 *   reask-rate.ts [--from YYYY-MM-DD] [--root <dir>] [--list]
 *
 * `--from` は指定日の 00:00（+09:00 固定）以降のユーザー発話を含む。
 * `--root` の既定は `$HOME/.claude/projects`。
 */

export type Category =
  | "short-q"
  | "confusion"
  | "meaning"
  | "what-next"
  | "explain"
  | "concrete"
  | "summarize";

// 順序は優先順位。短い疑問と「わからない」を先に取り、`summarize` は最後
const CATEGORIES: [Category, RegExp][] = [
  ["short-q", /^.{0,8}[?？]$/],
  [
    "confusion",
    /わからない|分からない|わからん|ついていけ|混乱|複雑すぎ|長すぎ|読みにくい|読みづらい|把握でき/,
  ],
  [
    "meaning",
    /どういうこと|どういう意味|つまり|要するに|意味が|理解でき|なにそれ|何それ|というと|ってこと[?？]/,
  ],
  [
    "what-next",
    /何をしたら|何をすれば|どうすれば|どうしたら|次は何|何をする|何をやれば|どれを選|どっち|どちらが|どちらを|何が良い|何がいい|おすすめは|どうするのが|どうするべき|どうすべき|どうしよう|何がおすすめ/,
  ],
  [
    "explain",
    /わかりやす|分かりやす|もう少し詳しく|詳しく説明|詳しく教えて|解説して|噛み砕|説明して|補足して|説明が欲しい/,
  ],
  ["concrete", /具体的に|例えば|例を|具体例/],
  // `まとめて` `簡潔に` は新規タスクの依頼（「PR にまとめて」）に多く当たるため外した
  ["summarize", /整理して|端的に|結論は|一言で|要点は/],
];

export function classifyReask(text: string): Category | null {
  const t = text.trim();
  for (const [category, re] of CATEGORIES) {
    if (re.test(t)) return category;
  }
  return null;
}

// コマンド展開、中断マーカー、memo 要約、headless probe の定型、cross-session と
// システム通知はユーザーの発話ではない
function isNoise(text: string): boolean {
  const s = text.trim();
  return s.startsWith("<") || s.startsWith("[Request interrupted") ||
    s.includes("以下はClaude Codeセッションの要約データ") ||
    s === "STYLE-CHECK" ||
    /^Answer (only|yes\/no|in one line)/.test(s) ||
    /^Use the Read tool/.test(s) ||
    /^Run this exact shell command/.test(s) ||
    /^Dispatch one subagent/.test(s) ||
    /^You are performing step/.test(s) ||
    /^Reply with exactly/.test(s) ||
    s.startsWith("Another Claude session sent") || s.startsWith("[SYSTEM");
}

export type Pair = {
  session: string;
  ts: string;
  user: string;
  category: Category | null;
  replyChars: number;
  replyEndsWithQuestion: boolean;
};

function userText(r: Record<string, unknown>): string | null {
  const m = r.message as { content?: unknown } | undefined;
  if (r.type !== "user" || !m) return null;
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    if (
      m.content.some((b) =>
        b && typeof b === "object" &&
        (b as { type?: unknown }).type === "tool_result"
      )
    ) return null;
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

function assistantText(r: Record<string, unknown>): string | null {
  if (r.type !== "assistant") return null;
  const blocks =
    (r.message as { content?: Array<{ type: string; text?: string }> })
      ?.content;
  if (!Array.isArray(blocks)) return null;
  const text = blocks.filter((b) => b.type === "text" && b.text).map((b) =>
    b.text!
  ).join("\n");
  return text.trim() ? text : null;
}

/** 1 transcript から組を作る。session は basename の先頭 8 文字。 */
export function collectPairs(
  content: string,
  session: string,
  fromMs: number,
): Pair[] {
  const pairs: Pair[] = [];
  let buf: string[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.isSidechain) continue;
    if (r.type === "user" && r.isMeta) continue;
    const a = assistantText(r);
    if (a !== null) {
      buf.push(a);
      continue;
    }
    const u = userText(r);
    if (u === null) continue;
    if (isNoise(u)) continue;
    if (buf.length) {
      const reply = buf.join("\n\n");
      const lines = reply.split("\n").filter((l) => l.trim());
      const last = lines[lines.length - 1] ?? "";
      const ts = String(r.timestamp ?? "");
      const ms = Date.parse(ts);
      if (!Number.isNaN(ms) && ms >= fromMs) {
        pairs.push({
          session,
          ts,
          user: u.trim(),
          category: classifyReask(u),
          replyChars: reply.length,
          replyEndsWithQuestion: /[?？]\s*$/.test(last),
        });
      }
    }
    buf = [];
  }
  return pairs;
}

const BANDS: [number, number][] = [[0, 300], [300, 800], [800, 1600], [
  1600,
  3200,
], [3200, Infinity]];

function pct(part: number, whole: number): string {
  return whole ? (part / whole * 100).toFixed(1) : "0.0";
}

function fail(msg: string): never {
  console.error(`reask-rate.ts: ${msg}`);
  Deno.exit(1);
}

// transcript は 30 日でローテーションされ、走査中にディレクトリごと消えることがある
async function* files(dir: string): AsyncGenerator<string> {
  let entries: Deno.DirEntry[];
  try {
    entries = await Array.fromAsync(Deno.readDir(dir));
  } catch {
    return;
  }
  for (const e of entries) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) {
      if (e.name === "subagents") continue;
      yield* files(p);
    } else if (e.name.endsWith(".jsonl")) yield p;
  }
}

/** `--from` と同じ +09:00 で日付を出す。UTC のままだと窓の境界と表示がずれる */
function jstDate(ts: string): string {
  const ms = Date.parse(ts);
  return Number.isNaN(ms)
    ? ts.slice(0, 10)
    : new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

if (import.meta.main) {
  const usage =
    "usage: reask-rate.ts [--from YYYY-MM-DD] [--root <dir>] [--list]";
  let fromMs = -Infinity;
  let root = `${Deno.env.get("HOME")}/.claude/projects`;
  let list = false;
  const args = [...Deno.args];
  while (args.length) {
    const a = args.shift()!;
    if (a === "--list") list = true;
    else if (a === "--from") {
      const v = args.shift();
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        fail(`--from は YYYY-MM-DD 形式で指定する（got: ${v ?? "なし"}）`);
      }
      const ms = Date.parse(`${v}T00:00:00+09:00`);
      if (Number.isNaN(ms)) fail(`--from の日付が不正: ${v}`);
      fromMs = ms;
    } else if (a === "--root") {
      const v = args.shift();
      if (!v) fail(`--root にはディレクトリを指定する（${usage}）`);
      root = v;
    } else fail(`未知の引数: ${a}（${usage}）`);
  }
  let rootStat: Deno.FileInfo;
  try {
    rootStat = await Deno.stat(root);
  } catch (e) {
    fail(
      e instanceof Deno.errors.NotFound
        ? `--root が存在しない: ${root}`
        : `--root を読めない: ${root} (${e instanceof Error ? e.message : e})`,
    );
  }
  if (!rootStat.isDirectory) fail(`--root はディレクトリではない: ${root}`);

  const pairs: Pair[] = [];
  for await (const path of files(root)) {
    let content: string;
    try {
      content = await Deno.readTextFile(path);
    } catch {
      continue;
    }
    const session = path.slice(path.lastIndexOf("/") + 1, -".jsonl".length)
      .slice(0, 8);
    pairs.push(...collectPairs(content, session, fromMs));
  }

  if (list) {
    for (
      const p of pairs.filter((p) => p.category).sort((a, b) =>
        a.ts.localeCompare(b.ts)
      )
    ) {
      const head = p.user.replace(/\s+/g, " ").slice(0, 80);
      console.log(
        `${
          jstDate(p.ts)
        } ${p.session} [${p.category}] ${p.replyChars}字 | ${head}`,
      );
    }
    Deno.exit(0);
  }

  const reask = pairs.filter((p) => p.category);
  console.log(
    `対象: ${pairs.length} 組、聞き返し（粗集合）${reask.length} 件（${
      pct(reask.length, pairs.length)
    }%）`,
  );
  const endsWithQuestion = pairs.filter((p) => p.replyEndsWithQuestion).length;
  console.log(
    `末尾が質問で終わる組: ${endsWithQuestion} 件（${
      pct(endsWithQuestion, pairs.length)
    }%）`,
  );
  console.log("\n分類別（粗集合）");
  for (const [c] of CATEGORIES) {
    console.log(
      `${c.padEnd(10)} ${reask.filter((p) => p.category === c).length}`,
    );
  }
  console.log("\n長さ帯別（agent テキスト字数 / 組数 / 聞き返し率、傾向参照）");
  for (const [lo, hi] of BANDS) {
    const g = pairs.filter((p) => p.replyChars >= lo && p.replyChars < hi);
    const label = `${lo}-${hi === Infinity ? "" : hi}`;
    console.log(
      `${label.padEnd(10)} ${String(g.length).padStart(5)} / ${
        pct(g.filter((p) => p.category).length, g.length).padStart(5)
      }%`,
    );
  }
}
