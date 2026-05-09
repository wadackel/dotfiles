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
    "$plan --answer <回答>",
    "^\\s*\\$plan\\s+--answer(?:\\s+|$)",
    "通常の `$plan <request>` より優先",
    ".clarifying-<cwd-hash>.json",
    "interviewId",
    "見つからない状態",
    "もう一度 `$plan <request>`",
  ]);
});

Deno.test("Codex Requirement Clarification enforces blocking interview contract", async () => {
  const skill = await readRepoFile(CODEX_PLAN);
  const restate = section(skill, "### Restate");
  const clarification = section(skill, "### Requirement Clarification");

  assertIncludesAll(restate, [
    "理解の restate",
    "Ask の代替確認ではない",
  ]);
  assertIncludesAll(clarification, [
    "Blocking Interview Protocol",
    "clarity-gated",
    "plan file / evidence sidecar / pending marker を一切作らない",
    "ここで回答を待ちます",
    "$plan --answer <回答>",
    ".clarifying-<cwd-hash>.json",
    "interviewId",
    "best-effort",
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
    "承認はユーザーの明示打鍵でのみ成立",
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

Deno.test("Codex plan skill uses optional Phase 2 explorer and mandatory Phase 4 subagents", async () => {
  const skill = await readRepoFile(CODEX_PLAN);
  const phase2 = section(skill, "## Phase 2 EXPLORE");
  const phase4 = section(skill, "## Phase 4 DEEPEN");
  const designNotes = section(skill, "## Design notes");

  assertIncludesAll(phase2, [
    "main session",
    "discovery outcome を埋める責任",
    "補助的に使ってよい",
    "mandatory ではなく、禁止でもない",
    "main session が統合",
    "読み取り中心の deterministic command",
    "network access",
    "package-manager install / run-script",
    "shell eval",
    "write",
    "credential access",
    "destructive command",
    "ユーザーが明示的に承認",
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
    "planning workflow の承認",
    "追加で「subagent を使ってよいですか」とユーザーに確認しない",
    "named review agents の spawn に限り",
    "通常の Codex policy を超える tool 権限を許可するものではない",
    "Phase 4 を skip できるのは",
    "Deepening Log とユーザー向け出力に理由を明記",
    "successful subagent deepening と同等扱いしない",
    "local self-review へ置き換えてはならない",
    "Phase 4 Subagent Lifecycle Budget",
    "agent_id / role / phase / status / closed",
    "`plan-critic` agent を `close_agent`",
    "plan-adversarial",
    "plan-simplifier",
    "Spawn the plan-adversarial subagent and the plan-simplifier subagent in parallel",
    "result-integrated subagents",
    "両方を `close_agent`",
    "missing side を retry exactly once",
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
    "Phase 2 は main-session owned exploration",
    "補助的に使ってよい",
    "Phase 4 subagent dispatch は原則 mandatory",
    "追加のユーザー許可確認は不要",
    "local self-review へ置き換えない",
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
