import { assert, assertEquals } from "jsr:@std/assert@1";

const lintPath = new URL("./lint.ts", import.meta.url).pathname;
const badPath = new URL("./fixtures/bad.md", import.meta.url).pathname;

async function runLint(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-env=HOME", lintPath, ...args],
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

Deno.test("lint.ts: findings があっても exit 0 で、text 形式で出力する", async () => {
  const r = await runLint([badPath]);
  assertEquals(r.code, 0);
  assert(r.stdout.includes(":[warn] workflow_vocab: task —"));
  assert(r.stdout.includes("[info] telegraphic_fragment:"));
});

Deno.test("lint.ts: --json は Finding 配列を返す", async () => {
  const r = await runLint([badPath, "--json"]);
  assertEquals(r.code, 0);
  const findings = JSON.parse(r.stdout);
  assert(Array.isArray(findings));
  const f = findings[0];
  for (const key of ["category", "severity", "line", "matched", "excerpt"]) {
    assert(key in f, `missing key: ${key}`);
  }
});

Deno.test("lint.ts: ファイル不在は exit 1", async () => {
  const r = await runLint(["/nonexistent/x.md"]);
  assertEquals(r.code, 1);
  assert(r.stderr.includes("cannot read"));
});

Deno.test("lint.ts: ディレクトリ指定は exit 1", async () => {
  const dir = new URL("./fixtures", import.meta.url).pathname;
  const r = await runLint([dir]);
  assertEquals(r.code, 1);
  assert(r.stderr.includes("directory"));
});

Deno.test("lint.ts: 引数なしは exit 1", async () => {
  const r = await runLint([]);
  assertEquals(r.code, 1);
  assert(r.stderr.includes("usage"));
});
