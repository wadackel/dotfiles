import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { test } from "bun:test";
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "../../../lib/proc.ts";

import {
  extractDescription,
  firedBy,
  firedFor,
  firstToolUse,
  parseEvalSet,
  passes,
  replaceDescription,
} from "./measure-trigger.ts";

const SCRIPT = join(import.meta.dirname, "measure-trigger.ts");

const SKILL_MD = `---
name: demo
description: original one-liner.
argument-hint: "[x]"
---

# Demo
`;

const BLOCK_SKILL_MD = `---
name: demo
description: |
  first line.
  Use when: "a", "b".
argument-hint: "[x]"
---

# Demo
`;

test("extractDescription reads a plain scalar", () => {
  assertEquals(extractDescription(SKILL_MD), "original one-liner.");
});

test("extractDescription reads a block scalar", () => {
  assertEquals(
    extractDescription(BLOCK_SKILL_MD),
    'first line.\nUse when: "a", "b".',
  );
});

test("replaceDescription swaps a scalar and keeps sibling keys", () => {
  const next = replaceDescription(SKILL_MD, "candidate.\nsecond line.");
  assertEquals(extractDescription(next), "candidate.\nsecond line.");
  assertStringIncludes(next, 'argument-hint: "[x]"');
  assertStringIncludes(next, "name: demo");
  assertStringIncludes(next, "# Demo");
});

test("replaceDescription swaps a block scalar without eating the next key", () => {
  const next = replaceDescription(BLOCK_SKILL_MD, "shorter.");
  assertEquals(extractDescription(next), "shorter.");
  assertStringIncludes(next, 'argument-hint: "[x]"');
});

test("replaceDescription takes $-sequences literally", () => {
  const candidate = "cost is 100$& and $` and $' and $1";
  const next = replaceDescription(SKILL_MD, candidate);
  assertEquals(extractDescription(next), candidate);
  assertEquals(next.match(/^---$/gm)?.length, 2);
});

test("replaceDescription rejects a file without frontmatter", () => {
  assertThrows(() => replaceDescription("# Demo\n", "x"), Error, "frontmatter");
});

test("parseEvalSet accepts the run_eval shape", () => {
  const items = parseEvalSet('[{"query": "a", "should_trigger": true}]');
  assertEquals(items, [{ query: "a", shouldTrigger: true }]);
});

test("parseEvalSet rejects malformed sets", () => {
  assertThrows(() => parseEvalSet("{"), Error, "valid JSON");
  assertThrows(() => parseEvalSet("[]"), Error, "non-empty array");
  assertThrows(() => parseEvalSet('[{"query": ""}]'), Error, "eval[0]: query");
  assertThrows(() => parseEvalSet('[{"query": "a"}]'), Error, "should_trigger");
});

const assistant = (name: string, skill?: string) =>
  JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name, input: skill ? { skill } : {} }],
    },
  });

test("firstToolUse takes the earliest tool call", () => {
  const stdout = [
    "not json",
    JSON.stringify({ type: "system", subtype: "init" }),
    assistant("Bash", undefined),
    assistant("Skill", "demo"),
  ].join("\n");
  assertEquals(firstToolUse(stdout), { name: "Bash", skill: undefined });
  assertEquals(firedFor(stdout, "demo"), false);
});

test("firedFor matches the target skill only", () => {
  const stdout = assistant("Skill", "demo");
  assertEquals(firedFor(stdout, "demo"), true);
  assertEquals(firedFor(stdout, "other"), false);
});

test("firstToolUse reads the stream_event shape", () => {
  const stdout = JSON.stringify({
    type: "stream_event",
    event: {
      type: "content_block_start",
      content_block: {
        type: "tool_use",
        name: "Skill",
        input: { skill: "demo" },
      },
    },
  });
  assertEquals(firstToolUse(stdout), { name: "Skill", skill: "demo" });
});

test("firedBy is the single verdict the report and the exit code share", () => {
  assertEquals(firedBy({ name: "Skill", skill: "demo" }, "demo"), true);
  assertEquals(firedBy({ name: "Skill", skill: "other" }, "demo"), false);
  assertEquals(firedBy({ name: "Bash" }, "demo"), false);
  assertEquals(firedBy(null, "demo"), false);
});

test("passes takes the majority of runs", () => {
  const row = (shouldTrigger: boolean, fired: number) => ({
    query: "q",
    shouldTrigger,
    runs: 3,
    fired,
    firstTools: [],
  });
  assertEquals(passes(row(true, 2)), true);
  assertEquals(passes(row(true, 1)), false);
  assertEquals(passes(row(false, 1)), true);
  assertEquals(passes(row(false, 2)), false);
});

test("firstToolUse returns null when nothing ran", () => {
  assertEquals(
    firstToolUse(JSON.stringify({ type: "result", result: "hi" })),
    null,
  );
});

type Outcome = { code: number; stdout: string; stderr: string };

// The stub `claude` comes first; bun's own directory is there only so the
// script's shebang resolves under a cleared environment.
const stubPath = (stubDir: string) =>
  `${stubDir}:/usr/bin:/bin:${dirname(process.execPath)}`;

async function runScript(args: string[], stubDir?: string): Promise<Outcome> {
  const out = await run(SCRIPT, args, {
    env: stubDir ? { PATH: stubPath(stubDir) } : undefined,
    clearEnv: stubDir !== undefined,
  });
  return { code: out.code, stdout: out.stdout, stderr: out.stderr };
}

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "measure-trigger-test-"));
  await mkdir(`${dir}/demo`);
  await writeFile(`${dir}/demo/SKILL.md`, SKILL_MD);
  await writeFile(
    `${dir}/eval.json`,
    '[{"query": "hello", "should_trigger": true}]',
  );
  await writeFile(`${dir}/desc.txt`, "candidate description.\n");
  await mkdir(`${dir}/bin`);
  await writeFile(
    `${dir}/bin/claude`,
    `#!/bin/bash\ncat >/dev/null\nsleep "\${STUB_SLEEP:-0}"\necho '${
      assistant("Skill", "demo")
    }'\n`,
  );
  await chmod(`${dir}/bin/claude`, 0o755);
  return dir;
}

test("--help exits 0 with usage", async () => {
  const out = await runScript(["--help"]);
  assertEquals(out.code, 0);
  assertStringIncludes(out.stdout, "--skill=<name|path>");
});

test("a leftover backup blocks the run", async () => {
  const dir = await fixture();
  try {
    await writeFile(
      `${dir}/demo/SKILL.md.measure-trigger.bak`,
      SKILL_MD,
    );
    const out = await runScript([
      `--skill=${dir}/demo`,
      `--eval=${dir}/eval.json`,
      "--runs=1",
    ], `${dir}/bin`);
    assertEquals(out.code, 2);
    assertStringIncludes(out.stderr, "previous run was interrupted");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("a malformed eval set stops before measuring", async () => {
  const dir = await fixture();
  try {
    await writeFile(`${dir}/bad.json`, '[{"query": "a"}]');
    const out = await runScript([
      `--skill=${dir}/demo`,
      `--eval=${dir}/bad.json`,
    ]);
    assertEquals(out.code, 2);
    assertStringIncludes(out.stderr, "should_trigger");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("a measured run restores the description and drops the backup", async () => {
  const dir = await fixture();
  try {
    const out = await runScript(
      [
        `--skill=${dir}/demo`,
        `--eval=${dir}/eval.json`,
        `--description=${dir}/desc.txt`,
        "--runs=1",
      ],
      `${dir}/bin`,
    );
    assertEquals(out.code, 0);
    assertStringIncludes(out.stdout, "1/1");
    assertEquals(await readFile(`${dir}/demo/SKILL.md`, "utf8"), SKILL_MD);
    assertEquals(
      readdirSync(`${dir}/demo`),
      ["SKILL.md"],
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("a query that fires against expectation exits 1", async () => {
  const dir = await fixture();
  try {
    await writeFile(
      `${dir}/neg.json`,
      '[{"query": "hello", "should_trigger": false}]',
    );
    const out = await runScript(
      [`--skill=${dir}/demo`, `--eval=${dir}/neg.json`, "--runs=1"],
      `${dir}/bin`,
    );
    assertEquals(out.code, 1);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("an unknown flag stops before measuring", async () => {
  const dir = await fixture();
  try {
    const out = await runScript(
      [`--skill=${dir}/demo`, `--eval=${dir}/eval.json`, "--run=1"],
      `${dir}/bin`,
    );
    assertEquals(out.code, 2);
    assertStringIncludes(out.stderr, "unknown argument: --run=1");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("a non-integer --runs is rejected", async () => {
  const dir = await fixture();
  try {
    const out = await runScript(
      [`--skill=${dir}/demo`, `--eval=${dir}/eval.json`, "--runs=2.5"],
      `${dir}/bin`,
    );
    assertEquals(out.code, 2);
    assertStringIncludes(out.stderr, "--runs must be an integer");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("SIGINT mid-run restores the description", async () => {
  const dir = await fixture();
  try {
    const child = spawn(SCRIPT, [
      `--skill=${dir}/demo`,
      `--eval=${dir}/eval.json`,
      `--description=${dir}/desc.txt`,
      "--runs=1",
    ], {
      env: { PATH: stubPath(`${dir}/bin`), STUB_SLEEP: "30" },
      stdio: ["inherit", "pipe", "pipe"],
    });
    const exited = new Promise<number | null>((resolve) =>
      child.once("exit", (code) => resolve(code))
    );
    let swappedDuringRun = false;
    for (let i = 0; i < 100 && !swappedDuringRun; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      swappedDuringRun = (await readFile(`${dir}/demo/SKILL.md`, "utf8"))
        .includes("candidate description");
    }
    assert(swappedDuringRun, "the candidate was never written");
    child.kill("SIGINT");
    const code = await exited;
    child.stdout.destroy();
    child.stderr.destroy();
    assertEquals(code, 130);
    assertEquals(await readFile(`${dir}/demo/SKILL.md`, "utf8"), SKILL_MD);
    assertEquals(
      readdirSync(`${dir}/demo`),
      ["SKILL.md"],
    );
  } finally {
    await rm(dir, { recursive: true });
  }
}, 30_000);

test("a bad --runs is rejected before the description is swapped", async () => {
  const dir = await fixture();
  try {
    const out = await runScript(
      [
        `--skill=${dir}/demo`,
        `--eval=${dir}/eval.json`,
        `--description=${dir}/desc.txt`,
        "--runs=0",
      ],
      `${dir}/bin`,
    );
    assertEquals(out.code, 2);
    assertEquals(await readFile(`${dir}/demo/SKILL.md`, "utf8"), SKILL_MD);
    assertEquals(
      readdirSync(`${dir}/demo`),
      ["SKILL.md"],
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});
