---
name: impl
description: Executes the plan task by task. Per task — implement, verify acceptance criteria, run simplify-review if large, run the Unified Lightweight Review Gate (default; opt-in /subagent-review on [strict-review] tag), mark complete. Final gate invokes /completion-audit → Security Sweep → /santa-loop. Use after /plan completes. Triggers include /impl / 実行して / 実装開始 / 作業を進めて / implement the plan.
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
   4. **Run acceptance criteria verification** commands. Capture **raw output verbatim** in `metadata.evidence` (do not paraphrase or summarize). The final gate (`/completion-audit` + `/santa-loop`) consumes this evidence.
   5. **Diff size check** with `git diff --stat`. If diff ≥ 20 files OR ≥ 500 lines, dispatch `Agent({subagent_type: "code-simplifier", ...})` — the agent is defined in `~/.claude/agents/code-simplifier.md`. Pass changed files + `git diff <baseline_sha>..HEAD` + the project CLAUDE.md path inline in the prompt. Apply HIGH-confidence simplifications, surface MEDIUM/LOW to the user.
   6. **Unified Lightweight Review Gate** — default per-task review. See the dedicated section below for skip conditions and dispatch spec. Strict two-stage `/subagent-review` is opt-in (user explicit invoke or task description carries `[strict-review]` tag).
   7. `TaskUpdate` to `completed` only when all acceptance criteria verifications pass and the Unified Lightweight Review Gate (or opt-in `/subagent-review`) does not surface blocking issues.
5. After all implementation tasks complete, the final `Run /completion-audit and /santa-loop` task automatically unblocks. Execute in order:
   1. Invoke `/completion-audit`. If verdict is **VERIFIED FAIL**, address the surfaced gaps and re-run `/completion-audit` (max 3 tries by /completion-audit's own loop). If 3 consecutive FAILs (its internal loop exhausted), leave the gate task `in_progress`, append `[BLOCKED: completion-audit escalated]` to the task description, surface the unresolved gap analysis to the user (mirrors santa-loop NAUGHTY escalation handling).
   2. On **VERIFIED PASS**, run **Security Sweep**: against the aggregated diff (`git diff <first-task baseline_sha>..HEAD`) evaluate the triggers in `~/.claude/skills/subagent-review/references/security-trigger-heuristic.md`. If any trigger fires, dispatch one fresh `security-auditor` agent via the Agent tool with the aggregated changed files and full diff. Fix any MUST_FIX issues before continuing; record verdict + raw findings in the gate task's `metadata.evidence`. If no trigger fires, record `Security Sweep: no trigger` and proceed. Max 2 retry rounds; 2 consecutive FAILs → append `[BLOCKED: security sweep escalated]` and surface to user.
   3. On Security Sweep PASS (or skip), invoke `/santa-loop` with the plan file path as its argument. The orchestrator captures `/completion-audit`'s verdict + per-criterion summary and embeds it as the `Audit Verdict Input` for `/santa-loop`'s reviewers.
   4. If santa-loop verdict is **NICE** → mark the gate task completed, emit the final report.
   5. If santa-loop verdict is **NAUGHTY (escalated after 3 rounds)** → leave the task `in_progress`, append `[BLOCKED: santa-loop escalated]` to the task description, surface the unresolved critical issues to the user.
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

After all tasks are `completed` and before `/completion-audit` and `/santa-loop`:
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

## Unified Lightweight Review Gate (default per-task review)

Replaces the two-stage `/subagent-review` (Spec sequential→ Quality) + multi-parallel Domain + per-task Security heuristic that used to run as the default per-task review. Multi-parallel Domain is gone from both the default path and the opt-in strict path; Security moves to the final gate Security Sweep. `/santa-loop` Layer 3 rubric backstops the dropped Domain observations at final-gate time.

### Skip conditions (any one suffices)

- (a) `diff --stat` shows < 10 changed lines AND ≤ 2 changed files (typo / trivial)
- (b) All changed files are docs / markdown files (`.md`, `.txt`, `README*`, or files whose only changes are within commented lines of other filetypes — but detecting comment-only diffs reliably is out of scope for the first iteration; default to file-type gating)
- (c) Verification-only task (test execution / lint only, no code change)
- (d) User has explicitly said "skip review" for this task
- (e) Task description carries a `[review-exempt]` tag

Record the triggering condition in `metadata.evidence` when skipping.

### Dispatch (fire)

When no skip condition applies:

1. **Unified reviewer** — dispatch 1 fresh `code-reviewer` subagent with `model: "opus"`, using the prompt template at `~/.claude/skills/subagent-review/references/unified-review-prompt.md` filled with:
   - `{task_description}` — task spec
   - `{plan_section}` — relevant plan section
   - `{git_diff}` — `git diff <baseline_sha>..HEAD`
   - `{file_paths}` — changed file list
   - `{claude_md_path}` — `~/.claude/CLAUDE.md`

   The reviewer returns one combined VERDICT covering Spec Compliance (MISSING / EXTRA / MISUNDERSTOOD / INCOMPLETE) + Code Quality (MUST_FIX / SHOULD_FIX / NIT).

2. **Conditional single Domain reviewer** — dispatch **at most one** domain-specialist agent based on the first match from this priority list:

   | Priority | Match | Agent |
   |---|---|---|
   | 1 | `.rs` file in diff | `rust-reviewer` |
   | 2 | `.go` file in diff | `go-reviewer` |
   | 3 | `.dart` file in diff | `dart-reviewer` |
   | 4 | `.nix` file in diff | `nix-reviewer` |
   | 5 | `.tsx` / `.jsx` file in diff | `typescript-reviewer` (React / a11y is covered by `/santa-loop` Layer 3 at final gate) |
   | 6 | `.ts` / `.mts` / `.cts` file in diff | `typescript-reviewer` |
   | 7 | `.sql` / `migrations/` / `schema.*` in diff | `database-reviewer` (schema migration safety reinforced at `/santa-loop` Layer 3) |
   | 8 | `Deno.` API reference in diff OR `jsr:` / `npm:` specifier added in diff OR `deno.jsonc` / `deno.json` itself modified in diff | `deno-reviewer` |
   | 9 | `.tf` / `*.tfvars` / k8s yaml / Helm chart / `Dockerfile` / `docker-compose.yml` / `serverless.yml` / `.github/workflows/*.yml` | `cloud-architecture-reviewer` |
   | 10 | `.css` / `.scss` / `.html` in diff AND no higher-priority match | `a11y-reviewer` |

   Only the **first** matching agent runs. No multi-dispatch. This priority list is identical to the opt-in strict path's single-domain dispatch in `/subagent-review` Step 6, so both paths behave identically at the Domain dispatch step (only the preceding review steps differ: Unified single-pass vs Spec → Quality sequential).

3. **No Security dispatch at per-task level** — moved to the final gate Security Sweep (see below).

### Gate verdict composition

When both the unified reviewer and a domain reviewer are dispatched, merge their outputs into a single gate verdict:

- Gate verdict = **PASS** only when (a) unified reviewer VERDICT is PASS **and** (b) the domain reviewer has no MUST_FIX-equivalent issue (i.e., its VERDICT is PASS)
- Gate verdict = **FAIL** if either reviewer returns FAIL
- On retry, re-dispatch **only** the failing reviewer(s) with a fresh agent instance. A PASSed reviewer is not re-run (anchoring bias, wasted cost)
- SHOULD_FIX / NIT items from either reviewer never block the gate — surface to the user as non-blocking notes

When only the unified reviewer runs (no domain match), the unified reviewer's VERDICT is the gate verdict.

### Malformed reviewer output

Applies uniformly to **all reviewer subagents invoked from `/impl`** — the unified reviewer, any conditional Domain specialist, and the final-gate `security-auditor` at the Security Sweep step.

A reviewer that fails to emit the mandated `VERDICT: PASS|FAIL` line (or returns malformed / un-parseable structure) is treated as FAIL with the synthetic critical issue `Reviewer returned malformed output`. One re-prompt with a stricter format reminder is allowed before counting the round; if the second attempt is still malformed, that reviewer counts as FAIL for the round and its synthetic critical issue is surfaced to the user along with any other findings. Mirrors `/subagent-review` Step 3 behavior.

### Retry

- Gate verdict PASS → proceed
- Gate verdict FAIL → fix flagged issues, re-dispatch the failing reviewer(s) with **fresh** subagent(s) (max **2** rounds)
- 2 consecutive FAILs → update task description with `[BLOCKED: unified review 2x failed]`, report issues to user

### Opt-in strict review

Per-task strict review via `/subagent-review` runs when:

- Task description carries `[strict-review]` tag, OR
- User explicitly invokes `/subagent-review` for the task

The opt-in strict flow is: Spec compliance → Code quality → **priority-ordered single** Domain specialist → Security heuristic. This is the current `/subagent-review` contract (see that skill's SKILL.md for details). Note that this differs from the prior pre-plan behavior, which dispatched multiple Domain specialists in parallel; the opt-in path inherits the same single-specialist demotion as the unified gate (rationale: multi-parallel Domain was a primary cost driver, and `/santa-loop` Layer 3 covers the dropped observations at the final gate regardless of which per-task path was taken).

## When to invoke /subagent-review

Opt-in only. The default per-task review is the **Unified Lightweight Review Gate** above. `/subagent-review` runs its strict two-stage flow when a task carries `[strict-review]` or the user invokes it explicitly. For `/codex-review` requests, follow the codex-review special rule from `~/.claude/CLAUDE.md` — never partial.

## Final gate: /completion-audit → Security Sweep → /santa-loop

The "Run /completion-audit and /santa-loop" task created by `/plan` Phase 5 (Pass 2) is `blockedBy` all implementation tasks. It auto-unblocks once all complete.

**Execution order is mandatory**:
1. `/completion-audit` first — evidence-sufficiency audit (no re-execution; reads per-task `metadata.evidence` against the plan's Completion Criteria). Must return **VERIFIED PASS** before continuing. On 3 consecutive FAILs (its internal loop exhausted), append `[BLOCKED: completion-audit escalated]` and surface to the user
2. **Security Sweep** — single `security-auditor` agent against the aggregated diff (`git diff <first-task baseline_sha>..HEAD`), gated by the triggers in `~/.claude/skills/subagent-review/references/security-trigger-heuristic.md`. Replaces the per-task security heuristic to avoid repeated dispatch across tasks. Fix any MUST_FIX before advancing; max 2 retry rounds. On pass or no trigger, proceed. On 2 consecutive FAILs, append `[BLOCKED: security sweep escalated]` and surface
3. `/santa-loop` third — dual-reviewer (Reviewer A: Claude code-reviewer/opus, Reviewer B: codex (claude-second fallback)). The orchestrator embeds the audit verdict + per-criterion summary as `Audit Verdict Input` so reviewers focus on code/design quality without re-judging completeness. `/santa-loop` Layer 3 rubric covers file-type-specific observations (React / a11y for `.tsx`, schema / migration / N+1 for `.sql`) that were dropped from the per-task Domain dispatch. Must return **NICE** (both reviewers PASS) to close the gate

`/verification-loop` is opt-in and invoked manually outside `/impl` (e.g., `/verify` before opening a PR, or as a standalone post-`/impl` step) when deterministic re-execution is genuinely required. It is not part of the `/impl` flow because per-task verification already covers re-execution and empirical analysis showed the gate-time re-run caught zero issues per-task missed (5/5 plans).

## Design decisions

**Why a per-task loop instead of batch impl**: Per-task verification + subagent-review catches regressions early. Batching defers feedback and makes diffs harder to review.

**Why baseline_sha is recorded per task**: Lets the audit trail tie a task's evidence to a precise diff range (`git diff <baseline_sha>..HEAD`). Compaction recovery also uses it to detect partial in-progress work.

**Why raw evidence (not summarized)**: Summaries lose the exact command + output that proves correctness. The completion-auditor needs verbatim evidence to verify acceptance.

**Why incremental re-plan keeps completed tasks**: Deleting completed tasks would erase the audit trail and force re-execution. Keeping them lets `/impl` resume from the correct state with full history.

**Why /subagent-review per task instead of at the end**: Issues surface immediately when the offending change is fresh in context. End-of-batch review forces re-context-loading and often misses which task introduced the issue.

**Why the diff-size threshold for the code-simplifier subagent**: Small diffs are unlikely to introduce defensive complexity worth a fresh-eyes review. Large diffs accumulate it.

**Why Agent dispatch (not skill loading)**: The `code-simplifier` subagent must actually execute to produce proposals. Loading the simplify-review skill definition into context alone does not spawn the reviewer. Direct Agent dispatch keeps behavior deterministic and matches the same pattern used by `/plan` Phase 4 Step 6 for `plan-simplifier`.

**Why /completion-audit is the default gate (not /verification-loop)**: per-task verification already covers re-execution; the gate's value is evidence audit + adversarial review, not redundant re-execution. Default re-execution duplicated cost without catching new issues empirically (5 plans audited, 0 catches). `/verification-loop` remains opt-in for cases that genuinely require deterministic re-execution.

**Why unified lightweight review as the default per-task review**: the prior 2-stage `/subagent-review` (Spec sequential→ Quality) + parallel Domain dispatch + Security heuristic spawned 4-7 fresh subagents per task and drove wall-time + token cost through the roof. Consolidating to a single unified pass (Spec + Quality merged) + at most one Domain agent + skip conditions for trivial / docs-only / verification-only tasks cuts per-task subagent count to 0-2 while keeping the early-feedback value. Strict review remains available opt-in via `[strict-review]` tag or explicit `/subagent-review` invocation.

**Why security dispatch moved to the final gate Security Sweep**: running the security heuristic per task dispatched the `security-auditor` repeatedly on overlapping diffs. At the final gate the heuristic runs once against the aggregated diff, eliminating the per-task repetition cost. The Security Sweep remains **heuristic-gated** — if the security-trigger-heuristic does not match the aggregated diff, no `security-auditor` is dispatched and the step records `Security Sweep: no trigger`. Residual risk: the heuristic can miss security-relevant changes whose signatures are outside its trigger set (path / content / config patterns). For high-assurance reviews, the user can force coverage by tagging the relevant task with `[strict-review]` (which runs per-task security heuristic on the opt-in path) or by invoking `/subagent-review` manually. Unconditional dispatch of `security-auditor` on every final gate would solve this but incurs cost on changes that carry no security signal; the first-iteration default prioritizes cost reduction and leaves full coverage as opt-in.
