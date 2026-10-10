import { test } from "bun:test";
import { assert, assertEquals } from "@std/assert";
import { join } from "node:path";
import { run } from "../../../agents/lib/proc.ts";

const lintPath = join(import.meta.dirname, "lint.ts");
const badPath = join(import.meta.dirname, "fixtures/bad.md");

async function runLint(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { code, stdout, stderr } = await run(lintPath, args);
  return { code, stdout, stderr };
}

test("lint.ts: findings があっても exit 0 で、text 形式で出力する", async () => {
  const r = await runLint([badPath]);
  assertEquals(r.code, 0);
  assert(r.stdout.includes(":[warn] workflow_vocab: task —"));
  assert(r.stdout.includes("[info] telegraphic_fragment:"));
});

test("lint.ts: --json は findings 配列と stats を返す", async () => {
  const r = await runLint([badPath, "--json"]);
  assertEquals(r.code, 0);
  const { findings, stats } = JSON.parse(r.stdout);
  assert(Array.isArray(findings));
  const f = findings[0];
  for (const key of ["category", "severity", "line", "matched", "excerpt"]) {
    assert(key in f, `missing key: ${key}`);
  }
  for (const key of ["sentences", "meanSentenceLength", "labelFragmentRatio"]) {
    assert(key in stats, `missing stats key: ${key}`);
  }
});

test("lint.ts: ファイル不在は exit 1", async () => {
  const r = await runLint(["/nonexistent/x.md"]);
  assertEquals(r.code, 1);
  assert(r.stderr.includes("cannot read"));
});

test("lint.ts: ディレクトリ指定は exit 1", async () => {
  const dir = join(import.meta.dirname, "fixtures");
  const r = await runLint([dir]);
  assertEquals(r.code, 1);
  assert(r.stderr.includes("directory"));
});

test("lint.ts: 引数なしは exit 1", async () => {
  const r = await runLint([]);
  assertEquals(r.code, 1);
  assert(r.stderr.includes("usage"));
});
