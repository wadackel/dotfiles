import { assertEquals } from "jsr:@std/assert";
import { measure, render } from "./comment-metrics.ts";

function diff(file: string, start: number, added: string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${start},0 +${start},${added.length} @@`,
    ...added.map((l) => `+${l}`),
  ].join("\n") + "\n";
}

Deno.test("a seven-line comment block is listed with its start line", () => {
  const m = measure(diff("src/a.ts", 3, [
    "const a = 1;",
    ...Array.from({ length: 7 }, (_, i) => `// line ${i}`),
    "const b = 2;",
  ]));
  assertEquals(m.code, 2);
  assertEquals(m.comment, 7);
  assertEquals(m.blocks, [{ file: "src/a.ts", line: 4, size: 7 }]);
  assertEquals(render(m).split("\n")[3], "  src/a.ts:4 (7 lines)");
});

Deno.test("a shebang is code, a lone comment is not a block", () => {
  const m = measure(
    diff("bin/run.sh", 1, ["#!/usr/bin/env bash", "# one comment", "echo hi"]),
  );
  assertEquals(m.code, 2);
  assertEquals(m.comment, 1);
  assertEquals(m.blocks, []);
  assertEquals(
    render(m),
    "added code lines: 2\nadded comment lines: 1 (50%)\ncomment blocks:\n  none",
  );
});

Deno.test("test files and non-code files are skipped", () => {
  const m = measure(
    diff("src/a_test.ts", 1, ["// x", "// y", "const a = 1;"]) +
      diff("docs/README.md", 1, ["# Heading", "# Another"]) +
      diff("tests/fixtures/b.ts", 1, ["// x", "// y"]),
  );
  assertEquals(m, { code: 0, comment: 0, blocks: [] });
  assertEquals(render(m).split("\n")[1], "added comment lines: 0 (n/a)");
});

Deno.test("two files with hunk offsets report the new-side line of each block", () => {
  const second = [
    "diff --git a/lib/b.rs b/lib/b.rs",
    "--- a/lib/b.rs",
    "+++ b/lib/b.rs",
    "@@ -10,3 +12,6 @@ fn x() {",
    " let a = 1;",
    "+// why not: the obvious call allocates",
    "+// so we reuse the buffer",
    "+let b = 2;",
    " let c = 3;",
    "@@ -30,2 +35,4 @@",
    "+// a",
    "+// b",
    "+// c",
    " let d = 4;",
  ].join("\n") + "\n";
  const m = measure(diff("src/a.go", 5, ["// p", "// q", "x := 1"]) + second);
  assertEquals(m.blocks, [
    { file: "src/a.go", line: 5, size: 2 },
    { file: "lib/b.rs", line: 13, size: 2 },
    { file: "lib/b.rs", line: 35, size: 3 },
  ]);
  assertEquals(m.code, 2);
  assertEquals(m.comment, 7);
});
