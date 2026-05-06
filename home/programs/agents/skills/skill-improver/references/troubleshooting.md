# Troubleshooting

Three FAQs for the empirical improvement loop.

## 1. Agent tool dispatch failed

**Symptom**: Dispatching a fresh subagent via the Agent tool returns an error or is unavailable in the current execution context.

**Action**: Switch to **structural mode**.
- Read `static-review.md` "Full Structural Fallback" section
- Run the 6-dimension 1-5 scoring on the target skill
- Tell the user: "Empirical evaluation skipped: Agent tool dispatch unavailable. Reporting structural review only."

**Limitation**: Auto-detecting a nested-as-subagent execution (skill-improver invoked from inside another subagent) is not supported. Dispatch failure is the only signal. If empirical mode is silently producing wrong results in a nested context, re-invoke skill-improver with an explicit natural-language request such as `/skill-improver <target> — run in structural mode only`. Claude treats that phrase as a user-level override and skips the empirical loop, going directly to `static-review.md` "Full Structural Fallback".

## 2. Metrics N/A (steps / duration not measurable)

**Symptom**: The target skill's work has no meaningful step count or duration metric (e.g., a Q&A skill, a documentation-generation skill, a single-shot lookup skill). The Agent tool returns usage metadata, but `tool_uses` and `duration_ms` are uninformative across iterations.

**Action**: Degrade to **qualitative-only mode**.
- Drop the `steps` and `duration` columns from the iteration report table
- Keep requirement satisfaction (○ / × / 部分的) and unclear-points count as the primary convergence signal
- Convergence criteria: 2 consecutive iterations with no new unclear points and no `[critical]` requirement failures

The numeric thresholds in SKILL.md's Convergence Criteria (steps ±10%, duration ±15%, +3pt accuracy) are guide values for skills with measurable execution; they do not apply when metrics are N/A.

## 3. Want to change a frozen scenario mid-iteration

**Symptom**: While running iterations, you realize a scenario is too easy / too hard / poorly designed / no longer reflects the use case.

**Action**: **Do not edit the scenario mid-run**.

Changing a scenario between iterations invalidates cross-iteration comparison: a metric drop or improvement could come from the patch OR from the moved goalpost. You can no longer trust the convergence verdict.

Correct procedure:
1. Stop the current run
2. Redesign the scenarios (with user agreement)
3. Restart from iteration 1 with the new frozen set

The cost is real (lost iterations), but the alternative is a meaningless verdict. If this happens often, your Step 3 (Scenario Design) phase is rushing — slow it down and validate scenarios with the user more carefully before freezing.
