import { test } from "bun:test";
import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initPlanEvidence, normalizePlanEvidence, run } from "./plan-state.ts";

const SUBJECTS = ["State helper", "Final Audit + Review"];
// The leading newline pins the helper to the start of its line: started by its
// path, with no interpreter in front of it.
const SKILL_HELPER_COMMAND = "\n~/.agents/scripts/plan-state.ts init ";
const IMPL_HELPER_COMMAND =
  "\nrtk proxy ~/.agents/scripts/plan-state.ts normalize ";

async function withHome(
  body: (home: string) => Promise<void>,
): Promise<void> {
  const previous = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "plan-state-home-"));
  process.env.HOME = home;
  try {
    await body(home);
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
  }
}

async function tempEvidence(
  home: string,
  data = initPlanEvidence("plan.md", SUBJECTS),
): Promise<string> {
  await mkdir(`${home}/.codex/plans`, { recursive: true });
  const path = `${home}/.codex/plans/${
    data.plan.replace(/\.md$/, ".evidence.json")
  }`;
  await writeFile(path, JSON.stringify(data, null, 2));
  return path;
}

function stream(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream();
}

test("initPlanEvidence creates canonical v1 tasks with final gate trailing", () => {
  const data = initPlanEvidence("plan.md", SUBJECTS);

  assertEquals(data, {
    plan: "plan.md",
    tasks: [
      {
        id: "task-1",
        subject: "State helper",
        baseline_sha: null,
        evidence: null,
        status: "pending",
      },
      {
        id: "task-2",
        subject: "Final Audit + Review",
        baseline_sha: null,
        evidence: null,
        status: "pending",
      },
    ],
  });
});

test("initPlanEvidence rejects subjects without trailing final gate", () => {
  assertRejects(
    async () => initPlanEvidence("plan.md", ["Only task"]),
    Error,
    "last task must be Final Audit + Review",
  );
});

test("normalizePlanEvidence accepts legacy name, missing id, object evidence, and null evidence", () => {
  const data = normalizePlanEvidence({
    plan: "legacy.md",
    tasks: [
      {
        name: "Legacy task",
        evidence: { ok: true, count: 2 },
      },
      {
        name: "Final Audit + Review",
        evidence: null,
      },
    ],
  });

  assertEquals(data.tasks[0], {
    id: "task-1",
    subject: "Legacy task",
    baseline_sha: null,
    evidence: '{\n  "ok": true,\n  "count": 2\n}',
    status: "pending",
  });
  assertEquals(data.tasks[1].id, "task-2");
  assertEquals(data.tasks[1].evidence, null);
});

test("normalizePlanEvidence rejects unknown status instead of reopening corrupted state", () => {
  assertRejects(
    async () =>
      normalizePlanEvidence({
        plan: "legacy.md",
        tasks: [
          { subject: "Task", status: "done" },
          { subject: "Final Audit + Review" },
        ],
      }),
    Error,
    "invalid task status: done",
  );
});

test("run init writes canonical JSON through the command surface", () =>
  withHome(async (home) => {
    await mkdir(`${home}/.codex/plans`, { recursive: true });
    const path = `${home}/.codex/plans/plan.evidence.json`;

    await run([
      "init",
      path,
      "plan.md",
      JSON.stringify(SUBJECTS),
    ]);

    const data = JSON.parse(await readFile(path, "utf8"));
    assertEquals(
      data.tasks.map((task: { subject: string }) => task.subject),
      SUBJECTS,
    );
  }));

test("documents the CLI invocation used by skills", async () => {
  const planSkill = await readFile(
    "home/programs/codex/skills/plan/SKILL.md",
    "utf8",
  );
  const implSkill = await readFile(
    "home/programs/codex/skills/impl/references/evidence.md",
    "utf8",
  );

  assertEquals(
    planSkill.includes(SKILL_HELPER_COMMAND),
    true,
  );
  assertEquals(
    implSkill.includes(IMPL_HELPER_COMMAND),
    true,
  );
});

test("impl skill documents the combined final review contract", async () => {
  const implSkill = await readFile(
    "home/programs/codex/skills/impl/SKILL.md",
    "utf8",
  );

  const required = [
    "Combined Generic Review",
    "git ls-files --others --exclude-standard",
    "Area: SPEC|QUALITY",
    "Domain-Specific Reviewer Dispatch",
    "Review lifecycle budget",
    "Security Dispatch Heuristic",
    "Reviewer self-modification",
    "main-review",
    'fork_turns: "none"',
    "same frozen target",
    "at most three concurrently",
    "reruns all selected reviewers",
    "[live]",
    "explicitly waived",
    "clear-matching",
  ];

  for (const text of required) {
    assertEquals(
      implSkill.includes(text),
      true,
      `impl skill should include ${text}`,
    );
  }

  const removed = [
    "Select every applicable specialist",
    "at least 20 files or 500 added/deleted lines",
    "### Step 4b: Code Quality",
    "fresh `code-reviewer` subagent を再 spawn",
    "Spec Compliance PASS 後",
    "同一 assistant turn で" + "並列 spawn",
    "同一 turn で" + "並列 dispatch",
  ];

  for (const text of removed) {
    assertEquals(
      implSkill.includes(text),
      false,
      `impl skill should not reintroduce ${text}`,
    );
  }
});

test("rejects writes outside the Codex plans evidence namespace", () =>
  withHome(async (home) => {
    await mkdir(`${home}/.codex/plans`, { recursive: true });

    await assertRejects(
      () =>
        run([
          "init",
          `${home}/.codex/plans/.active-abc123`,
          "plan.md",
          JSON.stringify(SUBJECTS),
        ]),
      Error,
      "evidence path must end with .evidence.json",
    );

    const outside = await mkdtemp(join(tmpdir(), "tmp-"));
    await assertRejects(
      () =>
        run([
          "init",
          `${outside}/plan.evidence.json`,
          "plan.md",
          JSON.stringify(SUBJECTS),
        ]),
      Error,
      "evidence path must be under",
    );

    await assertRejects(
      () =>
        run([
          "init",
          "relative.evidence.json",
          "plan.md",
          JSON.stringify(SUBJECTS),
        ]),
      Error,
      "evidence path must be absolute",
    );
  }));

test("rejects symlink evidence paths", () =>
  withHome(async (home) => {
    await mkdir(`${home}/.codex/plans`, { recursive: true });
    const target = `${home}/target.evidence.json`;
    const link = `${home}/.codex/plans/link.evidence.json`;
    await writeFile(target, "{}");
    await symlink(target, link);

    await assertRejects(
      () => run(["normalize", link]),
      Error,
      "evidence path must not be a symlink",
    );
  }));

test("atomic writes do not follow predictable sibling tmp symlinks", () =>
  withHome(async (home) => {
    await mkdir(`${home}/.codex/plans`, { recursive: true });
    const path = `${home}/.codex/plans/plan.evidence.json`;
    const predictableTmp = `${path}.tmp`;
    const target = `${home}/target`;
    await writeFile(target, "unchanged");
    await symlink(target, predictableTmp);

    await run([
      "init",
      path,
      "plan.md",
      JSON.stringify(SUBJECTS),
    ]);

    assertEquals(await readFile(target, "utf8"), "unchanged");
    assertEquals((await lstat(predictableTmp)).isSymbolicLink(), true);
  }));

test("append-evidence reads multiline stdin and appends with separator", () =>
  withHome(async (home) => {
    const path = await tempEvidence(home);

    await run(["append-evidence", path, "task-1"], stream("first\nline"));
    await run(["append-evidence", path, "task-1"], stream("second\nline"));

    const data = JSON.parse(await readFile(path, "utf8"));
    assertEquals(data.tasks[0].evidence, "first\nline\n---\nsecond\nline");
  }));

test("legacy completion is not accepted without current verification", () =>
  withHome(async (home) => {
    const path = await tempEvidence(
      home,
      {
        plan: "legacy.md",
        tasks: [
          {
            id: "",
            name: "Legacy task",
            baseline_sha: "",
            evidence: { output: "ok" },
          } as any,
          {
            name: "Final Audit + Review",
          } as any,
        ],
      } as ReturnType<typeof initPlanEvidence>,
    );

    await assertRejects(
      () => run(["complete", path, "task-1"]),
      Error,
      "required checks",
    );

    const data = normalizePlanEvidence(
      JSON.parse(await readFile(path, "utf8")),
    );
    assertEquals(data.tasks[0].subject, "Legacy task");
    assertEquals(data.tasks[0].status, "pending");
    assertEquals(data.tasks[0].evidence, '{\n  "output": "ok"\n}');
  }));

test("start records baseline only once from the repository root", () =>
  withHome(async (home) => {
    const path = await tempEvidence(home);

    await run(["start", path, "task-1"]);
    const first = JSON.parse(await readFile(path, "utf8"));
    const baseline = first.tasks[0].baseline_sha;

    await run(["start", path, "task-1"]);
    const second = JSON.parse(await readFile(path, "utf8"));

    assertMatch(baseline, /^[0-9a-f]{40}$/);
    assertEquals(second.tasks[0].baseline_sha, baseline);
    assertEquals(second.tasks[0].status, "in_progress");
  }));

test("missing task rejects mutation commands", () =>
  withHome(async (home) => {
    const path = await tempEvidence(home);

    await assertRejects(
      () => run(["complete", path, "task-404"]),
      Error,
      "task not found: task-404",
    );
  }));

test("accepts evidence under ~/.claude/plans when it is the only plans dir", () =>
  withHome(async (home) => {
    await mkdir(`${home}/.claude/plans`, { recursive: true });
    const path = `${home}/.claude/plans/plan.evidence.json`;

    await run(["init", path, "plan.md", JSON.stringify(SUBJECTS)]);

    const data = JSON.parse(await readFile(path, "utf8"));
    assertEquals(data.tasks.length, 2);
  }));

test("rejects evidence outside both plans dirs and names both", () =>
  withHome(async (home) => {
    await mkdir(`${home}/.codex/plans`, { recursive: true });
    await mkdir(`${home}/.claude/plans`, { recursive: true });
    const outside = await mkdtemp(join(tmpdir(), "tmp-"));

    const error = await assertRejects(
      () =>
        run([
          "init",
          `${outside}/plan.evidence.json`,
          "plan.md",
          JSON.stringify(SUBJECTS),
        ]),
      Error,
      "evidence path must be under",
    );
    assertMatch(error.message, /\.codex\/plans or .*\.claude\/plans/);
  }));

test("refuses to run when neither plans dir exists", () =>
  withHome(async (home) => {
    await assertRejects(
      () =>
        run([
          "init",
          `${home}/plan.evidence.json`,
          "plan.md",
          JSON.stringify(SUBJECTS),
        ]),
      Error,
      "neither",
    );
  }));
