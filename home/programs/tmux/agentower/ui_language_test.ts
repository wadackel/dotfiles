import { test } from "bun:test";
import { assertEquals } from "@std/assert";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Every string Agentower draws is English (see AGENTS.md). The conversation
// that asks for a change is usually Japanese, and a label written in it has
// shipped twice. Japanese on screen comes only from the user's own data
// (prompts, task lines), which arrives at run time, never from these sources.
const HERE = import.meta.dirname;
const WRITERS = [
  "../../claude/scripts/claude-pane-status.ts",
  "../../codex/scripts/codex-pane-status.ts",
  "../../opencode/plugin_logic.ts",
];
const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

async function sources(dir: string): Promise<string[]> {
  return (await readdir(dir))
    .filter((name) =>
      /\.tsx?$/.test(name) && !name.endsWith("_test.ts") &&
      !name.includes("_e2e_") && name !== "agentower-bench.ts"
    )
    .map((name) => join(dir, name));
}

test("Agentower sources and the pane-status writers carry no Japanese text", async () => {
  const files = [
    ...await sources(HERE),
    ...await sources(join(HERE, "../shared")),
    ...WRITERS.map((p) => join(HERE, p)),
  ];
  const hits: string[] = [];
  for (const file of files) {
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      if (JAPANESE.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assertEquals(hits, []);
});
