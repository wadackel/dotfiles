---
name: santa-loop
description: "Adversarial dual-reviewer convergence loop. Two independent reviewers (Claude Opus + Codex CLI) must both return NICE before declaring the change complete. NAUGHTY → fix all flagged issues → fresh re-review (max 3 rounds). Use as the final gate after all implementation tasks complete (replaces /completion-audit by default). Triggers include /santa-loop / dual review / 最終レビュー / sanity check / dual-reviewer."
argument-hint: "[plan-file-path | scope-spec]"
---

# Santa Loop

Adversarial dual-review convergence loop. Two independent reviewers — different models when possible, no shared context — must both return NICE before the change is considered complete. If either returns NAUGHTY, fix all flagged issues and re-run with **fresh** reviewers (no carry-over context). Maximum 3 rounds before escalating to the user.

**Core insight:** Single-reviewer biases are eliminated only by independence. If only one reviewer catches an issue, that issue is real — the other reviewer's blind spot is the failure mode this skill exists to fix.

## When to Use

- **Default**: as the final gate task in `/impl` (replaces `/completion-audit` for default flow). The "Run /verification-loop and /santa-loop" task created by `/plan` Phase 5 invokes this skill after `/verification-loop` returns READY.
- **Manual**: user explicitly asks for adversarial review, "santa loop", "dual review", "最終レビュー", or wants a stricter pre-ship check than `/codex-review` provides.

Do NOT use for:
- Mid-task review (use `/subagent-review` per task instead)
- Lightweight single-external sanity check (use `/codex-review` instead)
- Documentation-only / typo-only changes (overkill)

## Prerequisites

`/santa-loop` expects the prior `/verification-loop` to have returned READY (deterministic checks pass). When invoked from `/impl`, the orchestrator enforces this order.

When invoked manually:
- Reads plan file from `~/.claude/plans/.active-<cwd-hash>` if present (plan path embedded inside)
- Falls back to `$ARGUMENTS` (path or scope description)
- Falls back to uncommitted-changes scope if neither is available

## Workflow

### Step 1: Identify Scope

1. Resolve plan file path (active marker → `$ARGUMENTS` → none)
2. Resolve baseline:
   - If plan exists and `/impl` task `metadata.baseline_sha` is reachable, use `git diff <baseline_sha>..HEAD`
   - Otherwise use `git diff HEAD` (uncommitted changes)
3. Capture changed files: `git diff --name-only <baseline>..HEAD`
4. Read each changed file in full so the rubric can be tailored to file types

### Step 2: Build Rubric

Construct the rubric in three layers:

**Layer 1 — Default rubric (always present)**

| Criterion | Pass condition |
|---|---|
| Correctness | Logic is sound, no bugs, edge cases handled (cite file:line for any concern) |
| Completeness vs Completion Criteria | Every item in plan's `## Completion Criteria` section is addressed (cite which task / which lines satisfy each item) |
| Security | No hardcoded secrets, no injection vectors, OWASP-relevant patterns absent in changed code |
| Error handling | Errors handled explicitly, no silent swallowing |
| Internal consistency | No TECHNICAL contradictions across files / sections (contracts / types / cross-references). Style / naming / formatting differences are OUT OF SCOPE for this criterion — if noted, put them in `suggestions`, NOT `critical_issues` |
| No regressions | Changes don't break existing behavior reachable from changed code |

**Layer 2 — Completion Criteria embed**

Read the plan file's `## Completion Criteria` section verbatim and append it to the prompt under `{plan_completion_criteria}`. The reviewer must verify each item is addressed, NOT just code quality.

If no plan file is available, set `{plan_completion_criteria}` to `(no plan file in scope — verify only against general rubric)` and proceed.

**Layer 3 — File-type dynamic criteria**

Append based on detected file types in the diff:

| Detected | Append criterion |
|---|---|
| `.ts`, `.tsx`, `.mts` | `Type safety: no any leaks, exhaustive switches, no unsafe assertions` |
| `.sql`, `migrations/*` | `Migration safety: NOT NULL adds backfill, no destructive operations without lock plan, parameterized queries` |
| `.tf`, `*.tfvars`, k8s yaml | `Infrastructure safety: least-privilege IAM, no wildcard role, resource limits set` |
| `.go` | `Concurrency safety: no goroutine leaks, context propagation correct` |
| `.rs` | `Memory safety: unsafe usage justified, Send + Sync boundaries respected` |
| `.nix` | `Profile correctness: profile-specific switches (private vs work) consistent` |

### Step 3: Build Reviewer Prompt

Assemble the final reviewer prompt by combining: (a) the rubric from Step 2, (b) orchestrator-verified evidence for `[orchestrator-only]` items, (c) the task specification, (d) the diff and file paths.

#### Orchestrator Evidence Embedding

Some Completion Criteria items require host access the reviewer's sandbox cannot provide. For each such item, the orchestrator pre-runs and embeds verbatim evidence.

**Identify orchestrator-only items:**

Explicit tag: plan's Completion Criteria item has `[orchestrator-only]` prefix — this is the **sole signal**. Tags are mandatory per `/plan` Phase 4 Step 8; untagged items should never reach santa-loop. If encountered (bypassed /plan), emit a hard error and abort: `santa-loop: untagged Autonomous Verification items detected. Re-invoke /plan to add tags.`

When no plan file exists at all (manual `/santa-loop` invocation), fall back to conservative default: treat ALL commands in the diff / scope as `[file-state]` (reviewer self-verifies). This is safer than auto-classifying as orchestrator-only which could run untrusted commands.

**Embed format** (insert into reviewer prompt as new "Verified Evidence" section):

```
## Verified Evidence (from orchestrator — trusted, do NOT re-run)

$ nix flake check 2>&1 | tail -5
checking flake output 'homeConfigurations'...
checking flake output 'darwinConfigurations'...
running 1 flake checks...
exit=0

$ rg -l 'old-name' home/programs/claude/ 2>/dev/null || echo "(empty)"
(empty)
```

- Truncate stdout/stderr to last 50 lines if longer; note `[truncated, N lines elided]`
- Redact secrets matching `sk-[A-Za-z0-9]{20,}` / `password\s*=` / `TOKEN\s*=` before embedding
- When exit code ≠ 0, abort santa-loop and report orchestrator failure (do NOT invoke reviewers with failing evidence)

**Circular items** tagged `[outcome]` (e.g., "/santa-loop returns NICE") are NOT pre-run. Label them in prompt: "outcome of this review, not prerequisite".

**Skip Orchestrator Evidence Embedding when ALL hold:**
- Plan has no `[orchestrator-only]` tags, AND
- Reviewer B is Claude (same sandbox) with no known host-access limitation

Rationale: without this step, Round 2+ reviews in sandbox-limited reviewers (e.g., Codex without Nix daemon access) FAIL solely for environmental reasons, wasting a round.

#### Final prompt assembly

Build the prompt from `references/reviewer-prompt.md` template, filling:
- Task specification (from plan's Context / Overview or ad-hoc input)
- Rubric (from Step 2, three layers merged)
- Completion Criteria (verbatim from plan)
- Intentional Conventions section (verbatim if present)
- Verified Evidence block (from Orchestrator Evidence Embedding above, if applicable)
- Diff and changed file list

The same prompt string is used for both Reviewer A and Reviewer B in Step 4.

### Step 4: Dual Independent Review

**Critical invariants** (from santa-method):

1. **Context isolation** — neither reviewer sees the other's assessment
2. **Identical rubric** — both receive the same evaluation criteria
3. **Same inputs** — both receive task spec + Completion Criteria + diff + file paths
4. **Structured output** — each returns a typed JSON verdict (see `references/reviewer-prompt.md`)

Both reviewers MUST be launched **in parallel** — issue both tool calls in the SAME message. Sequential launching loses the speed benefit and risks context bleed.

#### Reviewer A: Claude code-reviewer (always runs)

```
Agent tool:
  subagent_type: "code-reviewer"
  model: "opus"
  prompt: <built from references/reviewer-prompt.md with all placeholders filled>
```

#### Reviewer B: External CLI (with fallback)

Detect availability and use the first one found:

```bash
# Detect once per Step 4 invocation
CODEX_OK=$(command -v codex >/dev/null 2>&1 && echo yes || echo no)
```

**Codex CLI (preferred)**

Invoke via bash (Claude Code's Bash tool default — do not rely on the user's interactive shell). The single-quoted heredoc delimiter used below is deliberately distinctive to avoid collision with prompt content and suppresses `$` / backtick / `${...}` expansion so the prompt is piped literally.

```bash
codex exec --sandbox read-only -C "$(pwd)" - << 'SANTA_REVIEWER_B_PROMPT_EOF'
<full reviewer prompt: same content as Reviewer A>
SANTA_REVIEWER_B_PROMPT_EOF
```

**Claude second instance (fallback if Codex unavailable — no model diversity)**

```
Agent tool:
  subagent_type: "code-reviewer"
  model: "opus"
  prompt: <reviewer prompt>
```

Log a warning: `WARN: santa-loop falling back to Claude-only dual review — model diversity NOT achieved, only context isolation.`

#### Output parsing

Each reviewer returns the JSON object specified in `references/reviewer-prompt.md`. Parse robustly:
- Strip leading/trailing whitespace
- Strip code-fence wrappers if present (` ```json ... ``` `)
- Validate required keys (`verdict`, `checks`, `critical_issues`, `suggestions`)
- On parse failure: re-prompt the reviewer ONCE with stricter format reminder; if still malformed, treat as `{"verdict":"FAIL","critical_issues":["Reviewer returned malformed JSON"],"suggestions":[]}`

### Step 5: Verdict Gate

```
if reviewerA.verdict == "PASS" and reviewerB.verdict == "PASS":
    verdict = "NICE"  # ship
else:
    verdict = "NAUGHTY"
    issues = dedupe(reviewerA.critical_issues + reviewerB.critical_issues)
    suggestions = dedupe(reviewerA.suggestions + reviewerB.suggestions)
```

**Why both must pass**: if only one reviewer catches an issue, that issue is real. The other reviewer's blind spot is exactly the failure mode `santa-loop` exists to eliminate. There is no partial credit.

Dedupe by lowercased issue text Levenshtein distance (or simpler: by first 80 chars). Show both reviewers' findings to the user — even when both agree, divergent phrasings provide useful detail.

### Step 6: Fix Cycle (NAUGHTY path)

```
MAX_ROUNDS = 3
for round in 1..MAX_ROUNDS:
    if verdict == "NICE":
        break

    # 1. Display merged critical_issues to user (per-issue file:line)
    # 2. Fix every flagged issue — change ONLY what was flagged
    #    NO drive-by refactors, NO scope expansion, NO "while I'm here"
    # 3. Record fixes in working tree. santa-loop does NOT auto-commit.
    #    Global CLAUDE.md rule "only commit when user requests" takes precedence.
    #    Fresh reviewers in the next round read the current working tree state
    #    (which includes all Round N-1 fixes) directly. Per-round audit trail is
    #    captured in metadata.evidence instead of git history.
    #    If the user wants per-round commits, they invoke /commit explicitly.

    # 4. Re-run Step 4 with FRESH reviewer instances (new Agent invocations,
    #    no Continue, no resume, no carry-over context)
    # 5. Re-evaluate Step 5 verdict gate
```

**Critical**: each round uses **fresh** Agent invocations (and a fresh heredoc stdin for Codex). Reusing the previous reviewer's session creates anchoring bias — the reviewer remembers what it flagged before and is reluctant to find new issues.

If after MAX_ROUNDS the verdict is still NAUGHTY:

```
SANTA LOOP ESCALATION (exceeded 3 rounds)

Remaining critical issues:
- <list, with file:line>

Reviewer agreement summary:
- Both flagged: <count>
- Reviewer A only: <count>
- Reviewer B only: <count>

Manual review required before proceeding. /impl will mark the task as
in_progress with [BLOCKED: santa-loop escalated] notation.
```

Do NOT push. Do NOT mark the task completed. Surface to the user.

### Step 7: Final Report

On NICE:

```
SANTA VERDICT: NICE

Reviewer A (Claude Opus):    PASS
Reviewer B (<model used>):   PASS

Rounds:                      <N>/3
Suggestions deferred:        <count>

Plan Completion Criteria coverage:
- ✅ <criterion 1>
- ✅ <criterion 2>
...

Result: READY for completion. Push is the user's decision (santa-loop does not push).
```

On NAUGHTY (escalated):

```
SANTA VERDICT: NAUGHTY (escalated)

Reviewer A: <PASS/FAIL>
Reviewer B: <PASS/FAIL>

Rounds completed: 3/3
Unresolved critical issues:
- <issue 1>
- <issue 2>

Recommendation: manually review and either fix the remaining items or re-scope the task.
```

When invoked from `/impl`, the orchestrator uses the final verdict to mark the gate task `completed` (NICE) or to add `[BLOCKED: santa-loop escalated]` to the description and leave it `in_progress` (NAUGHTY).

## Failure Modes & Mitigations

| Failure mode | Symptom | Mitigation |
|---|---|---|
| Both reviewers rubber-stamp | Every criterion PASS without specific evidence | Reviewer prompt's anti-pattern section forbids "looks good"; rubric requires file:line evidence |
| Infinite loop | Reviewers find new issues after each fix | MAX_ROUNDS=3 cap; escalate to user |
| Subjective drift | Reviewers flag style as critical | Rubric uses objective PASS/FAIL conditions only; style → suggestions bucket |
| Fix regression | Round N fix breaks something Round N-1 reviewers passed | Fresh reviewers each round catch regressions |
| Reviewer agreement bias | Both miss the same issue | Mitigated (not eliminated) by independence; for highest-stakes work, add a third human reviewer |
| External CLI unavailable | codex not installed | Fallback to claude-second with explicit warning when diversity is lost |
| Malformed JSON output | Reviewer returns prose instead of JSON | One re-prompt with stricter reminder; second failure → treat as FAIL with "malformed output" critical issue |
| Context bleed between rounds | Reviewer remembers prior round | ALWAYS spawn fresh Agent / fresh CLI invocation per round; never use Continue / resume / session reuse |
| Reviewer sandbox mismatch | Reviewer cannot re-run a verification command (e.g., Codex without Nix daemon access) and marks Completeness as FAIL | Step 3 embeds orchestrator-verified evidence verbatim into reviewer prompt; reviewer accepts without re-running |
| Interpretive dispute drain | Reviewer puts style/naming preferences into `critical_issues` causing rounds to burn on non-technical disputes | Step 2 "Internal consistency" criterion explicitly scopes to technical-only; reviewer-prompt.md strengthens "style → suggestions" rule |

## Integration Points

| Skill | Relationship |
|---|---|
| `/impl` | Invokes `/santa-loop` as the final gate task (after `/verification-loop` returns READY) |
| `/verification-loop` | Runs BEFORE `/santa-loop`. `/santa-loop` does not duplicate deterministic checks — it focuses on semantic correctness + completion criteria coverage |
| `/codex-review` | Lightweight single-external review for opt-in mid-task use. `/santa-loop` is the heavyweight dual-reviewer for the final gate. The two coexist with distinct purposes |
| `/subagent-review` | Per-task review during `/impl`. `/santa-loop` is end-of-implementation review, not per-task |
| `/completion-audit` | Deprecated for default flow. `/santa-loop`'s "Completeness vs Completion Criteria" criterion covers the same ground. Re-invoke `/completion-audit` manually only when stricter evidence-sufficiency audit is specifically required |

## Design Decisions

**Why both reviewers must PASS for NICE**: see Step 4 — partial credit defeats the purpose of dual review.

**Why fresh reviewers each round**: anchoring bias. A reviewer that remembers flagging X in round 1 is psychologically reluctant to find Y in round 2. Fresh agents have no such memory.

**Why no auto-push on NICE**: in this dotfiles workflow, `git push` is the user's decision (different from ECC's santa-loop). NICE just unblocks the final task and surfaces the report.

**Why the rubric embeds Completion Criteria**: this skill replaces `/completion-audit` for the default flow. Without this criterion, code-quality dual review would miss requirement coverage gaps.

**Why max 3 rounds**: empirically the convergence rate after round 3 is too low to justify continued automation. Beyond that, the issue is usually a design gap, not a code gap — escalate to the user.

**Why Codex before Claude fallback**: model diversity is the goal. Two Claude instances with isolated context still share training data and biases. Codex (GPT family) brings genuinely different blind spots.
