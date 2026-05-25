# Behavior-Change Pair

The unit of work in Phase 3 Pair Design. Replaces the prior "proposal" unit which was a document (text to add to CLAUDE.md / skill body). A Pair is **a targeted change in observable agent behavior paired with a mechanism that enforces it and a plan that verifies it**.

The shift matters because the prior unit could ship a CLAUDE.md line that nobody read and nobody could measure. A Pair cannot ship without specifying **how a future session will tell whether the change happened**.

## Required fields

Every Pair has exactly 5 fields. All are mandatory — missing any one disqualifies the learning from Rung 3 or Rung 4 routing (route to Rejection Log instead).

```markdown
### Pair: <short label>

- **Before** (observable): <what the agent did in this session, cite turn N + quote>
- **Target After** (observable): <what the agent should do next time, one sentence>
- **Enforcement layer**: hook | permissions | skill | claude_md
- **Verification plan**: <JSON matching outcome-verification.md grammar>
- **Expiry condition**: <one sentence trigger to remove, or "none">
```

### Field notes

**Before / Target After** must both be **observable** — not internal states, not intentions. Rewrite abstract claims ("be more careful") into observable traces ("does not run `sudo *` without approval prompt").

**Enforcement layer** is the result of running `mechanism-signature.md`'s 4-question pre-routing + the full Enforcement Ladder. It is not free-choice.

**Verification plan** is the JSON literal that ships into `ledger.proposals[].verification_plan`. See `outcome-verification.md` for the grammar. A Pair with no verifiable plan is a dead proposal — reject.

**Expiry condition** explains when the Pair becomes obsolete: "remove when skill X adds trigger phrase Y", "remove when library Z reaches version 2.0", or `none` if the rule is expected to be permanent. Forces the author to think about lifecycle at ship time, not at accidental discovery during cleanup later.

## Archetype → Enforcement mapping (typical bias)

3 archetypes from `learning-categories.md` bias toward different enforcement layers. This is NOT hard routing — the final choice still runs mechanism-signature + TDD gate — but these are useful defaults.

| Archetype | Typical enforcement | Why |
|---|---|---|
| Behavioral correction (user said "do Y instead") | hook or permissions (Rung 1 / 2) | Deterministic misbehavior, user already judged it wrong. 100% enforcement beats 50-80% skill triggering. |
| Workflow candidate (multi-step observed) | skill (Rung 3) | /invoke litmus passes. Procedure > rule. |
| Discovered fact (tool quirk / environment) | claude_md (Rung 4) — if unavoidable | Fact cannot be enforced, only documented. Strengthened Rung 4 bar still applies. |

## Worked examples

### Example 1 — Behavioral correction → hook

Session evidence: turn 34 user said "use pnpm not npm", turn 52 claude again typed `npm install`.

```markdown
### Pair: pnpm-over-npm

- **Before** (observable): at turn 52 claude ran `npm install` despite correction at turn 34
- **Target After** (observable): claude's Bash invocations containing `npm install / npm run / npx` are blocked by bash-policy; claude receives stderr feedback and uses pnpm
- **Enforcement layer**: hook
- **Verification plan**:
  ```json
  { "type": "transcript_grep", "pattern": "\\bnpm (install|run|ci)\\b", "expected": "absent" }
  ```
- **Expiry condition**: none (project permanently uses pnpm)
```

Why hook not claude_md: Q1 of mechanism-signature passes (deterministic + Bash pattern matchable). bash-policy.yaml rule enforces at 100% reliability.

### Example 2 — Workflow candidate → skill

Session evidence: claude executed "check CI → read failure logs → identify root cause → fix → push → wait" sequence three times (turns 18-25, 31-40, 55-64).

```markdown
### Pair: iterate-pr

- **Before** (observable): three-time repetition at turns 18-25 / 31-40 / 55-64 of the same 5-step CI-fix loop
- **Target After** (observable): user types `/iterate-pr` and claude runs the loop end-to-end without per-step instruction
- **Enforcement layer**: skill
- **Verification plan**:
  ```json
  { "type": "file_exists", "path": "home/programs/claude/skills/iterate-pr/SKILL.md", "expected": true }
  ```
- **Expiry condition**: remove if user deletes the skill OR if invocation frequency drops to zero for 30 days
```

Why skill not claude_md: Q4 of mechanism-signature passes (3+ steps, tool orchestration, parameterizable). Skill-TDD Gate: RED reproducible (without /iterate-pr, claude waited for per-step prompts); GREEN minimum (skill body = the 5 steps); REFACTOR: no existing skill covers CI-fix specifically.

### Example 3 — Discovered fact → claude_md (with strengthened Rung 4 bar)

Session evidence: at turn 47 claude's `git diff origin/main...HEAD` in shallow-clone CI returned 16 files when only 3 changed.

```markdown
### Pair: shallow-clone-diff-verification

- **Before** (observable): at turn 47 claude trusted 16-file diff output without comparing to expected 3-file count
- **Target After** (observable): in shallow-clone contexts, claude compares diff output against expected count and escalates on mismatch
- **Enforcement layer**: claude_md
- **Verification plan**:
  ```json
  { "type": "transcript_grep", "pattern": "shallow.*clone|fetch-depth|refs/pull/", "expected": "present" }
  ```
- **Expiry condition**: remove when `/iterate-pr` skill adds explicit shallow-clone guidance
```

Rung 4 strengthened bar check:
- (a) Past-session evidence: turn 47 of session-abc. ✓
- (b) Expiry OR redundancy: expiry specified (remove when `/iterate-pr` absorbs the guidance). ✓

Why not Rung 3: output-value verification is a principle, not a workflow. A skill for it would never fire — the scenario is sparse and cross-cutting.

## Anti-patterns

- **Non-observable Before**: "I was not careful enough" — rewrite as transcript evidence.
- **Aspirational Target After**: "claude should understand X" — rewrite as behavior trace.
- **Enforcement chosen without mechanism-signature**: pick hook because "hooks are strong". Run the 4 questions first.
- **Verification plan = `not-applicable`**: means the Pair is unverifiable. Discard.
- **Expiry = `none` without justification**: most rules have a lifecycle. Default to writing a trigger; `none` only when the rule encodes a permanent project constraint.
- **Pair wider than one learning**: if the Before cites 3 different behaviors, split into 3 Pairs. Each Pair = one enforcement mechanism = one verification plan.

## Relationship to other gates

- `mechanism-signature.md` → picks the Enforcement layer field
- `skill-tdd-gate.md` → must pass when Enforcement = skill
- `scope-agnostic-gate.md` → the Target After is the "principle" form; the Before is the specific instance
- `routing-logic.md` Rung 4 bar → applies when Enforcement = claude_md
- `outcome-verification.md` → defines the Verification plan JSON grammar
