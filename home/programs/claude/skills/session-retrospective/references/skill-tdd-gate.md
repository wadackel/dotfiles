# Skill-TDD Gate

Test-driven validation for skill proposals. Borrowed from superpowers' writing-skills principle:

> "If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing."

Run this gate in Phase 3 Pair Design for every skill candidate flagged as Workflow candidate in Phase 2 Extract & Drill (via Signals 1-6 in skill-opportunity-detection.md), whether the target is "new skill creation", "reference deepening", or "description fix". A proposal that cannot pass the gate is either premature or does not belong at Rung 3.

## Why this gate

The failure mode it prevents: skill proposals that look reasonable in the retrospective output but, once shipped, never actually change agent behavior because:

1. The agent would not have loaded the skill in the first place (description never matched)
2. The skill body restates what the agent already knew — no new information
3. The skill overlaps with an existing skill and the agent picked the other one
4. The skill's workflow is different in the wild than the retrospective imagined

Without a RED test, none of these are visible. With a RED test, they surface before the skill ships.

## The three phases

### RED — Reconstruct "agent without skill" failure from the session

Before proposing the skill, use the transcript evidence gathered in Phase 2 Extract & Drill to reconstruct the failure as it would occur in a **fresh agent session** without the proposed skill. Ask:

1. **Can the failure be reproduced from evidence alone?**
   - YES → RED is reproducible. Proceed.
   - NO → the retrospective inferred a failure that did not actually happen. Discard the proposal.

2. **Would a fresh agent — knowing what the main agent knew at that turn — have failed the same way without the skill?**
   - YES → the failure is truly skill-shaped.
   - NO → the agent had all the information needed; the skill is redundant. Demote to Rung 4 (if still worth documenting) or discard.

3. **What is the exact failure mode?**
   - Name it in one sentence. Cite the turn number.
   - Example: "At turn 42, agent ran `git diff origin/main...HEAD` on a shallow clone and reported 16 files instead of the correct 3, because no tool exposed the shallow-fetch caveat."

If you cannot name the failure mode in one sentence with a concrete turn citation, the RED test does not pass. **No reproducible RED → no Rung 3 proposal.** Route to Rung 4 or discard.

### GREEN — Minimum skill content that addresses the specific failure

Write only the minimum content that would have prevented the RED failure. Start with:

- **A description**: 1-2 sentences naming the trigger scenario using the language the user actually used. Skill descriptions state **when to use**, never workflow details (the full content of SKILL.md is read after description-match triggers load).
- **A body**: only the sections directly addressing the RED failure.

Do not add:

- Generic "best practices" sections unrelated to the RED
- Defensive content for failure modes not observed
- Cross-references to every nearby skill
- Background context that any agent with standard Claude Code knowledge already has

The rule of thumb from superpowers: a skill that survives the REFACTOR phase is usually 30-60% of the first draft's length.

### REFACTOR — Pressure-test for loopholes and overlaps

After GREEN, three adversarial checks:

1. **Overlap with existing skill**: run `ls ~/.claude/skills/` and scan for adjacent scopes. If an existing skill covers ≥60% of the proposed scope, route to **description fix** or **reference deepening** on that skill instead of new creation.

2. **Loophole scan**: re-read the GREEN content and ask "under what phrasing of the user's ask would the agent NOT load this skill even though it should?" If you find a phrasing, expand the description's trigger phrases.

3. **Description ↔ body drift** (static integrity check from skill-improver): every claim the description makes must have a body section that delivers it; body must not have an unadvertised hidden capability.

If REFACTOR surfaces an issue that cannot be closed without enlarging the skill past the GREEN scope, the proposal's scope was wrong. Split it, shrink it, or route to a smaller layer.

## Weak-justification auto-detection

Reject Rung 3 candidates that match any of these patterns:

| Signal | Why reject |
|---|---|
| "User mentioned it multiple times" but no workflow | Preference, not workflow → CLAUDE.md |
| "This is useful information" | Fact, not orchestration → CLAUDE.md |
| "Someone will probably need this someday" | Speculation, no reproducible RED → discard |
| "It's complex" but it is a one-off | One-off complex ≠ skill. Skill requires generalizability across future sessions |
| "Adds surface for review coverage" | No reproducible failure to fix — cargo-cult structure |
| Description written as a workflow summary | Descriptions state *when to use*, not *how* — rewrite |

Each of these is a **weak justification**. A proposal without reproducible RED is weak; demote to Rung 4 or discard.

## Output per skill candidate

Append to the Phase 3 Pair Design results for every skill-candidate learning:

```
### Skill candidate: <name>

**RED**:
- Failure mode (turn N): <one sentence, with turn citation>
- Reproducible from evidence alone? YES / NO
- Would a fresh agent have failed the same way? YES / NO
- Verdict: RED pass | RED fail (discard or demote)

**GREEN** (if RED pass):
- Proposed description: <1-2 sentences, user's language>
- Minimum body sections:
  - <section 1>
  - <section 2>
  - ...

**REFACTOR**:
- Overlap scan: <existing skills adjacent, ≥60% coverage? YES / NO>
  - If YES → route to description fix / reference deepening on <skill>
- Loophole: <any phrasing that would skip load? one line>
- Drift check: <description claim N ↔ body section? YES / NO>

**Final verdict**: new skill | reference deepening on <skill> | description fix on <skill> | demote to Rung 4 | discard
```

## Example

**Skill candidate**: `/shallow-diff` — verify file count in shallow-clone CI

**RED**:
- Failure mode (turn 58): agent ran `git diff origin/main...HEAD` in shallow CI and trusted the output (16 files) without comparing to expected (3 files). No tool surfaced shallow-fetch caveat.
- Reproducible from evidence alone? YES — raw transcript has the command + output.
- Would a fresh agent have failed the same way? YES — standard Claude knowledge does not include shallow-diff merge-base behavior.
- Verdict: RED pass.

**GREEN**:
- Description: "Verify output value correctness in shallow-clone CI diffs — use `refs/pull/N/merge` and cross-check expected file count."
- Body sections:
  - When to use (CI + shallow fetch present)
  - Exact diff command for shallow context
  - Expected-vs-actual comparison template

**REFACTOR**:
- Overlap scan: `auto-pr` and `iterate-pr` exist but do not cover shallow-diff caveat — no ≥60% overlap.
- Loophole: "check the diff" phrasing would not trigger — add "shallow clone", "CI diff", "file count wrong".
- Drift: description claims shallow-diff + count cross-check; both have body sections. OK.

**Final verdict**: new skill — but small. Alternative: **reference deepening** on `auto-pr` adding a "shallow-clone verification" section. Choose reference deepening if `auto-pr` already fires in these scenarios (check `auto-pr/SKILL.md` description). This keeps skill count down and reuses existing trigger surface.

## Relationship to skill-improver

`skill-improver` runs an empirical iteration loop with frozen scenarios after the skill ships. The Skill-TDD Gate runs **before** the skill ships, using past-session evidence as the RED scenario. The two are complementary:

- Skill-TDD Gate: cheap, static, catches obviously-unreproducible proposals.
- skill-improver: expensive, runtime, catches description/body drift, discretionary gaps, and ambiguity under real subagent pressure.

A skill that passes Skill-TDD Gate and then fails skill-improver convergence was usually right in intent but imprecise in wording. A skill that fails Skill-TDD Gate at RED should never reach skill-improver — save the empirical iteration cost.
