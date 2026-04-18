---
name: impl
description: Executes the plan task by task. Per task — implement, verify acceptance criteria, run simplify-review if large, run subagent-review, mark complete. Final gate invokes /verification-loop then /santa-loop. Use after /plan completes. Triggers include /impl / 実行して / 実装開始 / 作業を進めて / implement the plan.
---

# /impl

Executes the plan produced by `/plan` task by task. Single source of truth for the per-task loop, deviation handling, simplify-review threshold, subagent-review timing, plan compliance check, and recovery after compaction.

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
   4. **Run acceptance criteria verification** commands. Capture **raw output verbatim** in `metadata.evidence` (do not paraphrase or summarize). The final gate (`/verification-loop` + `/santa-loop`) consumes this evidence.
   5. **Diff size check** with `git diff --stat`. If diff ≥ 20 files OR ≥ 500 lines, dispatch `Agent({subagent_type: "code-simplifier", ...})` — the agent is defined in `~/.claude/agents/code-simplifier.md`. Pass changed files + `git diff <baseline_sha>..HEAD` + the project CLAUDE.md path inline in the prompt. Apply HIGH-confidence simplifications, surface MEDIUM/LOW to the user.
   6. **Subagent review** by invoking `/subagent-review` via the Skill tool — runs spec compliance check, then code quality check.
   7. `TaskUpdate` to `completed` only when all acceptance criteria verifications pass and `/subagent-review` does not surface critical issues.
5. After all implementation tasks complete, the final `Run /verification-loop and /santa-loop` task automatically unblocks. Execute in order:
   1. Invoke `/verification-loop`. If verdict is **NOT READY**, fix the surfaced issues and re-run `/verification-loop` until **READY**.
   2. Invoke `/santa-loop` with the plan file path as its argument. The skill embeds the plan's Completion Criteria into its rubric.
   3. If santa-loop verdict is **NICE** → mark the gate task completed, emit the final report.
   4. If santa-loop verdict is **NAUGHTY (escalated after 3 rounds)** → leave the task `in_progress`, append `[BLOCKED: santa-loop escalated]` to the task description, surface the unresolved critical issues to the user.
6. Emit a final report: changed files / tests added / deviations / santa-loop verdict + reviewer agreement / next-step suggestions.

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

After all tasks are `completed` and before `/verification-loop` and `/santa-loop`:
1. Re-`Read` the plan file's "Files to Change" and "Completion Criteria" sections.
2. Compare against actual `git diff --stat` of the implementation.
3. Flag any (a) plan items not implemented, (b) implementation items not in the plan, (c) misinterpreted items.
4. Report the comparison to the user before invoking `/santa-loop` (via the final gate task).

## When to invoke the code-simplifier subagent

| Condition | Action |
|---|---|
| Diff ≥ 20 files OR ≥ 500 lines for the current task | Spawn `code-simplifier` via the Agent tool |
| Diff smaller | Skip — `/subagent-review` covers basic simplification |
| User explicitly says "skip simplify" | Skip with note |

Apply HIGH-confidence simplifications automatically (subtractive only, behavior-preserving). Surface MEDIUM/LOW to the user before changes.

## When to invoke /subagent-review

After every implementation task completion (default review). For explicit `/codex-review` requests, follow the codex-review special rule from `~/.claude/CLAUDE.md` — never partial.

## Final gate: /verification-loop → /santa-loop

The "Run /verification-loop and /santa-loop" task created by `/plan` Phase 5 (Pass 2) is `blockedBy` all implementation tasks. It auto-unblocks once all complete.

**Execution order is mandatory**:
1. `/verification-loop` first — deterministic gate (build, typecheck, lint, tests). Must return **READY** before continuing
2. `/santa-loop` second — dual-reviewer (Reviewer A: Claude code-reviewer/opus, Reviewer B: codex (claude-second fallback)). The skill embeds the plan's Completion Criteria into its rubric so requirement coverage is verified alongside code quality. Must return **NICE** (both reviewers PASS) to close the gate

`/completion-audit` is NOT invoked by default anymore — `/santa-loop`'s "Completeness vs Completion Criteria" criterion covers the same ground with dual-reviewer adversarial verification. Re-invoke `/completion-audit` manually only if stricter evidence-sufficiency audit is specifically required (see that skill's deprecation notice).

## Design decisions

**Why a per-task loop instead of batch impl**: Per-task verification + subagent-review catches regressions early. Batching defers feedback and makes diffs harder to review.

**Why baseline_sha is recorded per task**: Lets the audit trail tie a task's evidence to a precise diff range (`git diff <baseline_sha>..HEAD`). Compaction recovery also uses it to detect partial in-progress work.

**Why raw evidence (not summarized)**: Summaries lose the exact command + output that proves correctness. The completion-auditor needs verbatim evidence to verify acceptance.

**Why incremental re-plan keeps completed tasks**: Deleting completed tasks would erase the audit trail and force re-execution. Keeping them lets `/impl` resume from the correct state with full history.

**Why /subagent-review per task instead of at the end**: Issues surface immediately when the offending change is fresh in context. End-of-batch review forces re-context-loading and often misses which task introduced the issue.

**Why the diff-size threshold for the code-simplifier subagent**: Small diffs are unlikely to introduce defensive complexity worth a fresh-eyes review. Large diffs accumulate it.

**Why Agent dispatch (not skill loading)**: The `code-simplifier` subagent must actually execute to produce proposals. Loading the simplify-review skill definition into context alone does not spawn the reviewer. Direct Agent dispatch keeps behavior deterministic and matches the same pattern used by `/plan` Phase 4 Step 6 for `plan-simplifier`.
