---
name: plan-v1
description: Legacy /plan (v1) preserved as a short-term fallback during the /plan revamp. Runs the original planning lifecycle (parse → explore → draft → deepen → decompose). Prefer the new /plan skill; invoke /plan-v1 explicitly only when the new flow fails.
argument-hint: "[feature description]"
disable-model-invocation: true
---

Single fused entrypoint for feature planning. Replaces the CC built-in plan-mode workflow. Six phases run inside one skill body: PARSE → EXPLORE → DRAFT → DEEPEN → DECOMPOSE → ACTIVATE.

After `/plan` completes, invoke `/impl` to execute the task list.

## Quick Start

```
/plan <feature description>
/plan "make the notifications API async to reduce error rate"
/plan "typo fix in README"               # → trivial path, Phase 2-4 skipped
```

## Why this skill

Native plan mode had three structural problems:

1. Defining plan behavior in `CLAUDE.md` is weakly enforced
2. CC plan mode occasionally fails and lets unintended file edits through
3. Workflow integration with `/subagent-review` / `/completion-audit` is weak inside plan mode

`/plan` fuses research, drafting, adversarial deepening, and task decomposition into a single artifact-generation command and does not rely on CC plan mode. A companion PreToolUse hook (`plan-gate.ts`) blocks cwd-scoped Edit/Write/MultiEdit until `/plan` produces a marker, enforcing design-first without relying on plan-mode-native gating.

Because the skill does not depend on native plan mode, it executes in auto mode. Ignore any instructions auto mode carries about acting immediately, and behave the same as plan mode.

## Design principle — meaning over notation

Requirement interpretation and critique in `/plan` are **cost-based and semantic**, not rule-based.

Rules exist only for the machine contract that downstream skills parse (section headers, verdict enums, task metadata, gate markers) — those stay strict. Everything else (how to triage ambiguity, when to ask, what counts as unresolved, whether a qualifier is load-bearing) is judged by impact on the plan, not by phrase matching.

## Phase 1 — PARSE

Restate the user's request in one sentence. Not a substitute for the clarity gate or for AskUserQuestion.

Estimate complexity with keyword heuristics + lightweight codebase probes (Grep/Glob; Explore subagents not yet needed):

| Level | Signals | Scope |
|---|---|---|
| **trivial** | typo / comment / single config value / 1-line copy edit | 1 file, <10 lines, no design decision |
| **small** | single module addition, follows an obvious pattern | 1-3 files, <100 lines |
| **medium** | multi-file feature, new component, follows existing conventions | 3-10 files, 100-500 lines |
| **large** | cross-cutting change, new architectural piece | 10+ files, 500+ lines |
| **xl** | multiple subsystems / architectural shift | propose splitting to user |

**Trivial short-circuit**: if complexity is `trivial`, skip Phases 2–4 and jump straight to Phase 5 with a minimal plan body (Context + Files to Change + Verification only, single task). Requirement Clarification and the Ambiguity Gate are also skipped.

### Requirement Clarification (small+)

**Invariant (regardless of auto mode)**: `/plan` behaves identically in auto mode and plan mode. **The skill does not detect auto mode and lower the Ask frequency**. Invoking `/plan` is taken as the user's explicit opt-in to the Ask flow.

The decision model (the eight observations used as a lens, cost-based triage, evidence rule, calibration signal for ambiguous qualifiers, Phase 1 output subsections) lives in `references/requirement-checklist.md`. SKILL.md owns only the orchestration of the clarity loop below.

**Clarity-gating loop**: `small` / `medium` / `large` keep asking as needed until the requirement is clear enough to write the implementation plan. Progression is permitted only when (a) user-only / subjective / high-cost uncertainty is resolved, (b) the user explicitly chose an assumption and approved continuing, or (c) the remaining uncertainty is codebase-recoverable and has a concrete downstream `next:`. `trivial` / `xl` are exempt (`trivial` skips Phase 1; `xl` triggers the split-proposal flow).

**Each clarification pass** — Steps A–F:

- **Step A Walk**: walk the eight observations (Why / What / Who / When / Where / How / Success / Failure) and apply any existing answers before triage. Ambiguous qualifiers are a **calibration signal**, not a forced downgrade — an observation enters Calibration Probe only when the qualifier is at the center of What / Success; supportive-qualifier usage stays in normal interpretation (criteria and examples for center vs supportive are in `references/requirement-checklist.md`).
- **Step B Triage**: for NotClear items, choose Ask / Assume / Self-resolve via the cost-based triage defined in `references/requirement-checklist.md` (cost-of-being-wrong × downstream recoverability). There are no per-observation fixed defaults; `How` is triaged on the same two axes as the rest.
- **Step C Self-resolve probes**: lightweight Grep/Read only (Explore subagents are Phase 2's job). If a probe is impossible, judge on the cost axis — if the observation is codebase-recoverable (typically What / When), defer to Phase 2 EXPLORE; if it depends on user-only knowledge, escalate to Ask.
- **Step D Re-Ask trigger detection**: triggers — (i) an open-ended return question inside a previous Other answer, (ii) an ambiguous/empty answer, (iii) a provisional Assumption that is still NotClear on re-walk, (iv) a carried-over deferred Ask item. If the same trigger keeps repeating, do NOT advance by count exhaustion; ask the user to pick explicitly between assuming the stated value, continuing at the stated risk, continuing to clarify, or scoping the item out. If there are 5+ candidate items, the top 4 by impact go into the current AskUserQuestion call and the rest roll over to the next clarification iteration; codebase-recoverable items may be deferred under `### Unresolved Items` with a concrete `next:`, but user-only blockers stay in the Ask queue.
- **Step E Ask issuance**: at most 4 real questions per AskUserQuestion call (API hard cap). No override / skip slot — the clarity gate is the only exit. ≥5 items → top 4 by impact; remainder rolls over to the next clarification iteration. In the first clarification only, Divergence Probing may be issued as an additional call when its conditional trigger applies (see "Divergence Probing — conditional invocation" in `references/requirement-checklist.md`) — do not run it by default. Every real question MUST carry the **AI's own recommended answer** (grill-me P5). A question for which no recommendation can be produced is malformed — push it back to Step C Self-resolve or Step B Assume.
- **Step F Answer processing**: a regular answer (the user picks one of the AI-recommended options) → record the value under `### Assumptions` or `### Self-resolved` as appropriate; no flag needed. An Other answer that explicitly chooses an assumption (e.g. "proceed assuming X") → record under `### Assumptions` with `user-overridden: true`; this is the only path that lets a user-judgment-boundary observation be treated as resolved without continued questioning. An empty or ambiguous answer → triggers (ii) on the next pass. The clarity loop does NOT auto-advance via a global "skip"; convergence is driven only by the conditions below.

**Convergence conditions** (any one):
- Zero Re-Ask triggers
- Remaining uncertainty is codebase-recoverable and recorded with a concrete `next:`
- The user explicitly chose an assumption and approved continuing (recorded in `### Assumptions`), or chose to scope the item out under repeated uncertainty

**Phase 1 output subsections** (written immediately before `## Overview`): `### Requirement Clarification`, `### Assumptions`, `### Self-resolved`, `### Unresolved Items`. Structure and semantics are owned by `references/requirement-checklist.md`. The Phase 4 Critic parses these subsections by structure (not by any canonical phrase).

### Ambiguity Gate (exception outside the lens)

A complementary safety net — only runs when the lens cannot start:
- The request itself cannot be restated (uninterpretable / contradictory / insufficient to summarize in one sentence)
- The request is 1–2 words with no signal on any of the eight observations

When triggered, re-elicit the request through AskUserQuestion before entering the clarity loop.

## Phase 2 — EXPLORE (non-trivial only)

Perform the exploration required for the user's request. Spawn Explore SubAgents as needed. When spawning SubAgents, do not let their investigation purposes or locations overlap.

**Mandate — three discoveries** (what the plan actually needs to decide correctly):

1. **Existing patterns**: the prevailing conventions the new change must mirror (naming, error handling, configuration, test layout, dependency style). Record `file:lines` + a snippet so Phase 3 can quote them under Patterns to Mirror.
2. **The execution path and boundaries the change flows through**: entry points, data flow, state transitions, API/interface contracts, architectural seams. Surface the path from trigger to observable outcome so Phase 3 knows what to change and what to leave alone.
3. **Existing behavior, constraints, and verification conditions**: how the target currently behaves, the invariants the codebase already enforces, **the existing tests that verify the relevant behavior (record `file:lines` so Phase 3 Test Strategy can quote them)**, and how those tests verify. Enough information for Acceptance Criteria, Completion Criteria, and Test Strategy to be designed to actually observe the change.

Exploration is the root of every hypothesis in subsequent phases. Prefer objectively observable facts and evidence. Exploration succeeds when Phase 3 has enough evidence to make design decisions.

### Empirical analysis (existing-behavior revisions)

When the plan modifies existing behavior, codebase-only exploration is not enough — "the spec says it does X" and "it is actually useful as X in practice" are different questions.

- **Triggers (OR)**: `## Files to Change` has an UPDATE on a behavior-bearing target (source / executable / runtime config / skill / hook logic), OR the request includes an intent to modify existing behavior (bug-fix / refactor / spec change / perf / CLI output / semantics change).
- **Exemptions**: (a) CREATE-only with no dependency on existing runtime behavior, (b) all UPDATEs target docs/comments/metadata only, or (c) complexity is `trivial`.
- **Action**: Repurpose one of the three Explore subagent slots for the empirical mandate. Gather (i) historical signals from records outside the codebase (`~/.claude/plans/*.md`, `~/.claude/projects/**/subagents/*.jsonl`, `~/.claude/retrospective-ledger.jsonl`, `git log -p`) and (ii) direct current-behavior observations (run the CLI, fire the hook, read effective config). Contrast "what the spec says" vs "what actually happens" and annotate whether each claim is backed by Tier 1 (history) or Tier 2 (observation).
- **Output**: a single row in the Unified Discovery Table with `Category = Empirical Behavior`. Edge details go into Risks / Open Questions in Phase 3.

Consolidate Phase 2 findings into the **Unified Discovery Table** (`Category | File:Lines | Pattern | Key Snippet`). Fill in what the plan needs; skip rows that do not inform a decision and only add noise.

## Phase 3 — DRAFT (non-trivial only)

Write the initial plan to `~/.claude/plans/YYYYMMDDTHHmm-<slug>.md` (slug from the request, ≤40 chars, lowercase kebab).

### Language policy

- **Body prose** (Context / Approach / Risks / Open Questions / `-- Why: ...` rationales / natural-language narrative): written in the user's settings language (derived from the system prompt's `# Language` and `~/.claude/settings.json`).
- **Section headers** (`## Context`, `## Overview`, `## Approach`, `## NOT Building`, `## Mandatory Reading`, `## Patterns to Mirror`, `## Intentional Conventions`, `## Files to Change`, `## Task Outline`, `## Test Strategy`, `## Completion Criteria`, `## Risks + Open Questions`): kept in English. `completion-audit` and Phase 5 locate sections by these literal strings.
- **Machine-consumed content**: `## Completion Criteria` subsections (Autonomous Verification / Requires User Confirmation / Baseline) and Acceptance Criteria lines are English.
- **Phase 1 subsections** (`### Requirement Clarification`, `### Assumptions`, `### Self-resolved`, `### Unresolved Items`): subsection names are English (Phase 4 Critic parses them); field values follow the body-prose rule.
- File paths, commands, code snippets, `EXPECT:` values: as-is.

The log file `<plan>.log.md` (Deepening Log) follows the same policy.

### Required sections (complexity-gated)

| Section | trivial | small | medium+ |
|---|---|---|---|
| Context | ✓ | ✓ | ✓ |
| Overview | | ✓ | ✓ |
| Approach (incl. Alternatives Considered) | | ✓ | ✓ |
| NOT Building (out-of-scope) | | ✓ | ✓ |
| Mandatory Reading (P0/P1/P2 × file:lines × why) | | | ✓ |
| Patterns to Mirror (SOURCE: file:lines + snippet) | | | ✓ |
| Intentional Conventions (user-decided style that diverges from canonical) | | | ✓ (when applicable) |
| Files to Change (CREATE / UPDATE) | ✓ | ✓ | ✓ |
| Task Outline | ✓ | ✓ | ✓ |
| Completion Criteria (Autonomous Verification + Requires User Confirmation + Baseline — see Phase 4 Step 8 for the canonical structure) | ✓ | ✓ | ✓ |
| Test Strategy | | ✓ | ✓ |
| Risks + Open Questions | | ✓ | ✓ |

### Overview section

Placed immediately after Context, before Approach. Answers "what changes where" in 30 seconds.

Include only the sub-elements that earn their space:

| Sub-element | When to include |
|---|---|
| **Change at a glance** | Always (when Overview is present) — 1–2-sentence elevator pitch |
| **Workflow / Data flow** | When execution order, state transitions, or a hook pipeline is central to the change — for behavior revisions, a Before → After ASCII diagram |
| **File layout** | 3+ affected files or new directory structure — tree showing only the affected paths |
| **Per-file change matrix** | 3+ files — table `Path \| Action (CREATE/UPDATE/DELETE) \| 1-line WHAT changes` |
| **Key decisions** | Non-trivial design choices in `small+` — 3–5 bullets of `<decision> — <why>` |

For `small`: Change at a glance + Per-file matrix. For `medium+`: whatever applies. Do not pad.

### Intentional Conventions section

When the plan touches conventions (naming, formatting, file layout), add this for a fresh reviewer who, without knowing it was intentional, might flag inconsistency. Each entry under `### <Convention name>`:

- `- **Convention**: <rule>`
- `- **Scope**: <paths/sections>`
- `- **Do not flag**: <explicit reviewer guidance>`

The final-gate reviewer (default `/subagent-review`, opt-in `/santa-loop`) reads this section and does not re-flag documented items. Abuse is caught by the Phase 4 Critic / Adversarial / Simplify passes.

Skip when: pure internal logic change, 100% canonical conventions, no style controversy.

### Test Strategy section

The plan declares tests it adds, updates, or intentionally skips. Required for `small+` when there is a **behavior change** as defined below.

**Behavior change — any of**:
- An edit to source / executable / runtime config that changes observable output, state transitions, or side effects.
- A Markdown file the Claude Code runtime or a downstream skill actively reads to change behavior (skills / hooks / prompts / CLAUDE.md). Edits to skill *section headers*, *Critic dimensions*, *Anti-patterns*, or *Phase procedures* count — even though the carrier is Markdown, they change runtime-interpreted behavior.

**Pure documentation changes** (Test Strategy may be a single line `No tests needed`): README prose / code comments / front-metadata / changelogs / non-interpreted Markdown that no tool parses as rules.

Required subsections (for behavior changes):
- **Existing coverage**: tests that already cover the target area — `file:lines` + a one-line description of what each test observes. "(none found)" is a valid answer when no existing tests exist.
- **Tests to add / update**: for each target behavior change, specify (i) the behavior under verification, (ii) the test file path (existing or new), (iii) the test type (unit / integration / e2e / static-assertion (e.g. `rg` section-existence) / manual-only with reason).
- **No tests needed (when applicable)**: explicit justification per omission. Acceptable reasons — quote one verbatim or state an equivalent: "pure doc change (no runtime consumer)", "skill-markdown change verified by `[file-state]` static assertions in Completion Criteria", "verified by existing test X at file:lines". Implicit omission is rejected by Phase 4 Critic Dimension 7.

Test tasks derived from this section MUST appear as first-class tasks in `## Task Outline` (not bundled as the implicit verification of an implementation task), unless the only verification is a static assertion already covered in `## Completion Criteria` (Autonomous Verification subsection).

Keep the plan body lightweight (target ~120–150 lines, excluding the Deepening Log). Round-by-round critique history lives in `<plan>.log.md`.

### Apply ECC-derived structure

- **NOT Building** enumerates out-of-scope items to stop scope creep.
- **Patterns to Mirror** captures `SOURCE: file:lines` + a snippet so the plan is self-contained. Rule: if you find yourself searching the codebase during implementation, capture that knowledge now.
- **No Prior Knowledge Test**: a developer unfamiliar with this codebase should be able to implement from this plan alone. If not, add context.

## Phase 4 — DEEPEN (non-trivial only)

Iterative adversarial critique flow. Prompts: `references/critic-prompt.md` and `references/adversarial-prompt.md`.

### Step 1 — Context collection
Collect the plan as written, the project CLAUDE.md, and the parsed `argument-hint` (max rounds, default 2, cap 5).

### Step 2 — Critic Subagent (each round, fresh)
Spawn a fresh `subagent_type: "Plan"` with `model: "opus"`. Inputs: full plan text, CLAUDE.md summary, round number, previous-rounds log. Template: `references/critic-prompt.md`. The Critic parses Phase 1's `### Unresolved Items` / `### Assumptions` by structure (not phrase match) and surfaces them as critique inputs.

### Step 3 — Process critique + classify
Triage each Critical Issue / Improvement Suggestion:
- **Self-resolvable**: the main agent resolves via code investigation
- **Needs user input**: an unverified assumption, scope ambiguity, or a tradeoff that requires domain knowledge
- **Reject**: irrelevant or in conflict with a previous user decision

Apply self-resolved changes inline with a one-line `-- Why: ...` rationale. Accumulate needs-user-input items into the **Consolidated Interview Queue** (Step 7) — do not interview mid-phase.

Append a Round N entry to `<plan>.log.md` and link from the plan body.

### Step 4 — Convergence check
Stop when: Critic verdict `CONVERGED` / max rounds reached / the same issue repeats (escalation) / zero Critical Issues. Otherwise loop back to Step 2 with a fresh subagent.

### Step 5 — Adversarial Falsification
Spawn one `subagent_type: "Explore"` with `references/adversarial-prompt.md`. Mandate: try to BREAK the plan with concrete code-level evidence. Skip only when there are no verifiable technical claims (pure doc changes).

Classify findings: Falsified (fix the plan, `-- Why`) / Unverified (add to Edge Cases / Risks) / Verified (record once) / Design Questions (Consolidated Interview Queue).

### Step 6 — Simplify Review (parallel with Step 5)
In the **same** assistant turn as Step 5, spawn a fresh `plan-simplifier` subagent via the Agent tool — a real parallel tool call with an orthogonal mandate (Step 5: factual falsification; Step 6: structural simplification).

```
Agent({
  subagent_type: "plan-simplifier",
  description: "Simplify review for plan",
  prompt: `## Original User Request\n\n<the user's original request>\n\n## Plan to Review\n\n<full plan text>\n\n## Project Design Principles\n\n<CLAUDE.md summary of YAGNI / KISS / DRY and relevant conventions>`
})
```

HIGH-confidence simplifications are auto-applied (subtraction only, behavior-preserving). MEDIUM / LOW go into the Consolidated Interview Queue. Skill-loading-based dispatch does NOT spawn the subagent — use direct Agent dispatch.

### Step 7 — Consolidated Interview (one call at end of Phase 4)
Phase 2 Explore unknowns and the needs-user-input items from Phase 4 Steps 3/5/6 collapse into a single `AskUserQuestion` call (max 4 questions; if more, split into the minimum number of calls, but do not interview inside a single step). Phase 1 Requirement Clarification runs its own multi-round cycle inside Phase 1 — those items do not re-enter Step 7 unless the Critic surfaces them from `### Unresolved Items`. Precede the questions with a `Self-resolved earlier:` block.

### Step 8 — Completion Criteria pipeline
Design observable Completion Criteria:
- **Autonomous Verification** — commands + `EXPECT` outputs. Tag every item (required for medium+):
  - `[file-state]` — verifiable with Read / Grep / Glob
  - `[orchestrator-only]` — requires host access the reviewer may not have (`nix flake check`, docker, sudo). The main session runs it ahead of the final gate and embeds the evidence.
  - `[outcome]` — circular (e.g. `/subagent-review returns PASS`); derived from the review's own verdict
  - When unsure, default to `[orchestrator-only]` (overrun is cheaper than a false FAIL).
  - **Fail-fast**: an untagged item under `### Autonomous Verification` rejects the plan in medium/large/xl (trivial / small are exempt from tagging overhead).
- **Requires User Confirmation** — items with genuine blocking capability (new GUI login, subjective judgment). Format: `- <condition> — Reason: <blocker>`.
- **Baseline** — per-task test/lint, plus one `/completion-audit` + `/subagent-review` at the final gate. `/santa-loop` and `/verification-loop` are opt-in when dual-reviewer convergence or deterministic re-execution is needed.

Example:

```markdown
## Completion Criteria

### Autonomous Verification

- [file-state] `rg -l 'old-name' src/` returns empty
- [file-state] `src/new-file.ts` exists with frontmatter `kind: X`
- [orchestrator-only] `nix flake check` passes with exit 0
- [outcome] `/subagent-review` returns PASS
```

`## Completion Criteria` is consumed by `/plan` Phase 5, by `/completion-audit` (final-gate step 1), and by `/subagent-review` (final-gate step 2, via the `Audit Verdict Input` from `/completion-audit`).

## Phase 5 — DECOMPOSE

The main session decomposes directly — no subagent dispatch. The plan is already in context from Phases 3/4.

### Decomposition Rules

1. **One task = one verifiable unit**: granularity at which completion can be confirmed independently.
2. **Verification inside the implementation task**: each task carries its own acceptance criteria (commands + expected outputs). The only verification-only task allowed is the final gate (Rule 5).
3. **Separation of concerns**: different concerns → different tasks; files sharing one concern → one task.
4. **Three elements of a task description**: (1) target files, (2) expected behavior after the change, (3) acceptance criteria (verification commands + expected output).
5. **Final gate task**: always include `Run /completion-audit and /subagent-review`, with `blockedBy` set to all implementation tasks. `/completion-audit` runs first (reads per-task `metadata.evidence` against `## Completion Criteria`; no re-execution), then `/subagent-review` runs against the aggregated diff (Spec Compliance → Code Quality → parallel orthogonal Domain specialists → Security heuristic). `/santa-loop` is opt-in for dual-reviewer convergence and is NOT part of the default gate.

### Acceptance criteria by change type

| Change Type | Acceptance criteria |
|---|---|
| CLI script | Execute and confirm output matches expected values |
| Hook script | Reproduce the trigger condition and confirm intervention |
| Web UI | Open with `/agent-browser`, screenshots; layout / console / responsiveness |
| Nix config | Confirm settings applied after `darwin-rebuild` |
| Skill/ agent addition | skill-tester trigger test or manual invocation |
| Improvement task | Before baseline → After comparison |
| Test update / addition | Run the test and confirm it fails without the implementation change and passes with it (red-green verification); for new-feature tests without a prior bug, state the regression the test catches if the implementation regresses |

`code-simplifier` dispatch is `/impl`'s concern (auto-spawn when a task's diff is ≥20 files or ≥500 lines). Do not create a standalone simplifier task.

See `~/.claude/skills/completion-audit/references/behavioral-verification.md` for templates per change type.

### Anti-patterns

- Splitting verification tasks out from implementation tasks (exception: the final gate).
- "Confirm X" without a specific command.
- Missing `blockedBy` for prerequisite dependencies.
- Missing the final gate task.
- Missing a `## Test Strategy` section in a `small+` plan with behavior-change targets (source / skill / hook / prompt / runtime-interpreted CLAUDE.md rule edits). The credibility of task outline / test type / justification is Phase 4 Critic Dimension 7's concern; this anti-pattern fires only on an unconditional structural omission.

### 2-pass TaskCreate (required)

Pass 1 — create every implementation task and collect IDs:
```
for each implementation task:
    id = TaskCreate(subject, description, ...)
    implTaskIds.push(id)
```

`/impl` later records `metadata.baseline_sha` (the `git rev-parse HEAD` at task start) and `metadata.evidence` (verbatim verification output) on each task as it runs.

Pass 2 — create the final-gate task with blockers:
```
gateId = TaskCreate(
    subject: "Run /completion-audit and /subagent-review",
    description: "Final gate. Execute in order:
      1. Invoke /completion-audit — must return VERIFIED PASS (max 3 tries by its internal loop).
      2. Invoke /subagent-review against the aggregated diff (git diff <first-task baseline_sha>..HEAD) — runs Spec Compliance → Code Quality → parallel orthogonal Domain specialists → Security heuristic internally. Must return PASS (no open MUST_FIX).
      Target: no additional files; verification-only.
      Expected behavior: /subagent-review emits PASS after all stages.
      Verification: verbatim output captured in metadata.evidence.
      Optional: /santa-loop can be invoked manually afterward for dual-reviewer convergence (not part of this gate).",
    ...)
TaskUpdate(gateId, addBlockedBy: implTaskIds)
```

-- Why: implementation task IDs are not assigned until Pass 1 completes; `blockedBy` needs them.

### Re-plan during /impl

- Preserve `completed` tasks (evidence intact).
- Delete only `pending` / `in_progress` tasks.
- Re-invoke `/plan`; the main session decomposes with a summary of finished tasks in context (avoiding duplicate decomposition).

## Phase 6 — ACTIVATE PENDING

Write a session-scoped **pending** marker so the user can approve the plan by typing `/impl`. The marker is `.pending-<session-hash>` (NOT `.active-<session-hash>`). The active marker is created only when the user types `/impl` as a top-level prompt — the `plan-approval-tracker.ts` UserPromptSubmit hook performs the promotion.

This two-marker scheme exists because auto mode encourages "execute immediately"; if `/plan` itself created `.active-<session-hash>`, the AI could chain `/plan` → `/impl` in the same turn without user approval. UserPromptSubmit fires only on real user keystrokes (not AI skill-tool invocations), so requiring user input `/impl` to promote `.pending-` → `.active-` is the only mechanical way to distinguish AI self-invocation from human approval.

Markers are session-scoped: each Claude session gets its own `<session-hash>`, so a marker held by a different session does not grant edit rights to the current session. A per-session `/plan` is structurally required. `cwd` is intentionally NOT part of the marker key — Claude Code updates the hook payload's `cwd` to track Bash `cd`, so a cwd-bound marker would be invalidated by any subdirectory navigation mid-session.

**Important**: the `PLAN_FILE_PATH` value below is **template-substituted by the agent at invocation time**. This is not bash variable expansion — the agent writes the literal plan path into the bash command string. `$CLAUDE_CODE_SESSION_ID` is the Claude-Code-provided environment variable available in the Bash tool's shell (note the `CLAUDE_CODE_` prefix; the `!` substitution syntax used by `/plan-marker-grant` exposes a different `CLAUDE_SESSION_ID` alias). The pending-marker content (the plan path) is copied verbatim into the active marker at promotion time.

Marker operations are delegated to a deterministic helper. The agent does not assemble session-hash or marker paths in inline shell.

```bash
deno run --allow-env=HOME --allow-read="$HOME/.claude/plans,$PWD" --allow-write="$HOME/.claude/plans" --no-prompt ~/.claude/scripts/plan-marker.ts activate-pending '<PLAN_FILE_PATH from Phase 3, agent-substituted>' "$CLAUDE_CODE_SESSION_ID"
```

-- Why: `plan-marker.ts` derives the same session-hash as `plan-gate.ts`, atomically writes the pending marker, and clears stale active markers for this session on a re-plan. The 24-hour TTL is checked by both `plan-gate.ts` and `plan-marker.ts`; each `/plan` invocation updates the pending mtime, invalidating prior approvals.

### Output to user

To let the user approve without opening the file, **emit the entire plan body inline**, then the metadata block:

```
## Plan
<full plan body, verbatim>

---

## Plan ready
- File: <plan path>
- Complexity: <trivial/small/medium/large/xl>
- Tasks: <count> (+ /completion-audit + /subagent-review gate)
- Status: PENDING APPROVAL — type `/impl` to approve and execute

⚠️ Auto mode does NOT bypass this gate. The user must explicitly type `/impl` as their next top-level prompt; the UserPromptSubmit hook is the only mechanism that promotes `.pending-<hash>` → `.active-<hash>`.
```

**xl fallback** (when the plan exceeds ~600 lines): replace the full-body block with a TOC of `##`-level section headings + the plan path, and keep the metadata block.

## Integration with existing skills

- `plan-simplifier`: dispatched in Phase 4 Step 6. `/simplify-review plan` exposes the same reviewer for manual use.
- The pre-planning loading rules for `/qa-planner` and `/agent-browser` come from CLAUDE.md — load them in Phase 1 or Phase 2 if the task needs them.
- `/obsidian-cli` applies when the plan involves vault work.
