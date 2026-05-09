import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";

const CWD_ROOT = new URL(`file://${Deno.cwd().replace(/\/$/, "")}/`);
const MODULE_ROOT = new URL("../../../../", import.meta.url);
const CODEX_PLAN = "home/programs/codex/skills/plan/SKILL.md";
const CLAUDE_PLAN = "home/programs/claude/skills/plan/SKILL.md";
const SHARED_CHECKLIST =
  "home/programs/agents/shared/plan/references/requirement-checklist.md";
const CRITIC_PROMPT =
  "home/programs/agents/shared/plan/references/critic-prompt.md";
const REPRESENTATIVE_ARTIFACTS = [
  {
    path: "20260506T1750-redesign-cli-output-ui.md",
    body:
      "### Requirement Clarification\n\n- Interview status: clear enough to plan\n",
  },
  {
    path: "20260506T1115-codex-startup-picker-run-status.md",
    body:
      "### Requirement Clarification\n\n- Interview status: clear enough to plan\n",
  },
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readRepoFile(relativePath: string): Promise<string> {
  try {
    return await Deno.readTextFile(new URL(relativePath, CWD_ROOT));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
  return await Deno.readTextFile(new URL(relativePath, MODULE_ROOT));
}

function section(markdown: string, heading: string): string {
  const level = heading.match(/^#+/)?.[0].length;
  assert(level, `invalid markdown heading: ${heading}`);

  const match = markdown.match(
    new RegExp(`^${escapeRegExp(heading)}(?:\\s|$).*?$`, "m"),
  );
  assert(match?.index !== undefined, `missing section: ${heading}`);

  const rest = markdown.slice(match.index);
  const nextHeading = new RegExp(`\\n#{1,${level}}\\s+\\S`, "m");
  const next = rest.slice(heading.length).search(nextHeading);
  return next < 0 ? rest : rest.slice(0, heading.length + next);
}

function spanBetween(
  markdown: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = markdown.indexOf(startMarker);
  assert(start >= 0, `missing start marker: ${startMarker}`);

  const end = markdown.indexOf(endMarker, start + startMarker.length);
  assert(end >= 0, `missing end marker after ${startMarker}: ${endMarker}`);

  return markdown.slice(start, end);
}

function assertIncludesAll(haystack: string, needles: string[]): void {
  for (const needle of needles) {
    assertStringIncludes(haystack, needle);
  }
}

function assertExcludesAll(haystack: string, needles: string[]): void {
  for (const needle of needles) {
    assertEquals(
      haystack.includes(needle),
      false,
      `should not include legacy fixed-confirmation phrase: ${needle}`,
    );
  }
}

function assertInOrder(haystack: string, needles: string[]): void {
  let previous = -1;
  for (const needle of needles) {
    const current = haystack.indexOf(needle);
    assert(current >= 0, `missing ordered marker: ${needle}`);
    assert(
      current > previous,
      `marker should appear after previous marker: ${needle}`,
    );
    previous = current;
  }
}

Deno.test("Codex argument extraction prioritizes --answer continuation", async () => {
  const skill = await readRepoFile(CODEX_PLAN);
  const argumentExtraction = section(skill, "## Argument extraction");

  assertIncludesAll(argumentExtraction, [
    "$plan --answer <answer>",
    "^\\s*\\$plan\\s+--answer(?:\\s+|$)",
    "before normal `$plan <request>` parsing",
    ".clarifying-<cwd-hash>.json",
    "interviewId",
    "without a matching `.clarifying-<cwd-hash>.json`",
    "restart from `$plan <request>`",
  ]);
});

Deno.test("Codex Requirement Clarification enforces blocking interview contract", async () => {
  const skill = await readRepoFile(CODEX_PLAN);
  const restate = section(skill, "### Restate");
  const clarification = section(skill, "### Requirement Clarification");

  assertIncludesAll(restate, [
    "restate of understanding",
    "does not replace an Ask",
  ]);
  assertIncludesAll(clarification, [
    "Blocking Interview Protocol",
    "clarity-gated",
    "create no plan file, evidence sidecar, or pending marker",
    "Here I will wait for your answer",
    "$plan --answer <answer>",
    ".clarifying-<cwd-hash>.json",
    "interviewId",
    "Best-effort",
    "no-ask reason",
  ]);
  assertExcludesAll(clarification, [
    "MVP",
    "1 round",
    "最大 3 件",
    "default 3",
    "3 rounds",
    "3 round",
    "operating limit",
  ]);
});

Deno.test("Codex Approval Summary exposes approval decision details", async () => {
  const skill = await readRepoFile(CODEX_PLAN);
  const output = spanBetween(
    skill,
    "### Output to user",
    "## Integration with existing tooling",
  );

  assertIncludesAll(output, [
    "## Approval Summary",
    "### Overview",
    "### Approach",
    "### Files to Change",
    "### Completion Criteria",
    "### Test Strategy",
    "### Execution",
    "Source: ## Overview",
    "Source: ## Approach",
    "Source: ## Files to Change",
    "Source: ## Completion Criteria",
    "## Task Outline",
    "Preserve the plan's Completion Criteria vocabulary",
    "Source: ## Test Strategy when present",
    "## Verification Commands and ## Completion Criteria",
    "no separate Test Strategy section exists",
    "source: ## Task Outline",
    "source: ## Verification Commands",
    "source: ## Risks + Open Questions",
    "tree-style code block",
    "CREATE / UPDATE / DELETE",
    "Collapse by directory",
    "Final Audit + Review",
    "PENDING APPROVAL",
    "Approval is established only by the user's explicit top-level `$impl` keystroke",
  ]);
  assertInOrder(output, [
    "### Overview",
    "### Approach",
    "### Files to Change",
    "### Completion Criteria",
    "### Test Strategy",
    "### Execution",
  ]);
});

Deno.test("Codex plan skill preserves user-facing output language", async () => {
  const skill = await readRepoFile(CODEX_PLAN);
  const languagePolicy = section(skill, "### Language policy");

  assertIncludesAll(languagePolicy, [
    "Skill instruction prose in this file is English",
    "User-facing generated output remains in the user's configured language",
    "Japanese unless the user asks otherwise",
    "Section headers are fixed English strings",
    "Machine-consumed contents",
  ]);
});

Deno.test("Codex plan skill uses optional Phase 2 explorer and mandatory Phase 4 subagents", async () => {
  const skill = await readRepoFile(CODEX_PLAN);
  const phase2 = section(skill, "## Phase 2 EXPLORE");
  const phase4 = section(skill, "## Phase 4 DEEPEN");
  const designNotes = section(skill, "## Design notes");

  assertIncludesAll(phase2, [
    "main session",
    "discovery outcomes",
    "may be used as helpers",
    "optional, not mandatory and not forbidden",
    "integrated by the main session",
    "deterministic read-only commands",
    "network access",
    "package-manager install or run-script",
    "shell eval",
    "write",
    "credential access",
    "destructive command",
    "explicitly approved by the user",
    "Existing patterns",
    "Execution paths and boundaries",
    "Existing behavior, constraints, verification conditions",
    "Unified Discovery Table",
  ]);
  assertExcludesAll(phase2, [
    "subagent は起動しない",
    "Codex 版では explorer subagent へ委譲せず",
    "Spawn three explorer",
    "[explorer 1]",
    "[explorer 2]",
    "[explorer 3]",
    "3 件すべてを `close_agent`",
  ]);
  assertIncludesAll(phase4, [
    "$plan <request>",
    "Phase 4 subagent deepening",
    "approval for the planning workflow",
    "Do not ask the user again for permission",
    "spawning named review agents",
    "does not grant write, network, credential, shell, or any tool permission beyond active Codex policy",
    "Skip Phase 4 only for",
    "record the reason in the Deepening Log and user output",
    "successful subagent deepening",
    "Do not replace required subagent deepening with local self-review",
    "Phase 4 Subagent Lifecycle Budget",
    "agent_id / role / phase / status / closed",
    "close that round's `plan-critic` agent",
    "plan-adversarial",
    "plan-simplifier",
    "Spawn the plan-adversarial subagent and the plan-simplifier subagent in parallel",
    "result-integrated subagents",
    "close both",
    "retry the missing side exactly once",
  ]);
  assertExcludesAll(phase4, [
    "permission policy",
    "user-explicit policy",
    "追加のユーザー許可待ち",
    "Subagent-based Phase 4 was not dispatched",
    "active Codex tool policy",
    "self-review fallback",
  ]);
  assertIncludesAll(designNotes, [
    "Phase 2 is main-session owned exploration",
    "may use explorer subagents only as helpers",
    "Phase 4 subagent dispatch is normally mandatory",
    "Do not ask for extra user permission",
    "do not replace it with local self-review",
    "Phase 4 Subagent Lifecycle Budget",
    "bounded",
  ]);
});

Deno.test("shared checklist distinguishes Ask from restate and uses clarity gate", async () => {
  const checklist = await readRepoFile(SHARED_CHECKLIST);

  assertIncludesAll(checklist, [
    "Clarity gate: no fixed confirmation cap",
    "要件が明確になるまで",
    "Ask の定義",
    "user の次回答を待つ interaction",
    "Restate、理解確認の prose、`### Requires User Confirmation` への記録は Ask の代替ではない",
    "user の主観そのものが中心仕様",
    "Ask で calibration",
    "artifact 作成前",
    "downstream `next:` deferral は codebase-recoverable uncertainty のみに使う",
    "user-only / subjective blocker はここに出さず",
    "codebase-recoverable",
    "具体的な `next:`",
    "仮定を選ぶ / このまま進める / 追加で確認する / scope out する",
    "slot 上限 4 = AskUserQuestion API hard cap",
  ]);
  assertExcludesAll(checklist, [
    "Round budget",
    "round budget",
    "Rounds:",
    "default 上限",
    "3 round",
    "operating limit",
    "user 主観判断であり、現時点の codebase probe だけでは候補を確定できない",
    "slot（通常 3）",
    "override で 1 回にまとめる",
  ]);
  const unresolvedExample = section(checklist, "### Unresolved Items");
  assertExcludesAll(unresolvedExample, [
    "Phase 4 Step 7 Consolidated Interview で確定",
    "implementation 時に user 判断",
  ]);
});

Deno.test("Claude Requirement Clarification preserves AskUserQuestion without fixed cap progression", async () => {
  const skill = await readRepoFile(CLAUDE_PLAN);
  const restate = section(skill, "## Phase 1");
  const clarification = section(skill, "### Requirement Clarification");

  assertIncludesAll(restate, [
    "summary/restate",
    "does not satisfy the clarity gate or replace AskUserQuestion",
  ]);
  assertIncludesAll(clarification, [
    "AskUserQuestion",
    "Clarity-gated loop",
    "continue asking as needed",
    "Max 4 real questions per AskUserQuestion call (API hard cap)",
    "No override / skip slot",
    "the clarity gate is the only exit",
    "explicitly choose",
  ]);
  assertExcludesAll(clarification, [
    "default 3 rounds",
    "3 rounds",
    "3 round",
    "round budget",
    "Operating limit",
    "operating limit",
    "Max 3 real questions + 1 override question",
    "Phase 2 へ進む",
    "追加確認が必要",
  ]);
});

Deno.test("Critic prompt mandates regression findings for clarification failures", async () => {
  const prompt = await readRepoFile(CRITIC_PROMPT);

  assertIncludesAll(prompt, [
    "Blocking Interview regression checks",
    "silently self-resolved",
    "Critical Issue [USER]",
    "documented continuation lifecycle is missing or contradicted",
    "Critical Issue [TECH]",
    "documented continuation lifecycle",
    "Do not require a live `.clarifying-<cwd-hash>.json` after a successful continuation",
    "fixed round cap",
    "default operating limit",
    "Count-based exhaustion is not a valid clarity condition",
    "downstream `next:` does not count for these blockers",
    "codebase-recoverable / technical discovery",
    "explicit user-selected assumption",
    "do not re-interview it solely because it is subjective",
  ]);
  assertExcludesAll(prompt, [
    "subjective preference, undisclosed domain knowledge, intent), treat it as a **Critical Issue [USER]** and recommend it re-enter the Phase 4 Step 7 Consolidated Interview queue",
  ]);
});

Deno.test("representative plan artifact fixtures preserve contract context", () => {
  for (const artifact of REPRESENTATIVE_ARTIFACTS) {
    assert(artifact.path.endsWith(".md"));
    assertStringIncludes(artifact.body, "### Requirement Clarification");
    assertStringIncludes(artifact.body, "Interview status");
  }
});
