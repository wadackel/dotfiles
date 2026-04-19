# 5-Whys Drill

Iterative root-cause drill-down invoked from Phase 2 Extract & Drill (Step: "Why did this happen?" in the per-learning drill). Replaces the single-level "Why did this happen?" with a 3-5 step chain until the chain terminates at a **systemic / process / environment** cause — the level at which a durable fix is possible.

The point is not to ask "Why?" literally five times. It is to keep asking "what earlier condition made this possible?" until the answer stops being an individual action and starts being a property of the system.

## When to run

Run this drill for every non-preference learning — Behavioral correction, Workflow candidate, Discovered fact (knowledge gap), and Discovered fact (tool quirk). SKILL.md Phase 2 Step 1 invokes the drill on all such learnings; this file owns the procedure details.

Skip this drill for session-local one-shot preferences (outside the 3 archetypes in learning-categories.md) — preferences are not failures, they have no causal chain to drill.

Use the 3-tier early-stop rule below when a trivial learning reaches systemic/process/environment at Level 1 or Level 2. That keeps mandatory application cheap for simple cases while preserving depth for real incidents.

## Procedure

### Step 1 — Define the symptom as a specific, observable fact

Write the symptom as **what was observed**, not **what went wrong in the abstract**.

- ✗ "Claude did the wrong thing with git" (too abstract)
- ✓ "At turn 42, Claude ran `git diff` in a shallow clone and returned 16 files when 3 were expected" (specific, observable)

Cite turn number or transcript quote. Without a concrete symptom the chain will drift.

### Step 2 — Ask "Why?" iteratively

For each level, ask: **"What condition made the previous level possible?"** Record the chain:

```
[Symptom] → Why1 → Why2 → Why3 → ... → Root Cause
```

Each Why answer must be:
- **Causally upstream** of the previous level (not a restatement)
- **Observable or verifiable** (not speculation)
- **Not blaming the individual action** — blame the condition that enabled it

### Step 3 — Apply the stop condition

Stop when the chain reaches any of:

- **Systemic**: a property of the harness, skill design, tool contract, or shared infrastructure. Example: "skill description lacks the triggering phrase for this scenario"
- **Process**: a step that is missing or misordered in a documented workflow. Example: "plan Phase 4 Critic has no step that checks for output-value verification"
- **Environment**: a property of the runtime, filesystem, shell, or external service that is not under the user's direct control but is knowable. Example: "shallow clone fetches only HEAD, so 2-dot diffs against the base branch resolve incorrectly"

If the chain reaches one of these, the Root Cause is actionable — you can fix the system, the process, or document the environment constraint.

### Step 4 — Early-stop for trivial learnings (3-tier rule)

Not every learning warrants 5 levels. Stop early when:

- **Level 1**: the symptom is a one-off user preference with no upstream condition (e.g., "user prefers Japanese commit messages"). Route directly to Rung 4.
- **Level 2**: the Why already points at a systemic/process/environment cause (e.g., symptom = "Claude used npm", Why1 = "project uses pnpm and CLAUDE.md does not say so" = Discovered fact (knowledge gap) at the systemic level).
- **Level 3**: the chain has reached systemic/process/environment without needing deeper levels.

Do not force additional levels just to "complete the drill". Redundant levels dilute signal.

### Step 5 — Countermeasure split

From the Root Cause, design **two** countermeasures:

- **Immediate fix** (this session / next session): patches the current instance
- **Prevention** (for future sessions): addresses the systemic/process/environment cause

Only the **Prevention** countermeasure enters Phase 3 Routing as a proposal. The Immediate fix is session-scoped and already applied.

## Output format

Append to the evidence list for each drilled learning:

```
### Learning: <short label>

**Symptom** (turn N): <verbatim quote or specific observation>

**5-Whys chain**:
- Why1: <upstream condition>
- Why2: <further upstream>
- Why3: <further upstream> → STOP (systemic/process/environment)

**Root Cause**: <one-sentence, actionable>
**Category**: systemic | process | environment

**Immediate fix** (applied this session): <what was done>
**Prevention proposal**: <fed into Phase 3 routing>
```

## Example: shallow-clone diff

- **Symptom** (turn 58): `git diff origin/main...HEAD` in a shallow clone returned 16 files; the PR actually changed 3 files
- **Why1**: shallow clone fetches only HEAD, not the merge base
- **Why2**: the skill's verification command assumed full history
- **Why3**: no layer documents the shallow-clone constraint → **STOP (systemic / skill content gap)**
- **Root Cause**: skill verification commands are written assuming full git history, without documenting the shallow-clone alternative (`refs/pull/N/merge`)
- **Category**: systemic
- **Immediate fix**: rerun with `--depth=0` unshallow in this session
- **Prevention proposal**: Reference deepening in the skill that owns diff-verification — add a "shallow-clone" subsection pointing to `refs/pull/N/merge` and value-correctness checks. Routed to Rung 3 (reference deepening), NOT Rung 4 (CLAUDE.md), because it is a multi-paragraph workflow, not a one-liner.

## Anti-patterns

- **Restating instead of drilling**: "Why1: because the command was wrong" is a restatement of the symptom, not a drill. Reject and re-ask.
- **Blaming the action**: "Why1: Claude should have known" — this is a rationalization that skips the system. The correct Why1 is "What condition prevented Claude from knowing?"
- **Drilling past the stop condition**: once systemic/process/environment is reached, going further produces speculation. Stop.
- **Forcing exactly 5 levels**: the name "5-whys" is a heuristic, not a quota. Stop at the earliest systemic/process/environment hit.
