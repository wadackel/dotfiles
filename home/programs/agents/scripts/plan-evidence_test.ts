import { test } from "bun:test";
import { assertEquals, assertRejects } from "@std/assert";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as runCommand } from "../lib/proc.ts";
import { run } from "./plan-state.ts";

const REAL_HOME = process.env.HOME!;

const input = (value: unknown) => new Blob([JSON.stringify(value)]).stream();

async function fixture(test: (path: string) => Promise<void>) {
  const previous = { cwd: process.cwd(), home: process.env.HOME! };
  const temp = await mkdtemp(join(tmpdir(), "plan-evidence-"));
  try {
    process.env.HOME = temp;
    await mkdir(`${temp}/.codex/plans`, { recursive: true });
    await mkdir(`${temp}/.claude`, { recursive: true });
    // The helper's own argv guard reads HOME's settings whenever they exist;
    // the test argv is Bun itself, plus the path the ENOENT test starts.
    await writeFile(
      `${temp}/.claude/settings.json`,
      JSON.stringify({
        permissions: {
          allow: [`Bash(${process.execPath} *)`, "Bash(/nonexistent/*)"],
          deny: ["Bash(git push -f origin main)"],
        },
      }),
    );
    await mkdir(`${temp}/repo`);
    process.chdir(`${temp}/repo`);
    for (
      const args of [
        ["init", "-q"],
        ["config", "user.email", "test@example.invalid"],
        ["config", "user.name", "Test"],
      ]
    ) {
      const result = await runCommand("git", args);
      assertEquals(result.code, 0);
    }
    await writeFile("main.txt", "initial\n");
    await runCommand("git", ["add", "."]);
    await runCommand("git", ["commit", "-qm", "initial"]);
    const path = `${temp}/.codex/plans/plan.evidence.json`;
    await writeFile(
      `${temp}/.codex/plans/plan.md`,
      "Acceptance: main works\n",
    );
    await run([
      "init",
      path,
      "plan.md",
      JSON.stringify(["Behavior", "Final Audit + Review"]),
    ]);
    await run(["start", path, "task-1"]);
    await test(path);
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.HOME;
    else process.env.HOME = previous.home;
    await rm(temp, { recursive: true });
  }
}

async function target(path: string): Promise<string> {
  const { snapshot } = await import("./plan-evidence.ts");
  return await snapshot(path, JSON.parse(await readFile(path, "utf8")));
}

async function declare(path: string, task = "task-1", kind = "file-state") {
  await run(
    ["require", path, task],
    input([{
      id: "behavior",
      kind,
      ...(kind === "live" ? { expected: { git_head: true } } : {}),
    }]),
  );
}

async function record(path: string, overrides = {}, task = "task-1") {
  const id = (overrides as { id?: string }).id;
  const output = id === "audit"
    ? "AUDIT_VERDICT: PASS"
    : id === "generic"
    ? "### MUST_FIX\n- None\nVERDICT: PASS"
    : "initial";
  await run(
    ["record", path, task],
    input({
      id: "behavior",
      status: "pass",
      target: await target(path),
      command: "read main.txt",
      output,
      ...overrides,
    }),
  );
}

test("completion rejects missing verification and preserves legacy evidence", async () => {
  await fixture(async (path) => {
    await run(
      ["append-evidence", path, "task-1"],
      new Blob(["old PASS"]).stream(),
    );
    await assertRejects(
      () => run(["complete", path, "task-1"]),
      Error,
      "required checks",
    );
    assertEquals(
      JSON.parse(await readFile(path, "utf8")).tasks[0].evidence,
      "old PASS",
    );
  });
});

test("non-empty low-risk work completes with explicit main-session review evidence", async () => {
  await fixture(async (path) => {
    await writeFile("main.txt", "corrected prose\n");
    await declare(path);
    const observed = await readFile("main.txt", "utf8");
    assertEquals(observed, "corrected prose\n");
    await record(path, { output: observed });
    await run(["complete", path, "task-1"]);
    await run(["start", path, "task-2"]);
    await run(
      ["require", path, "task-2"],
      input([
        { id: "audit", kind: "audit" },
        { id: "main-review", kind: "review" },
      ]),
    );
    await record(path, { id: "audit" }, "task-2");
    await assertRejects(
      () => run(["complete", path, "task-2"]),
      Error,
      "missing verification",
    );
    const output =
      "Review executor: main session\nArea: SPEC|QUALITY\n### MUST_FIX\n- None\nVERDICT: PASS";
    await record(path, {
      id: "main-review",
      command: "main-session review of the prose correction",
      output,
    }, "task-2");
    await run(["complete", path, "task-2"]);
    const final = JSON.parse(await readFile(path, "utf8")).tasks[1];
    assertEquals(final.status, "completed");
    assertEquals(final.checks.at(-1).id, "main-review");
    assertEquals(final.checks.at(-1).output, output);
  });
});

test("content, untracked, mode, symlink and plan changes invalidate a PASS; commit and stage do not", async () => {
  await fixture(async (path) => {
    await declare(path);
    await record(path);
    await run(["complete", path, "task-1"]);
    for (
      const change of [
        () => writeFile("main.txt", "changed\n"),
        () => writeFile("new.txt", "new\n"),
        () => chmod("new.txt", 0o755),
        () => rm("new.txt"),
        () =>
          writeFile(
            path.replace(".evidence.json", ".md"),
            "new acceptance\n",
          ),
        () => chmod("main.txt", 0o755),
        async () => {
          await writeFile("ita.txt", "intended\n");
          await runCommand("git", ["add", "-N", "ita.txt"]);
        },
        () => writeFile("ita.txt", "intended later\n"),
        () => symlink("ita.txt", "link.txt"),
        () => rm("main.txt"),
      ]
    ) {
      const before = await target(path);
      await change();
      assertEquals(await target(path) === before, false);
      await assertRejects(
        () => run(["complete", path, "task-1"]),
        Error,
        "stale",
      );
      await record(path);
      await run(["complete", path, "task-1"]);
    }
    const before = await target(path);
    await writeFile("ita.txt", await readFile("ita.txt"));
    assertEquals(await target(path), before);
    await runCommand("git", ["add", "-A"]);
    assertEquals(await target(path), before);
    assertEquals(
      (await runCommand("git", ["commit", "-qm", "same tree"])).code,
      0,
    );
    assertEquals(await target(path), before);
    await run(["complete", path, "task-1"]);
  });
});

test("snapshot rejects submodules and nested repositories", async () => {
  await fixture(async (path) => {
    await mkdir("sub");
    process.chdir("sub");
    try {
      for (
        const args of [
          ["init", "-q"],
          ["commit", "-q", "--allow-empty", "-m", "nested"],
        ]
      ) {
        const result = await runCommand("git", [
          "-c",
          "user.email=test@example.invalid",
          "-c",
          "user.name=Test",
          ...args,
        ]);
        assertEquals(result.code, 0);
      }
    } finally {
      process.chdir("..");
    }
    await assertRejects(() => target(path), Error, "cannot fingerprint");
    assertEquals((await runCommand("git", ["add", "sub"])).code, 0);
    const staged = await runCommand("git", ["ls-files", "--stage", "sub"]);
    assertEquals(staged.stdout.startsWith("160000 "), true);
    await assertRejects(() => target(path), Error, "cannot fingerprint");
  });
});

test("changed target during verification and blocked/live claims cannot pass", async () => {
  await fixture(async (path) => {
    await declare(path, "task-1", "live");
    const before = await target(path);
    await writeFile("main.txt", "changed\n");
    await assertRejects(
      () => record(path, { target: before }),
      Error,
      "target changed",
    );
    await assertRejects(() => record(path), Error, "observed");
    await assertRejects(
      () => record(path, { expected: "current-head", observed: "old-ci-head" }),
      Error,
      "does not match",
    );
    await assertRejects(
      () =>
        record(path, {
          expected: "new-binary-digest",
          observed: "old-binary-digest",
        }),
      Error,
      "does not match",
    );
    await assertRejects(
      () => record(path, { expected: "old-ci-head", observed: "old-ci-head" }),
      Error,
      "declared source",
    );
    await record(path, { status: "blocked", output: "runner unavailable" });
    await assertRejects(
      () => run(["complete", path, "task-1"]),
      Error,
      "blocked",
    );
    await assertRejects(
      () => record(path, { status: "waived" }),
      Error,
      "authorization",
    );
    await record(path, {
      status: "waived",
      authorization: "User explicitly waived live check in this task",
    });
    await run(["complete", path, "task-1"]);
  });
});

test("final completion requires current audit, review and implementation evidence", async () => {
  await fixture(async (path) => {
    await declare(path);
    await record(path);
    await run(["complete", path, "task-1"]);
    await run(["start", path, "task-2"]);
    await assertRejects(
      () => run(["complete", path, "task-2"]),
      Error,
      "required checks",
    );
    await run(
      ["require", path, "task-2"],
      input([
        { id: "audit", kind: "audit" },
        { id: "generic", kind: "review" },
      ]),
    );
    await record(path, { id: "audit" }, "task-2");
    await record(path, { id: "generic" }, "task-2");
    await run(["complete", path, "task-2"]);
    await writeFile("main.txt", "review fix\n");
    await assertRejects(
      () => run(["complete", path, "task-2"]),
      Error,
      "stale",
    );
    await record(path, { id: "audit" }, "task-2");
    await record(path, { id: "generic" }, "task-2");
    await assertRejects(
      () => run(["complete", path, "task-2"]),
      Error,
      "stale",
    );
    await record(path);
    await run(["complete", path, "task-2"]);
  });
});

test("reconcile reopens missing artifacts without discarding evidence", async () => {
  await fixture(async (path) => {
    await declare(path);
    await record(path);
    await run(["complete", path, "task-1"]);
    await rm("main.txt");
    await run(["reconcile", path]);
    const data = JSON.parse(await readFile(path, "utf8"));
    assertEquals(data.tasks[0].status, "in_progress");
    assertEquals(data.tasks[0].checks.length, 1);
    await mkdir("other");
    process.chdir("other");
    await runCommand("git", ["init", "-q"]);
    await assertRejects(
      () => run(["reconcile", path]),
      Error,
      "repository mismatch",
    );
  });
});

test("plan identity, initialization and writer locks preserve existing evidence", async () => {
  await fixture(async (path) => {
    const original = await readFile(path, "utf8");
    await assertRejects(
      () =>
        run([
          "init",
          path,
          "plan.md",
          JSON.stringify(["Final Audit + Review"]),
        ]),
      Error,
      "already exists",
    );
    await writeFile(`${path}.lock`, "another writer");
    // The wait is read once per process at module load, so the override goes
    // to the CLI child; in-process `run` would wait the default 10 s here.
    const result = await runCommand(
      join(import.meta.dirname, "plan-state.ts"),
      ["complete", path, "task-1"],
      {
        env: {
          PLAN_STATE_LOCK_WAIT_MS: "200",
          BUN_RUNTIME_TRANSPILER_CACHE_PATH:
            `${REAL_HOME}/Library/Caches/bun/@t@`,
        },
      },
    );
    assertEquals(result.code, 1);
    assertEquals(result.stderr.includes("locked"), true, result.stderr);
    assertEquals(await readFile(path, "utf8"), original);
    await rm(`${path}.lock`);
    const data = JSON.parse(original);
    data.plan = "other.md";
    await writeFile(path, JSON.stringify(data));
    await assertRejects(() => run(["normalize", path]), Error, "plan identity");
  });
});

test("live expected artifact is independently hashed and checked again at completion", async () => {
  await fixture(async (path) => {
    await run(
      ["require", path, "task-1"],
      input([{ id: "behavior", kind: "live", expected: { file: "main.txt" } }]),
    );
    const bytes = new TextEncoder().encode("initial\n");
    const expected = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    await record(path, { expected, observed: expected });
    await run(["complete", path, "task-1"]);
    await assertRejects(
      () => record(path, { expected: "old", observed: "old" }),
      Error,
      "declared source",
    );
    await assertRejects(
      () =>
        run(
          ["require", path, "task-1"],
          input([{
            id: "behavior",
            kind: "live",
            expected: { identity: "old" },
          }]),
        ),
      Error,
      "cannot change",
    );
  });
});

test("a tracked directory replaced by a symlink changes the target and nothing outside is read", async () => {
  await fixture(async (path) => {
    await mkdir("nested");
    await writeFile("nested/value.txt", "local");
    await runCommand("git", ["add", "nested/value.txt"]);
    const before = await target(path);
    await rename("nested", "../external");
    await symlink("../external", "nested");
    const after = await target(path);
    assertEquals(after === before, false);
    await writeFile("../external/value.txt", "changed outside");
    assertEquals(await target(path), after);
  });
});

test("snapshot works when .git/objects is read-only and keeps its objects next to the sidecar", async () => {
  await fixture(async (path) => {
    await chmod(".git/objects", 0o555);
    try {
      const before = await target(path);
      await writeFile("main.txt", "read-only objects\n");
      assertEquals(await target(path) === before, false);
    } finally {
      await chmod(".git/objects", 0o755);
    }
    const objects = path.replace(/\.evidence\.json$/, ".objects");
    assertEquals((await stat(objects)).isDirectory(), true);
  });
});

test("final completion needs every record at the current target and names what changed; a legacy gate field is dropped", async () => {
  await fixture(async (path) => {
    await run(
      ["require", path, "task-1"],
      input([{
        id: "behavior",
        kind: "live",
        expected: { identity: "runtime-v1" },
      }]),
    );
    await record(path, { expected: "runtime-v1", observed: "runtime-v1" });
    await run(["complete", path, "task-1"]);
    await run(["start", path, "task-2"]);
    await run(
      ["require", path, "task-2"],
      input([{ id: "audit", kind: "audit" }, {
        id: "generic",
        kind: "review",
      }]),
    );
    await assertRejects(
      () =>
        record(path, {
          id: "audit",
          output: "AUDIT_VERDICT: PASS\nAUDIT_VERDICT: FAIL",
        }, "task-2"),
      Error,
      "audit PASS",
    );
    for (
      const output of [
        "review unavailable",
        "### MUST_FIX\n- defect\nVERDICT: PASS",
        "### MUST_FIX\n- None\n### MUST_FIX\n- defect\nVERDICT: PASS",
      ]
    ) {
      await assertRejects(() =>
        record(path, { id: "generic", output }, "task-2")
      );
    }
    await record(path, { id: "audit" }, "task-2");
    await record(path, { id: "generic" }, "task-2");
    await run(["complete", path, "task-2"]);
    await run(["start", path, "task-2"]);
    await run(["complete", path, "task-2"]);
    await writeFile("main.txt", "after the review\n");
    await assertRejects(
      () => run(["complete", path, "task-2"]),
      Error,
      "changed since the record: main.txt; observe it again and record",
    );
    await record(path, { expected: "runtime-v1", observed: "runtime-v1" });
    await record(path, { id: "audit" }, "task-2");
    await record(path, { id: "generic" }, "task-2");
    await run(["complete", path, "task-2"]);
    const raw = JSON.parse(await readFile(path, "utf8"));
    raw.gate = "legacy-generation";
    raw.tasks[0].checks[0].gate = "legacy-generation";
    await writeFile(path, JSON.stringify(raw));
    await run(["start", path, "task-2"]);
    const data = JSON.parse(await readFile(path, "utf8"));
    assertEquals(data.gate, undefined);
    assertEquals(data.tasks[0].checks[0].gate, undefined);
    await run(["complete", path, "task-2"]);
  });
});

test("malformed CLI mutations release their lock", async () => {
  const script = join(import.meta.dirname, "plan-state.ts");
  await fixture(async (path) => {
    for (const command of ["start", "init", "require", "record", "complete"]) {
      const result = await runCommand(script, [command, path], {
        env: {
          BUN_RUNTIME_TRANSPILER_CACHE_PATH:
            `${REAL_HOME}/Library/Caches/bun/@t@`,
        },
      });
      assertEquals(result.code, 1);
      const missing = await assertRejects(() => stat(`${path}.lock`));
      assertEquals((missing as NodeJS.ErrnoException).code, "ENOENT");
    }
    await declare(path);
  });
});

test("final task completes with a review check alone; audit is optional", async () => {
  await fixture(async (path) => {
    await declare(path);
    await record(path);
    await run(["complete", path, "task-1"]);
    await run(["start", path, "task-2"]);
    await run(
      ["require", path, "task-2"],
      input([{ id: "generic", kind: "review" }]),
    );
    await record(path, { id: "generic" }, "task-2");
    await run(["complete", path, "task-2"]);
    const final = JSON.parse(await readFile(path, "utf8")).tasks[1];
    assertEquals(final.status, "completed");
  });
});

test("final task without any review check cannot complete", async () => {
  await fixture(async (path) => {
    await declare(path);
    await record(path);
    await run(["complete", path, "task-1"]);
    await run(["start", path, "task-2"]);
    await run(
      ["require", path, "task-2"],
      input([{ id: "audit", kind: "audit" }]),
    );
    await record(path, { id: "audit" }, "task-2");
    await assertRejects(
      () => run(["complete", path, "task-2"]),
      Error,
      "requires a review check",
    );
  });
});

test("coverage lists Autonomous Verification bullets without a cc-<n> check", async () => {
  await fixture(async (path) => {
    const plan = path.replace(/\.evidence\.json$/, ".md");
    await writeFile(
      plan,
      [
        "## Completion Criteria",
        "",
        "```markdown",
        "### Autonomous Verification",
        "- [file-state] a template sample before the real section",
        "```",
        "",
        "### Autonomous Verification",
        "- [file-state] main.txt says corrected",
        "```",
        "# a heading inside a command example must not end the scan",
        "- [live] Observe: sample line inside a fence is not a bullet",
        "```",
        "  - [orchestrator-only] deno test passes",
        "- [outcome] /gate returns PASS",
        "",
        "### Requires User Confirmation",
        "- None",
        "",
      ].join("\n"),
    );
    await run(
      ["require", path, "task-1"],
      input([{ id: "cc-1", kind: "file-state" }]),
    );
    await assertRejects(
      () => run(["coverage", path]),
      Error,
      "cc-2",
    );
    await run(
      ["require", path, "task-1"],
      input([{ id: "cc-2", kind: "orchestrator-only" }]),
    );
    await run(["coverage", path]);
  });
});

test("coverage rejects a bullet declared with another check kind", async () => {
  await fixture(async (path) => {
    const plan = path.replace(/\.evidence\.json$/, ".md");
    await writeFile(
      plan,
      [
        "### Autonomous Verification",
        "- [live] the CLI prints hello on the real surface",
        "",
      ].join("\n"),
    );
    await run(
      ["require", path, "task-1"],
      input([{ id: "cc-1", kind: "file-state" }]),
    );
    await assertRejects(
      () => run(["coverage", path]),
      Error,
      "cc-1: file-state for [live]",
    );
  });
});

// --- run ---
//
// The argv is executed without a shell, so these tests drive the Bun binary
// itself (`process.execPath -e …`) instead of relying on `node` or `true`.

const BUN = process.execPath;
const CLI = join(import.meta.dirname, "plan-state.ts");
const CLI_ENV = {
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: `${REAL_HOME}/Library/Caches/bun/@t@`,
};

async function lastCheck(path: string, id = "behavior") {
  const data = JSON.parse(await readFile(path, "utf8"));
  const checks = data.tasks[0].checks as Record<string, unknown>[];
  return checks.filter((c) => c.id === id).at(-1)!;
}

test("run records pass, fail and --expect-exit with argv, exit and tree", async () => {
  await fixture(async (path) => {
    await declare(path);
    assertEquals(
      await run([
        "run",
        path,
        "task-1",
        "behavior",
        "--",
        BUN,
        "-e",
        "console.log('ok')",
      ]),
      0,
    );
    let check = await lastCheck(path);
    assertEquals(check.status, "pass");
    assertEquals(check.argv, [BUN, "-e", "console.log('ok')"]);
    assertEquals(check.exit, 0);
    assertEquals(check.expectExit, 0);
    assertEquals(check.output, "ok\n");
    assertEquals(typeof check.tree, "string");
    assertEquals(typeof check.durationMs, "number");
    assertEquals(check.cwd, process.cwd());
    assertEquals(check.target, await target(path));
    await run(["complete", path, "task-1"]);

    assertEquals(
      await run([
        "run",
        path,
        "task-1",
        "behavior",
        "--",
        BUN,
        "-e",
        "process.exit(3)",
      ]),
      1,
    );
    check = await lastCheck(path);
    assertEquals(check.status, "fail");
    assertEquals(check.exit, 3);
    await assertRejects(() => run(["complete", path, "task-1"]), Error, "fail");

    assertEquals(
      await run([
        "run",
        path,
        "task-1",
        "behavior",
        "--expect-exit",
        "3",
        "--",
        BUN,
        "-e",
        "process.exit(3)",
      ]),
      0,
    );
    check = await lastCheck(path);
    assertEquals(check.status, "pass");
    assertEquals(check.expectExit, 3);
    await run(["complete", path, "task-1"]);
  });
});

test("run stores (no output) for a silent command and truncates a long output", async () => {
  await fixture(async (path) => {
    await declare(path);
    await run(["run", path, "task-1", "behavior", "--", BUN, "-e", "void 0"]);
    assertEquals((await lastCheck(path)).output, "(no output)");
    await run([
      "run",
      path,
      "task-1",
      "behavior",
      "--",
      BUN,
      "-e",
      "process.stdout.write('x'.repeat(21000))",
    ]);
    const check = await lastCheck(path);
    assertEquals(check.truncated, true);
    const output = check.output as string;
    assertEquals(output.length < 21000, true);
    assertEquals(output.includes("chars omitted"), true);
    assertEquals(output.startsWith("x".repeat(4096)), true);
    assertEquals(output.endsWith("x".repeat(16384)), true);
  });
});

test("run prints one status line and then the tail or the grep matches", async () => {
  await fixture(async (path) => {
    await declare(path);
    const program = "for (let i = 0; i < 30; i++) console.log('line' + i)";
    const tail = await runCommand(CLI, [
      "run",
      path,
      "task-1",
      "behavior",
      "--tail",
      "3",
      "--",
      BUN,
      "-e",
      program,
    ], { env: CLI_ENV });
    assertEquals(tail.code, 0, tail.stderr);
    const lines = tail.stdout.trimEnd().split("\n");
    assertEquals(
      /^pass behavior exit=0 \d+ms mutated=0$/.test(lines[0]),
      true,
      lines[0],
    );
    assertEquals(lines.slice(1), ["line27", "line28", "line29"]);
    const grep = await runCommand(CLI, [
      "run",
      path,
      "task-1",
      "behavior",
      "--grep",
      "line2[0-9]",
      "--",
      BUN,
      "-e",
      program,
    ], { env: CLI_ENV });
    assertEquals(grep.stdout.trimEnd().split("\n").slice(1).length, 10);
  });
});

test("run refuses live checks, a nested helper, an unsafe env key and a cwd outside the repository before spawning", async () => {
  await fixture(async (path) => {
    await declare(path, "task-1", "live");
    await assertRejects(
      () => run(["run", path, "task-1", "behavior", "--", BUN, "-e", "void 0"]),
      Error,
      "use record",
    );
    await run(
      ["require", path, "task-1"],
      input([{ id: "local", kind: "file-state" }]),
    );
    await assertRejects(
      () =>
        run([
          "run",
          path,
          "task-1",
          "local",
          "--",
          CLI,
          "run",
          path,
          "task-1",
          "local",
          "--",
          BUN,
          "-e",
          "",
        ]),
      Error,
      "may not invoke plan-state.ts",
    );
    await assertRejects(
      () =>
        run([
          "run",
          path,
          "task-1",
          "local",
          "--env",
          "GIT_SSH_COMMAND=x",
          "--",
          BUN,
          "-e",
          "",
        ]),
      Error,
      "not allowed",
    );
    await assertRejects(
      () =>
        run([
          "run",
          path,
          "task-1",
          "local",
          "--cwd",
          "..",
          "--",
          BUN,
          "-e",
          "",
        ]),
      Error,
      "inside the repository",
    );
    await assertRejects(
      () => run(["run", path, "task-1", "local", BUN, "-e", "void 0"]),
      Error,
      "-- <command>",
    );
    const data = JSON.parse(await readFile(path, "utf8"));
    assertEquals(data.tasks[0].checks, undefined);
  });
});

test("run records mutated paths, --expect-unchanged fails on a mutation, and a changed argv is noted", async () => {
  await fixture(async (path) => {
    await declare(path);
    assertEquals(
      await run([
        "run",
        path,
        "task-1",
        "behavior",
        "--",
        BUN,
        "-e",
        "require('node:fs').writeFileSync('gen.txt', 'g')",
      ]),
      0,
    );
    let check = await lastCheck(path);
    assertEquals(check.mutated, ["gen.txt"]);
    assertEquals(check.target, await target(path));
    await run(["complete", path, "task-1"]);
    assertEquals(
      await run([
        "run",
        path,
        "task-1",
        "behavior",
        "--expect-unchanged",
        "--",
        BUN,
        "-e",
        "require('node:fs').writeFileSync('gen2.txt', 'g')",
      ]),
      1,
    );
    check = await lastCheck(path);
    assertEquals(check.status, "fail");
    assertEquals(check.expectUnchanged, true);
    assertEquals(check.mutated, ["gen2.txt"]);
    const changed = await runCommand(CLI, [
      "run",
      path,
      "task-1",
      "behavior",
      "--",
      BUN,
      "-e",
      "console.log(1)",
    ], { env: CLI_ENV });
    assertEquals(
      changed.stdout.includes("supersedes previous argv"),
      true,
      changed.stdout,
    );
  });
});

test("record rejects the fields only run writes", async () => {
  await fixture(async (path) => {
    await declare(path);
    for (
      const field of [{ argv: ["x"] }, { tree: "abc" }, { exit: 0 }, {
        mutated: [],
      }]
    ) {
      await assertRejects(() => record(path, field), Error, "written by run");
    }
  });
});

test("two runs appending at the same time are both recorded", async () => {
  await fixture(async (path) => {
    await run(
      ["require", path, "task-1"],
      input([{ id: "a", kind: "file-state" }, { id: "b", kind: "file-state" }]),
    );
    const program = "await new Promise((r) => setTimeout(r, 300))";
    const results = await Promise.all(
      ["a", "b"].map((id) =>
        runCommand(CLI, ["run", path, "task-1", id, "--", BUN, "-e", program], {
          env: CLI_ENV,
        })
      ),
    );
    for (const r of results) assertEquals(r.code, 0, r.stderr);
    const data = JSON.parse(await readFile(path, "utf8"));
    assertEquals(data.tasks[0].checks.map((c: { id: string }) => c.id).sort(), [
      "a",
      "b",
    ]);
  });
});

// --- rerun ---

test("rerun skips fresh checks, re-executes stale and failed ones once per argv, lists record-made checks, keeps --expect-unchanged, and fails when a rerun fails", async () => {
  await fixture(async (path) => {
    await run(
      ["require", path, "task-1"],
      // u comes first: it rewrites a file, and a mutating check re-executed
      // after the others would leave their fresh records at an older tree.
      input([
        { id: "u", kind: "file-state" },
        { id: "a", kind: "file-state" },
        { id: "b", kind: "file-state" },
      ]),
    );
    await run(["start", path, "task-2"]);
    await run(
      ["require", path, "task-2"],
      input([{ id: "c", kind: "file-state" }, {
        id: "generic",
        kind: "review",
      }]),
    );
    const count = "require('node:fs').appendFileSync('count.txt', 'x')";
    await run(["run", path, "task-1", "a", "--", BUN, "-e", count]);
    await run(["run", path, "task-1", "b", "--", BUN, "-e", count]);
    await run([
      "run",
      path,
      "task-1",
      "u",
      "--expect-unchanged",
      "--",
      BUN,
      "-e",
      "require('node:fs').writeFileSync('u.txt', Date.now().toString())",
    ]);
    await run(["run", path, "task-2", "c", "--", BUN, "-e", "process.exit(2)"]);
    await record(path, { id: "generic" }, "task-2");
    assertEquals(await readFile("count.txt", "utf8"), "xx");

    await writeFile("main.txt", "stale now\n");
    const first = await runCommand(CLI, ["rerun", path], { env: CLI_ENV });
    assertEquals(first.code, 1, first.stderr);
    const rows = first.stdout.trimEnd().split("\n");
    assertEquals(rows[0], "| task | check | status | exit | mutated |");
    const cell = (check: string) =>
      rows.find((r) => r.includes(`| ${check} |`))!;
    assertEquals(/\| a \| pass \| 0 \| 1 \|/.test(cell("a")), true, cell("a"));
    assertEquals(/\| b \| pass \| 0 \| 1 \|/.test(cell("b")), true, cell("b"));
    assertEquals(/\| u \| fail \| 0 \| 1 \|/.test(cell("u")), true, cell("u"));
    assertEquals(/\| c \| fail \| 2 \| 0 \|/.test(cell("c")), true, cell("c"));
    assertEquals(
      /\| generic \| skipped \(record\) \| - \| 0 \|/.test(cell("generic")),
      true,
      cell("generic"),
    );
    assertEquals(await readFile("count.txt", "utf8"), "xxx");
    const data = JSON.parse(await readFile(path, "utf8"));
    const u = data.tasks[0].checks.filter((c: { id: string }) => c.id === "u")
      .at(-1);
    assertEquals(u.expectUnchanged, true);
    assertEquals(u.mutated, ["u.txt"]);

    await run([
      "run",
      path,
      "task-2",
      "c",
      "--expect-exit",
      "2",
      "--",
      BUN,
      "-e",
      "process.exit(2)",
    ]);
    await run(["run", path, "task-1", "u", "--", BUN, "-e", "void 0"]);
    const second = await runCommand(CLI, ["rerun", path], { env: CLI_ENV });
    assertEquals(second.code, 0, second.stderr);
    for (const check of ["a", "b", "u", "c"]) {
      const row = second.stdout.split("\n").find((r) =>
        r.includes(`| ${check} |`)
      )!;
      assertEquals(row.includes("| fresh |"), true, row);
    }
    assertEquals(await readFile("count.txt", "utf8"), "xxx");
  });
});

test("the helper itself refuses an argv a direct Bash call could not run, before spawning, with CLAUDECODE cleared", async () => {
  await fixture(async (path) => {
    await declare(path);
    const guarded = { ...CLI_ENV, CLAUDECODE: "" };
    const denied = await runCommand(CLI, [
      "run",
      path,
      "task-1",
      "behavior",
      "--",
      "git",
      "push",
      "-f",
      "origin",
      "main",
    ], { env: guarded });
    assertEquals(denied.code, 1);
    assertEquals(
      denied.stderr.includes("permissions.deny"),
      true,
      denied.stderr,
    );
    const wrapped = await runCommand(CLI, [
      "run",
      path,
      "task-1",
      "behavior",
      "--",
      "timeout",
      "9",
      "git",
      "push",
      "-f",
      "origin",
      "main",
    ], { env: guarded });
    assertEquals(wrapped.code, 1);
    assertEquals(wrapped.stderr.includes("wrapper"), true, wrapped.stderr);
    const unlisted = await runCommand(CLI, [
      "run",
      path,
      "task-1",
      "behavior",
      "--",
      "rm",
      "-rf",
      "/tmp/nope",
    ], { env: guarded });
    assertEquals(unlisted.code, 1);
    assertEquals(
      unlisted.stderr.includes("not in permissions.allow"),
      true,
      unlisted.stderr,
    );
    const allowed = await runCommand(CLI, [
      "run",
      path,
      "task-1",
      "behavior",
      "--",
      BUN,
      "-e",
      "void 0",
    ], { env: guarded });
    assertEquals(allowed.code, 0, allowed.stderr);
    const data = JSON.parse(await readFile(path, "utf8"));
    assertEquals(data.tasks[0].checks.length, 1);
    await run(
      ["require", path, "task-1"],
      input([{ id: "r", kind: "file-state" }]),
    );
    await run(["run", path, "task-1", "r", "--", BUN, "-e", "void 0"]);
    const raw = JSON.parse(await readFile(path, "utf8"));
    raw.tasks[0].checks.at(-1).argv = ["git", "push", "-f", "origin", "main"];
    raw.tasks[0].checks.at(-1).target = "stale";
    await writeFile(path, JSON.stringify(raw));
    const rerun = await runCommand(CLI, ["rerun", path], { env: guarded });
    assertEquals(rerun.code, 1);
    assertEquals(rerun.stderr.includes("permissions.deny"), true, rerun.stderr);
  });
});

test("run validates --grep before spawning and records a missing command as a failure", async () => {
  await fixture(async (path) => {
    await declare(path);
    await assertRejects(
      () =>
        run([
          "run",
          path,
          "task-1",
          "behavior",
          "--grep",
          "(",
          "--",
          BUN,
          "-e",
          "void 0",
        ]),
      Error,
      "invalid regular expression",
    );
    assertEquals(
      JSON.parse(await readFile(path, "utf8")).tasks[0].checks,
      undefined,
    );
    assertEquals(
      await run([
        "run",
        path,
        "task-1",
        "behavior",
        "--",
        "/nonexistent/command-xyz",
      ]),
      1,
    );
    const check = await lastCheck(path);
    assertEquals(check.status, "fail");
    assertEquals(check.exit, 127);
    assertEquals(String(check.output).startsWith("cannot start"), true);
  });
});
