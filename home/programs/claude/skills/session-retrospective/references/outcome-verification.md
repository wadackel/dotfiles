# Outcome Verification

Grammar and auto-run procedure for Phase 1 Outcome Verification. Consumed by the `retrospective-ledger.ts verify` subcommand.

Each proposal ships with a `verification_plan` that tells a future session how to automatically detect whether the proposal's target behavior actually happened. Without this, there is no feedback loop — every past proposal is equally trusted, and the skill cannot tell a working rule from a dead one.

## Verification plan types (v1)

Three types. **Only `transcript_grep` is fully implemented in v1**; the other two are skeleton-only (recognized in the schema, treated as `not-applicable` at runtime) so proposals can already declare them without schema churn when they land.

### 1. `transcript_grep` (v1 implemented)

Greps the current session transcript for a pattern.

```json
{
  "type": "transcript_grep",
  "pattern": "git -C",
  "expected": "absent"
}
```

- `pattern` — JavaScript regex, applied to the full transcript text via `new RegExp(pattern).test(text)`
- `expected` — `"absent"` (pattern must NOT appear → prevented) or `"present"` (pattern must appear → prevented)
- **When to use**: behavioral corrections that leave a grep-able trace. "Claude should not run `git -C`" or "Claude should invoke `/verification-loop` before claiming done".
- **False-negative risk**: the pattern might be in a quoted example or a comment. Anchor with a prefix like `^> ` (tool-call marker) when possible.
- **False-positive risk**: paraphrased forms. Widen with alternation when multiple forms exist: `git -C |cd [^&]+ && git`.

### 2. `git_log_grep` (v1 skeleton)

Greps `git log` output within a time window.

```json
{
  "type": "git_log_grep",
  "pattern": "Co-Authored-By: .+noreply",
  "expected": "present",
  "since_days": 7
}
```

- **When to use**: proposals that should change commit content (message format, sign-off, trailer). Proposals that take effect ONLY at commit time.
- **v1 runtime**: recorded as `not-applicable`. Ship the plan now; implementation follows.
- **Implementation roadmap**: subprocess `git log --since=<N days ago> --format=%B`, regex match, map expected ↔ found to prevented / recurred.

### 3. `file_exists` (v1 skeleton)

Checks a file's presence / absence.

```json
{
  "type": "file_exists",
  "path": "home/programs/claude/skills/<name>/SKILL.md",
  "expected": true
}
```

- **When to use**: proposals that create or delete a skill / reference / hook. The durable artifact is a file.
- **v1 runtime**: recorded as `not-applicable`. Implementation follows.

## Auto-run procedure (Phase 1)

```
ledger = readLedger("~/.claude/retrospective-ledger.jsonl")
transcript = extract-session-history.ts output path
for entry in ledger where entry.status == "active" and entry.proposals:
    plan = entry.proposals[-1].verification_plan    # latest proposal wins
    result = run(plan, transcript)
    applyOutcome(entry, { session_id, checked_at, result, evidence })
writeLedger(...)
```

`applyOutcome` updates both the `outcomes` array and `confidence` per the delta table below.

## Confidence delta

| Result | Delta | Rationale |
|---|---|---|
| `prevented` | **+0.05** | Weak positive — a single observation is evidence but not proof. Multiple observations accrue. |
| `recurred` | **-0.2** | Strong negative — the proposal did NOT work. Significant signal. |
| `not-applicable` | 0 (but counted) | No observation either way. If 5 consecutive `not-applicable` accumulate, apply **-0.1** once (the rule is silent — might be stale or unobservable by current plan). |

Clamp: confidence stays in `[0, 0.9]`. Prune threshold: entries at `confidence ≤ 0.3` become candidates for `retrospective-ledger.ts prune`.

**Why asymmetric** (+0.05 vs -0.2): a single "prevented" observation could be coincidence (the scenario simply did not arise); a "recurred" observation means the rule failed when it was relevant. Weight evidence of failure higher than evidence of success.

**Why weaker than user-correction signal** (+0.1 in `reinforce`): outcome observations are automatic and abundant. User corrections are rare and intentional. Keep outcome signal weaker so the ledger does not drift from real engineering judgment.

## Subjective / unobservable cases

Some rules cannot be auto-verified:

- "Write clearer commit messages" — subjective
- "Prefer functional composition" — requires AST inspection and style judgment
- "User prefers concise responses" — depends on user perception

For these, the verification_plan should still be recorded (for transparency) but the chosen type is typically `transcript_grep` with a weak proxy pattern. When no reasonable proxy exists, SKIP the proposal — a rule that cannot be verified should not land at Rung 4 and should not be in the ledger. Refer to the Rung 4 strengthened acceptance bar in `routing-logic.md`.

## Example end-to-end

Past session introduced rule "avoid `git -C <path>`", routed to Rung 1A (`bash-policy.yaml`). Proposal recorded in ledger:

```json
{
  "proposed_at": "2026-04-19",
  "session_id": "session-abc",
  "enforcement_layer": "hook",
  "target_file": "home/programs/claude/scripts/bash-policy.yaml",
  "verification_plan": {
    "type": "transcript_grep",
    "pattern": "git -C ",
    "expected": "absent"
  },
  "expiry_condition": null
}
```

Next session's Phase 1:
- Runs `retrospective-ledger.ts verify --transcript /tmp/claude-session-history-xxx.md`
- For this entry: pattern `git -C ` not in transcript → `prevented`
- `applyOutcome` appends to outcomes, bumps confidence from 0.5 to 0.55

After 5 successful sessions: confidence approaches 0.75 → eligible for CLAUDE.md promotion (if not already there).

If one session's transcript HAD `git -C`: confidence drops 0.55 → 0.35. Phase 2 picks up the recurrence as escalation signal and proposes tightening the bash-policy rule (Rung 1 escalation per routing-logic.md boundary handling).

## Anti-patterns

- **Missing verification_plan**: the proposal lands without ever being auto-checked. No feedback loop. Reject at Phase 3 Pair Design.
- **Too-wide pattern**: `"pattern": ".*"` — matches everything. Meaningless.
- **Too-narrow pattern**: anchored to exact-string of a one-off output. Trivially `not-applicable`. Widen or drop.
- **expected value flipped**: double-negative errors. Use lint test: write a single unit case for every new proposal in the ledger.
