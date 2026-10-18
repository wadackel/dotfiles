import { test } from "bun:test";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as runCommand } from "../../../agents/lib/proc.ts";
import {
  classifyKind,
  countDiffOnlyCalls,
  errorResultTexts,
  findPlanSegments,
  joinSubagents,
  listSessionFiles,
  readSession,
  sidecarTime,
} from "./transcripts.ts";
import {
  classifyCritical,
  criticalItems,
  designQuestionCount,
  evidenceStats,
  falsifiedCount,
  median,
  parseDeepeningLog,
  parseGateLog,
} from "./metrics.ts";

const scriptPath = join(import.meta.dirname, "plan-metrics.ts");
const repoRoot = join(import.meta.dirname, "..", "..", "..", "..", "..");

// ---- fixture builders ----

let seq = 0;
const uuid = () => `u-${++seq}`;

function user(text: string, ts: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "user",
    uuid: uuid(),
    timestamp: ts,
    message: { role: "user", content: text },
    ...extra,
  });
}
function assistant(text: string, ts: string) {
  return JSON.stringify({
    type: "assistant",
    uuid: uuid(),
    timestamp: ts,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      usage: { output_tokens: 10, cache_read_input_tokens: 100 },
    },
  });
}
function toolUse(
  name: string,
  input: Record<string, unknown>,
  ts: string,
  id = `t-${++seq}`,
) {
  return JSON.stringify({
    type: "assistant",
    uuid: uuid(),
    timestamp: ts,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name, input }],
      usage: { output_tokens: 5, cache_read_input_tokens: 50 },
    },
  });
}
function toolResult(
  toolUseId: string,
  content: string,
  ts: string,
  isError = false,
) {
  return JSON.stringify({
    type: "user",
    uuid: uuid(),
    timestamp: ts,
    message: {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: toolUseId,
        content,
        is_error: isError,
      }],
    },
  });
}

const T = (min: number, sec = 0) =>
  new Date(Date.UTC(2026, 9, 1, 10, min, sec)).toISOString();

const PLAN_CMD =
  "<command-message>plan</command-message>\n<command-name>/plan</command-name>\n<command-args>fix it</command-args>";
const IMPL_CMD =
  "<command-message>impl</command-message>\n<command-name>/impl</command-name>";
const HANDOFF =
  "本文\n\n## Plan ready\n- File: ~/.claude/plans/20261001T1900-fix-it.md\n- Complexity: small\n- Tasks: 1 (+ Final Audit + Review)\n- Status: PENDING APPROVAL — type `/impl` to approve and execute";

/** One session: /plan → question (answered after 1 min) → critic dispatch → question (2 min) → handoff → /impl → report. */
function sessionLines(
  opts: { oldEnd?: boolean; noEnd?: boolean } = {},
): string[] {
  const lines = [
    user(PLAN_CMD, T(0)),
    assistant(
      "### どちらにしますか？\n\n- **A. x**\n- **B. y**\n\n> 推奨: A。理由",
      T(1),
    ),
    user("a", T(2)),
    toolUse(
      "Agent",
      {
        subagent_type: "Plan",
        description: "Critic round 1 for fix-it plan",
        prompt: "Read critic-prompt.md",
      },
      T(3),
      "agent-call-1",
    ),
    toolResult(
      "agent-call-1",
      "Async agent launched successfully. agentId: aaa111",
      T(3, 1),
    ),
    toolUse(
      "Bash",
      { command: "~/.agents/scripts/plan-state.ts init x" },
      T(3, 30),
    ),
    toolResult("t-x", "initialized", T(3, 31)),
    assistant("### 範囲は？\n\n- **A. 狭く**\n- **B. 広く**", T(4)),
    user("b", T(6)),
    assistant(HANDOFF, T(7)),
    user(IMPL_CMD, T(8)),
    toolUse(
      "Bash",
      { command: "~/.agents/scripts/plan-state.ts snapshot e.json" },
      T(9),
      "bash-1",
    ),
    toolResult("bash-1", "tok", T(9, 1)),
    toolUse("Bash", { command: "cargo test" }, T(10), "bash-2"),
    toolResult("bash-2", "ok", T(10, 1)),
    toolUse(
      "Bash",
      { command: "~/.agents/scripts/plan-state.ts record e.json task-1" },
      T(11),
      "bash-3",
    ),
    toolResult(
      "bash-3",
      "target changed during verification (artifact or gate generation)",
      T(11, 1),
      true,
    ),
  ];
  if (!opts.noEnd) {
    lines.push(
      assistant(
        opts.oldEnd
          ? "done\n\nFull record: ~/.claude/plans/x.evidence.json"
          : "完了\n\n## 変わったこと\n\n## 確かめたこと\n\n## 決めてほしいこと\n\nSidecar: ~/.claude/plans/x.gate.log.md",
        T(20),
      ),
    );
  }
  return lines;
}

async function writeSession(
  root: string,
  project: string,
  name: string,
  lines: string[],
) {
  const dir = join(root, project);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}.jsonl`);
  await writeFile(path, lines.join("\n") + "\n");
  return path;
}

async function withTmp(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "plan-metrics-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true });
  }
}

// ---- transcripts.ts ----

test("findPlanSegments takes complexity, slug, active minutes, waits and replies from one session", async () => {
  await withTmp(async (root) => {
    const path = await writeSession(
      root,
      "-Users-x-proj",
      "s1",
      sessionLines(),
    );
    const session = await readSession(path, "-Users-x-proj");
    const segs = findPlanSegments(session, { fromMs: -Infinity });
    assertEquals(segs.length, 1);
    const s = segs[0];
    assertEquals(s.handoff?.complexity, "small");
    assertEquals(s.handoff?.slug, "20261001T1900-fix-it");
    assertEquals(s.questions.length, 2);
    assertEquals(s.questions[0].afterCritic, false);
    assertEquals(s.questions[0].hasRecommendation, true);
    assertEquals(s.questions[1].afterCritic, true);
    assertEquals(s.questions[1].hasRecommendation, false);
    assertEquals(Math.round(s.waitMin * 10) / 10, 3); // 1 + 2 minutes
    assertEquals(Math.round((s.planActiveMin ?? NaN) * 10) / 10, 4); // 7 minutes wall minus 3 waiting
    assertEquals(s.state, "complete");
    assertEquals(Math.round((s.implMin ?? 0) * 10) / 10, 12); // 8 → 20
  });
});

test("findPlanSegments accepts the old `Full record:` end marker and flags a missing end as noEnd", async () => {
  await withTmp(async (root) => {
    const a = await readSession(
      await writeSession(
        root,
        "-Users-x-proj",
        "old",
        sessionLines({ oldEnd: true }),
      ),
      "-Users-x-proj",
    );
    assertEquals(
      findPlanSegments(a, { fromMs: -Infinity })[0].state,
      "complete",
    );
    const b = await readSession(
      await writeSession(
        root,
        "-Users-x-proj",
        "noend",
        sessionLines({ noEnd: true }),
      ),
      "-Users-x-proj",
    );
    assertEquals(findPlanSegments(b, { fromMs: -Infinity })[0].state, "noEnd");
  });
});

test("findPlanSegments starts a segment from a Skill tool_use too and keeps the last handoff of a segment", async () => {
  await withTmp(async (root) => {
    const lines = [
      toolUse("Skill", { skill: "plan", args: "do it" }, T(0)),
      assistant(HANDOFF.replace("small", "medium"), T(5)),
      user("条件を足して", T(9)), // a correction after the first handoff: waiting, not a question
      assistant(HANDOFF, T(10)),
    ];
    const s = await readSession(
      await writeSession(root, "-Users-x-proj", "skill", lines),
      "-Users-x-proj",
    );
    const segs = findPlanSegments(s, { fromMs: -Infinity });
    assertEquals(segs.length, 1);
    assertEquals(segs[0].handoff?.complexity, "small");
    assertEquals(segs[0].state, "noImpl");
    assertEquals(segs[0].questions.length, 0);
    assertEquals(Math.round(segs[0].waitMin), 4);
    assertEquals(Math.round(segs[0].planActiveMin ?? NaN), 6); // 10 minutes wall minus 4 waiting
    // A reply after the last handoff is waiting before /impl, not plan time: it must not make the plan negative.
    const tail = [...lines, user("LGTM", T(60)), user(IMPL_CMD, T(61))];
    const s2 = await readSession(
      await writeSession(root, "-Users-x-proj", "skill2", tail),
      "-Users-x-proj",
    );
    const seg2 = findPlanSegments(s2, { fromMs: -Infinity })[0];
    assertEquals(Math.round(seg2.planActiveMin ?? NaN), 6);
    assertEquals(Math.round(seg2.postHandoffWaitMin), 50);
    assertEquals(seg2.state, "noEnd");
  });
});

test("findPlanSegments drops segments that start before --from and stops counting tool input at the impl end marker", async () => {
  await withTmp(async (root) => {
    const lines = [
      ...sessionLines(),
      toolUse(
        "Bash",
        {
          command: "~/.agents/scripts/plan-state.ts record e.json task-9 "
            .padEnd(2000, "x"),
        },
        T(21),
        "late-1",
      ),
      toolResult(
        "late-1",
        "target changed during verification",
        T(21, 1),
        true,
      ),
    ];
    const s = await readSession(
      await writeSession(root, "-Users-x-proj", "late", lines),
      "-Users-x-proj",
    );
    const seg = findPlanSegments(s, { fromMs: -Infinity })[0];
    assertEquals(seg.targetChanged, 1); // the one before the report, not the one after
    assert(seg.implToolInputChars < 1000, String(seg.implToolInputChars));
    assertEquals(
      findPlanSegments(s, { fromMs: Date.parse(T(0, 1)) }).length,
      0,
    );
  });
});

test("joinSubagents binds by meta.json toolUseId and classifies Critic / Critique / Adversarial / Falsify / unparsed", async () => {
  await withTmp(async (root) => {
    const path = await writeSession(
      root,
      "-Users-x-proj",
      "s1",
      sessionLines(),
    );
    const sub = join(root, "-Users-x-proj", "s1", "subagents");
    await mkdir(sub, { recursive: true });
    const agent = async (
      id: string,
      meta: Record<string, unknown> | null,
      prompt: string,
      report: string,
    ) => {
      await writeFile(
        join(sub, `agent-${id}.jsonl`),
        [
          user(prompt, T(3, 2)),
          assistant("working", T(4)),
          toolUse("SubagentHandback", { message: report }, T(6)),
        ].join("\n") + "\n",
      );
      if (meta) {
        await writeFile(
          join(sub, `agent-${id}.meta.json`),
          JSON.stringify(meta),
        );
      }
    };
    await agent(
      "c1",
      {
        agentType: "Plan",
        description: "Critic round 1 for fix-it plan",
        toolUseId: "agent-call-1",
      },
      "x",
      "### Critical Issues\n1. [TECH] a\n### Verdict\nITERATE",
    );
    await agent(
      "c2",
      {
        agentType: "Plan",
        description: "Critique web-clip UI plan",
        toolUseId: "agent-call-2",
      },
      "x",
      "### Critical Issues\nNone\n### Verdict\nCONVERGED",
    );
    await agent(
      "a1",
      {
        agentType: "Explore",
        description: "Adversarial falsification of plan",
        toolUseId: "agent-call-3",
      },
      "x",
      "#### Falsified (CRITICAL)\n- **Claim**: q\n#### Verdict\nITERATE",
    );
    await agent(
      "a2",
      {
        agentType: "Explore",
        description: "Falsify Hermes plan claims",
        toolUseId: "agent-call-4",
      },
      "x",
      "#### Falsified (CRITICAL)\nNone\n#### Design Questions\n- one\n- two",
    );
    await agent(
      "n1",
      null,
      "You are an adversarial falsification agent for a /plan run. Read adversarial-prompt.md",
      "r",
    );
    await agent(
      "n2",
      null,
      "You are an adversarial plan critic. Read critic-prompt.md",
      "r",
    );
    await agent(
      "n3",
      null,
      "Read /x/critic-prompt.md and do something odd",
      "r",
    );
    await agent(
      "r1",
      {
        agentType: "code-reviewer",
        description: "Spec and quality review",
        toolUseId: "agent-call-9",
      },
      "x",
      "VERDICT: PASS",
    );
    await writeFile(
      join(sub, "agent-bad.jsonl"),
      "not json\n" + user("x", T(3, 2)) + "\n",
    );
    const session = await readSession(path, "-Users-x-proj");
    const { agents, unparsedKind, badLines } = await joinSubagents(session);
    assertEquals(badLines, 1);
    const kinds = Object.fromEntries(agents.map((a) => [a.id, a.kind]));
    assertEquals(kinds.c1, "critic");
    assertEquals(kinds.c2, "critic");
    assertEquals(kinds.a1, "adversarial");
    assertEquals(kinds.a2, "adversarial");
    assertEquals(kinds.n1, "adversarial");
    assertEquals(kinds.n2, "critic");
    assertEquals(kinds.n3, "unparsed");
    assertEquals(kinds.r1, "other");
    assertEquals(unparsedKind, 1);
    const c1 = agents.find((a) => a.id === "c1")!;
    assertEquals(c1.toolUseId, "agent-call-1");
    assertEquals(Math.round(c1.durMin), 3);
    assertEquals(c1.out, 15);
    assertStringIncludes(c1.report, "### Critical Issues");
  });
});

test("classifyKind prefers the description, then template lines, critic before adversarial", () => {
  assertEquals(classifyKind("Critic round 2", ""), "critic");
  assertEquals(classifyKind("Round 2 plan critique", ""), "critic");
  assertEquals(classifyKind("Adversarial check", ""), "adversarial");
  assertEquals(
    classifyKind("Falsify reply-shape plan claims", ""),
    "adversarial",
  );
  assertEquals(
    classifyKind(
      "Spec and quality review",
      "You are an adversarial plan critic.",
    ),
    "critic",
  );
  assertEquals(
    classifyKind("", "You are an adversarial falsification agent."),
    "adversarial",
  );
  assertEquals(
    classifyKind("", "please read adversarial-prompt.md"),
    "unparsed",
  );
  assertEquals(
    classifyKind("Rust specialist review", "focus on ownership"),
    "other",
  );
});

test("countDiffOnlyCalls reads both the command form and the Skill tool form and dedupes", async () => {
  await withTmp(async (root) => {
    const lines = [
      user(
        "<command-message>gate</command-message>\n<command-name>/gate</command-name>\n<command-args>--diff-only HEAD~1</command-args>",
        T(0),
      ),
      toolUse("Skill", { skill: "gate", args: "--diff-only" }, T(1), "sk-1"),
      toolUse(
        "Skill",
        { skill: "gate", args: "~/.claude/plans/x.md" },
        T(2),
        "sk-2",
      ),
    ];
    const s = await readSession(
      await writeSession(root, "-Users-x-proj", "g", lines),
      "-Users-x-proj",
    );
    assertEquals(countDiffOnlyCalls(s), 2);
    const dup = JSON.parse(lines[0]);
    const s2 = await readSession(
      await writeSession(root, "-Users-x-proj", "g2", [
        lines[0],
        JSON.stringify(dup),
        lines[1],
      ]),
      "-Users-x-proj",
    );
    assertEquals(countDiffOnlyCalls(s2), 2); // the same user uuid twice counts once
  });
});

test("errorResultTexts returns only is_error tool_results, so a source read that mentions the string does not count", async () => {
  await withTmp(async (root) => {
    const lines = [
      toolUse("Bash", { command: "git -C /x status" }, T(0), "b1"),
      toolResult(
        "b1",
        "PreToolUse:Bash hook error: Do not use 'git -C <path>'",
        T(0, 1),
        true,
      ),
      toolUse("Bash", { command: "cat bash-policy.yaml" }, T(1), "b2"),
      toolResult("b2", "message: Do not use 'git -C <path>'", T(1, 1), false),
    ];
    const s = await readSession(
      await writeSession(root, "-Users-x-proj", "f", lines),
      "-Users-x-proj",
    );
    const texts = errorResultTexts(s);
    assertEquals(texts.length, 1);
    assertStringIncludes(texts[0], "git -C");
  });
});

test("listSessionFiles skips -private-tmp- projects by default, old files by mtime, and counts both", async () => {
  await withTmp(async (root) => {
    const keep = await writeSession(
      root,
      "-Users-x-proj",
      "new",
      sessionLines(),
    );
    const old = await writeSession(
      root,
      "-Users-x-proj",
      "old",
      sessionLines(),
    );
    const tmp = await writeSession(
      root,
      "-private-tmp-claude-501-x-scratchpad-hr",
      "t",
      sessionLines(),
    );
    const oldDate = new Date("2026-09-01T00:00:00Z");
    await utimes(old, oldDate, oldDate);
    await mkdir(join(root, "-Users-x-proj", "new", "subagents"), {
      recursive: true,
    });
    await writeFile(
      join(root, "-Users-x-proj", "new", "subagents", "agent-z.jsonl"),
      "",
    );
    const fromMs = Date.parse("2026-09-15T00:00:00+09:00");
    const a = await listSessionFiles(root, { fromMs, includeTmp: false });
    assertEquals(a.files.map((f) => f.path), [keep]);
    assertEquals(a.skippedOld, 1);
    assertEquals(a.skippedTmp, 1);
    const b = await listSessionFiles(root, { fromMs, includeTmp: true });
    assertEquals(b.files.map((f) => f.path).sort(), [keep, tmp].sort());
    const c = await listSessionFiles(join(root, "missing"), {
      fromMs,
      includeTmp: false,
    });
    assertEquals(c.files.length, 0);
    assertEquals(c.missing, 1);
  });
});

test("sidecarTime reads the YYYYMMDDTHHmm prefix as +09:00", () => {
  assertEquals(
    sidecarTime("20260915T0000-x.log.md"),
    Date.parse("2026-09-15T00:00:00+09:00"),
  );
  assertEquals(
    sidecarTime("20260914T2359-x.gate.log.md"),
    Date.parse("2026-09-14T23:59:00+09:00"),
  );
  assertEquals(sidecarTime("notes.md"), null);
});

// ---- metrics.ts ----

test("criticalItems and classifyCritical apply the ordered regex to the first 240 chars of each item", () => {
  const report = [
    "### Dimension Assessments",
    "text",
    "### Critical Issues (must fix before implementation)",
    "1. **[USER] Scope was silently narrowed.** details",
    "   - **Suggestion**: ask",
    "2. [TECH] Self-resolved #4 cites `x.ts:10-12` but the lines hold nothing",
    "3. [TECH] Dimension 7 MUST-check 3: no `[live]` item",
    "4. [TECH] The denylist leaks secrets into PR bodies",
    "### Improvement Suggestions (should consider)",
    "1. [TECH] rename",
    "### Verdict",
    "ITERATE",
  ].join("\n");
  const items = criticalItems(report);
  assertEquals(items.length, 4);
  assertEquals(items.map(classifyCritical), [
    "user",
    "evidence",
    "dim7",
    "behavior",
  ]);
  assertEquals(
    criticalItems("### Critical Issues\nNone\n### Verdict\nCONVERGED").length,
    0,
  );
  assertEquals(
    criticalItems("### Critical Issues\n- None\n### Verdict\nCONVERGED").length,
    0,
  );
});

test("falsifiedCount and designQuestionCount read only their own sections", () => {
  const report = [
    "#### Falsified (CRITICAL)",
    "- **Claim**: a",
    "- **Claim**: b",
    "#### Unverified",
    "- **Claim**: c",
    "#### Verified",
    "- **Claim**: d",
    "#### Design Questions",
    "- q1",
    "- q2",
    "- q3",
    "### Verdict",
    "ITERATE",
  ].join("\n");
  assertEquals(falsifiedCount(report), 2);
  assertEquals(designQuestionCount(report), 3);
  assertEquals(
    falsifiedCount(
      "#### Falsified (CRITICAL)\nNone\n#### Verified\n- **Claim**: d",
    ),
    0,
  );
});

test("parseDeepeningLog sees round 2, its veto origin and whether round 2 applied anything", () => {
  const log = [
    "# Deepening log",
    "## Round 1",
    "Critic: ITERATE (Dim 7 MUST-check 3 veto). Adversarial: CONVERGED.",
    "- Applied: x",
    "## Round 2",
    "Critic: CONVERGED.",
    "- Applied: y -- Why: z",
  ].join("\n");
  const r = parseDeepeningLog(log);
  assertEquals(r.rounds, 2);
  assertEquals(r.round1Veto, true);
  assertEquals(r.round2Applied, true);
  const one = parseDeepeningLog(
    "# Deepening log\n## Round 1 (critic only; small)\nVerdict: CONVERGED.",
  );
  assertEquals(one.rounds, 1);
  assertEquals(one.round1Veto, false);
});

test("parseGateLog reads seven real variants, separates skipped waves, and marks unreadable logs", () => {
  const variants: Array<[string, Record<string, "PASS" | "FAIL">]> = [
    [
      "### Round 1\n#### code-reviewer\n```\n### Must Fix\nNone\nVERDICT: PASS\n```\n#### rust-reviewer\n```\n### Must Fix\n- x\nVERDICT: FAIL\n```",
      { "code-reviewer": "PASS", "rust-reviewer": "FAIL" },
    ],
    [
      "### Round 1\n#### code-reviewer — VERDICT: PASS\nnotes\n#### comment-reviewer — VERDICT: FAIL\nSHOULD_FIX only",
      { "code-reviewer": "PASS", "comment-reviewer": "FAIL" },
    ],
    [
      "### Round 1\n#### code-reviewer (VERDICT: FAIL)\nMUST_FIX: x\n#### typescript-reviewer (VERDICT: PASS)",
      { "code-reviewer": "FAIL", "typescript-reviewer": "PASS" },
    ],
    [
      "### Round 1\n- code-reviewer: VERDICT: FAIL\n- a11y-reviewer: VERDICT: PASS",
      { "code-reviewer": "FAIL", "a11y-reviewer": "PASS" },
    ],
    ["### Round 1\n- code-reviewer: Issues None. VERDICT: PASS", {
      "code-reviewer": "PASS",
    }],
    [
      "### Round 1\n- Reviewers: code-reviewer, a11y-reviewer. Both PASS, no blockers.",
      { "code-reviewer": "PASS", "a11y-reviewer": "PASS" },
    ],
    [
      "### Round 1\n- Reviewer: code-reviewer\n- Verdict: FAIL\n- Blocker: MUST_FIX x",
      { "code-reviewer": "FAIL" },
    ],
  ];
  for (const [text, expected] of variants) {
    const g = parseGateLog(text);
    assertEquals(g.unparsed, false, text.slice(0, 40));
    assertEquals(
      Object.fromEntries(g.reviewers.map((r) => [r.name, r.verdict])),
      expected,
      text.slice(0, 40),
    );
  }
  const blocker = parseGateLog(variants[2][0]);
  assertEquals(
    blocker.reviewers.find((r) => r.name === "code-reviewer")?.blocker,
    true,
  );
  // A spec Issue in the standard reply shape (### Issues + **Type**) is a blocker even when Must Fix and Should Fix are (none).
  const spec = parseGateLog(
    "### Round 1\n#### code-reviewer\n### Issues\n1. **Type**: EXTRA\n   - **Description**: x\n### Must Fix\n(none)\n### Should Fix\n(none)\nVERDICT: FAIL",
  );
  assertEquals(
    spec.reviewers.find((r) => r.name === "code-reviewer")?.blocker,
    true,
  );
  const emptyMust = parseGateLog(
    "### Round 1\n#### code-reviewer\n### Issues\nNone\n### Must Fix\n\n### Should Fix\n- **Severity**: SHOULD_FIX\nVERDICT: FAIL",
  );
  assertEquals(
    emptyMust.reviewers.find((r) => r.name === "code-reviewer")?.blocker,
    false,
  );
  const issueNoType = parseGateLog(
    "### Round 1\n#### code-reviewer\n### Issues\n1. **File:Line**: x\n### Must Fix\nNone\nVERDICT: FAIL",
  );
  assertEquals(
    issueNoType.reviewers.find((r) => r.name === "code-reviewer")?.blocker,
    true,
  );
  const typePlain = parseGateLog(
    "### Round 1\n#### code-reviewer\n### Issues\nNone\n- Type: INCOMPLETE\nVERDICT: FAIL",
  );
  assertEquals(
    typePlain.reviewers.find((r) => r.name === "code-reviewer")?.blocker,
    true,
  );
  const boldColon = parseGateLog(
    "### Round 1\n#### code-reviewer\n### Issues\nNone\n- **Type:** INCOMPLETE\nVERDICT: FAIL",
  );
  assertEquals(
    boldColon.reviewers.find((r) => r.name === "code-reviewer")?.blocker,
    true,
  );
  const subType = parseGateLog(
    "### Round 1\n#### code-reviewer\n### Issues\nNone\nSubType: MISSING in prose\nVERDICT: FAIL",
  );
  assertEquals(
    subType.reviewers.find((r) => r.name === "code-reviewer")?.blocker,
    false,
  );
  const emptyIfNone = parseGateLog(
    "### Round 1\n#### code-reviewer\n### Issues\nEmpty if none\n### Must Fix\n(none)\n### Should Fix\n- **Severity**: SHOULD_FIX\nVERDICT: FAIL",
  );
  assertEquals(
    emptyIfNone.reviewers.find((r) => r.name === "code-reviewer")?.blocker,
    false,
  );
  const shouldOnly = parseGateLog(variants[1][0]);
  assertEquals(
    shouldOnly.reviewers.find((r) => r.name === "comment-reviewer")?.blocker,
    false,
  );
  assertEquals(
    parseGateLog("### Round 1\nReview wave skipped: docs-only diff.").skipped,
    true,
  );
  assertEquals(
    parseGateLog(
      "### Round 1\n- Main-session review: x\n#### code-reviewer — VERDICT: PASS",
    ).skipped,
    false,
  );
  assertEquals(parseGateLog("### Round 1\nCoverage ok.").unparsed, true);
  const two = parseGateLog(
    variants[0][0] +
      "\n### Round 2\n#### rust-reviewer — VERDICT: PASS\nrereview-1.gate.diff",
  );
  assertEquals(two.rounds, 2);
  assertEquals(
    two.reviewers.find((r) => r.name === "rust-reviewer")?.verdict,
    "PASS",
  );
  assertEquals(
    two.reviewers.find((r) => r.name === "rust-reviewer")?.everFailed,
    true,
  );
  // A pasted reply with its own `### Must Fix` headings and no fence still belongs to the reviewer above it.
  const pasted = parseGateLog(
    "### Round 1\n#### code-reviewer (verbatim)\n### Issues\nNone\n### Must Fix\nNone\nVERDICT: PASS\n#### Buckets\nnone",
  );
  assertEquals(pasted.reviewers.map((r) => `${r.name}:${r.verdict}`), [
    "code-reviewer:PASS",
  ]);
  // Names on a Reviewers line, verdict on a later Verdicts line.
  const later = parseGateLog(
    "### Round 1\n- Reviewers: code-reviewer, react-reviewer (React effects). a11y skipped: no markup changed.\n- Verdicts: PASS, no blockers.",
  );
  assertEquals(later.reviewers.map((r) => `${r.name}:${r.verdict}`).sort(), [
    "code-reviewer:PASS",
    "react-reviewer:PASS",
  ]);
  const mixed = parseGateLog(
    "### Round 1\n- Reviewers: code-reviewer, a11y-reviewer. a11y PASS. code-reviewer FAIL: SHOULD_FIX — duplicated block.\n- code-reviewer (diagnostic re-review): PASS, no new blocker.",
  );
  assertEquals(
    mixed.reviewers.find((r) => r.name === "code-reviewer")?.everFailed,
    true,
  );
  assertEquals(
    mixed.reviewers.find((r) => r.name === "code-reviewer")?.verdict,
    "PASS",
  );
  assertEquals(
    mixed.reviewers.find((r) => r.name === "code-reviewer")?.blocker,
    false,
  );
  const sel = parseGateLog(
    "### Round 1\n**Selection**: `code-reviewer` (always); `nix-reviewer` (`.nix`); `security-auditor` not dispatched.\n**Verdicts** (replies condensed; every reply ended `VERDICT: PASS`):\n- code-reviewer — Issues: None.",
  );
  assertEquals(sel.reviewers.map((r) => `${r.name}:${r.verdict}`).sort(), [
    "code-reviewer:PASS",
    "nix-reviewer:PASS",
  ]);
});

test("evidenceStats counts records per id, distinct targets, status changes and output chars", () => {
  const ev = {
    tasks: [
      {
        id: "task-1",
        checks: [
          {
            id: "cc-1",
            status: "pass",
            target: "aaa",
            command: "c",
            output: "12345",
          },
          {
            id: "cc-1",
            status: "pass",
            target: "bbb",
            command: "c",
            output: "123",
          },
          {
            id: "cc-2",
            status: "fail",
            target: "aaa",
            command: "c",
            output: "x",
          },
          {
            id: "cc-2",
            status: "pass",
            target: "bbb",
            command: "c",
            output: "x",
          },
        ],
      },
      { id: "task-2", checks: [] },
    ],
  };
  const s = evidenceStats(ev);
  assertEquals(s.records, 4);
  assertEquals(s.distinctIds, 2);
  assertEquals(s.recordsPerIdMedian, 2);
  assertEquals(s.statusChangedIds, 1);
  assertEquals(s.distinctTargets, 2);
  assertEquals(s.outputChars, 10);
});

test("median returns the middle value and NaN for an empty list", () => {
  assertEquals(median([3, 1, 2]), 2);
  assertEquals(median([4, 1, 2, 3]), 2.5);
  assert(Number.isNaN(median([])));
});

// ---- strings the script keys on must exist where they are defined ----

test("the markers the script keys on exist in the repo skill files", async () => {
  const plan = await readFile(
    join(repoRoot, "home/programs/claude/skills/plan/SKILL.md"),
    "utf8",
  );
  for (const m of ["## Plan ready", "- File:", "- Complexity:"]) {
    assertStringIncludes(plan, m);
  }
  const impl = await readFile(
    join(repoRoot, "home/programs/claude/skills/impl/SKILL.md"),
    "utf8",
  );
  for (const m of ["## 確かめたこと", "## 決めてほしいこと", "Sidecar:"]) {
    assertStringIncludes(impl, m);
  }
  const critic = await readFile(
    join(
      repoRoot,
      "home/programs/agents/shared/plan/references/critic-prompt.md",
    ),
    "utf8",
  );
  for (
    const m of [
      "### Critical Issues",
      "### Improvement Suggestions",
      "You are an adversarial plan critic",
    ]
  ) assertStringIncludes(critic, m);
  const adv = await readFile(
    join(
      repoRoot,
      "home/programs/agents/shared/plan/references/adversarial-prompt.md",
    ),
    "utf8",
  );
  for (
    const m of [
      "#### Falsified",
      "#### Design Questions",
      "You are an adversarial falsification agent",
    ]
  ) assertStringIncludes(adv, m);
  // `Full record:` is the pre-2026-09-22 report ending and is no longer in the repo; the parser keeps it for old transcripts.
});

// ---- CLI (Task 2) ----

test("CLI rejects an unknown argument with usage and exit 1", async () => {
  const { code, stderr } = await runCommand(scriptPath, ["--bogus"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "usage");
});

test("CLI --json emits the eight groups plus window, population and unparsed; --list prints one line per item", async () => {
  await withTmp(async (root) => {
    const projects = join(root, "projects");
    const plans = join(root, "plans");
    await mkdir(plans, { recursive: true });
    await writeSession(projects, "-Users-x-proj", "s1", sessionLines());
    const sub = join(projects, "-Users-x-proj", "s1", "subagents");
    await mkdir(sub, { recursive: true });
    await writeFile(
      join(sub, "agent-c1.jsonl"),
      [
        user("x", T(3, 2)),
        toolUse("SubagentHandback", {
          message:
            "### Critical Issues\n1. [TECH] The hook leaks secrets\n### Verdict\nITERATE",
        }, T(6)),
      ].join("\n") + "\n",
    );
    await writeFile(
      join(sub, "agent-c1.meta.json"),
      JSON.stringify({
        agentType: "Plan",
        description: "Critic round 1 for fix-it plan",
        toolUseId: "agent-call-1",
      }),
    );
    // A readable transcript with an unreadable meta.json counts once, under metaFiles, never under subagentFiles.
    await writeFile(join(sub, "agent-c2.jsonl"), user("x", T(3, 2)) + "\n");
    await writeFile(join(sub, "agent-c2.meta.json"), "{bad");
    // A `/plan` start line without a timestamp cannot be placed in the window; it is counted, not dropped.
    await writeSession(projects, "-Users-x-proj", "s2", [
      JSON.stringify({
        type: "user",
        uuid: "u-untimed",
        message: { role: "user", content: PLAN_CMD },
      }),
    ]);
    await writeFile(
      join(plans, "20261001T1900-fix-it.log.md"),
      "# Deepening log\n## Round 1\nCritic: CONVERGED.\n",
    );
    await writeFile(
      join(plans, "20261001T1900-fix-it.gate.log.md"),
      "### Round 1\n#### code-reviewer — VERDICT: PASS\n",
    );
    await writeFile(
      join(plans, "20261001T1900-fix-it.evidence.json"),
      JSON.stringify({
        tasks: [{
          id: "task-1",
          checks: [{
            id: "cc-1",
            status: "pass",
            target: "a",
            command: "c",
            output: "o",
          }],
        }],
      }),
    );
    const base = ["--root", projects, "--plans", plans, "--from", "2026-09-15"];
    const j = await runCommand(scriptPath, [...base, "--json"]);
    assertEquals(j.code, 0, j.stderr);
    const out = JSON.parse(j.stdout);
    for (
      const k of [
        "window",
        "population",
        "unparsed",
        "phases",
        "critics",
        "adversarial",
        "rounds",
        "gates",
        "evidence",
        "questions",
        "friction",
      ]
    ) assert(k in out, `missing ${k}`);
    assertEquals(out.phases.small.plans, 1);
    assertEquals(out.critics.runs, 1);
    assertEquals(out.critics.classification.behavior, 1);
    assertEquals(out.friction.targetChangedSessions, 1);
    assertEquals(out.population.abandonedPlanSegments, 0);
    assertEquals(out.population.read, 2);
    assertEquals(out.unparsed.untimedSegments, 1);
    assertEquals(out.unparsed.metaFiles, 1);
    assertEquals(out.unparsed.subagentFiles, 0);
    assertEquals(out.unparsed.sidecars, 0);
    assert(out.evidence.planStateShare > 0);
    assertEquals(out.gates.logs, 1);
    assertEquals(out.rounds.logs, 1);
    const q = await runCommand(scriptPath, [...base, "--list", "questions"]);
    assertEquals(q.code, 0, q.stderr);
    assertEquals(q.stdout.trim().split("\n").length, 2);
    assertStringIncludes(q.stdout, "どちらにしますか");
    const c = await runCommand(scriptPath, [...base, "--list", "critical"]);
    assertEquals(c.code, 0, c.stderr);
    const lines = c.stdout.trim().split("\n");
    assertEquals(lines.length, 1);
    assert(/^(user|evidence|dim7|behavior)\t/.test(lines[0]), lines[0]);
    const t = await runCommand(scriptPath, base);
    assertEquals(t.code, 0, t.stderr);
    assertStringIncludes(t.stdout, "critics");
    assertStringIncludes(t.stdout, "window");
  });
});
