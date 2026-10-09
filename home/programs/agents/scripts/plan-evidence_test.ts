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

test("uncommitted, staged, untracked, modes and plan changes invalidate a PASS", async () => {
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
        async () => {
          await runCommand("git", ["add", "main.txt"]);
        },
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
    await assertRejects(
      () => run(["complete", path, "task-1"]),
      Error,
      "locked",
    );
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

test("snapshot rejects tracked paths redirected outside the repository", async () => {
  await fixture(async (path) => {
    await mkdir("nested");
    await writeFile("nested/value.txt", "local");
    await runCommand("git", ["add", "nested/value.txt"]);
    await rename("nested", "../external");
    await symlink("../external", "nested");
    await assertRejects(() => target(path), Error, "escapes repository");
  });
});

test("final gate rejects missing verdicts and observations from a prior generation", async () => {
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
    await assertRejects(
      () => run(["complete", path, "task-2"]),
      Error,
      "fresh final-gate",
    );
    await record(path, { expected: "runtime-v1", observed: "runtime-v1" });
    await run(["complete", path, "task-2"]);
    await run(["start", path, "task-2"]);
    await assertRejects(
      () => run(["complete", path, "task-2"]),
      Error,
      "fresh final-gate",
    );
  });
});

test("a verification begun before a new gate cannot be recorded into it", async () => {
  await fixture(async (path) => {
    await declare(path);
    await record(path);
    await run(["complete", path, "task-1"]);
    await run(["start", path, "task-2"]);
    await run(
      ["require", path, "task-2"],
      input([{ id: "audit", kind: "audit" }]),
    );
    const previous = await target(path);
    await run(["start", path, "task-2"]);
    await assertRejects(
      () => record(path, { id: "audit", target: previous }, "task-2"),
      Error,
      "target changed",
    );
    await record(path, { id: "audit" }, "task-2");
    await run(["complete", path, "task-1"]);
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
