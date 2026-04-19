---
name: session-retrospective
description: Review the current session to extract learnings, verify prior proposals' outcomes, and propose behavior-change pairs with auto-verifiable outcomes. Closes the feedback loop between past proposals and next-session behavior. Routes proposals to hook / permissions / skill / CLAUDE.md via Mechanism-Signature + Enforcement Ladder. Triggers include "retrospective", "session retro", "振り返って", "何を学んだ？", "セッションの学び", "what did we learn?", "improve from this session".
---

# Session Retrospective

Review the current session to extract learnings and propose improvements with verifiable outcomes. Writes proposals into a durable ledger (`~/.claude/retrospective-ledger.jsonl`) that the NEXT session's Phase 1 reads back to auto-check whether past proposals actually changed behavior.

## Architecture summary

Earlier versions of this skill emitted proposals into a one-way pipe (CLAUDE.md line → shipped → never measured). v3 closes the loop:

```
ledger ← (Phase 1 verifies prior proposals: prevented/recurred/noise) ←─┐
  ↓                                                                      │
Phase 1 → Phase 2 Extract & Drill → Phase 3 Pair Design → Phase 4 Present & Track
           (3 archetypes)           (Behavior-Change Pair)                  ↓
                                                                       ledger appended
                                                                         (next session: loop)
```

**Unit of work** is a **Behavior-Change Pair**, not a "proposal document". Each Pair has: observable Before, observable Target After, chosen Enforcement layer, machine-runnable Verification plan, Expiry condition. See [references/behavior-change-pair.md](references/behavior-change-pair.md).

**Source of truth** is the ledger. The `retrospective-ledger.ts` CLI (at `~/.claude/skills/instinct-learner/scripts/retrospective-ledger.ts`) is the only way to mutate it.

## Quick Start

```
/session-retrospective
```

No arguments. The skill reads the current session transcript automatically.

## Workflow

### Phase 1: Outcome Verification

Read the ledger and auto-verify prior proposals against the current session's observable state. Updates outcomes and confidence scores.

**Step 1 — Extract transcript** (same as prior version):

```bash
cd $(git rev-parse --show-toplevel)
~/.claude/skills/session-retrospective/extract-session-history.ts
```

Captures the stdout path (something like `/tmp/claude-session-history-NNNN.md`).

**Step 2 — Run verify**:

```bash
~/.claude/skills/instinct-learner/scripts/retrospective-ledger.ts verify \
  --transcript /tmp/claude-session-history-NNNN.md \
  --session "$(cat /tmp/claude-session-id 2>/dev/null || echo unknown)"
```

This iterates every active entry that has a proposal and applies the verification plan. See [references/outcome-verification.md](references/outcome-verification.md) for grammar and delta rules.

**Step 3 — Surface recurrences**: the CLI output lists each entry's result. Entries returning `recurred` are **escalation signals for Phase 2**:

- The proposal did NOT work. The current enforcement layer is too weak.
- Feed into Phase 3 Pair Design as a "revise existing Pair" candidate — typically by escalating one Rung down (stronger enforcement) per the boundary rules in `routing-logic.md`.

**Step 4 — Summarize**: note counts of prevented / recurred / not-applicable + 5-session noise-prune candidates (confidence delta < 0 via streak).

### Phase 2: Extract & Drill

Build an evidence list from the transcript. For each potential learning, record:

- **What happened**: 1-sentence summary
- **Evidence**: direct quote or turn number + file:line anchor
- **Archetype** (from [references/learning-categories.md](references/learning-categories.md)): Behavioral correction | Workflow candidate | Discovered fact
- **5-whys chain** (from [references/five-whys-drill.md](references/five-whys-drill.md)): `Symptom → Why1 → Why2 → ... → Root Cause` until stop condition (systemic / process / environment). Skip for Preference-like learnings.
- **Scope-Agnostic verdict** (from [references/scope-agnostic-gate.md](references/scope-agnostic-gate.md)): keep-principle / keep-instance / discard. Two counter-examples required.

While scanning the transcript, apply these lenses:

- Tasks and their outcomes
- Errors and their resolutions
- Questions the user asked claude (signals missing context)
- User corrections to claude's approach
- Repeated patterns (intra-session)
- Tool-usage patterns
- Compact boundaries (phase transitions)

**Cross-session recurrence signal** (from Phase 1): if a recurred entry's topic appears in this session's evidence, note `RECURRENCE` on the learning so Phase 3 Pair Design revises the existing Pair rather than creating a new one.

### Phase 3: Pair Design

For each learning that survived Phase 2, construct a **Behavior-Change Pair** per [references/behavior-change-pair.md](references/behavior-change-pair.md):

1. **Before** / **Target After** in observable terms
2. **Enforcement layer** via `Mechanism-Signature` 4-question pre-routing ([references/mechanism-signature.md](references/mechanism-signature.md)) + Enforcement Ladder ([references/routing-logic.md](references/routing-logic.md))
3. **Verification plan** in the JSON grammar from [references/outcome-verification.md](references/outcome-verification.md)
4. **Expiry condition** (trigger to remove) or `none`

**Gates that MUST run** per Pair:

- If Enforcement = skill: pass [references/skill-tdd-gate.md](references/skill-tdd-gate.md) RED test. No reproducible RED → demote to claude_md (if the strengthened Rung 4 bar passes) or Rejection Log.
- If Enforcement = claude_md: pass the strengthened Rung 4 acceptance bar in `routing-logic.md` — (a) past-session concrete evidence AND ((b) expiry OR (c) redundancy check).
- Scope-Agnostic verdict from Phase 2 must be keep-principle or keep-instance. discard → Rejection Log.

**RECURRENCE handling**: if a learning is flagged as RECURRENCE from Phase 1, the Pair targets the SAME rule but at a stronger enforcement Rung (Rung N → Rung N-1). Per routing-logic.md boundary handling.

### Phase 4: Present & Track

Present all Pairs grouped by target, plus the Rejection Log and the prior-proposal status transition report.

```
## Session Retrospective Results

### Prior-proposal status transitions (from Phase 1)
| Entry | Before | After | Δconfidence |
|---|---|---|---|
| inst-XXXX | 0.55 | 0.60 | +0.05 prevented |
| inst-YYYY | 0.70 | 0.50 | -0.20 recurred → escalation proposal below |

### New Behavior-Change Pairs

#### Hook / bash-policy (Rung 1A) — N Pairs
[numbered Pairs with diff]

#### Hook script (Rung 1B) — N Pairs
[numbered Pairs]

#### Permissions (Rung 2) — N Pairs
[numbered Pairs]

#### Skill creation / description fix / reference deepening (Rung 3) — N Pairs
[numbered Pairs]

#### CLAUDE.md addition (Rung 4) — N Pairs
[numbered Pairs with required Rung 4 bar fields]

### Rejected Proposals (N items)
- <label> — rejected: <reason: Scope-Agnostic Gate discard | Skill-TDD Gate no reproducible RED | Rung 4 missing past-session evidence | Rung 4 redundant with existing line X | etc.>

---
Which proposals would you like to apply?
(all / specific numbers like 1,3,5 / none)
```

**After user approval**:

1. Apply the concrete changes (edit files, create skills, add hook rules, etc.) via Edit / Write tools.
2. For EACH accepted Pair, call `retrospective-ledger.ts` to record the Pair in the ledger:
   - `retrospective-ledger.ts add --rule "<Target After in one sentence>" --domain "<archetype>" --session "<current session id>"`
   - If the add matched an existing entry (similarity match), the entry is reinforced; otherwise a new entry is created.
   - Then `retrospective-ledger.ts record-proposal <id> --layer <hook|permissions|skill|claude_md> --target <path> --plan '<verification_plan JSON>' --expiry "<expiry sentence or empty>" --session "<session id>"`
3. For RECURRENCE-derived Pairs (escalation), record-proposal attaches a NEW proposal to the SAME existing entry (id from Phase 1's recurrence list).
4. Emit a final summary: X Pairs shipped, Y rejected, Z recurred+escalated.

## What NOT to propose

- Information claude already knows (standard library usage, well-known commands)
- One-off session-local preferences ("concise for this one response")
- Facts already covered by an existing active ledger entry at confidence ≥ 0.5 (redundancy)
- Learnings whose Verification plan cannot be written — unverifiable proposals do not enter the ledger

## Related gates / skills

- [references/five-whys-drill.md](references/five-whys-drill.md) — 5-whys iterative drill (Phase 2)
- [references/scope-agnostic-gate.md](references/scope-agnostic-gate.md) — substitution test + counter-examples (Phase 2)
- [references/mechanism-signature.md](references/mechanism-signature.md) — 4-question pre-routing (Phase 3)
- [references/skill-tdd-gate.md](references/skill-tdd-gate.md) — RED/GREEN/REFACTOR (Phase 3, skill candidates)
- [references/routing-logic.md](references/routing-logic.md) — Enforcement Ladder + Rung 4 strengthened bar (Phase 3)
- [references/behavior-change-pair.md](references/behavior-change-pair.md) — Pair template + archetype → enforcement bias (Phase 3)
- [references/outcome-verification.md](references/outcome-verification.md) — Verification plan grammar + confidence delta (Phase 1)
- [references/learning-categories.md](references/learning-categories.md) — 3 archetypes (Phase 2)
- [references/skill-opportunity-detection.md](references/skill-opportunity-detection.md) — Signals 1-6 for skill candidates (Phase 2)
- `/cross-session-analysis` — 100+ session analysis via Gemini (separate scope; ledger remains local to this skill)

## Design decisions

**Why 4 phases instead of 5**: the prior Phase 2.5 (Skill Opportunity Scan) and Phase 2.6 (Instinct Extraction) were orthogonal cuts through the same evidence. Merged into Phase 2 (Extract & Drill) since the 3-archetype classification delivers both outcomes with one pass.

**Why the ledger is the source of truth**: prior design had proposals → CLAUDE.md lines → never measured. Ledger makes proposals first-class objects with verification plans, outcomes history, and confidence. instinct-learner was folded in because it was the same ledger concept at a lower abstraction.

**Why verification_plan is mandatory**: a proposal that cannot be auto-verified cannot close the feedback loop. It ships but the skill cannot tell whether it worked. Unmeasurable proposals were the single largest source of CLAUDE.md bloat.

**Why confidence is outcome-driven**: the prior reinforce-on-reoccurrence signal (+0.1 per duplicate) counted rediscovery of the same rule, not evidence that the rule changed behavior. Outcome-driven confidence (prevented +0.05, recurred -0.2) measures what we actually care about.
