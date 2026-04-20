---
name: plan
description: Plan creation skill that replaces CC builtin plan mode. Runs the full plan lifecycle — parse, explore, draft, adversarial deepen, task decompose — in a single command. Writes the plan to ~/.claude/plans/ and creates a task list plus a cwd-hash gate marker that unlocks Edit/Write/MultiEdit for the session. Use when the user asks to implement a new feature, fix a bug with design decisions, refactor, or make multi-file changes. Triggers include 実装して / 対応して / 修正して / plan / implement / develop / build / design.
argument-hint: "[feature description]"
---

# /plan

Single fused entry point for feature planning. Replaces the CC builtin plan mode workflow. Runs 6 phases in one skill body: PARSE → EXPLORE → DRAFT → DEEPEN → DECOMPOSE → ACTIVATE.

After `/plan` completes, invoke `/impl` to execute the task list.

## Quick Start

```
/plan <feature description>
/plan "notifications API を非同期化してエラー率を下げたい"
/plan "typo fix in README"               # → trivial path, Phase 2-4 skip
```

## Why this skill

The native plan mode had three structural problems:
1. `task-planner` decomposition only fired via an `ExitPlanMode` hook, not reliably for every plan.
2. CC plan mode occasionally fails to engage, letting edits slip through.
3. `/subagent-review` / `/completion-audit` integration was weak inside plan mode.

`/plan` fuses research, draft, adversarial deepening, and task decomposition into one artifact-producing command and is independent of CC plan mode. A companion PreToolUse hook (`plan-gate.ts`) blocks cwd-scoped Edit/Write/MultiEdit until `/plan` produces a marker, enforcing design-first without relying on plan mode's own gating.

## Design principle — meaning over notation

Requirement interpretation and critique in `/plan` are **cost-based and semantic**, not rule-based. Rules exist for machine contracts that downstream skills parse (section headers, verdict enums, task metadata, gate markers) — those stay strict. Everything else (how to triage ambiguity, when to ask, what counts as unresolved, whether a qualifier is load-bearing) is judged by its impact on the plan, not by phrase matching.

## Phase 1 — PARSE

Restate the user's request back to them: "あなたが実装したいのは X ですね？" (confirm understanding).

Estimate complexity via keyword heuristic + lightweight codebase probe (Grep/Glob, no Explore subagent yet):

| Level | Signals | Scope |
|---|---|---|
| **trivial** | typo / comment / single config value / 1-line copy edit | 1 file, <10 lines, no design decision |
| **small** | single module addition, follows an obvious pattern | 1-3 files, <100 lines |
| **medium** | multi-file feature, new component, follows existing conventions | 3-10 files, 100-500 lines |
| **large** | cross-cutting change, new architectural piece | 10+ files, 500+ lines |
| **xl** | multiple subsystems / architectural shift | propose splitting to user |

**Trivial short-circuit**: when complexity is `trivial`, skip Phases 2–4 and jump directly to Phase 5 with a minimal plan body (Context + Files to Change + Verification only, 1 task). Requirement Clarification and Ambiguity Gate are also skipped.

### Requirement Clarification (small+)

**Invariant (auto mode regardless)**: `/plan` operates identically under auto mode and plan mode. The skill does NOT detect auto mode or reduce Ask frequency. Invoking `/plan` is the explicit user opt-in to the Ask flow.

The judgement model (8 observations as a lens, cost-based triage, evidence rule, ambiguous qualifier calibration signal, Phase 1 output subsections) lives in `references/requirement-checklist.md`. SKILL.md owns only the round-loop orchestration below.

**Round loop — default operating limit**: `small` / `medium` / `large` default to 3 rounds. The limit is operational, not protocol:

- If a high-cost uncertainty remains (Scope / Success materially unresolved, proceeding would invalidate the plan), additional rounds are allowed.
- If only low-cost uncertainty remains, converge early and record the rest in `### Assumptions` or `### Unresolved Items` for downstream handling.

`trivial` / `xl` stay exempt (`trivial` skips Phase 1; `xl` triggers a split proposal).

**Each round** — Steps A–F:

- **Step A Walk**: Round 1 walks the 8 observations (Why / What / Who / When / Where / How / Success / Failure). Round 2+ re-walks with prior answers applied. Ambiguous qualifiers are a **calibration signal**, not a forced downgrade — only when the qualifier is the center of What / Success does the observation go into Calibration Probe; supportive-modifier uses stay with normal interpretation (see `references/requirement-checklist.md` for the central-vs-supportive criterion and examples).
- **Step B Triage**: For NotClear items, choose Ask / Assume / Self-resolve via the cost-based triage (cost-if-wrong × downstream recoverability) defined in `references/requirement-checklist.md`. No per-observation fixed default; `How` is triaged by the same 2 axes as the others.
- **Step C Self-resolve probe**: Lightweight Grep/Read only (Explore subagent is Phase 2's job). If probe is infeasible, decide via the cost axis — delegate to Phase 2 EXPLORE when the observation is codebase-recoverable (typically What / When), or promote to Ask when it depends on user-only knowledge.
- **Step D Re-Ask trigger detection (Round 2+)**: Triggers — (i) open-ended return question in a prior Other answer, (ii) ambiguous / empty answer, (iii) tentative Assumption still NotClear on re-walk, (iv) deferred Ask items carried over. If the same trigger repeats in two consecutive rounds, stop issuing Asks and advance to Phase 2 with the item recorded under `### Unresolved Items`. If Ask overflow or call-budget overflow blocks new questions, record remaining items under `### Unresolved Items` with `next: Phase 4 Step 7 Consolidated Interview` and advance. No canonical phrase is required for either path — the structured subsection is the handoff.
- **Step E Ask issuance**: Max 3 real questions + 1 override question ("このまま Phase 2 へ進む" / "追加確認が必要") per AskUserQuestion call. ≥4 items → Impact-priority top 3 + override; remainder carried to the next round's candidate head. Round 1 may additionally issue Divergence Probing as a separate call — but only when the conditional trigger applies (see `references/requirement-checklist.md`'s "Divergence Probing — conditional 発動"); do not run it by default.
- **Step F Answer handling**: "Phase 2 へ進む" override → record remaining answers as final, flag any qualifier-centered choices in `### Assumptions` with `user-overridden: true`. "追加確認" override within round budget → next round. Empty or ambiguous answer → trigger (ii) on next round.

**Convergence conditions** (any one):
- User chose the "Phase 2 へ進む" override
- Zero re-Ask triggers
- Same trigger repeated across consecutive rounds (advance with `### Unresolved Items` entry)
- Operating limit reached and no high-cost uncertainty remaining (advance)

**Phase 1 output subsections** (written immediately before `## Overview`): `### Requirement Clarification`, `### Assumptions`, `### Self-resolved`, `### Unresolved Items`. Structure and semantics are owned by `references/requirement-checklist.md`. Phase 4 Critic parses the subsection structure (not any canonical phrase).

### Ambiguity Gate (exception outside the lens)

Complementary safety net — runs only when the lens cannot start:
- The request itself cannot be restated (uninterpretable / contradictory / insufficient to summarize in one sentence)
- The request is 1–2 words with no signal across any of the 8 observations

On fire, re-acquire the request via AskUserQuestion before starting Round 1.

## Phase 2 — EXPLORE (non-trivial only)

Launch up to 3 Explore subagents in parallel (single message). Distinct mandates — do not duplicate searches across them.

**Mandate — three discovery outcomes** (what the plan actually needs to decide correctly):

1. **Existing patterns**: prevailing conventions the new change must mirror (naming, error handling, config, test layout, dependency style). Record `file:lines` + snippet so Phase 3 can cite them in Patterns to Mirror.
2. **Execution paths and boundaries the change flows through**: entry points, data flow, state transitions, API / interface contracts, architectural seams. Surface the path from trigger to observable outcome so Phase 3 knows what to change and what to leave alone.
3. **Existing behavior, constraints, and verification conditions**: how the target currently behaves, what invariants the codebase already enforces, how existing tests verify related behavior. Enough to design Acceptance Criteria and Completion Criteria that actually observe the change.

These replace the older "8 categories + 5 execution paths" checklist. Exploration succeeds when Phase 3 has the evidence to make design decisions — not when a matrix is filled.

### Empirical analysis (existing-behavior revisions)

When the plan modifies existing behavior, codebase-only exploration is insufficient — "specified to do X" and "actually useful as X in practice" are different questions.

- **Trigger (OR)**: `## Files to Change` has an UPDATE on a behavior-bearing target (source / executable / runtime config / skill/hook logic), OR the request contains existing-behavior-revision intent (bug-fix / refactor / 仕様変更 / perf / CLI 出力 / semantics change).
- **Exempt**: (a) CREATE-only with no dependency on existing runtime behavior, (b) all UPDATEs target docs / comments / metadata only, or (c) complexity is `trivial`.
- **Action**: repurpose one of the 3 Explore subagent slots for an empirical mandate. Gather (i) historical signals from codebase-external records (`~/.claude/plans/*.md`, `~/.claude/projects/**/subagents/*.jsonl`, `~/.claude/retrospective-ledger.jsonl`, `git log -p`) and (ii) direct current-behavior observation (run the CLI, trigger the hook, read effective config). Contrast "what the spec says" vs "what actually happens" and note whether each claim is Tier 1 (history) or Tier 2 (observation) backed.
- **Output**: one row in the Unified Discovery Table with `Category = Empirical Behavior`. Edge details go to Risks / Open Questions in Phase 3.

Consolidate Phase 2 findings into a **Unified Discovery Table** (`Category | File:Lines | Pattern | Key Snippet`). Fill what the plan needs; skip rows that add noise without informing a decision.

## Phase 3 — DRAFT (non-trivial only)

Write the initial plan to `~/.claude/plans/YYYYMMDDTHHmm-<slug>.md` (slug from request, max 40 chars, lowercase kebab).

### Language policy

- **Body prose** (Context / Approach / Risks / Open Questions / `-- Why: ...` rationales / natural-language narrative): write in the user's configured language (`# Language` in system prompt, derived from `~/.claude/settings.json`).
- **Section headers** (`## Context`, `## Overview`, `## Approach`, `## NOT Building`, `## Mandatory Reading`, `## Patterns to Mirror`, `## Intentional Conventions`, `## Files to Change`, `## Task Outline`, `## Verification Commands`, `## Definition of Done`, `## Risks + Open Questions`, `## Completion Criteria`): keep in English. `completion-audit` and Phase 5 locate sections by these literal strings.
- **Machine-consumed contents**: `## Completion Criteria` subsections (Autonomous Verification / Requires User Confirmation / Baseline) and Acceptance Criteria lines are English.
- **Phase 1 subsections** (`### Requirement Clarification`, `### Assumptions`, `### Self-resolved`, `### Unresolved Items`): English subsection names (Phase 4 Critic parses them); field values follow the body-prose rule.
- File paths, commands, code snippets, `EXPECT:` values: as-is.

Log file `<plan>.log.md` (Deepening Log) follows the same policy.

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
| Verification Commands (with `EXPECT:`) | ✓ | ✓ | ✓ |
| Definition of Done | ✓ | ✓ | ✓ |
| Risks + Open Questions | | ✓ | ✓ |

### Overview section

Place immediately after Context, before Approach. Answer "what changes and where" in 30 seconds.

Include only sub-elements that earn their space:

| Sub-element | When to include |
|---|---|
| **Change at a glance** | always (when Overview is present) — 1–2 sentence elevator pitch |
| **Workflow / Data flow** | execution order, state transitions, or hook pipelines are central to the change — ASCII diagram, Before → After for behavior revisions |
| **File layout** | 3+ affected files or new directory structure — tree showing affected paths only |
| **Per-file change matrix** | 3+ files — table `Path \| Action (CREATE/UPDATE/DELETE) \| one-line WHAT changes` |
| **Key decisions** | small+ with non-obvious design choices — 3–5 bullets `<decision> — <why>` |

For `small`: Change at a glance + Per-file matrix. For `medium+`: whichever apply. Do not pad.

### Intentional Conventions section

Add when the plan touches conventions (naming, formatting, file layout) a fresh reviewer might flag as inconsistent without knowing they are deliberate. Each entry under `### <Convention name>`:
- `- **Convention**: <rule>`
- `- **Scope**: <paths/sections>`
- `- **Do not flag**: <explicit reviewer guidance>`

Final-gate reviewers (`/subagent-review` by default, `/santa-loop` when invoked manually) read this section and will not re-flag documented items. Abuse is caught by Phase 4 Critic / Adversarial / Simplify passes.

Skip for: pure internal-logic changes, 100% canonical conventions, no style disputes.

Keep the plan body lean (target ~120–150 lines, excluding Deepening Log). Per-round critique history lives in `<plan>.log.md`.

### Apply ECC-derived structure

- **NOT Building** enumerates out-of-scope to stop scope creep.
- **Patterns to Mirror** captures `SOURCE: file:lines` + snippets so the plan is self-contained. Rule: if you would search the codebase during implementation, capture that knowledge now.
- **No Prior Knowledge Test**: a developer unfamiliar with this codebase can implement from this plan alone. If not, add context.

## Phase 4 — DEEPEN (non-trivial only)

Iterative adversarial-critique flow. Prompts: `references/critic-prompt.md` and `references/adversarial-prompt.md`.

### Step 1 — Context collection
Gather the plan just written, project CLAUDE.md, parsed `argument-hint` (max-rounds, default 2, cap 5).

### Step 2 — Critic Subagent (each round, fresh)
Spawn a fresh `subagent_type: "Plan"` with `model: "opus"`. Inputs: full plan text, CLAUDE.md summary, round number, prior rounds' log. Template: `references/critic-prompt.md`. The Critic parses Phase 1 `### Unresolved Items` / `### Assumptions` by structure (not by phrase match) and surfaces them as critique inputs.

### Step 3 — Process critique + classify
Triage each Critical Issue / Improvement Suggestion:
- **Self-resolvable**: main agent resolves via code investigation
- **Needs user input**: unverified assumption, scope ambiguity, tradeoff requiring domain knowledge
- **Reject**: irrelevant or contradicts an earlier user decision

Apply self-resolved changes inline with a `-- Why: ...` one-line rationale. Accumulate needs-user-input items into the **Consolidated Interview Queue** (Step 7) — do not interview mid-phase.

Append a Round N entry to `<plan>.log.md`, link from the plan body.

### Step 4 — Convergence check
Stop when: Critic verdict `CONVERGED` / max rounds reached / same issues repeat (escalate) / zero Critical Issues. Otherwise return to Step 2 with a fresh subagent.

### Step 5 — Adversarial Falsification
Spawn one `subagent_type: "Explore"` with `references/adversarial-prompt.md`. Mandate: try to BREAK the plan with concrete code-level evidence. Skip only if the plan has no verifiable technical claims (pure doc change).

Classify findings: Falsified (fix plan, `-- Why`) / Unverified (add to Edge Cases / Risks) / Verified (log once) / Design Questions (Consolidated Interview Queue).

### Step 6 — Simplify Review (parallel with Step 5)
In the SAME assistant turn as Step 5, spawn a fresh `plan-simplifier` subagent via the Agent tool — true parallel tool calls with orthogonal mandates (Step 5: factual falsification; Step 6: structural simplification).

```
Agent({
  subagent_type: "plan-simplifier",
  description: "Simplify review for plan",
  prompt: `## Original User Request\n\n<the user's original request>\n\n## Plan to Review\n\n<full plan text>\n\n## Project Design Principles\n\n<CLAUDE.md summary of YAGNI / KISS / DRY and relevant conventions>`
})
```

HIGH-confidence simplifications auto-apply (subtractive only, behavior-preserving). MEDIUM / LOW go to the Consolidated Interview Queue. Skill-loading-based dispatch does not spawn a subagent — use direct Agent dispatch.

### Step 7 — Consolidated Interview (one call at end of Phase 4)
All needs-user-input items from Phase 2 Explore unknowns and Phase 4 Steps 3/5/6 collapse into a single `AskUserQuestion` call (max 4 questions; split into the minimum number of calls if more, but never interview inside a single Step). Phase 1 Requirement Clarification runs its own multi-round cycle at Phase 1 — those items do not re-enter Step 7 unless surfaced by the Critic from `### Unresolved Items`. Present an `以下を自己解決しました:` block before questions.

### Step 8 — Definition of Done pipeline
Design observable Completion Criteria:
- **Autonomous Verification** — commands + `EXPECT` outputs. Tag each item (required for medium+):
  - `[file-state]` — verifiable by Read / Grep / Glob
  - `[orchestrator-only]` — needs host access a reviewer may lack (`nix flake check`, docker, sudo). Main session pre-runs and embeds evidence for the final gate.
  - `[outcome]` — circular (e.g. `/subagent-review returns PASS`), derived from the review's own verdict
  - Default to `[orchestrator-only]` when unclear (over-running is cheaper than a false FAIL).
  - **Fail-fast**: untagged items under `### Autonomous Verification` reject the plan for medium/large/xl (trivial / small are exempt from tagging overhead).
- **Requires User Confirmation** — items with genuine blocking capability (fresh GUI login, subjective judgment). Format: `- <condition> — 理由: <blocker>` (`Reason:` for English plan bodies).
- **Baseline** — tests / lint per task, `/completion-audit` + `/subagent-review` once at final gate. `/santa-loop` and `/verification-loop` are opt-in for cases that require dual-reviewer convergence or deterministic re-execution.

Example:

```markdown
## Completion Criteria

### Autonomous Verification

- [file-state] `rg -l 'old-name' src/` returns empty
- [file-state] `src/new-file.ts` exists with frontmatter `kind: X`
- [orchestrator-only] `nix flake check` passes with exit 0
- [outcome] `/subagent-review` returns PASS
```

`## Completion Criteria` is consumed by `/plan` Phase 5, `/completion-audit` (final gate step 1), and `/subagent-review` (final gate step 2, via `Audit Verdict Input` from `/completion-audit`).

## Phase 5 — DECOMPOSE

Main session decomposes directly — no subagent dispatch. The plan is already in context from Phase 3/4.

### Decomposition Rules

1. **1 task = 1 verifiable unit**: granularity where completion can be confirmed independently.
2. **Verification within implementation tasks**: each task includes its own acceptance criteria (commands + expected output). The only verification-only task allowed is the final gate in rule 5.
3. **Separation of concerns**: different concerns → different tasks; files sharing a concern → one task.
4. **Three elements of task descriptions**: (1) target files, (2) expected behavior after change, (3) acceptance criteria (verification commands + expected output).
5. **Final gate task**: always include `Run /completion-audit and /subagent-review`, `blockedBy` all implementation tasks. `/completion-audit` runs first (reads per-task `metadata.evidence` against `## Completion Criteria`, no re-execution); then `/subagent-review` runs against the aggregated diff (Spec Compliance → Code Quality → Domain specialist → Security heuristic). `/santa-loop` is opt-in for dual-reviewer convergence and not part of the default gate.

### Acceptance criteria by change type

| Change Type | Acceptance criteria |
|---|---|
| CLI script | Execute and confirm output matches expected values |
| Hook script | Reproduce the trigger condition and confirm intervention |
| Web UI | Open with `/agent-browser`, screenshots; layout / console / responsiveness |
| Nix config | Confirm settings applied after `darwin-rebuild` |
| Skill/agent addition | skill-tester trigger test or manual invocation |
| Improvement task | Before baseline → After comparison |

`code-simplifier` dispatch is `/impl`'s concern (auto-spawned when a task's diff ≥ 20 files or ≥ 500 lines). Do not create a standalone simplifier task.

See `~/.claude/skills/completion-audit/references/behavioral-verification.md` for the per-change-type template.

### Anti-patterns

- Separate verification tasks among implementation tasks (exception: final gate).
- "Confirm X" without specific commands.
- Missing `blockedBy` for prerequisite dependencies.
- Missing final gate task.

### 2-pass TaskCreate (required)

Pass 1 — create all implementation tasks and collect IDs:
```
for each implementation task:
    id = TaskCreate(subject, description, ...)
    implTaskIds.push(id)
```

`/impl` later records `metadata.baseline_sha` (git rev-parse HEAD at task start) and `metadata.evidence` (verbatim verification output) on each task as it executes.

Pass 2 — create the final gate task with blockers:
```
gateId = TaskCreate(
    subject: "Run /completion-audit and /subagent-review",
    description: "Final gate. Execute in order:
      1. Invoke /completion-audit — must return VERIFIED PASS (max 3 tries by its internal loop).
      2. Invoke /subagent-review against the aggregated diff (git diff <first-task baseline_sha>..HEAD) — runs Spec Compliance → Code Quality → Domain specialist → Security heuristic internally. Must return PASS (no open MUST_FIX).
      Target: no additional files; verification-only.
      Expected behavior: /subagent-review emits PASS after all stages.
      Verification: verbatim output captured in metadata.evidence.
      Optional: /santa-loop can be invoked manually afterward for dual-reviewer convergence (not part of this gate).",
    ...)
TaskUpdate(gateId, addBlockedBy: implTaskIds)
```

-- Why: impl task IDs are not assigned until Pass 1 completes; `blockedBy` needs them.

### Re-plan during /impl

- Keep `completed` tasks (evidence intact).
- Delete `pending` / `in_progress` tasks only.
- Re-invoke `/plan`; main session decomposes with the completed-task summaries already in context (avoid duplicate decomposition).

## Phase 6 — ACTIVATE

Touch the cwd-hash marker so `plan-gate.ts` unblocks Edit/Write/MultiEdit for the session.

**Important**: the `PLAN_FILE_PATH` value below is **template-substituted by the agent at invocation time** using the path decided in Phase 3. This is not a bash variable expansion — the agent writes the literal plan path into the bash command string.

```bash
REAL_PWD=$(realpath "$PWD")
CWD_HASH=$(printf '%s' "$REAL_PWD" | shasum -a 256 | cut -c1-16)
mkdir -p "$HOME/.claude/plans"
printf '%s\n' '<PLAN_FILE_PATH from Phase 3, agent-substituted>' > "$HOME/.claude/plans/.active-${CWD_HASH}"
```

-- Why: cwd-hash is computed from the realpath `$PWD` on both sides (bash `realpath` and TS `Deno.realPath`) so symlink-heavy cwds hash-match. 24h TTL is checked by `plan-gate.ts` only; each `/plan` invocation refreshes mtime.

### Output to user

Emit the **full plan body inline** so the user can approve without opening the file, followed by metadata:

```
## Plan
<full plan body, verbatim>

---

## Plan ready
- File: <plan path>
- Complexity: <trivial/small/medium/large/xl>
- Tasks: <count> (+ /completion-audit + /subagent-review gate)
- Gate: active until <24h from now>

Run `/impl` when you approve.
```

**xl fallback** (plan > ~600 lines): replace the full-body block with a TOC of `##`-level section headings + plan path, keep the metadata block.

## Integration with existing skills

- `plan-simplifier`: dispatched in Phase 4 Step 6. `/simplify-review plan` exposes the same reviewer for manual use.
- `/qa-planner`, `/agent-browser` load-before-planning rules from CLAUDE.md apply — load them in Phase 1 or Phase 2 when the task requires.
- `/obsidian-cli` applies when the plan involves vault work.

## Design decisions

**Why fused instead of chained**: multi-command chaining was rejected — single command eliminates hand-off overhead and guarantees decomposition (prior hook-based dispatch was unreliable).

**Why PreToolUse gate instead of UserPromptSubmit redirect**: a blocking hook enforces design-first even when CC plan mode fails. Bootstrap risk is handled by `plan-gate.ts`'s infra-path allowlist.

**Why complexity-gated plan sections**: trivial changes don't need 10 sections; forcing them produces empty fields.

**Why consolidated interview**: interviewing inside each Step would block the user 3–4 times per plan. One queue, one call.

**Why meaning over notation in judgement, strict in contracts**: requirement interpretation is where rigid rules cause brittle behavior (missing token ≠ missing intent). Machine contracts (section headers, verdict enums, gate markers) are strict because downstream parsing depends on them.
