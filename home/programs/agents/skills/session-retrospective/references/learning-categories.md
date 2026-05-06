# Learning Archetypes

3 archetypes used by Phase 2 Extract & Drill to classify each learning. Each archetype biases toward a particular Enforcement layer when Phase 3 Pair Design routes the proposal.

The prior 5-category taxonomy (Missing Context / Corrected Approaches / Repeated Workflows / Tool Knowledge / Preference Patterns) was retired because categorization was not directly actionable — two of the five were near-duplicates (Missing Context ≈ Tool Knowledge, Corrected Approaches ≈ Preference Patterns at different intensities) and the routing step had to re-derive the archetype on the fly. The 3 archetypes map directly to enforcement layers.

## The 3 archetypes

### 1. Behavioral correction

**Definition:** user explicitly corrected an action claude took, or claude repeated a misbehavior that the user had already corrected before.

**Identification signals:**
- User said "no, do X instead" / "use Y not Z" / "don't do X"
- Claude did action X, user followed up with "use Y next time"
- Session transcript shows claude doing X at turn N AFTER user correction at turn M<N for the same behavior

**Examples:**
- User corrected `npm install` → `pnpm install` three turns later claude used npm again
- User said "commit messages in Japanese", claude pushed with English message
- User said "use `Edit` tool, not `sed` via Bash", claude ran sed

**Routing bias:** hook or permissions (Rung 1 / 2). Deterministic misbehavior with a named correct form — enforcement at 100% reliability beats 50-80% skill triggering or ~always-ignored written rule.

**Absorbs**: the prior "Corrected Approaches" category in full, plus the **weak** end of "Preference Patterns" (repeated style corrections). Non-repeated single-instance preferences ("I prefer concise explanations for this one question") are NOT Behavioral corrections — they are session-local and do not enter the ledger.

### 2. Workflow candidate

**Definition:** claude executed (or the user described) a multi-step procedure that passes the `/invoke` litmus test — the user would realistically type `/name` to trigger it in future sessions.

**Identification signals:**
- 3+ ordered tool calls that share a goal (e.g., "check CI → read logs → find failure → fix → push")
- User taught a procedure with 3+ sequential steps
- Cross-session repetition signals in the user's language ("I always", "every time", "毎回")
- Signal 6 from `skill-opportunity-detection.md`: external knowledge systematization

**Examples:**
- Repeated 5-step CI-fix loop across 3 distinct failures in one session
- User said "when fixing PR feedback, always: check diff → read comments → apply fixes → push → reply"
- Session consumed a design doc and the user asked to "turn this into a reviewer"

**Routing bias:** skill (Rung 3). Must pass `skill-tdd-gate.md` RED test (reproduce "agent without skill" failure from evidence). Failure → demote to Behavioral correction (if the missing step is single-shot) or Discovered fact (if it is pure documentation).

**Absorbs**: the prior "Repeated Workflows" category in full.

### 3. Discovered fact

**Definition:** session revealed a fact about a tool, environment, library, or convention that claude did not know. Not a behavior misaligned with user preference — a piece of knowledge gap.

**Identification signals:**
- Claude asked the user for info the user clarified (e.g., "which flake output?")
- Claude hit a failure mode it could not diagnose without new info (e.g., shallow-clone diff returns wrong count)
- User pointed out a tool quirk or version-specific behavior

**Examples:**
- `git diff origin/main...HEAD` in shallow clone returns meaningless count
- `deno run -e` does not exist — use `deno eval`
- Chrome DevTools MCP requires `take_snapshot` before element interaction
- This repo uses `.#private` / `.#work` as flake outputs (project-specific fact)

**Routing bias:** claude_md (Rung 4) — **if the strengthened Rung 4 bar passes**. Facts cannot be enforced, only documented. Key check: does mechanism-signature Q1-Q3 pass instead? If yes (e.g., "tool X is broken, block it") the archetype is really a Behavioral correction with enforcement, not a Discovered fact.

**Absorbs**: the prior "Missing Context" and "Tool Knowledge" categories in full.

## Decision tree (Phase 2 classification)

```
For each evidence-list entry:
  Did user correct or redirect claude on a specific action?
    YES → Behavioral correction
    NO ↓

  Is the learning a multi-step procedure (3+ ordered steps, /invoke passes)?
    YES → Workflow candidate
    NO ↓

  Is the learning a fact (tool / environment / convention) claude did not have?
    YES → Discovered fact
    NO ↓

  None of the above → DROP (likely session-local, not worth recording)
```

Ambiguous case — learning fits more than one archetype:

- **Behavioral correction + Workflow candidate**: usually Behavioral correction. A correction that names 3 steps could become a skill, but 100% enforcement via hook or permissions usually delivers the target behavior more reliably than a skill's 50-80% triggering.
- **Behavioral correction + Discovered fact**: pick Behavioral correction if there is a clearly preferred action; pick Discovered fact if the learning is purely factual (no named correct action).
- **Workflow candidate + Discovered fact**: pick Workflow candidate — turning the fact into an invocable procedure is higher-leverage.

When truly unclear, default to **Behavioral correction** — it maps to the strongest enforcement layer (hook/permissions) and cuts through the CLAUDE.md bias.

## Migration map (5 category → 3 archetype)

For backfilling or re-classifying legacy ledger entries:

| Old category | New archetype | Note |
|---|---|---|
| Missing Context | Discovered fact | Pure knowledge gap |
| Tool Knowledge | Discovered fact | Tool-specific fact |
| Corrected Approaches | Behavioral correction | Direct map |
| Preference Patterns (repeated ≥2x) | Behavioral correction | Stable preference = behavioral rule |
| Preference Patterns (one-shot) | DROP | Session-local, not ledger-worthy |
| Repeated Workflows | Workflow candidate | Direct map |

Legacy entries already in the ledger are NOT automatically re-classified — they continue under their old categorization fields until natural reinforcement / decay cycles them. See `retrospective-ledger.jsonl` for the current 40 entries.

## Anti-patterns

- **Over-assigning Workflow candidate**: every 2-step sequence is NOT a workflow. Requires 3+ steps AND /invoke litmus passes AND skill-TDD gate RED is reproducible.
- **Calling a bug a Discovered fact**: bugs are not knowledge gaps. If the learning is "claude did X wrong", it is Behavioral correction, not Discovered fact.
- **Splitting one evidence entry into two archetypes**: pick one. If genuinely both, see the ambiguity rules above.
- **Recording session-local preferences as Behavioral correction**: if the user said "for this one response, be concise", it is NOT a behavioral rule. Drop.
