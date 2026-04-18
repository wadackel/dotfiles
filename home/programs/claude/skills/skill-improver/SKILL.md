---
name: skill-improver
description: Improves existing Claude Code skill definitions through an empirical iteration loop — dispatching fresh subagents against frozen scenarios to measure description-body drift, unclear points, and tool-use patterns, then applies one-theme patches until the skill converges. Use when users want to improve, refine, review, or optimize a skill's quality, description, structure, or workflow based on actual subagent behavior rather than static review alone. Triggers include "improve this skill", "review skill quality", "make this skill better", "スキルを改善して", "スキルの品質を上げて", "スキルをレビューして", or when skill definitions need refinement based on empirical scenario evaluation.
argument-hint: "[skill-name]"
---

# Skill Improver

Improve a Claude Code skill through an empirical iteration loop. A fresh subagent executes the skill against frozen scenarios with a `[critical]`-tagged requirements checklist; its self-report and the caller-side tool-use metrics drive a one-theme patch per iteration until the skill converges.

The writer cannot review their own prompt objectively — this skill dispatches bias-free executors and measures, rather than reading and scoring.

## Quick Start

```
/skill-improver [skill-name]
```

If no skill name is provided, you're prompted to select from available skills under `~/.claude/skills/` or `.claude/skills/`.

## Guards

Two guards can route the workflow to **structural mode** (see `references/static-review.md` "Full Structural Fallback") instead of empirical iteration. They fire at different points in the workflow.

### Guard 1: Recursion (pre-flight, evaluated on the resolved target)

Fires **before Step 3 (Scenario Design)**, on whichever invocation path resolves first:
- at entry if `$ARGUMENTS == "skill-improver"`, OR
- immediately after Step 1 if the user selected `skill-improver` from the interactive list.

The target is skill-improver itself. Dispatching a subagent that runs skill-improver on a third target would recurse indefinitely. Switch to structural mode and tell the user: "Self-application detected — running structural review of skill-improver instead of recursive empirical evaluation."

### Guard 2: Agent tool dispatch unavailable (runtime, at the first dispatch attempt in Step 4)

This guard fires **at exactly one point in the workflow**: the first `Agent` tool call in Step 4. It cannot fire earlier (nested-as-subagent auto-detection is not supported; dispatch failure is the only signal) and it must not fire later (a mid-iteration dispatch failure is a different condition — retry the single dispatch; do not switch modes mid-run).

When that first Step 4 dispatch returns an unavailable / permission / tool-missing error, abort empirical iteration, switch to structural mode, and tell the user: "Empirical evaluation skipped: Agent tool dispatch unavailable. Reporting structural review only."

See `references/troubleshooting.md` if empirical mode misbehaves in nested contexts.

## Workflow

### Step 1: Identify target

If `$ARGUMENTS` is provided, use it. Otherwise list available skills:

```bash
ls -1 ~/.claude/skills/
ls -1 .claude/skills/   # if in a project
```

Verify the skill directory and SKILL.md exist. Stop with an error if not found.

After the target is resolved, re-evaluate Guard 1 (recursion) if it was not already tripped at entry. If the user selected `skill-improver` interactively, switch to structural mode now.

### Step 2: Iteration 0 — Static Integrity Check

Two sub-steps, no subagent dispatch yet.

**(a) WebFetch latest skill spec.** Fetch both:
- `https://code.claude.com/docs/en/skills` (Claude Code skills documentation)
- `https://agentskills.io/specification` (Agent Skills open specification)

Parse: frontmatter rules, required / optional fields, description best practices, progressive disclosure guidelines, anti-patterns. Running this every session keeps the evaluation aligned with the current standard.

If WebFetch fails (network, 404, rate limit): fall back to `references/specification-summary.md` and tell the user that cached spec is in use.

**(b) Static integrity check.** Using the fetched (or cached) spec as the source of truth, verify against the target skill:
- **Description ↔ body alignment**: each description claim has a body section that delivers it; body has no unadvertised hidden capability
- **Frontmatter format**: `name` / `description` / optional fields match current spec
- **File-reference link integrity**: every `references/*.md` in SKILL.md exists; no orphans

Detailed procedure: `references/static-review.md` "Iteration 0 Minimal".

Apply any fixes before Step 3. Entering empirical iteration against a drifted skill produces false-positive accuracy scores (the dispatched subagent reinterprets the skill via its description).

### Step 3: Scenario Design

Work with the user to design 2-3 evaluation scenarios with a frozen requirements checklist.

- 1 median scenario + 1-2 edge scenarios
- 3-7 requirements per scenario
- At least 1 `[critical]` tag per scenario (success = all `[critical]` items ○)
- Freeze after user agreement — do not edit during the iteration loop

Claude proposes first; the user edits / confirms / rejects; then freeze.

Full guidance: `references/scenario-and-contract.md` "Scenario Design".

### Step 4: Dispatch fresh subagent (per scenario)

For each frozen scenario, dispatch a fresh subagent via the `Agent` tool (`subagent_type: "general-purpose"` by default). Multiple scenarios run in parallel — issue all Agent tool calls in a single message.

Each subagent receives the launch contract from `references/scenario-and-contract.md` "Subagent Launch Contract":
- The target skill (body text or absolute path to Read)
- The scenario setup paragraph
- The frozen requirements checklist
- The standard report structure
- The **dry-run convention** (return artifacts and commands; do not execute side effects)

Never reuse a subagent across iterations — prior iterations' patches bias its self-report.

### Step 5: Dual-axis evaluation

For each returned report, capture both axes:

**Qualitative (from self-report):**
- Unclear points (list)
- Discretionary choices (list) — spots where the skill left decisions to the subagent
- Retry count (how often the subagent redid the same judgment)

**Quantitative (from Agent tool usage metadata):**
- Success / failure (binary — all `[critical]` ○ = ○, otherwise ×)
- Accuracy % (ratio of requirements met: ○ = 1, partial = 0.5, × = 0)
- `tool_uses` (Read / Grep included, no exclusions)
- `duration_ms`

**Metrics N/A**: for Q&A-style or documentation-style skills where `tool_uses` / `duration_ms` are uninformative, degrade to qualitative-only mode (see `references/troubleshooting.md`). Drop the two metric columns from the report; convergence keys on unclear-points count and requirement satisfaction.

### Step 6: Diagnose + 1-theme patch

Identify the single highest-impact unclear point or discretionary gap. Select ONE patch theme from `references/improvement-patterns.md`.

**One iteration, one theme.** Related micro-fixes inside the same theme are fine; unrelated fixes wait for the next iteration. Batching unrelated patches destroys the ability to attribute which fix caused which metric change.

Apply the patch to the target skill's files.

### Step 7: Re-dispatch fresh subagent

Repeat Step 4 with **new** subagent instances. Same scenarios, same frozen checklist. Collect the new dual-axis evaluation.

### Step 8: Convergence check

After each iteration, check stop conditions.

**Converged** when TWO CONSECUTIVE iterations satisfy all:
- Zero new unclear points (no ambiguity that wasn't already present)
- Accuracy delta ≤ +3 percentage points (saturation)
- `tool_uses` variance within ±10% of the prior iteration
- `duration_ms` variance within ±15% of the prior iteration

These are guide values; eyeball them when metrics are noisy.

On convergence, generate a **hold-out scenario** per `references/scenario-and-contract.md` "Hold-out Scenario Generation" (shift one dimension of one frozen scenario by one degree). Run hold-out ONCE. Compare its accuracy to the **average accuracy of the last 2 frozen-scenario iterations** (single source of truth — see `scenario-and-contract.md` "Hold-out judgement"). If the hold-out accuracy drops ≤ 15pt from that baseline, CONVERGED. If > 15pt drop, allow one additional iteration targeting the hold-out's unclear points, then re-test ONCE. Never run hold-out more than twice.

**Diverged** when 3 iterations produce no reduction in unclear points → the skill's design itself is flawed. Stop patching; recommend structural rewrite to the user.

**Resource cutoff**: if iteration cost no longer justifies the quality gain, stop at the current score. Report it to the user as a colloquial "good enough" cutoff (e.g., "shipping at ~80 points" using the source skill's informal phrasing — this is not a formal 100-point scoring scale).

## Iteration Report Format

Present at each iteration:

```
## Iteration N

### Change from previous iteration
- <one-line patch theme>

### Results (per scenario)
| Scenario | Pass/Fail | Accuracy | steps | duration | retries |
|---|---|---|---|---|---|
| A | ○ | 90% | 4 | 20s | 0 |
| B | × | 60% | 9 | 41s | 2 |

### New unclear points
- <scenario B>: [critical] item 3 × — <one-line reason>    # always list [critical] failure first
- <scenario B>: <other unclear point>
- <scenario A>: (none new)

### New discretionary gaps
- <scenario B>: <what the subagent had to choose on its own>

### Next patch theme
- <one-line plan>

(Convergence: X consecutive clean / Y iterations until stop)
```

## Evaluation Axes

| Axis | Source | Meaning |
|---|---|---|
| Pass / Fail | Requirement satisfaction (binary) | Minimum bar: all `[critical]` ○ |
| Accuracy | Weighted requirement ratio | Partial-success level |
| Steps (`tool_uses`) | Agent usage metadata | Instruction-efficiency signal |
| Duration (`duration_ms`) | Agent usage metadata | Cognitive load proxy |
| Retries | Self-report | Ambiguity signal (same decision redone) |
| Unclear points | Self-report (bulleted) | Qualitative improvement material |
| Discretionary gaps | Self-report (bulleted) | Hidden-spec surface |

Weight qualitative (unclear points, discretionary gaps) **over** quantitative. Chasing duration alone strips the skill too thin.

`tool_uses` cross-scenario variance interpretation: if one scenario shows 3-5× more tool calls than siblings, the skill is likely over-reliant on references descent (subagent is traversing reference files hunting for guidance). Add an inline minimal example or a "when to read references" hint to the SKILL.md body.

## Convergence Criteria (guide values)

- Consecutive clean iterations: 2 (3 for critical skills)
- Accuracy delta: ≤ +3 percentage points
- Steps variance: ±10%
- Duration variance: ±15%
- Hold-out accuracy drop: ≤ 15 percentage points

Numbers are guide values from empirical-prompt-tuning; eyeball when metrics are noisy or when N/A.

## Red Flags (rationalizations to refuse)

| Rationalization | Actual state |
|---|---|
| "I can reread my own prompt — same effect" | Cannot objectify text you just wrote. Dispatch a fresh subagent. |
| "One scenario is enough" | One scenario overfits. Minimum 2, prefer 3. |
| "Zero unclear points once — done" | Could be luck. Require 2 consecutive. |
| "Squash multiple unclear points in one patch" | Lose attribution. One theme per iteration. |
| "Split each micro-fix into its own iteration" | Opposite trap. Related fixes bundle fine; unrelated split. |
| "Metrics look good — ignore qualitative feedback" | Time shrinkage can mean over-thinning. Qualitative first. |
| "Faster to rewrite than iterate" | Valid after 3 stuck iterations. Before that, it's an escape. |
| "Reuse the same subagent to save cost" | Subagent has learned. Always fresh. |
| "Change the scenario if it keeps failing" | Invalidates cross-iteration comparison. Frozen means frozen. |
| "Skip hold-out — we already converged" | Hold-out catches overfitting to the frozen set. Do not skip. |
| "Defer to the skill author's judgment on unclear points I found" | You are the evaluator. Report everything observable. |

## Self-application

`/skill-improver skill-improver` routes to structural mode via the Recursion Guard. Empirical evaluation of skill-improver on itself would dispatch a subagent that runs skill-improver on a third target, which recurses indefinitely. Structural mode via `references/static-review.md` is the correct path for reviewing skill-improver itself.

## Tips

- Respect existing language, voice, and scope of the target skill. Patch narrowly.
- Cite the rationale when explaining a patch ("subagent retried the same decision 3 times — tighten the instruction").
- Always run hold-out after convergence. The convergence signal without hold-out is fit-to-scenario.

## Related Skills

- **skill-tester**: validates trigger / activation (does `description` match the user's prompt?). Complementary — run it before skill-improver to fix triggering, then skill-improver for content quality.
- **skill-creator**: for creating new skills from scratch. skill-improver assumes a pre-existing skill.

## References

- [references/static-review.md](references/static-review.md) — Iteration 0 Minimal + Full Structural Fallback (invoked when Guard 1 or Guard 2 routes to structural mode)
- [references/scenario-and-contract.md](references/scenario-and-contract.md) — Scenario design rules, subagent launch contract, dry-run convention, hold-out generation
- [references/improvement-patterns.md](references/improvement-patterns.md) — Step 6 patch catalog (select one theme per iteration)
- [references/specification-summary.md](references/specification-summary.md) — Step 2 WebFetch fallback (cached skill standard summary)
- [references/troubleshooting.md](references/troubleshooting.md) — Agent dispatch failure, metrics N/A, frozen-scenario mid-run mistakes
