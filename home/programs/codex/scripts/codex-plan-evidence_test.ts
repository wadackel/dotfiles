import { assertEquals, assertRejects } from "jsr:@std/assert@^1";
import { run } from "./codex-plan-state.ts";

const input = (value: unknown) => new Blob([JSON.stringify(value)]).stream();

async function fixture(test: (path: string) => Promise<void>) {
  const previous = { cwd: Deno.cwd(), home: Deno.env.get("HOME")! };
  const temp = await Deno.makeTempDir({ prefix: "plan-evidence-" });
  try {
    Deno.env.set("HOME", temp);
    await Deno.mkdir(`${temp}/.codex/plans`, { recursive: true });
    await Deno.mkdir(`${temp}/repo`);
    Deno.chdir(`${temp}/repo`);
    for (
      const args of [
        ["init", "-q"],
        ["config", "user.email", "test@example.invalid"],
        ["config", "user.name", "Test"],
      ]
    ) {
      const result = await new Deno.Command("git", { args }).output();
      assertEquals(result.success, true);
    }
    await Deno.writeTextFile("main.txt", "initial\n");
    await new Deno.Command("git", { args: ["add", "."] }).output();
    await new Deno.Command("git", { args: ["commit", "-qm", "initial"] })
      .output();
    const path = `${temp}/.codex/plans/plan.evidence.json`;
    await Deno.writeTextFile(
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
    Deno.chdir(previous.cwd);
    Deno.env.set("HOME", previous.home);
    await Deno.remove(temp, { recursive: true });
  }
}

async function target(path: string): Promise<string> {
  const { snapshot } = await import("./codex-plan-evidence.ts");
  return await snapshot(path, JSON.parse(await Deno.readTextFile(path)));
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

Deno.test("completion rejects missing verification and preserves legacy evidence", async () => {
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
      JSON.parse(await Deno.readTextFile(path)).tasks[0].evidence,
      "old PASS",
    );
  });
});

Deno.test("uncommitted, staged, untracked, modes and plan changes invalidate a PASS", async () => {
  await fixture(async (path) => {
    await declare(path);
    await record(path);
    await run(["complete", path, "task-1"]);
    for (
      const change of [
        () => Deno.writeTextFile("main.txt", "changed\n"),
        () => Deno.writeTextFile("new.txt", "new\n"),
        () => Deno.chmod("new.txt", 0o755),
        () => Deno.remove("new.txt"),
        () =>
          Deno.writeTextFile(
            path.replace(".evidence.json", ".md"),
            "new acceptance\n",
          ),
        async () => {
          await new Deno.Command("git", { args: ["add", "main.txt"] }).output();
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

Deno.test("changed target during verification and blocked/live claims cannot pass", async () => {
  await fixture(async (path) => {
    await declare(path, "task-1", "live");
    const before = await target(path);
    await Deno.writeTextFile("main.txt", "changed\n");
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

Deno.test("final completion requires current audit, review and implementation evidence", async () => {
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
    await Deno.writeTextFile("main.txt", "review fix\n");
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

Deno.test("reconcile reopens missing artifacts without discarding evidence", async () => {
  await fixture(async (path) => {
    await declare(path);
    await record(path);
    await run(["complete", path, "task-1"]);
    await Deno.remove("main.txt");
    await run(["reconcile", path]);
    const data = JSON.parse(await Deno.readTextFile(path));
    assertEquals(data.tasks[0].status, "in_progress");
    assertEquals(data.tasks[0].checks.length, 1);
    await Deno.mkdir("other");
    Deno.chdir("other");
    await new Deno.Command("git", { args: ["init", "-q"] }).output();
    await assertRejects(
      () => run(["reconcile", path]),
      Error,
      "repository mismatch",
    );
  });
});

Deno.test("plan identity, initialization and writer locks preserve existing evidence", async () => {
  await fixture(async (path) => {
    const original = await Deno.readTextFile(path);
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
    await Deno.writeTextFile(`${path}.lock`, "another writer");
    await assertRejects(
      () => run(["complete", path, "task-1"]),
      Error,
      "locked",
    );
    assertEquals(await Deno.readTextFile(path), original);
    await Deno.remove(`${path}.lock`);
    const data = JSON.parse(original);
    data.plan = "other.md";
    await Deno.writeTextFile(path, JSON.stringify(data));
    await assertRejects(() => run(["normalize", path]), Error, "plan identity");
  });
});

Deno.test("live expected artifact is independently hashed and checked again at completion", async () => {
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

Deno.test("snapshot rejects tracked paths redirected outside the repository", async () => {
  await fixture(async (path) => {
    await Deno.mkdir("nested");
    await Deno.writeTextFile("nested/value.txt", "local");
    await new Deno.Command("git", { args: ["add", "nested/value.txt"] })
      .output();
    await Deno.rename("nested", "../external");
    await Deno.symlink("../external", "nested");
    await assertRejects(() => target(path), Error, "escapes repository");
  });
});

Deno.test("final gate rejects missing verdicts and observations from a prior generation", async () => {
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

Deno.test("a verification begun before a new gate cannot be recorded into it", async () => {
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

Deno.test("malformed CLI mutations release their lock", async () => {
  const script = new URL("./codex-plan-state.ts", import.meta.url).pathname;
  await fixture(async (path) => {
    for (const command of ["start", "init", "require", "record", "complete"]) {
      const result = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-env=HOME",
          "--allow-read",
          "--allow-write",
          "--allow-run=git",
          script,
          command,
          path,
        ],
      }).output();
      assertEquals(result.code, 1);
      await assertRejects(
        () => Deno.stat(`${path}.lock`),
        Deno.errors.NotFound,
      );
    }
    await declare(path);
  });
});
