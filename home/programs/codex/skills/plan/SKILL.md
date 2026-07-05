---
name: plan
description: Codex design-first planning skill. Mirrors Claude `/plan`'s seven named phases (PARSE → AGREE → EXPLORE → DRAFT → DEEPEN → DECOMPOSE → ACTIVATE) and runs only when the user explicitly invokes `$plan <request>`. Auto-loading is disabled by agents/openai.yaml.
---

# $plan

Creates an implementation plan in Codex CLI. This skill mirrors Claude Code's `/plan` (`~/.claude/skills/plan/SKILL.md`, worktree path `home/programs/claude/skills/plan/SKILL.md`) with seven named phases. It is started explicitly with `$plan <request>`. When it finishes, it creates `~/.codex/plans/.pending-<cwd-hash>` as a UI-pointer marker for the tmux picker. `$impl` promotes `.pending-` to `.active-` at the start of its run.

Do not write code or create files until you have agreed on the design with the user and produced an approved plan. This applies to every request regardless of perceived difficulty.

## Anti-Pattern: "This Is Too Simple To Need A Design"

Every request goes through PARSE → AGREE. No exception for typo fixes, single config flips, or one-line copy edits. "Simple" requests are exactly where unverified assumptions cause the most wasted work. For trivial work the design body can be one or two sentences, but **presentation and agreement are mandatory**.

## Quick Start

```
$plan <feature description>
$plan "make notifications API async to reduce error rate"
$plan "typo fix in README"               # trivial still goes through AGREE — design body can be one sentence
```

Once `$plan` ends with PENDING APPROVAL, the user types `$impl` as a top-level prompt to approve and execute.

## Phase overview

PARSE → AGREE → EXPLORE → DRAFT → DEEPEN → DECOMPOSE → ACTIVATE.

AGREE is conversational and is the Codex implementation of the Direction Agreement Gate (Codex has no AskUserQuestion API, so AGREE is realized through the Blocking Interview Protocol with `$plan --answer` continuation). DEEPEN keeps the Critic + Adversarial + Simplifier subagents as default safety nets, with an additional inline over-engineering flag-only self-review layer.

## Argument extraction

Codex skills do not have Claude's `$ARGUMENTS` expansion. If the user invokes `$plan README update`, the verbatim user prompt `$plan README update` is passed into this skill body.

First action: read the received user prompt and interpret it with this priority order.

1. If the prompt starts with `^\s*\$plan\s+--answer(?:\s+|$)`, treat it as a continuation answer for the Blocking Interview before normal `$plan <request>` parsing. Read the matching `.clarifying-<cwd-hash>.json`, merge the saved `request` with this `<answer>`, and resume AGREE. Continue only if the `interviewId` shown with the question matches the marker.
2. If the prompt starts with `^\s*\$plan(?:\s+|$)`, extract everything after `$plan` as the request.
3. If the request is empty, ask the user for the implementation request and end the turn. Treat the next answer as the request.

Guaranteed continuation syntax is `$plan --answer <answer>`. If `$plan --answer` arrives without a matching `.clarifying-<cwd-hash>.json`, tell the user that no active clarification session was found and ask them to restart from `$plan <request>`, then end the turn.

## Prerequisites

DEEPEN depends on Codex subagent dispatch.

- `~/.codex/agents/plan-critic.toml`
- `~/.codex/agents/plan-adversarial.toml`
- `~/.codex/agents/plan-simplifier.toml`
- `~/.codex/agents/code-simplifier.toml` (used by `$impl` per-task on large diffs; see `$impl` SKILL.md)

## Core behavior

`$plan` exists to produce a plan that lets the implementer execute without drifting from user intent. Do not proceed to plan creation merely because an implementation path is technically visible.

For small, medium, and large requests, do not create the plan file, evidence sidecar, or pending marker until user-intent decisions are resolved. Resolved means the user answered, the user explicitly authorized a stated assumption, or the remaining uncertainty is codebase-recoverable technical discovery with a concrete downstream `next:`.

Self-resolve observable facts before asking. Facts may come from code, config, logs, existing issues, and the current conversation. Do not infer desired behavior, priorities, scope boundaries, success criteria, risk tolerance, or trade-off acceptance from observation.

Facts can be inferred from observation; user intent cannot.

If the current context prevents actual investigation, such as dry-run, read-only smoke, or first-message-only instructions, do not end with only "I will investigate." Briefly list observable items as `Self-resolved later`, ask the highest-impact remaining `User decision`, include a recommended answer and rationale, then end the turn.

Every real clarification question must include a recommended answer and a short rationale. If no recommendation is possible, the question is too broad or under-researched. Narrow it or investigate enough to make a defensible recommendation.

## PARSE

### Restate

Summarize the user's request in one sentence. This is a restate of understanding and does not replace an Ask.

### Complexity estimate

Estimate complexity with quick `rg`/`fd` probes (no Explore subagents yet):

| Level | Signals | Scope |
|---|---|---|
| trivial | typo / comment / single config value / one-line copy edit | 1 file, <10 lines, no design decision |
| small | single module addition, follows a clear existing pattern | 1-3 files, <100 lines |
| medium | multi-file feature, follows existing conventions | 3-10 files, 100-500 lines |
| large | cross-cutting change or new architectural piece | 10+ files, 500+ lines |
| xl | multiple subsystems or structural shift | propose splitting to the user |

For `xl`, step out of the normal flow and ask the user whether to decompose into independently-scoped sub-projects before going further.

**Ambiguity Gate**: if the request cannot be restated in one sentence (uninterpretable / contradictory / 1-2 words with no signal), re-elicit through AGREE before drafting.

Trivial short-circuit: if complexity is trivial, skip DEEPEN and go directly to DRAFT with a minimal plan: Context, Files to Change, Verification Commands, Definition of Done, Completion Criteria, and one task. AGREE is still mandatory — even trivial requests get a one-sentence direction confirmation.

## AGREE

The Direction Agreement Gate. Conversational. Goal: agree on *Purpose* and *Approach* before any plan body is drafted. Codex implements AGREE through the **Blocking Interview Protocol** because Codex CLI has no AskUserQuestion API; user answers arrive as natural-language turns or guaranteed `$plan --answer <answer>` continuations.

**Key principles (apply throughout AGREE):**
- **One question at a time.** Each turn asks a single question. Do not pack multiple questions into one message just because the format allows it.
- **Multiple-choice preferred.** Present concrete options with the AI's recommended choice marked. Open-ended only when no recommendation can be formed — and if no recommendation can be formed, push the question back to self-resolve first.
- **State the tradeoff in one sentence.** When listing approaches, name the axis in one sentence (e.g. "existing-asset reuse vs. clean-slate freedom"). Do not pad with pros/cons bullets.
- **No trivial exception.** Even trivial requests go through AGREE. The design body can be one sentence, but agreement is mandatory.

**Steps A1–A7 (Codex realization via Blocking Interview Protocol):**

- **A1 Purpose check** (one question): present the restate; ask "is this right + anything to add?". Wait for the user's response (natural-language turn or `$plan --answer`).
- **A2 Re-ask**: if the answer is empty or ambiguous, stay in this phase and ask again — still one question per message.
- **A3 List approaches**: 2-3 candidate approaches, each labelled with the tradeoff axis in one sentence.
- **A4 Recommend**: name the AI's recommended approach and give 1-2 sentences of reasoning.
- **A5 Approve approach** (one question): "go with recommended / pick another / modify". Wait for the user's response.
- **A6 Companion consent** (only when upcoming questions are likely visual — UI mockups, layout comparisons, etc.): offer `/agent-browser` in a standalone message, once. Skip A6 entirely when no visual questions are anticipated.
- **A7 Summarise**: one-sentence summary of the agreed direction. Wait for the user's OK; on OK, advance to EXPLORE.

AGREE produces three subsections that get written into the plan body (preserving the downstream Critic parse contract): `### Assumptions`, `### Self-resolved`, `### Unresolved Items`. See `### AGREE output` below.

If the user changes direction mid-AGREE, go back to A3 and restart the approach list. No penalty for revisiting.

### Requirement Clarification

This subsection defines the **Blocking Interview Protocol** that backs AGREE for non-trivial `$plan` requests.

Use `home/programs/agents/shared/plan/references/requirement-checklist.md` (public path `~/.agents/skills/plan/references/requirement-checklist.md`) as the judgment lens.

Clarity-gated loop: AGREE is clarity-gated. For small, medium, large, and xl requests, keep asking as needed until the request is clear enough to write an implementation plan. There is no fixed maximum number of clarification rounds. `trivial` short-circuits AGREE to a single A1 confirmation.

Interview gate: every unresolved ambiguity must be classified before plan creation.

| Bucket | Meaning | Action |
|---|---|---|
| **Observed fact** | Observable from codebase, logs, docs, existing issues, or current conversation | Self-resolve with lightweight grep/read. Do not record secrets, tokens, or credentials in plans or logs. |
| **User decision** | Depends on desired behavior, priority, scope boundary, audience, risk tolerance, success criteria, or trade-off acceptance | Ask the user. Do not convert to Draft assumption just because a reasonable default exists. |
| **Technical deferral** | Codebase-recoverable but too heavy for an AGREE lightweight probe | Record in `### Unresolved Items` with a concrete `next:` for EXPLORE, DEEPEN, or implementation. |
| **Draft assumption** | User explicitly allowed proceeding with an assumption, or the detail is non-blocking technical/default behavior | Record in `### Assumptions` with a reason. |

If any `User decision` remains, create no plan file, evidence sidecar, or pending marker in this turn. Ask and end the turn.

Each clarification pass:

1. **Step A Walk**: Walk the 8 observations: Why, What, Who, When, Where, How, Success, Failure. Apply prior answers, then identify NotClear items. Restate is not a substitute for Ask.
2. **Step B Triage**: Choose Ask / Assume / Self-resolve by cost-if-wrong and downstream recoverability. For items not asked, record the no-ask reason in `### Assumptions`, `### Self-resolved`, or `### Unresolved Items`. Never assume values that depend on user intent without an explicit user choice.
3. **Step C Self-resolve probe**: Resolve anything answerable by lightweight grep/read. If an item is codebase-recoverable but too heavy for AGREE, defer it with a concrete `next:`. If it depends on user-only knowledge, promote it to Ask.
4. **Step D Re-Ask trigger detection**: Triggers are (i) an open-ended return question in a prior answer, (ii) ambiguous or empty answer, (iii) a tentative assumption still NotClear after re-walk, and (iv) carried-over Ask items. If the same trigger remains, do not advance by count exhaustion; ask the user to choose between proceeding with a stated assumption, proceeding with stated risk, continuing clarification, or scoping it out.
5. **Step E Ask issuance**: Combine remaining real questions by impact priority, maximum 4 questions per round. Every question must include a recommended answer and short rationale. Immediately before asking, create or overwrite `~/.codex/plans/.clarifying-<cwd-hash>.json` with `request`, `questions`, `selfResolvedSummary`, `createdAt`, `cwd`, `version`, and `interviewId`. Show `interviewId` in the question text and verify it on continuation. Starting a new Blocking Interview overwrites the previous marker.
6. **Step F Wait**: Say: `Here I will wait for your answer. In the next turn, answer naturally, or use $plan --answer <answer> if you need guaranteed continuation.` Then end the turn.
7. **Step G Answer handling**: Best-effort attach a natural-language next-turn answer to the latest `.clarifying-<cwd-hash>.json`. For guaranteed continuation, use `$plan --answer <answer>`. If the user chooses the recommended answer, record it. If the user explicitly says to proceed with a stated assumption, record user-judgment-bound observation in `### Assumptions` with `user-overridden: true`. Empty or ambiguous answers become re-Ask triggers.
8. **Step H Cleanup**: When the clarity gate is satisfied, delete the marker and continue to EXPLORE. After successful plan creation, delete `.clarifying-<cwd-hash>.json`. If a new non-clarifying `$plan <request>` succeeds, also delete any old clarifying marker.

Convergence conditions, any one:

- Zero Ask / re-Ask triggers and no remaining `User decision`
- Remaining uncertainty is codebase-recoverable and recorded in `### Unresolved Items` with a concrete downstream `next:`
- User explicitly authorized a stated assumption or scoped out repeated uncertainty

### AGREE output

Write these four subsections into the plan body immediately before `## Overview`: `### Requirement Clarification` (one-line status), `### Assumptions`, `### Self-resolved`, and `### Unresolved Items`. Keep these subsection names in English for downstream parsing.

## EXPLORE

Investigate the codebase as needed for the agreed direction. The main session owns these three discovery outcomes. Usually `rg`, `sed`, file reads, and other deterministic read-only commands are enough. Explorer subagents may be used as helpers when Codex judges them useful, but their use is **optional, not mandatory and not forbidden**. Evidence from file lines, snippets, and commands must be integrated by the main session into DRAFT: Mandatory Reading, Patterns to Mirror, Test Strategy, and Completion Criteria.

EXPLORE commands are for observation only. Do not use network access, package-manager install or run-script, shell eval, write operations, credential access, or destructive commands during EXPLORE discovery unless explicitly approved by the user.

**Three discoveries** (everything else is noise):

1. **Existing patterns** — collect existing conventions for naming, error handling, config, test layout, and dependency style. Record each finding with file:lines and snippet.
2. **Execution paths and boundaries** — trace entry points, data flow, state transitions, API contracts, and architectural boundaries. Record the path from trigger to observable outcome with file:lines.
3. **Existing behavior, constraints, verification conditions** — collect current behavior, invariants, related existing tests, and verification methods. Provide enough information to design Acceptance, Completion Criteria, and Test Strategy.

The main session should separate read targets by outcome, decide what local reads can cover and what an explorer should cover, and avoid repeatedly reading the same file:lines.

If explorer subagents are used, they inherit EXPLORE observation limits. They must not write, install, or access credentials, and they must return evidence with file:lines.

Consolidate findings into a **Unified Discovery Table**: `Category | File:Lines | Pattern | Key Snippet`. Skip rows that do not inform a design decision.

### Empirical analysis (existing-behavior revisions)

If `## Files to Change` contains UPDATE and behavior changes, or if the request is bug-fix, refactor, spec change, performance, CLI output, or semantic change, use one of the three mandates for empirical observation:

- historical signals: `~/.codex/plans/*.md`, `~/.codex/sessions/**/*.jsonl`, `~/.claude/retrospective-ledger.jsonl`, `git log -p`
- direct current-behavior observation: run the CLI, trigger the hook, or read effective config

Record "what the spec says" vs "what actually happens" at Tier 1/2 and add an Empirical Behavior row to the Discovery Table.

## DRAFT

Write the plan body to `~/.codex/plans/YYYYMMDDTHHmm-<slug>.md`. The slug comes from the request, max 40 characters, lowercase kebab. Before writing, run `mkdir -p ~/.codex/plans`.

### Language policy

- Skill instruction prose in this file is English.
- User-facing generated output remains in the user's configured language. In this repository, that means Japanese unless the user asks otherwise.
- Section headers are fixed English strings because DEEPEN, DECOMPOSE, and `$impl` Audit/Review locate them literally: `## Context`, `## Overview`, `## Approach`, `## NOT Building`, `## Mandatory Reading`, `## Patterns to Mirror`, `## Intentional Conventions`, `## Files to Change`, `## Task Outline`, `## Test Strategy`, `## Verification Commands`, `## Definition of Done`, `## Risks + Open Questions`, `## Deepening Log`, and `## Completion Criteria`.
- Machine-consumed contents, including `## Completion Criteria` subsections and Acceptance Criteria lines, are English.
- AGREE-output subsection headings are fixed English: `### Requirement Clarification`, `### Assumptions`, `### Self-resolved`, and `### Unresolved Items`.
- File paths, commands, and `EXPECT:` values stay as-is.

### Required sections (complexity-gated)

Plan body section contract (14 headers; Claude 12-row base plus Codex-specific `Verification Commands` and `Definition of Done`):

| Section | trivial | small | medium+ |
|---|---|---|---|
| Context | ✓ | ✓ | ✓ |
| Overview |   | ✓ | ✓ |
| Approach (incl. Alternatives Considered) |   | ✓ | ✓ |
| NOT Building |   | ✓ | ✓ |
| Mandatory Reading (P0/P1/P2 × file:lines × why) |   |   | ✓ |
| Patterns to Mirror (SOURCE: file:lines + snippet) |   |   | ✓ |
| Intentional Conventions (when applicable) |   |   | ✓ |
| Files to Change (CREATE / UPDATE / DELETE) | ✓ | ✓ | ✓ |
| Task Outline | ✓ | ✓ | ✓ |
| Test Strategy (when there is a behavior change) |   | ✓ | ✓ |
| Verification Commands | ✓ | ✓ | ✓ |
| Definition of Done | ✓ | ✓ | ✓ |
| Completion Criteria (Autonomous Verification + Requires User Confirmation + Baseline) | ✓ | ✓ | ✓ |
| Risks + Open Questions |   | ✓ | ✓ |

`Verification Commands` and `Definition of Done` are required for every complexity level because Codex `$impl` Audit and Approval Summary consume them.

The AGREE-derived `### Requirement Clarification` / `### Assumptions` / `### Self-resolved` / `### Unresolved Items` subsections are written into the plan body just before `## Overview`.

### Section-by-section confirmation

After writing each non-trivial section, briefly ask "looks good so far?" in the user's configured language. For trivial / small plans, the whole body can be confirmed at once at the end. The goal is to catch direction drift before DEEPEN. In Codex, confirmation is a natural-language turn; there is no AskUserQuestion API.

Keep the plan body lightweight (target ~120-180 lines, excluding the Deepening Log).

### Completion Criteria item tags (medium+)

Tag every Autonomous Verification item (`$impl` Audit consumes these):

- `[file-state]`: observable with Read / Grep / Glob
- `[orchestrator-only]`: requires host access commands such as `nix flake check`, `darwin-rebuild`, or sudo; main session pre-runs and records evidence in the sidecar before the final gate
- `[outcome]`: circular by design (e.g. `$impl` built-in Review PASS); derived from the review's own verdict

When unsure, default to `[orchestrator-only]`.

`## Completion Criteria` is machine-consumed and must keep these subsection names:

```markdown
## Completion Criteria

### Autonomous Verification
- [file-state] ...
- [orchestrator-only] ...

### Requires User Confirmation
- None

### Baseline
- Each implementation task has raw verification evidence recorded in the sidecar JSON.
- The reserved `Final Audit + Review` task is completed only after `$impl` emits `AUDIT_VERDICT: PASS` and `REVIEW_VERDICT: PASS`.
```

`[outcome]` may appear under `### Autonomous Verification`, but `$impl` Audit excludes it as circular and checks it only after final Review. Verdict format `^(AUDIT|SECTION|REVIEW)_VERDICT: (PASS|FAIL)(\s|$)` is consumed by `$impl` Audit + Review.

## DEEPEN

Iterative critique. Logs go to `<plan-basename>.log.md` (separate from the plan body). Prompts live in `~/.agents/skills/plan/references/`. DEEPEN subagents are predefined in `~/.codex/agents/{plan-critic,plan-adversarial,plan-simplifier}.toml`.

Explicit `$plan <request>` invocation is approval for the planning workflow including DEEPEN subagent deepening. Do not ask the user again for permission to start `plan-critic`, `plan-adversarial`, or `plan-simplifier`. This approval is limited to spawning named review agents. It does not grant write, network, credential, shell, or any tool permission beyond active Codex policy. Skip DEEPEN only for trivial short-circuit, missing prerequisites, unavailable spawn tool, or explicit user instruction to skip deepening/subagent review. If spawn is unavailable, record the reason in the Deepening Log and user output; do not treat local self-review as successful subagent deepening. Do not replace required subagent deepening with local self-review only because additional user permission was not requested.

### Subagent Lifecycle Budget

This is the DEEPEN Subagent Lifecycle Budget. When DEEPEN starts subagents, keep a lightweight ledger: `agent_id / role / phase / status / closed`. After integrating a subagent result into the plan, Deepening Log, or Consolidated Interview queue, mark it result-integrated and close it with `close_agent` before the next step or round. Use `close_agent` only for result-integrated or terminal/known completed agents, not to interrupt running work.

EXPLORE explorers are optional and not the main target of this lifecycle budget. In normal DEEPEN operation, keep live subagents bounded, with Adversarial + Simplifier as the usual true-parallel pair. Before DEEPEN, close any known completed but unclosed subagent.

If spawn fails with `agent thread limit reached`, close known completed / terminal agents, then retry the failed dispatch exactly once. If retry still fails, do not keep spawning; follow that step's failure/degrade rule.

### Critic Subagent (each round)

Extract `max-rounds` from the argument hint if present, default 2 and cap 5, for example `$plan --max-rounds=3 ...`. Prepare the plan body written in DRAFT and project AGENTS context (`~/.codex/AGENTS.md` and this repository's AGENTS.md).

For each round, spawn the `plan-critic` subagent:

```text
Spawn the plan-critic subagent.
plan-critic input:
  {plan_content}: <full plan body>
  {project_context}: <CLAUDE.md summary + repo facts>
  {prior_log}: <previous round entries from <basename>.log.md, or "first round">
Wait for its response.
```

The Critic contract returns `CONVERGED` or `ITERATE` on the line immediately after `### Verdict`. Even if a `Reasoning:` line follows, read only that next verdict line.

The main session triages Critic output:

- **Self-resolvable**: resolve by grep/read and apply to the plan with `-- Why: ...` rationale
- **Needs user input**: add to the Consolidated Interview queue
- **Reject**: conflicts with a prior user decision or is irrelevant

Verdict extraction: `rg -m1 -A1 '^### Verdict$' <subagent-output>` and read the second line as `CONVERGED` or `ITERATE`. Append a Round N entry with verbatim subagent output to `<plan-basename>.log.md`.

After triage, verdict extraction, and log append, close that round's `plan-critic` agent. Ensure the critic is closed before spawning the next round.

Continue to the next step if any of these is true:

- Verdict is `CONVERGED`
- max-rounds reached
- same issue repeats for 2 consecutive rounds
- zero Critical Issues

Otherwise start a fresh critic for the next round.

### Adversarial + Simplifier (true parallel)

Spawn `plan-adversarial` and `plan-simplifier` in parallel in the same message:

```text
Spawn the plan-adversarial subagent and the plan-simplifier subagent in parallel.

plan-adversarial input:
  {plan_content}: <full plan body>
  {project_context}: <CLAUDE.md summary + repo facts>
  {file_paths}: <list of key file paths referenced in the plan>

plan-simplifier input:
  {plan_content}: <full plan body>
  {original_user_request}: <the user's original request that drove the plan>
  {project_design_principles}: <CLAUDE.md YAGNI/KISS/DRY framing>

Wait for both, then return their findings together.
```

Adversarial returns findings tagged `(FALSIFIED|UNVERIFIED|VERIFIED|DESIGN_QUESTION)`. Simplifier returns proposals tagged `(HIGH|MEDIUM|LOW)` confidence. Auto-apply only HIGH subtractive proposals; send MEDIUM/LOW to the Consolidated Interview queue.

Before Adversarial + Simplifier dispatch, verify result-integrated subagents in the ledger are closed. After reflecting Adversarial/Simplifier results into the plan or queue, close both.

Parallel dispatch failure: if one side is missing despite same-message spawn, treat the missing side as ITERATE for Adversarial or no proposals for Simplifier. Do not re-fire in that round. If the reason is `agent thread limit reached`, clean up as defined above and retry the missing side exactly once.

### Inline over-engineering self-review

After the last Critic round and the Adversarial/Simplifier pair, do one inline pass with YAGNI/KISS/DRY in mind. **Only flag — do not delete.** Annotate each suspect spot with `<!-- over-eng? -->` and surface them in the Consolidated Interview. Deep simplification subagent dispatch (`plan-simplifier`) is already done in the previous step; this inline self-review is an additional flag-only layer that the main session runs without spawning a subagent.

### Consolidated Interview

At round end, combine needs-user-input items from Critic triage, Adversarial findings, Simplifier MEDIUM/LOW proposals, and inline over-engineering flags into one text list, maximum 4 questions, then end the turn. Codex has no AskUserQuestion API here, so the user answers naturally next turn (or via `$plan --answer`). First show a `Self-resolved items:` block. Every real question follows the AGREE rule: recommended answer plus short rationale. If no recommendation is possible, narrow or investigate before asking. Items already resolved in AGREE do not re-enter unless the Critic surfaces them.

### Definition of Done pipeline

Design Completion Criteria using the `[file-state]` / `[orchestrator-only]` / `[outcome]` tag scheme defined in DRAFT. Cross-check that every implementation task's Verification Commands have a matching `[file-state]` or `[orchestrator-only]` row.

### Deepening Log artifact

Append verbatim round output to `~/.codex/plans/<plan-basename>.log.md`. Redact secrets, tokens, and credentials as `[REDACTED]`; never save raw secrets.

```markdown
### Round 1

### Critic
<verbatim subagent stdout>

### Adversarial
<verbatim subagent stdout>

### Simplifier
<verbatim subagent stdout>

### Applied changes
- <bullet 1>: <Why>
```

Round entries begin with `### Round N`. Subsection structure is not machine-consumed; paste subagent formats as returned. The plan body must contain exactly one `## Deepening Log` section with only `See [./<basename>.log.md](./<basename>.log.md)`.

## DECOMPOSE

The main session registers tasks with Codex `update_plan` and initializes the evidence sidecar JSON. No subagent dispatch in DECOMPOSE.

### update_plan constraints

- Return value is only literal `"Plan updated"`. No task IDs are returned.
- Fields are only `step` (1-5 word short phrase) and `status` (`pending|in_progress|completed`). No metadata.
- Persistent within one session and preserved across `codex resume`.

### 1-call DECOMPOSE

Register tasks in one `update_plan` call as an ordered array. There is no Pass 1/2 split because no returned IDs means no stable `blockedBy` concept:

```text
update_plan({
  explanation: "Decompose plan into impl tasks",
  plan: [
    { step: "<task 1 short subject>", status: "pending" },
    { step: "<task 2 short subject>", status: "pending" },
    ...
    { step: "Final Audit + Review", status: "pending" }
  ]
})
```

### Sidecar JSON initialization

Initialize `~/.codex/plans/<plan-basename>.evidence.json` in the same order as tasks. The helper assigns IDs by array order: `task-1`, `task-2`, etc. Do not depend on execute bits; use this permissioned command shape:

```bash
deno run --allow-env=HOME --allow-read --allow-write --allow-run=git --no-prompt ~/.codex/scripts/codex-plan-state.ts init /Users/$USER/.codex/plans/<basename>.evidence.json '<basename>.md' '["subject 1","subject 2","Final Audit + Review"]'
```

The helper exits 1 if `subjects-json` does not end with `Final Audit + Review`. Sidecar writes are atomic via tmpfile + rename.

The trailing `Final Audit + Review` entry is a marker for `$impl`'s built-in Audit and fresh Codex subagent Review phase. It is not an implementation task.

### Decomposition Rules

1. One task equals one verifiable unit.
2. Verification Commands are included in each implementation task. The only verification-only task allowed is `Final Audit + Review`.
3. Keep separation of concerns.
4. Each task has three elements: target files, expected behavior, verification commands + EXPECTED output.
5. The final `Final Audit + Review` task is the entry point for `$impl` built-in Audit + Codex subagent Review. No separate skill invocation is required because Codex has no skill-to-skill invocation API.

`$impl` auto-spawns the `code-simplifier` subagent when a per-task diff is ≥ 20 files or ≥ 500 lines — do not create a standalone simplifier task in the plan.

### Acceptance criteria by change type

Use the Claude version table as a reference: `~/.claude/skills/plan/SKILL.md`, worktree path `home/programs/claude/skills/plan/SKILL.md`.

## ACTIVATE

Write the `.pending-<cwd-hash>` UI-pointer marker so the tmux picker can show this cwd's plan/task progress. The marker is a display pointer only — it does not gate edits. `$impl` promotes `.pending-` to `.active-` at the start of its run (it calls the helper's `promote` subcommand); do not create `.active-` here.

Delegate marker operations to the deterministic helper. Do not build cwd-hash or marker paths inline in shell.

```bash
~/.codex/scripts/codex-plan-marker.ts activate-pending '<PLAN_FILE_PATH from DRAFT>' "$PWD"
```

`<PLAN_FILE_PATH from DRAFT>` is the absolute path decided in DRAFT and substituted by the agent as a literal string, not via bash variable expansion. The helper canonicalizes `$PWD` to the same cwd-hash the picker derives, creates `~/.codex/plans`, removes old active markers for re-plan, and atomically writes the pending marker.

### Output to user

The user must be able to decide whether to approve `$impl` without opening the plan file. First output an approval-ready summary, then the plan body and metadata block. `## Approval Summary` is extracted from plan sections and must show `Overview`, `Approach`, and `Files to Change` first. The summary is the approval decision surface, not a duplicate of the plan body, so keep it compact.

````markdown
## Plan

## Approval Summary

### Overview
<2-4 bullets or a short paragraph that states what Codex understood and what will change. Source: ## Overview. If ## Overview is absent for trivial plans, use the request and ## Context.>

### Approach
<3-5 bullets describing the intended implementation direction, key design choices, and notable non-goals/tradeoffs. Source: ## Approach. If ## Approach is absent, derive only from ## Task Outline and ## NOT Building.>

### Files to Change
<tree-style code block showing only affected paths, annotated with CREATE / UPDATE / DELETE and one-line impact. Source: ## Files to Change. Collapse by directory and point to the plan file when the tree would exceed ~20 lines.>

```text
path/
└── to/
    └── file.ext  UPDATE: one-line impact
```

### Completion Criteria
<compact bullets describing what must be true for the plan to be complete. Source: ## Completion Criteria plus task-level expected behavior / verification from ## Task Outline. Preserve the plan's Completion Criteria vocabulary; do not rename this to Acceptance Criteria.>

### Test Strategy
<compact bullets describing existing coverage, tests to add/update, and any justified omissions. Source: ## Test Strategy when present. If ## Test Strategy is absent, derive only from ## Verification Commands and ## Completion Criteria and state that no separate Test Strategy section exists for this plan.>

### Execution
- Task outline: <implementation task subjects, excluding Final Audit + Review; max 5 tasks, one line each> (source: ## Task Outline)
- Verification: <commands and expected outcomes; max 3 commands, summarize if more> (source: ## Verification Commands)
- Risks / open questions: <top 1-3 items, or `None` when the section is absent> (source: ## Risks + Open Questions)

## Plan body
<full plan body, verbatim unless xl fallback applies>

---

## Plan ready
- File: <plan path>
- Complexity: <trivial/small/medium/large/xl>
- Tasks: <count> (+ Final Audit + Review)
- Status: PENDING APPROVAL - type `$impl` to approve and execute

AI self-chaining `$impl` does not fire the UserPromptSubmit hook, so `.pending-` is not promoted to `.active-`. Approval is established only by the user's explicit top-level `$impl` keystroke.
````

If an xl plan body exceeds roughly 600 lines, replace `## Plan body` with a TOC of section headings plus the plan path. Do not omit Approval Summary.

## Integration with existing tooling

- `home/programs/agents/shared/plan/references/requirement-checklist.md` (Codex public path `~/.agents/skills/plan/references/requirement-checklist.md`, Claude public path `~/.claude/skills/plan/references/requirement-checklist.md`): shared with the Claude version through whole-dir linking. AGREE judgment lens.
- `home/programs/agents/shared/plan/references/critic-prompt.md` / `adversarial-prompt.md` (Codex public path `~/.agents/skills/plan/references/`, Claude public path `~/.claude/skills/plan/references/`): DEEPEN subagent prompts. `~/.codex/agents/{plan-critic,plan-adversarial}.toml` points to these shared workspace paths.
- `~/.codex/agents/{plan-critic,plan-adversarial,plan-simplifier,code-simplifier}.toml`: custom agent definitions required by DEEPEN and `$impl`. Dotfiles source is `home/programs/codex/agents/`.
- `$impl` skill: executes the `update_plan` task list registered in DECOMPOSE and finally emits `^(AUDIT|SECTION|REVIEW)_VERDICT: (PASS|FAIL)(\s|$)` from its built-in Audit + Codex subagent review phase.
- Marker helper (`codex-plan-marker.ts`): writes the tmux picker's UI-pointer markers. Owns ACTIVATE pending activation, `$impl` start-of-run `.pending-` → `.active-` promotion and active plan-path resolution, and active cleanup after final PASS. The markers are display pointers only and do not gate edits.

## Design notes

- **EXPLORE is main-session owned exploration**: the main session fills discovery outcomes and may use explorer subagents only as helpers.
- **DEEPEN subagent dispatch is normally mandatory**: `$plan <request>` includes approval for DEEPEN subagent deepening. Do not ask for extra user permission and do not replace it with local self-review without an explicit skip condition.
- **DEEPEN Subagent Lifecycle Budget**: close result-integrated subagents with `close_agent` and keep live subagents bounded.
