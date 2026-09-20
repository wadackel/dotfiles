import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";

const CWD_ROOT = new URL(`file://${Deno.cwd().replace(/\/$/, "")}/`);
const MODULE_ROOT = new URL("../../../../", import.meta.url);
const CODEX_PLAN = "home/programs/codex/skills/plan/SKILL.md";
const CLAUDE_PLAN = "home/programs/claude/skills/plan/SKILL.md";
const REQUIREMENTS_INTERVIEW =
  "home/programs/agents/skills/requirements-interview/SKILL.md";
const CONTRACT = "home/programs/agents/shared/plan/references/contract.md";
const INTERVIEW = "home/programs/agents/shared/plan/references/interview.md";
const CRITIC_PROMPT =
  "home/programs/agents/shared/plan/references/critic-prompt.md";
const ADVERSARIAL_PROMPT =
  "home/programs/agents/shared/plan/references/adversarial-prompt.md";
const CHECK_PLAN_SCRIPT = "home/programs/agents/scripts/check-plan.ts";

// Codex may reuse prior agreement; imposing Claude's fixed cadence on both
// would silently reintroduce redundant approval turns.
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
  "**A5 Approve approach** (one question)",
  "go with recommended / pick another / modify",
  "**A7 Direction statement** (not a gate)",
  "Proceeding with:",
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

// The interview cadence is defined once in interview.md; the three skills that
// interview a user point at it instead of restating it, so a rewording cannot
// diverge between them.
const INTERVIEW_RULE_NEEDLES = [
  "Ask only from the frontier: the set of questions whose prerequisites — prior decisions and pending investigations — are all settled.",
  "A question that depends on an open answer or an in-flight investigation waits.",
  "The interview ends when the frontier is empty and no investigation is pending: nothing left to ask, nothing left to collect.",
  "The question is the last content in the turn; end the turn and do not advance until the answer arrives.",
  "Do not pack multiple questions into one message just because the format allows it.",
  "**Observe before asking.** If the answer is a fact you could observe by running or reading something (behavior, layout, timing, whether a file or path exists, whether a test passes), probe it or sketch it in a throwaway file and present the result as an option. Reserve questions for preference and product calls no probe can settle.",
  "Background stays at 2–3 sentences, and one of them states the premise the question rests on — current behavior, the file's role, a prior decision — with `file:lines`, so a wrong premise gets corrected instead of questioned back.",
  "When an option's shape can be shown (output sample, layout, wording), the body carries a sample of each option as a fenced block; a question the user can only answer by first asking to see it is not ready.",
  "<背景 2〜3 文。前提を file:lines 付きで 1 文、見せられる選択肢はサンプルを fenced block で>",
  "When the recommended answer is settled by a CLAUDE.md rule, a decision already made in this conversation, or the dominant convention in the code being changed, and the choice can be reversed later, do not ask: adopt it and record it under `### Assumptions` with `observation` / `value` / `reason`.",
  // Pinned on its own so the carve-out cannot be dropped while the rule survives.
  "Desired behavior, priority, scope, success criteria, and risk tolerance never fall under this rule — they are asked.",
  "Facts can be inferred from observation; user intent cannot.",
  "A reasonable default does not turn it into an assumption",
  "choose an assumption / proceed as-is / continue clarifying / scope out",
];
const INTERVIEW_LEGACY_NEEDLES = [
  "Round budget",
  "round budget",
  "default operating limit",
  "3 round",
  "operating limit",
  "Max 3 real questions",
  "Self-resolved earlier:",
];
const INTERVIEW_SKILLS: ReadonlyArray<readonly [string, string]> = [
  ["Codex plan", CODEX_PLAN],
  ["Claude plan", CLAUDE_PLAN],
  ["requirements-interview", REQUIREMENTS_INTERVIEW],
];

// Contract entries: the string, and every file that must carry it verbatim.
// contract.md is the definition; a skill or script that carries the string
// too is a deliberate mirror (check-plan.ts constants, plan skills that show
// the template to the writer). Reference-only files carry `references/contract.md`.
const LIVE_TAG_DEFINITION =
  "observed on the real surface with the user's own run method — start command, mode, target URL or PR, network condition, account role — recorded in the task evidence; gating at every complexity, waivable only by explicit user decision (BLOCKED BY USER)";
const RUC_ITEM_TEMPLATE =
  "- [live] Observe: <what the user will see> / Why not autonomous: <one line> / Needs: <sudo | auth | dialog | role switch | dev server | real PR | device | interactive session> / Your steps: <command, URL, role> / Needed by: <task N | final gate | next real run <trigger>>";
const SELF_RESOLVED_SOURCE_TEMPLATE =
  "source: [Direct|Supported|Inferred] <probe command + file:lines>";
const FINAL_TASK_SUBJECT = "Final Audit + Review";
const PLAN_READY_LINES = [
  "## Plan ready",
  "- File: <plan path>",
  "- Status: PENDING APPROVAL — type `/impl` to approve and execute",
];
const REQUIRED_SECTIONS = [
  "## Context",
  "## Files to Change",
  "## Task Outline",
  "## Completion Criteria",
  "### Autonomous Verification",
  "### Requires User Confirmation",
  "### Baseline",
];
const CC_TAGS = ["[file-state]", "[orchestrator-only]", "[live]", "[outcome]"];
const REVIEWER_VOCAB = [
  "do not create, modify, or delete files",
  "FAIL otherwise",
  "`MUST_FIX`",
  "`SHOULD_FIX`",
  "`### MUST_FIX`",
  "`VERDICT: PASS`",
  "ITERATE",
  "CONVERGED",
  "#### Falsified (CRITICAL)",
];
const CONTRACT_MIRRORS: ReadonlyArray<readonly [string, string[]]> = [
  [LIVE_TAG_DEFINITION, [CONTRACT]],
  [RUC_ITEM_TEMPLATE, [CONTRACT]],
  [SELF_RESOLVED_SOURCE_TEMPLATE, [
    CONTRACT,
    CLAUDE_PLAN,
    CODEX_PLAN,
    CHECK_PLAN_SCRIPT,
  ]],
  [FINAL_TASK_SUBJECT, [CONTRACT, CODEX_PLAN, CLAUDE_PLAN]],
  ["`Your steps` must not inline tokens, passwords, or credentialed URLs", [
    CONTRACT,
  ]],
  ["<redacted:", [CONTRACT, CLAUDE_PLAN, CRITIC_PROMPT]],
];
const CONTRACT_REFERRERS = [
  CLAUDE_PLAN,
  CODEX_PLAN,
  CRITIC_PROMPT,
  ADVERSARIAL_PROMPT,
];
const INTERVIEW_REFERRERS = [CLAUDE_PLAN, CODEX_PLAN, REQUIREMENTS_INTERVIEW];

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
    "references/interview.md",
  ]);
  assertExcludesAll(clarification, [
    "MVP",
    "1 round",
    "最大 3 件",
    "default 3",
    "3 rounds",
    "3 round",
    "operating limit",
    "requirement-checklist",
  ]);
});

for (const [agent, path] of AGENT_PLANS) {
  Deno.test(`${agent} AGREE keeps A1/A5 blocking and A7 non-blocking`, async () => {
    const skill = await readRepoFile(path);

    if (agent === "Claude") {
      assertIncludesAll(section(skill, "## AGREE"), AGREE_GATE_NEEDLES);
    } else {
      assertIncludesAll(section(skill, "## AGREE"), [
        "**A1 Direction check**",
        "**A5 Approve approach**",
        "**A7 Direction statement** (not a gate)",
        "Existing explicit scope satisfies this step",
        "Carry prior authorization forward",
        "no answer or elapsed time does not establish approval",
      ]);
      assertExcludesAll(skill, [
        "single mandatory gate",
        "Codex CLI has no structured question tool",
      ]);
    }
    // Scoped to the whole file, not the AGREE section: legacy gate wording
    // reintroduced under Phase overview or Design notes would slip past a
    // section-scoped exclusion while still re-establishing the gate.
    assertExcludesAll(skill, AGREE_LEGACY_NEEDLES);
  });
}

Deno.test("interview.md carries the shared interview rules and no round caps", async () => {
  const interview = await readRepoFile(INTERVIEW);
  assertIncludesAll(interview, INTERVIEW_RULE_NEEDLES);
  assertExcludesAll(interview, INTERVIEW_LEGACY_NEEDLES);
});

for (const [name, path] of INTERVIEW_SKILLS) {
  Deno.test(`${name} points at interview.md instead of restating it`, async () => {
    const skill = await readRepoFile(path);
    assertStringIncludes(skill, "references/interview.md");
    assertExcludesAll(skill, INTERVIEW_LEGACY_NEEDLES);
    if (path === CODEX_PLAN) {
      assertIncludesAll(skill, [
        "Keep dependent questions sequential",
        "continue independent work",
        "Wait for required answers",
      ]);
    }
  });
}

Deno.test("contract.md defines every fixed string once", async () => {
  const contract = await readRepoFile(CONTRACT);
  assertIncludesAll(contract, [
    ...REQUIRED_SECTIONS,
    ...CC_TAGS,
    ...PLAN_READY_LINES,
    ...REVIEWER_VOCAB,
    "PENDING APPROVAL — $impl [plan-path]",
    "`cc-<n>`",
    ".evidence.json",
    ".gate.log.md",
    ".gate.diff",
    ".rereview-<n>.gate.diff",
    "[BLOCKED: gate escalated]",
    "BLOCKED BY USER",
  ]);
});

for (const [needle, files] of CONTRACT_MIRRORS) {
  Deno.test(`contract string is carried verbatim: ${needle.slice(0, 40)}`, async () => {
    for (const path of files) {
      assertStringIncludes(await readRepoFile(path), needle, path);
    }
  });
}

Deno.test("skills and prompts reference contract.md rather than deleted references", async () => {
  for (const path of CONTRACT_REFERRERS) {
    const body = await readRepoFile(path);
    assertStringIncludes(body, "references/contract.md", path);
    assertExcludesAll(body, ["evidence-grades.md", "requirement-checklist.md"]);
  }
  for (const path of INTERVIEW_REFERRERS) {
    assertStringIncludes(
      await readRepoFile(path),
      "references/interview.md",
      path,
    );
  }
  const checkPlan = await readRepoFile(CHECK_PLAN_SCRIPT);
  assertExcludesAll(checkPlan, ["evidence-grades.md"]);
});

Deno.test("check-plan.ts mirrors the contract vocabulary", async () => {
  const checkPlan = await readRepoFile(CHECK_PLAN_SCRIPT);
  const contract = await readRepoFile(CONTRACT);
  for (const heading of REQUIRED_SECTIONS) {
    assertStringIncludes(checkPlan, `"${heading}"`, heading);
  }
  for (const tag of CC_TAGS) assertStringIncludes(checkPlan, `"${tag}"`);
  for (
    const needs of [
      "sudo",
      "auth",
      "dialog",
      "role switch",
      "dev server",
      "real PR",
      "device",
      "interactive session",
    ]
  ) {
    assertStringIncludes(checkPlan, `"${needs}"`);
    assertStringIncludes(contract, needs);
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
    "Approval Summary",
    "PENDING APPROVAL",
    "$impl [plan-path]",
    "full plan body only when requested",
    "Preserve any broader execution authorization",
  ]);
  assertInOrder(output, [
    "**Overview**",
    "**Approach**",
    "**Files to Change**",
    "**Completion Criteria**",
    "**Test Strategy**",
    "**Execution**",
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

Deno.test("Codex plan selects independent review before the trivial bypass", async () => {
  const skill = await readRepoFile(CODEX_PLAN);
  const parse = section(skill, "## PARSE");
  const selection = section(skill, "### Independent review selection");
  const deepen = section(skill, "## DEEPEN");
  const riskIndex = parse.indexOf("### Independent review selection");
  const bypassIndex = parse.indexOf("Trivial short-circuit");

  assert(riskIndex >= 0 && bypassIndex > riskIndex);
  assertIncludesAll(selection, [
    "trust boundaries",
    "review or approval instructions",
    "one-line",
  ]);
  assertIncludesAll(deepen, [
    "### Main-session review",
    "one `plan-critic`",
    'fork_turns: "none"',
    "FALSIFIED",
    "UNVERIFIED",
    "does not grant write, network, credential, shell, or any tool permission beyond active Codex policy",
  ]);
  assertExcludesAll(skill, [
    "DEEPEN subagent dispatch is normally mandatory",
    "Spawn the plan-adversarial subagent and the plan-simplifier subagent in parallel",
    "Otherwise start a fresh critic for the next round",
    "auto-spawns the `code-simplifier`",
  ]);
});

Deno.test("Codex delegation policy is deployed without model or size gates", async () => {
  const policy = await readRepoFile("home/programs/codex/subagent-policy.md");
  const nix = await readRepoFile("home/programs/codex/default.nix");
  assertStringIncludes(nix, "builtins.readFile ./subagent-policy.md");
  assertStringIncludes(
    nix,
    "builtins.readFile ../agents/shared/comment-conventions.md",
  );
  assertIncludesAll(policy, [
    "main session",
    "shared skills",
    "explicit",
    'fork_turns: "none"',
  ]);
  assert(!/gpt-\d|Astra|20 files|500 lines/i.test(policy));
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
    "In both, A7 is non-blocking.",
    "Codex carries prior agreement forward without another approval, while Claude retains its skill-defined cadence.",
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

// opencode 側の配線は 2 ファイルに別れた同じリテラルで成立するため、片方だけ改名しても
// build も lint も通り、opencode だけが黙って規則を受け取らなくなる。
Deno.test("Vault-first policy reaches both Codex and opencode", async () => {
  const policy = await readRepoFile(
    "home/programs/agents/shared/vault-policy.md",
  );
  assertInOrder(await readRepoFile("home/programs/codex/default.nix"), [
    "builtins.readFile ./subagent-policy.md",
    "builtins.readFile ../agents/shared/vault-policy.md",
  ]);
  assertStringIncludes(
    await readRepoFile("home/programs/agents/default.nix"),
    '".agents/vault-policy.md"',
  );
  assertStringIncludes(
    await readRepoFile("home/programs/opencode/opencode.json"),
    '"{env:HOME}/.agents/vault-policy.md"',
  );
  assertIncludesAll(policy, [
    "more than one defensible answer",
    "`llm-wiki` skill's `query` verb",
    "Skip it only for what the current repository settles",
  ]);
});
