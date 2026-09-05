import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";

const CWD_ROOT = new URL(`file://${Deno.cwd().replace(/\/$/, "")}/`);
const MODULE_ROOT = new URL("../../../../", import.meta.url);
const CODEX_PLAN = "home/programs/codex/skills/plan/SKILL.md";
const CLAUDE_PLAN = "home/programs/claude/skills/plan/SKILL.md";

// The AGREE cadence is a cross-agent contract: the shared references assert
// "A1 and A5 are the blocking gates, A7 is non-blocking" for both agents, so
// pinning only one side would let the other regress while the suite stays green.
const AGENT_PLANS: ReadonlyArray<readonly [string, string]> = [
  ["Codex", CODEX_PLAN],
  ["Claude", CLAUDE_PLAN],
];

// Needles are joined with their neighbouring text rather than kept as short
// phrases: assertIncludesAll does not check adjacency, so a bare "(not a gate)"
// would still match after A7 was re-gated and the phrase survived elsewhere.
const AGREE_GATE_NEEDLES = [
  "A1 Direction check",
  "concrete options and a marked recommendation",
  'Never ask a bare "is this right?" yes/no',
  "has bought nothing. Wait for the user's response",
  "**A5 Approve approach** (one question)",
  "go with recommended / pick another / modify",
  "**A7 Direction statement** (not a gate)",
  "Do not wait",
  "Proceeding with:",
  "trivial, A1 is the single mandatory gate",
  "no adjacent candidates",
  "**Observe before asking.** If the answer is a fact you could observe by running or reading something (behavior, layout, timing, whether a file or path exists, whether a test passes), probe it or sketch it in a throwaway file and present the result as an option. Reserve questions for preference and product calls no probe can settle.",
];

// Outside the AGREE section, so asserted against the whole file.
const PLAN_PREAMBLE_NEEDLES = [
  "Complexity gates the *depth after agreement* (DEEPEN rounds, plan body size) — never the agreement itself.",
  "if complexity is trivial, skip DEEPEN",
  "Emitting it twice is what makes PARSE and AGREE read as duplicate confirmation",
  "state the plan path, the section headings, and the key design decisions in at most 3 lines",
  "Do not ask whether to proceed — direction agreement happened in AGREE, and drift detection is DEEPEN's job",
  "Do not pack multiple questions into one message just because the format allows it.",
];

const AGREE_LEGACY_NEEDLES = [
  "A1 Purpose check",
  "A7 Summarise",
  "Wait for the user's OK",
  "looks good so far",
  "Section-by-section",
  "maximum 4 questions",
  "Multiple-choice preferred",
  "Each AskUserQuestion call asks a single question",
];
const SHARED_CHECKLIST =
  "home/programs/agents/shared/plan/references/requirement-checklist.md";
const REQUIREMENTS_INTERVIEW =
  "home/programs/agents/skills/requirements-interview/SKILL.md";

// The interview cadence is shared prose across three skills. The sentences are
// asserted whole-file and character-identical so a rewording in one file cannot
// silently diverge from the others.
const INTERVIEW_RULE_NEEDLES = [
  "Ask only from the frontier: the set of questions whose prerequisites — prior decisions and pending investigations — are all settled.",
  "A question that depends on an open answer or an in-flight investigation waits.",
  "The interview ends when the frontier is empty and no investigation is pending: nothing left to ask, nothing left to collect.",
];
// Codex is excluded: its Blocking Interview Protocol (Step F end-turn) already
// enforces blocking, and the sentence would duplicate that contract.
const BLOCKING_RULE_NEEDLE =
  "The question is the last content in the turn; end the turn and do not advance until the answer arrives.";
const INTERVIEW_SKILLS: ReadonlyArray<readonly [string, string]> = [
  ["Codex plan", CODEX_PLAN],
  ["Claude plan", CLAUDE_PLAN],
  ["requirements-interview", REQUIREMENTS_INTERVIEW],
];
const CRITIC_PROMPT =
  "home/programs/agents/shared/plan/references/critic-prompt.md";
const COMPLETION_AUDIT =
  "home/programs/claude/skills/completion-audit/SKILL.md";
// The tag list markers differ per file (`—` in Claude plan and completion-audit,
// `:` in Codex plan), so only the definition text after the marker is pinned.
const LIVE_TAG_DEFINITION =
  "observed on the real surface with the user's own run method — start command, mode, target URL or PR, network condition, account role — recorded in the task evidence; gating at every complexity, waivable only by explicit user decision (BLOCKED BY USER)";
const LIVE_TAG_FILES = [CLAUDE_PLAN, CODEX_PLAN, COMPLETION_AUDIT];
const RUC_TEMPLATE_FILES = [CLAUDE_PLAN, CODEX_PLAN, COMPLETION_AUDIT];
// Pinned byte-for-byte across the plan skills and completion-audit: plans are written
// from this line and the audit table copies it back, so a reworded template in one
// file silently breaks the handoff.
const RUC_ITEM_TEMPLATE =
  "- [live] Observe: <what the user will see> / Why not autonomous: <one line> / Needs: <sudo | auth | dialog | role switch | dev server | real PR | device | interactive session> / Your steps: <command, URL, role> / Needed by: <task N | final gate | next real run <trigger>>";
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
    "Do **not** emit it as a standalone message",
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

for (const [agent, path] of AGENT_PLANS) {
  Deno.test(`${agent} AGREE keeps A1/A5 blocking and A7 non-blocking`, async () => {
    const skill = await readRepoFile(path);

    assertIncludesAll(section(skill, "## AGREE"), AGREE_GATE_NEEDLES);
    assertIncludesAll(skill, PLAN_PREAMBLE_NEEDLES);
    // Scoped to the whole file, not the AGREE section: legacy gate wording
    // reintroduced under Phase overview or Design notes would slip past a
    // section-scoped exclusion while still re-establishing the gate.
    assertExcludesAll(skill, AGREE_LEGACY_NEEDLES);
  });
}

for (const [name, path] of INTERVIEW_SKILLS) {
  Deno.test(`${name} carries the shared interview rule sentences verbatim`, async () => {
    const skill = await readRepoFile(path);
    assertIncludesAll(skill, INTERVIEW_RULE_NEEDLES);
  });
}

Deno.test("[live] tag definition is present in plan skills and completion-audit", async () => {
  for (const path of LIVE_TAG_FILES) {
    const body = await readRepoFile(path);
    assertStringIncludes(body, "`[live]`");
    assertStringIncludes(body, LIVE_TAG_DEFINITION);
  }
});

Deno.test("Requires User Confirmation item template is present in plan skills and completion-audit", async () => {
  for (const path of RUC_TEMPLATE_FILES) {
    const body = await readRepoFile(path);
    assertStringIncludes(body, RUC_ITEM_TEMPLATE);
  }
  for (const [, path] of AGENT_PLANS) {
    const body = await readRepoFile(path);
    assertStringIncludes(
      body,
      "`Your steps` must not inline tokens, passwords, or credentialed URLs",
    );
  }
});

Deno.test("text questions block the turn where no tool enforces it", async () => {
  for (const path of [CLAUDE_PLAN, REQUIREMENTS_INTERVIEW]) {
    assertStringIncludes(await readRepoFile(path), BLOCKING_RULE_NEEDLE);
  }
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

Deno.test("Codex plan skill uses optional EXPLORE explorer and mandatory DEEPEN subagents", async () => {
  const skill = await readRepoFile(CODEX_PLAN);
  const explore = section(skill, "## EXPLORE");
  const deepen = section(skill, "## DEEPEN");
  const designNotes = section(skill, "## Design notes");

  assertIncludesAll(explore, [
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
  assertExcludesAll(explore, [
    "subagent は起動しない",
    "Codex 版では explorer subagent へ委譲せず",
    "Spawn three explorer",
    "[explorer 1]",
    "[explorer 2]",
    "[explorer 3]",
    "3 件すべてを `close_agent`",
  ]);
  assertIncludesAll(deepen, [
    "$plan <request>",
    "DEEPEN subagent deepening",
    "approval for the planning workflow",
    "Do not ask the user again for permission",
    "spawning named review agents",
    "does not grant write, network, credential, shell, or any tool permission beyond active Codex policy",
    "Skip DEEPEN only for",
    "record the reason in the Deepening Log and user output",
    "successful subagent deepening",
    "Do not replace required subagent deepening with local self-review",
    "DEEPEN Subagent Lifecycle Budget",
    "agent_id / role / phase / status / closed",
    "close that round's `plan-critic` agent",
    "plan-adversarial",
    "plan-simplifier",
    "Spawn the plan-adversarial subagent and the plan-simplifier subagent in parallel",
    "result-integrated subagents",
    "close both",
    "retry the missing side exactly once",
  ]);
  assertExcludesAll(deepen, [
    "permission policy",
    "user-explicit policy",
    "追加のユーザー許可待ち",
    "Subagent-based DEEPEN was not dispatched",
    "active Codex tool policy",
    "self-review fallback",
  ]);
  assertIncludesAll(designNotes, [
    "EXPLORE is main-session owned exploration",
    "may use explorer subagents only as helpers",
    "DEEPEN subagent dispatch is normally mandatory",
    "Do not ask for extra user permission",
    "do not replace it with local self-review",
    "DEEPEN Subagent Lifecycle Budget",
    "bounded",
  ]);
});

Deno.test("shared checklist distinguishes Ask from restate and uses clarity gate", async () => {
  const checklist = await readRepoFile(SHARED_CHECKLIST);

  assertIncludesAll(checklist, [
    "Clarity gate: no fixed confirmation cap",
    "keep confirming as needed until the requirement is clear",
    "Definition of Ask",
    "an interaction that waits for the user's next answer",
    "Restating, prose for understanding-check, or recording under `### Requires User Confirmation` is NOT a substitute for an Ask",
    "the user's subjectivity itself is the central spec",
    "Ask to calibrate",
    "before artifact creation",
    "`### Unresolved Items` downstream `next:` deferral is only for codebase-recoverable uncertainty",
    "Do NOT surface user-only / subjective blockers here",
    "codebase-recoverable",
    "concrete `next:`",
    "choose an assumption / proceed as-is / continue clarifying / scope out",
    "ask exactly one question per turn",
    "A7 is a non-blocking direction statement",
    "Both agents follow the same one-question cadence",
    "a question whose prerequisites — prior answers or pending investigations — are unsettled waits",
    "is context, not a second question",
  ]);
  assertExcludesAll(checklist, [
    "A1–A7 cadence",
    "A1-A7 cadence",
    "Round budget",
    "round budget",
    "Rounds:",
    "default operating limit",
    "3 round",
    "operating limit",
    "Max 3 real questions + 1 override question",
    "slot (normally 3)",
    "bundle into a single override",
    "slot cap 4",
    "Ask count 5+",
    "bundle all into a single AskUserQuestion call",
  ]);
  const unresolvedExample = section(checklist, "### Unresolved Items");
  assertExcludesAll(unresolvedExample, [
    "DEEPEN Consolidated Interview で確定",
    "implementation 時に user 判断",
  ]);
});

Deno.test("Critic prompt mandates regression findings for clarification failures", async () => {
  const prompt = await readRepoFile(CRITIC_PROMPT);

  assertIncludesAll(prompt, [
    "Verdict criteria (stop decision)",
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
    "A7 is a non-blocking direction statement",
  ]);
  assertExcludesAll(prompt, [
    "subjective preference, undisclosed domain knowledge, intent), treat it as a **Critical Issue [USER]** and recommend it re-enter the DEEPEN Consolidated Interview queue",
    "A1–A7 cadence",
    "A1-A7 cadence",
  ]);
});

Deno.test("representative plan artifact fixtures preserve contract context", () => {
  for (const artifact of REPRESENTATIVE_ARTIFACTS) {
    assert(artifact.path.endsWith(".md"));
    assertStringIncludes(artifact.body, "### Requirement Clarification");
    assertStringIncludes(artifact.body, "Interview status");
  }
});
