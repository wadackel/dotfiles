import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";

import {
  extractDescription,
  firedBy,
  firedFor,
  firstToolUse,
  parseEvalSet,
  passes,
  replaceDescription,
} from "./measure-trigger.ts";

const SCRIPT = new URL("./measure-trigger.ts", import.meta.url).pathname;

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

Deno.test("extractDescription reads a plain scalar", () => {
  assertEquals(extractDescription(SKILL_MD), "original one-liner.");
});

Deno.test("extractDescription reads a block scalar", () => {
  assertEquals(
    extractDescription(BLOCK_SKILL_MD),
    'first line.\nUse when: "a", "b".',
  );
});

Deno.test("replaceDescription swaps a scalar and keeps sibling keys", () => {
  const next = replaceDescription(SKILL_MD, "candidate.\nsecond line.");
  assertEquals(extractDescription(next), "candidate.\nsecond line.");
  assertStringIncludes(next, 'argument-hint: "[x]"');
  assertStringIncludes(next, "name: demo");
  assertStringIncludes(next, "# Demo");
});

Deno.test("replaceDescription swaps a block scalar without eating the next key", () => {
  const next = replaceDescription(BLOCK_SKILL_MD, "shorter.");
  assertEquals(extractDescription(next), "shorter.");
  assertStringIncludes(next, 'argument-hint: "[x]"');
});

Deno.test("replaceDescription takes $-sequences literally", () => {
  const candidate = "cost is 100$& and $` and $' and $1";
  const next = replaceDescription(SKILL_MD, candidate);
  assertEquals(extractDescription(next), candidate);
  assertEquals(next.match(/^---$/gm)?.length, 2);
});

Deno.test("replaceDescription rejects a file without frontmatter", () => {
  assertThrows(() => replaceDescription("# Demo\n", "x"), Error, "frontmatter");
});

Deno.test("parseEvalSet accepts the run_eval shape", () => {
  const items = parseEvalSet('[{"query": "a", "should_trigger": true}]');
  assertEquals(items, [{ query: "a", shouldTrigger: true }]);
});

Deno.test("parseEvalSet rejects malformed sets", () => {
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

Deno.test("firstToolUse takes the earliest tool call", () => {
  const stdout = [
    "not json",
    JSON.stringify({ type: "system", subtype: "init" }),
    assistant("Bash", undefined),
    assistant("Skill", "demo"),
  ].join("\n");
  assertEquals(firstToolUse(stdout), { name: "Bash", skill: undefined });
  assertEquals(firedFor(stdout, "demo"), false);
});

Deno.test("firedFor matches the target skill only", () => {
  const stdout = assistant("Skill", "demo");
  assertEquals(firedFor(stdout, "demo"), true);
  assertEquals(firedFor(stdout, "other"), false);
});

Deno.test("firstToolUse reads the stream_event shape", () => {
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

Deno.test("firedBy is the single verdict the report and the exit code share", () => {
  assertEquals(firedBy({ name: "Skill", skill: "demo" }, "demo"), true);
  assertEquals(firedBy({ name: "Skill", skill: "other" }, "demo"), false);
  assertEquals(firedBy({ name: "Bash" }, "demo"), false);
  assertEquals(firedBy(null, "demo"), false);
});

Deno.test("passes takes the majority of runs", () => {
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

Deno.test("firstToolUse returns null when nothing ran", () => {
  assertEquals(
    firstToolUse(JSON.stringify({ type: "result", result: "hi" })),
    null,
  );
});

type Outcome = { code: number; stdout: string; stderr: string };

async function runScript(args: string[], stubDir?: string): Promise<Outcome> {
  const out = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env=HOME",
      "--allow-run=claude",
      "--no-prompt",
      SCRIPT,
      ...args,
    ],
    env: stubDir ? { PATH: `${stubDir}:/usr/bin:/bin` } : undefined,
    clearEnv: stubDir !== undefined,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

async function fixture(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "measure-trigger-test-" });
  await Deno.mkdir(`${dir}/demo`);
  await Deno.writeTextFile(`${dir}/demo/SKILL.md`, SKILL_MD);
  await Deno.writeTextFile(
    `${dir}/eval.json`,
    '[{"query": "hello", "should_trigger": true}]',
  );
  await Deno.writeTextFile(`${dir}/desc.txt`, "candidate description.\n");
  await Deno.mkdir(`${dir}/bin`);
  await Deno.writeTextFile(
    `${dir}/bin/claude`,
    `#!/bin/bash\ncat >/dev/null\nsleep "\${STUB_SLEEP:-0}"\necho '${
      assistant("Skill", "demo")
    }'\n`,
  );
  await Deno.chmod(`${dir}/bin/claude`, 0o755);
  return dir;
}

Deno.test("--help exits 0 with usage", async () => {
  const out = await runScript(["--help"]);
  assertEquals(out.code, 0);
  assertStringIncludes(out.stdout, "--skill=<name|path>");
});

Deno.test("a leftover backup blocks the run", async () => {
  const dir = await fixture();
  try {
    await Deno.writeTextFile(
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
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a malformed eval set stops before measuring", async () => {
  const dir = await fixture();
  try {
    await Deno.writeTextFile(`${dir}/bad.json`, '[{"query": "a"}]');
    const out = await runScript([
      `--skill=${dir}/demo`,
      `--eval=${dir}/bad.json`,
    ]);
    assertEquals(out.code, 2);
    assertStringIncludes(out.stderr, "should_trigger");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a measured run restores the description and drops the backup", async () => {
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
    assertEquals(await Deno.readTextFile(`${dir}/demo/SKILL.md`), SKILL_MD);
    assertEquals(
      [...Deno.readDirSync(`${dir}/demo`)].map((e) => e.name),
      ["SKILL.md"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a query that fires against expectation exits 1", async () => {
  const dir = await fixture();
  try {
    await Deno.writeTextFile(
      `${dir}/neg.json`,
      '[{"query": "hello", "should_trigger": false}]',
    );
    const out = await runScript(
      [`--skill=${dir}/demo`, `--eval=${dir}/neg.json`, "--runs=1"],
      `${dir}/bin`,
    );
    assertEquals(out.code, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an unknown flag stops before measuring", async () => {
  const dir = await fixture();
  try {
    const out = await runScript(
      [`--skill=${dir}/demo`, `--eval=${dir}/eval.json`, "--run=1"],
      `${dir}/bin`,
    );
    assertEquals(out.code, 2);
    assertStringIncludes(out.stderr, "unknown argument: --run=1");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a non-integer --runs is rejected", async () => {
  const dir = await fixture();
  try {
    const out = await runScript(
      [`--skill=${dir}/demo`, `--eval=${dir}/eval.json`, "--runs=2.5"],
      `${dir}/bin`,
    );
    assertEquals(out.code, 2);
    assertStringIncludes(out.stderr, "--runs must be an integer");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("SIGINT mid-run restores the description", async () => {
  const dir = await fixture();
  try {
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env=HOME",
        "--allow-run=claude",
        "--no-prompt",
        SCRIPT,
        `--skill=${dir}/demo`,
        `--eval=${dir}/eval.json`,
        `--description=${dir}/desc.txt`,
        "--runs=1",
      ],
      env: { PATH: `${dir}/bin:/usr/bin:/bin`, STUB_SLEEP: "30" },
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    let swappedDuringRun = false;
    for (let i = 0; i < 100 && !swappedDuringRun; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      swappedDuringRun = (await Deno.readTextFile(`${dir}/demo/SKILL.md`))
        .includes("candidate description");
    }
    assert(swappedDuringRun, "the candidate was never written");
    child.kill("SIGINT");
    const status = await child.status;
    await child.stdout.cancel();
    await child.stderr.cancel();
    assertEquals(status.code, 130);
    assertEquals(await Deno.readTextFile(`${dir}/demo/SKILL.md`), SKILL_MD);
    assertEquals(
      [...Deno.readDirSync(`${dir}/demo`)].map((e) => e.name),
      ["SKILL.md"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a bad --runs is rejected before the description is swapped", async () => {
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
    assertEquals(await Deno.readTextFile(`${dir}/demo/SKILL.md`), SKILL_MD);
    assertEquals(
      [...Deno.readDirSync(`${dir}/demo`)].map((e) => e.name),
      ["SKILL.md"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
