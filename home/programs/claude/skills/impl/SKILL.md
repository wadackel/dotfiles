---
name: impl
description: Executes the plan task by task. Per task — implement, verify acceptance criteria, optionally run simplify-review on large diffs, mark complete. Final gate is /completion-audit → /subagent-review. /santa-loop is opt-in (user-invoked only, not part of the default flow). Use after /plan completes. Triggers include /impl / 実行して / 実装開始 / 作業を進めて / implement the plan.
---

# /impl

Executes the plan produced by `/plan` task by task. Single source of truth for the per-task loop, deviation handling, simplify-review threshold, final-gate orchestration, plan compliance check, and recovery after compaction.

## Quick Start

```
/impl              # Process all pending tasks in ID order
```

## Prerequisites

`/impl` reads the active plan from the cwd-hash marker that `/plan` Phase 6 created.

```
PATH = ~/.claude/plans/.active-<sha256(realpath $PWD) | hex slice 16>
```

If the marker is absent, `/impl` exits with: `Run /plan first. No active plan for this cwd.`

If the marker is expired (mtime > 24h, blocked by `plan-gate.ts`), the user is told to re-run `/plan`.

## Workflow

1. Resolve plan file path from the cwd-hash marker.
2. `Read` the plan file in full so subsequent tasks can faithfully follow its **Files to Change** and **Patterns to Mirror**.
3. `TaskList` → process tasks in **ID ascending order**, skipping any with non-empty `blockedBy`.
4. For each task:
   1. `TaskGet` to retrieve full description (target files / expected behavior / verification).
   2. `TaskUpdate` to `in_progress` and record `metadata.baseline_sha` (current `git rev-parse HEAD`).
   3. **Implement** following the plan's "Files to Change" and "Patterns to Mirror" exactly. Match naming, error handling, and conventions captured during Phase 2 EXPLORE.
   4. **Run acceptance criteria verification** commands. Capture **raw output verbatim** in `metadata.evidence` (do not paraphrase or summarize). The final gate (`/completion-audit` + `/subagent-review`) consumes this evidence.
   5. **Diff size check** with `git diff --stat`. If diff ≥ 20 files OR ≥ 500 lines, dispatch `Agent({subagent_type: "code-simplifier", ...})` — the agent is defined in `~/.claude/agents/code-simplifier.md`. Pass changed files + `git diff <baseline_sha>..HEAD` + the project CLAUDE.md path inline in the prompt. Apply HIGH-confidence simplifications, surface MEDIUM/LOW to the user.
   6. `TaskUpdate` to `completed` once all acceptance criteria verifications pass. No per-task review gate — quality and security are adjudicated at the final gate.
5. After all implementation tasks complete, the final `Run /completion-audit and /subagent-review` task automatically unblocks. Execute in order:
   1. Invoke `/completion-audit`. If verdict is **VERIFIED FAIL**, address the surfaced gaps and re-run `/completion-audit` (max 3 tries by /completion-audit's own loop). If 3 consecutive FAILs (its internal loop exhausted), leave the gate task `in_progress`, append `[BLOCKED: completion-audit escalated]` to the task description, surface the unresolved gap analysis to the user.
   2. On **VERIFIED PASS**, invoke `/subagent-review` against the aggregated diff (`git diff <first-task baseline_sha>..HEAD`). `/subagent-review` runs Spec Compliance → Code Quality → single Domain specialist → Security heuristic internally; the Security step replaces the former standalone Security Sweep. Must return PASS (no MUST_FIX open) to close the gate.
   3. If `/subagent-review` returns **PASS** → mark the gate task completed, emit the final report.
   4. If `/subagent-review` returns **FAIL** after its internal retry exhausts (3 rounds per stage) → leave the task `in_progress`, append `[BLOCKED: subagent-review escalated]` to the task description, surface the unresolved MUST_FIX issues to the user.
6. Emit a final report: changed files / tests added / deviations / subagent-review verdict / next-step suggestions. `/santa-loop` is not part of the default flow — run it manually when additional dual-reviewer (Claude + Codex) convergence is desired before PR.

## Three elements rule (enforced per task description)

Every task description must contain:
1. **Target files** — exact absolute paths to create or modify
2. **Expected behavior** after change — concrete observable outcome
3. **Verification method** — command + expected output

If the description is missing any of these three, stop and report. Do not improvise — re-invoke `/plan` to fix the decomposition.

## Deviation handling

If implementing the task as described is infeasible (plan was wrong, environment differs, missing dependency surfaced, etc.):
1. **Stop** before applying the deviation.
2. State to the user: (a) what cannot be done as planned, (b) why, (c) the proposed alternative.
3. Wait for explicit user approval (or correction).
4. Implicit plan changes are prohibited — never silently change approach because "this way is better".
5. After approval, proceed with the corrected approach. Note the deviation in the task's `metadata.evidence` for the audit trail.

## Re-plan (mid-execution plan revision)

If during `/impl` the user wants to revise the plan:
1. Confirm: "再 plan しますか？(/plan を再実行) — completed task は保持されます"
2. On confirmation:
   - **Keep** all `completed` tasks (including their `metadata.evidence`)
   - **Delete** all `pending` and `in_progress` tasks
   - Re-invoke `/plan`; the main session decomposes using the existing completed-task summary list already in its context so the new decomposition does not duplicate completed work
3. Resume `/impl` after the new tasks are created.

## Recovery after compaction

If context compaction occurs mid-`/impl`:
1. Re-fetch active plan path from the cwd-hash marker.
2. `TaskList` → find tasks not yet `completed`.
3. Re-`Read` the plan file.
4. Resume from the lowest-ID `pending` (or stuck `in_progress`) task.
5. For an `in_progress` task with partial work, decide via diff inspection whether to continue or revert and restart.

## Plan compliance check on completion

After all tasks are `completed` and before `/completion-audit` + `/subagent-review`:
1. Re-`Read` the plan file's "Files to Change" and "Completion Criteria" sections.
2. Compare against actual `git diff --stat` of the implementation.
3. Flag any (a) plan items not implemented, (b) implementation items not in the plan, (c) misinterpreted items.
4. Report the comparison to the user before invoking the final gate task.

## When to invoke the code-simplifier subagent

| Condition | Action |
|---|---|
| Diff ≥ 20 files OR ≥ 500 lines for the current task | Spawn `code-simplifier` via the Agent tool |
| Diff smaller | Skip — `/subagent-review` covers basic simplification |
| User explicitly says "skip simplify" | Skip with note |

Apply HIGH-confidence simplifications automatically (subtractive only, behavior-preserving). Surface MEDIUM/LOW to the user before changes.

## When to invoke /subagent-review

`/subagent-review` is the second (and quality/security) step of the final gate — it runs automatically once `/completion-audit` returns VERIFIED PASS. The user can also invoke it manually on demand for a standalone review pass. There is no per-task review gate; per-task cost is kept to acceptance-criteria verification only.

For `/codex-review` requests, follow the codex-review special rule from `~/.claude/CLAUDE.md` — never partial.

## Final gate: /completion-audit → /subagent-review

The "Run /completion-audit and /subagent-review" task created by `/plan` Phase 5 (Pass 2) is `blockedBy` all implementation tasks. It auto-unblocks once all complete.

**Execution order is mandatory**:
1. `/completion-audit` first — evidence-sufficiency audit (no re-execution; reads per-task `metadata.evidence` against the plan's Completion Criteria). Must return **VERIFIED PASS** before continuing. On 3 consecutive FAILs (its internal loop exhausted), append `[BLOCKED: completion-audit escalated]` and surface to the user.
2. `/subagent-review` second — runs against the aggregated diff (`git diff <first-task baseline_sha>..HEAD`). Executes Spec Compliance → Code Quality → single Domain specialist (priority-ordered) → Security heuristic internally. The Security step uses `~/.claude/skills/subagent-review/references/security-trigger-heuristic.md` and dispatches `security-auditor` only when a trigger fires. Must return **PASS** (no open MUST_FIX) to close the gate. On internal retry exhaustion (3 rounds per stage), append `[BLOCKED: subagent-review escalated]` and surface.

`/santa-loop` is **not** part of the default final gate. Invoke it manually when additional dual-reviewer (Claude + Codex) convergence is desired — for example before opening a PR on high-risk changes. `/santa-loop` requires `/completion-audit` to have returned VERIFIED PASS first (see its SKILL.md Prerequisites).

`/verification-loop` is opt-in and invoked manually outside `/impl` (e.g., `/verify` before opening a PR) when deterministic re-execution is genuinely required. It is not part of the `/impl` flow because per-task acceptance verification already covers re-execution.

## Design decisions

**Why a per-task loop instead of batch impl**: Per-task verification + subagent-review catches regressions early. Batching defers feedback and makes diffs harder to review.

**Why baseline_sha is recorded per task**: Lets the audit trail tie a task's evidence to a precise diff range (`git diff <baseline_sha>..HEAD`). Compaction recovery also uses it to detect partial in-progress work.

**Why raw evidence (not summarized)**: Summaries lose the exact command + output that proves correctness. The completion-auditor needs verbatim evidence to verify acceptance.

**Why incremental re-plan keeps completed tasks**: Deleting completed tasks would erase the audit trail and force re-execution. Keeping them lets `/impl` resume from the correct state with full history.

**Why no per-task review gate**: the prior Unified Lightweight Review Gate (single unified reviewer + conditional Domain) spawned 1–2 fresh subagents per task and drove wall-time + token cost upward for limited marginal value; most findings were re-surfaced by `/subagent-review` at the final gate anyway. Removing per-task review keeps the per-task loop to implementation + acceptance verification only. Quality and security are adjudicated once, against the aggregated diff, at the final gate.

**Why the diff-size threshold for the code-simplifier subagent**: Small diffs are unlikely to introduce defensive complexity worth a fresh-eyes review. Large diffs accumulate it. This is the only per-task subagent dispatch that remains, and it is threshold-gated.

**Why Agent dispatch (not skill loading)**: The `code-simplifier` subagent must actually execute to produce proposals. Loading the simplify-review skill definition into context alone does not spawn the reviewer. Direct Agent dispatch keeps behavior deterministic and matches the same pattern used by `/plan` Phase 4 Step 6 for `plan-simplifier`.

**Why /completion-audit is the default gate (not /verification-loop)**: per-task verification already covers re-execution; the gate's value is evidence audit + adversarial review, not redundant re-execution. Default re-execution duplicated cost without catching new issues empirically. `/verification-loop` remains opt-in for cases that genuinely require deterministic re-execution.

**Why /subagent-review (not /santa-loop) as the default final-gate review**: `/santa-loop` spawns two independent reviewers (Claude Opus + Codex CLI) and iterates until both return NICE. It is powerful but token-heavy — the dual-model convergence loop was the single largest cost component of the old `/impl` flow. `/subagent-review` covers spec compliance, code quality, domain specialization, and security heuristic in one sequential pass against the aggregated diff and converges faster. `/santa-loop` stays available as a user-invoked opt-in step for high-assurance reviews (e.g., pre-PR on security-critical changes).

**Why Security Sweep is absorbed into /subagent-review**: the prior Security Sweep was a separate orchestration step that duplicated the heuristic check already owned by `/subagent-review` Step 7. Collapsing them removes one orchestration layer without changing detection coverage — the same `security-trigger-heuristic.md` fires `security-auditor` when triggers match the aggregated diff. Residual risk (heuristic false negatives on exotic security signals) is unchanged from the prior design; users can force full coverage by invoking `security-auditor` directly or running `/santa-loop` manually.
