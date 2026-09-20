import { assert, assertEquals } from "jsr:@std/assert@1";
import { classifyReask, collectPairs } from "./reask-rate.ts";

const scriptPath = new URL("./reask-rate.ts", import.meta.url).pathname;

async function run(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-env=HOME", scriptPath, ...args],
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

function user(text: string, ts: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "user",
    timestamp: ts,
    message: { role: "user", content: text },
    ...extra,
  });
}
function assistant(text: string, ts: string) {
  return JSON.stringify({
    type: "assistant",
    timestamp: ts,
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}
function toolResult(ts: string) {
  return JSON.stringify({
    type: "user",
    timestamp: ts,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
    },
  });
}

// 聞き返し 2 組（explain, what-next）、通常 3 組。間に tool_result / isMeta /
// コマンド展開 / 改行入り発話を挟む
const FIXTURE = [
  user("最初の依頼です", "2026-09-01T00:00:00.000Z"),
  assistant("調べます。", "2026-09-01T00:00:01.000Z"),
  toolResult("2026-09-01T00:00:02.000Z"),
  assistant("結果は A です。B も候補です。", "2026-09-01T00:00:03.000Z"),
  user("ここをもう少し\n分かりやすく説明して", "2026-09-01T00:01:00.000Z"),
  assistant("A は …。", "2026-09-01T00:01:05.000Z"),
  user("<command-name>/model</command-name>", "2026-09-01T00:01:06.000Z"),
  user("skill body", "2026-09-01T00:01:07.000Z", { isMeta: true }),
  user("ありがとう。次は何をしたらいい？", "2026-09-01T00:02:00.000Z"),
  assistant("C を進めますか？", "2026-09-01T00:02:05.000Z"),
  user("進めて", "2026-09-02T00:00:00.000Z"),
  assistant("進めました。", "2026-09-02T00:00:05.000Z"),
  user("PR にまとめて", "2026-09-02T00:01:00.000Z"),
  assistant("PR を作りました。", "2026-09-02T00:01:05.000Z"),
  user("簡潔にコミットして", "2026-09-02T00:02:00.000Z"),
].join("\n") + "\n";

Deno.test("classifyReask: 7 分類の代表例", () => {
  assertEquals(classifyReask("状況はどう？"), "short-q");
  assertEquals(classifyReask("ちょっと返答が長すぎてわからない"), "confusion");
  assertEquals(classifyReask("サービスを止めるってどういう意味？"), "meaning");
  assertEquals(
    classifyReask("実機で検証したいのだけど何をしたらいい？"),
    "what-next",
  );
  assertEquals(
    classifyReask("ここまでの結果を分かりやすく整理して"),
    "explain",
  );
  assertEquals(classifyReask("具体的にどのディレクトリ？"), "concrete");
  assertEquals(classifyReask("検証観点を整理して"), "summarize");
});

Deno.test("classifyReask: まとめて / 簡潔に だけの発話は拾わない", () => {
  assertEquals(classifyReask("PR にまとめて"), null);
  assertEquals(classifyReask("簡潔にコミットして"), null);
  assertEquals(classifyReask("進めて"), null);
});

Deno.test("collectPairs: 組の境界と除外", () => {
  const pairs = collectPairs(FIXTURE, "sess-1", -Infinity);
  assertEquals(pairs.length, 5);
  assertEquals(pairs.map((p) => p.category), [
    "explain",
    "what-next",
    null,
    null,
    null,
  ]);
  // tool_result をまたいだ assistant テキストは 1 組に連結される
  assertEquals(
    pairs[0].replyChars,
    "調べます。\n\n結果は A です。B も候補です。".length,
  );
  assert(pairs[1].replyEndsWithQuestion === false);
  assert(pairs[2].replyEndsWithQuestion === true);
});

async function withFixture<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await Deno.makeTempDir({ prefix: "reask-rate-" });
  try {
    await Deno.mkdir(`${root}/proj-a`);
    await Deno.writeTextFile(`${root}/proj-a/sess-1234abcd.jsonl`, FIXTURE);
    return await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("CLI: --list は聞き返し 1 組 1 行で、改行は空白になる", async () => {
  await withFixture(async (root) => {
    const r = await run(["--root", root, "--list"]);
    assertEquals(r.code, 0, r.stderr);
    const lines = r.stdout.trim().split("\n");
    assertEquals(lines.length, 2);
    assert(lines[0].startsWith("2026-09-01 sess-123 [explain]"), lines[0]);
    assert(lines[0].includes("ここをもう少し 分かりやすく説明して"), lines[0]);
    assert(lines[1].includes("[what-next]"), lines[1]);
  });
});

Deno.test("CLI: --from で境界前の組が落ちる", async () => {
  await withFixture(async (root) => {
    const r = await run(["--root", root, "--from", "2026-09-02"]);
    assertEquals(r.code, 0, r.stderr);
    assert(r.stdout.includes("対象: 3 組、聞き返し（粗集合）0 件"), r.stdout);
    const all = await run(["--root", root]);
    assert(
      all.stdout.includes("対象: 5 組、聞き返し（粗集合）2 件（40.0%）"),
      all.stdout,
    );
    assert(all.stdout.includes("末尾が質問で終わる組: 1 件"), all.stdout);
  });
});

Deno.test("CLI: 存在しない --root は exit 1 で stderr にパス", async () => {
  const r = await run(["--root", "/nonexistent/reask-root"]);
  assertEquals(r.code, 1);
  assert(r.stderr.includes("/nonexistent/reask-root"), r.stderr);
});

Deno.test("CLI: 未知の引数は exit 1", async () => {
  const r = await run(["--bogus"]);
  assertEquals(r.code, 1);
  assert(r.stderr.includes("usage"), r.stderr);
});
