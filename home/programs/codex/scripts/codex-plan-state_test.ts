import {
  assertEquals,
  assertMatch,
  assertRejects,
} from "jsr:@std/assert@^1";
import {
  initPlanEvidence,
  normalizePlanEvidence,
  run,
} from "./codex-plan-state.ts";

const SUBJECTS = ["State helper", "Final Audit + Review"];
const SKILL_HELPER_COMMAND = [
  "deno",
  "run",
  "--allow-env=HOME",
  "--allow-read",
  "--allow-write",
  "--allow-run=git",
  "--no-prompt",
  "~/.codex/scripts/codex-plan-state.ts",
].join(" ");

async function tempEvidence(
  data = initPlanEvidence("plan.md", SUBJECTS),
): Promise<string> {
  const home = await Deno.makeTempDir({ prefix: "codex-plan-state-home-" });
  Deno.env.set("HOME", home);
  await Deno.mkdir(`${home}/.codex/plans`, { recursive: true });
  const path = await Deno.makeTempFile({
    dir: `${home}/.codex/plans`,
    suffix: ".evidence.json",
  });
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2));
  return path;
}

function stream(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream();
}

Deno.test("initPlanEvidence creates canonical v1 tasks with final gate trailing", () => {
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

Deno.test("initPlanEvidence rejects subjects without trailing final gate", () => {
  assertRejects(
    async () => initPlanEvidence("plan.md", ["Only task"]),
    Error,
    "last task must be Final Audit + Review",
  );
});

Deno.test("normalizePlanEvidence accepts legacy name, missing id, object evidence, and null evidence", () => {
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

Deno.test("normalizePlanEvidence rejects unknown status instead of reopening corrupted state", () => {
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

Deno.test("run init writes canonical JSON through the command surface", async () => {
  const home = await Deno.makeTempDir({ prefix: "codex-plan-state-home-" });
  Deno.env.set("HOME", home);
  await Deno.mkdir(`${home}/.codex/plans`, { recursive: true });
  const path = `${home}/.codex/plans/plan.evidence.json`;

  await run([
    "init",
    path,
    "plan.md",
    JSON.stringify(SUBJECTS),
  ]);

  const data = JSON.parse(await Deno.readTextFile(path));
  assertEquals(data.tasks.map((task: { subject: string }) => task.subject), SUBJECTS);
});

Deno.test("documents the permissioned CLI invocation used by skills", async () => {
  const planSkill = await Deno.readTextFile(
    "home/programs/codex/skills/plan/SKILL.md",
  );
  const implSkill = await Deno.readTextFile(
    "home/programs/codex/skills/impl/SKILL.md",
  );

  assertEquals(
    planSkill.includes(SKILL_HELPER_COMMAND),
    true,
  );
  assertEquals(
    implSkill.includes(SKILL_HELPER_COMMAND),
    true,
  );
});

Deno.test("impl skill documents the combined final review contract", async () => {
  const implSkill = await Deno.readTextFile(
    "home/programs/codex/skills/impl/SKILL.md",
  );

  const required = [
    "Combined Generic Review",
    "SECTION_VERDICT: PASS (no diff and no untracked files)",
    "git ls-files --others --exclude-standard",
    "REVIEW_FILES",
    "untracked file contents",
    "Area: SPEC|QUALITY",
    "No VERDICT",
    "malformed output",
    "max 3 attempts",
    "Domain-Specific Reviewer Dispatch",
    "Security Dispatch Heuristic",
    "Reviewer self-modification",
  ];

  for (const text of required) {
    assertEquals(
      implSkill.includes(text),
      true,
      `impl skill should include ${text}`,
    );
  }

  const removed = [
    "### Step 4b: Code Quality",
    "fresh `code-reviewer` subagent を再 spawn",
    "Spec Compliance PASS 後",
  ];

  for (const text of removed) {
    assertEquals(
      implSkill.includes(text),
      false,
      `impl skill should not reintroduce ${text}`,
    );
  }
});

Deno.test("rejects writes outside the Codex plans evidence namespace", async () => {
  const home = await Deno.makeTempDir({ prefix: "codex-plan-state-home-" });
  Deno.env.set("HOME", home);
  await Deno.mkdir(`${home}/.codex/plans`, { recursive: true });

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

  const outside = await Deno.makeTempDir();
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
});

Deno.test("rejects symlink evidence paths", async () => {
  const home = await Deno.makeTempDir({ prefix: "codex-plan-state-home-" });
  Deno.env.set("HOME", home);
  await Deno.mkdir(`${home}/.codex/plans`, { recursive: true });
  const target = `${home}/target.evidence.json`;
  const link = `${home}/.codex/plans/link.evidence.json`;
  await Deno.writeTextFile(target, "{}");
  await Deno.symlink(target, link);

  await assertRejects(
    () => run(["normalize", link]),
    Error,
    "evidence path must not be a symlink",
  );
});

Deno.test("atomic writes do not follow predictable sibling tmp symlinks", async () => {
  const home = await Deno.makeTempDir({ prefix: "codex-plan-state-home-" });
  Deno.env.set("HOME", home);
  await Deno.mkdir(`${home}/.codex/plans`, { recursive: true });
  const path = `${home}/.codex/plans/plan.evidence.json`;
  const predictableTmp = `${path}.tmp`;
  const target = `${home}/target`;
  await Deno.writeTextFile(target, "unchanged");
  await Deno.symlink(target, predictableTmp);

  await run([
    "init",
    path,
    "plan.md",
    JSON.stringify(SUBJECTS),
  ]);

  assertEquals(await Deno.readTextFile(target), "unchanged");
  assertEquals((await Deno.lstat(predictableTmp)).isSymlink, true);
});

Deno.test("append-evidence reads multiline stdin and appends with separator", async () => {
  const path = await tempEvidence();

  await run(["append-evidence", path, "task-1"], stream("first\nline"));
  await run(["append-evidence", path, "task-1"], stream("second\nline"));

  const data = JSON.parse(await Deno.readTextFile(path));
  assertEquals(data.tasks[0].evidence, "first\nline\n---\nsecond\nline");
});

Deno.test("complete normalizes legacy state before writing canonical v1 JSON", async () => {
  const path = await tempEvidence({
    plan: "legacy.md",
    tasks: [
      {
        id: "",
        // deno-lint-ignore no-explicit-any
        name: "Legacy task",
        baseline_sha: "",
        evidence: { output: "ok" },
      } as any,
      {
        // deno-lint-ignore no-explicit-any
        name: "Final Audit + Review",
      } as any,
    ],
  } as ReturnType<typeof initPlanEvidence>);

  await run(["complete", path, "task-1"]);

  const data = JSON.parse(await Deno.readTextFile(path));
  assertEquals(data.tasks[0].subject, "Legacy task");
  assertEquals(data.tasks[0].status, "completed");
  assertEquals(data.tasks[0].evidence, '{\n  "output": "ok"\n}');
});

Deno.test("start records baseline only once from the repository root", async () => {
  const path = await tempEvidence();

  await run(["start", path, "task-1"]);
  const first = JSON.parse(await Deno.readTextFile(path));
  const baseline = first.tasks[0].baseline_sha;

  await run(["start", path, "task-1"]);
  const second = JSON.parse(await Deno.readTextFile(path));

  assertMatch(baseline, /^[0-9a-f]{40}$/);
  assertEquals(second.tasks[0].baseline_sha, baseline);
  assertEquals(second.tasks[0].status, "in_progress");
});

Deno.test("missing task rejects mutation commands", async () => {
  const path = await tempEvidence();

  await assertRejects(
    () => run(["complete", path, "task-404"]),
    Error,
    "task not found: task-404",
  );
});
