#!/usr/bin/env -S deno run --allow-read --allow-env=HOME
/**
 * 和英混在と分量のベースライン。
 * 和文の地の文に混ざる英単語・カタカナ語の密度と、1ユーザーターンあたりの応答総量を実測する。
 * 判定対象は地の文のみ。コードブロック・インラインコードは除外する。
 */

const HOME = Deno.env.get("HOME")!;

const proseOnly = (t: string) =>
  t.replace(/```[\s\S]*?```/g, "\n").replace(/~~~[\s\S]*?~~~/g, "\n").replace(
    /`[^`\n]+`/g,
    "␣",
  );

/** コード識別子・パス・URL らしきものは「正当」として別勘定にする */
function classifyLatin(w: string): "identifier" | "acronym" | "word" {
  if (/[._/]/.test(w)) return "identifier";
  if (/^[a-z]+[A-Z]/.test(w)) return "identifier"; // camelCase
  if (/^[A-Z]{2,}$/.test(w)) return "acronym";
  if (/\d/.test(w)) return "identifier";
  return "word";
}

const latinFreq = new Map<string, number>();
const kataFreq = new Map<string, number>();
const kataRuns: string[] = [];
const mixedSentences: string[] = [];

let responses = 0;
let proseChars = 0;
let jaChars = 0;
let latinWordTokens = 0;
let kataTokens = 0;
let sentences = 0;
let mixedCount = 0;
let heavyMixed = 0;

type LenB = {
  name: string;
  min: number;
  max: number;
  n: number;
  chars: number;
  latin: number;
  kata: number;
};
const lenBuckets: LenB[] = [
  { name: "  ~199字", min: 0, max: 199, n: 0, chars: 0, latin: 0, kata: 0 },
  { name: " 200~999", min: 200, max: 999, n: 0, chars: 0, latin: 0, kata: 0 },
  {
    name: "1000~2999",
    min: 1000,
    max: 2999,
    n: 0,
    chars: 0,
    latin: 0,
    kata: 0,
  },
  {
    name: "3000字~",
    min: 3000,
    max: Infinity,
    n: 0,
    chars: 0,
    latin: 0,
    kata: 0,
  },
];

// 1ユーザーターンあたりの応答総量
const turnTotals: number[] = [];

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
  let turnAccum = 0;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.isSidechain) continue;

    if (r.type === "user") {
      // tool_result も type: "user" で記録されるため、これを境界に含めると
      // ツール呼び出しのたびにターンが分割され分量が大幅に過小になる (実測で user レコードの約9割が tool_result)
      const c = (r.message as { content?: unknown })?.content;
      if (
        Array.isArray(c) &&
        c.some((b) => (b as { type?: string })?.type === "tool_result")
      ) {
        continue;
      }
      if (turnAccum > 0) turnTotals.push(turnAccum);
      turnAccum = 0;
      continue;
    }
    if (r.type !== "assistant") continue;
    const blocks =
      (r.message as { content?: Array<{ type: string; text?: string }> })
        ?.content;
    if (!Array.isArray(blocks)) continue;
    const raw = blocks.filter((b) => b.type === "text" && b.text).map((b) =>
      b.text!
    ).join("\n").trim();
    if (raw.length < 20) continue;

    turnAccum += raw.length;
    responses++;
    const prose = proseOnly(raw);
    proseChars += prose.length;
    jaChars += (prose.match(/[぀-ヿ一-鿿]/g) ?? []).length;

    const bucket = lenBuckets.find((b) =>
      raw.length >= b.min && raw.length <= b.max
    )!;
    bucket.n++;
    bucket.chars += prose.length;

    // ラテン文字語
    for (const m of prose.matchAll(/[A-Za-z][A-Za-z0-9_.\-/]*/g)) {
      const w = m[0].replace(/[.\-/]+$/, "");
      if (w.length < 3) continue;
      const kind = classifyLatin(w);
      if (kind !== "word") continue;
      latinWordTokens++;
      bucket.latin++;
      const key = w.toLowerCase();
      latinFreq.set(key, (latinFreq.get(key) ?? 0) + 1);
    }

    // カタカナ語
    for (const m of prose.matchAll(/[ァ-ヺー]{3,}/g)) {
      kataTokens++;
      bucket.kata++;
      kataFreq.set(m[0], (kataFreq.get(m[0]) ?? 0) + 1);
    }
    // カタカナ語の3連続（中黒や助詞なしの連結を含む）
    for (const m of prose.matchAll(/(?:[ァ-ヺー]{2,}[・\s]?){3,}/g)) {
      if (kataRuns.length < 20 && m[0].length >= 10) kataRuns.push(m[0].trim());
    }

    // 文単位で和英混在を判定
    for (const s of prose.split(/(?<=[。．！？\n])/)) {
      const t = s.trim();
      if (t.length < 15) continue;
      if (!/[぀-ヿ一-鿿]/.test(t)) continue; // 和文でない行は対象外
      sentences++;
      const latin = [...t.matchAll(/[A-Za-z][A-Za-z0-9_.\-/]*/g)]
        .map((m) => m[0])
        .filter((w) => w.length >= 3 && classifyLatin(w) === "word");
      if (latin.length >= 1) mixedCount++;
      if (latin.length >= 3) {
        heavyMixed++;
        if (mixedSentences.length < 12) {
          mixedSentences.push(t.replace(/\s+/g, " ").slice(0, 150));
        }
      }
    }
  }
  if (turnAccum > 0) turnTotals.push(turnAccum);
}

const p = (arr: number[], q: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * q))] ?? 0;
};
const per1k = (n: number, c: number) => ((n / c) * 1000).toFixed(2);

console.log(`# 和英混在と分量のベースライン（メイン対話 / 地の文のみ）\n`);
console.log(
  `応答数 ${responses}  地の文 ${proseChars.toLocaleString()}字  うち日本語文字 ${
    ((jaChars / proseChars) * 100).toFixed(1)
  }%`,
);

console.log(`\n## 分量`);
console.log(`1ユーザーターンあたりの応答総量  n=${turnTotals.length}`);
console.log(
  `  p50=${p(turnTotals, 0.5)}字  p75=${p(turnTotals, 0.75)}字  p90=${
    p(turnTotals, 0.9)
  }字  p99=${p(turnTotals, 0.99)}字  max=${p(turnTotals, 1)}字`,
);
const readMin = (n: number) => (n / 500).toFixed(1);
console.log(
  `  読了目安(500字/分)  p50=${readMin(p(turnTotals, 0.5))}分  p90=${
    readMin(p(turnTotals, 0.9))
  }分  p99=${readMin(p(turnTotals, 0.99))}分`,
);
const over3k = turnTotals.filter((x) => x >= 3000).length;
const over6k = turnTotals.filter((x) => x >= 6000).length;
console.log(
  `  3000字以上のターン: ${over3k}件 (${
    ((over3k / turnTotals.length) * 100).toFixed(1)
  }%)`,
);
console.log(
  `  6000字以上のターン: ${over6k}件 (${
    ((over6k / turnTotals.length) * 100).toFixed(1)
  }%)`,
);

console.log(`\n## 和英混在`);
console.log(`和文の文: ${sentences}`);
console.log(
  `  英単語を1語以上含む文: ${mixedCount} (${
    ((mixedCount / sentences) * 100).toFixed(1)
  }%)`,
);
console.log(
  `  英単語を3語以上含む文: ${heavyMixed} (${
    ((heavyMixed / sentences) * 100).toFixed(1)
  }%)`,
);
console.log(
  `英単語トークン密度: ${
    per1k(latinWordTokens, proseChars)
  }/1000字  (計 ${latinWordTokens})`,
);
console.log(
  `カタカナ語トークン密度: ${
    per1k(kataTokens, proseChars)
  }/1000字  (計 ${kataTokens})`,
);

console.log(`\n## 応答長別の混在密度（/1000字）`);
console.log(`区分        応答数   英単語  カタカナ`);
for (const b of lenBuckets) {
  console.log(
    `${b.name.padEnd(10)} ${String(b.n).padStart(5)}  ${
      per1k(b.latin, b.chars).padStart(7)
    }  ${per1k(b.kata, b.chars).padStart(8)}`,
  );
}

console.log(
  `\n## 和文に混ざる英単語 上位40（コード識別子・略語・数字入りは除外済み）`,
);
const lf = [...latinFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
for (let i = 0; i < lf.length; i += 4) {
  console.log(
    "  " + lf.slice(i, i + 4).map(([w, n]) => `${w}(${n})`.padEnd(22)).join(""),
  );
}

console.log(`\n## カタカナ語 上位40`);
const kf = [...kataFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
for (let i = 0; i < kf.length; i += 4) {
  console.log(
    "  " + kf.slice(i, i + 4).map(([w, n]) => `${w}(${n})`.padEnd(22)).join(""),
  );
}

console.log(`\n## カタカナ語の連続（3語以上）`);
for (const r of kataRuns.slice(0, 10)) console.log(`  ${r}`);

console.log(`\n## 英単語3語以上を含む文の実例`);
for (const s of mixedSentences.slice(0, 10)) console.log(`  ${s}`);
