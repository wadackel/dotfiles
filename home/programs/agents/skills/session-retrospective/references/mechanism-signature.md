# Mechanism-Signature Pre-Routing

Early-prune heuristic that narrows candidate Rungs **before** Phase 3 Routing runs the full Enforcement Layer Ladder. Used at the start of Phase 3 to prevent the default bias toward Rung 4 (CLAUDE.md).

The failure mode this heuristic addresses: the existing Phase 2 Root Cause Check asks "which layer could have stopped this earliest?" but in practice the answer defaults to CLAUDE.md because it is the path of least resistance — any rule *can* be expressed as a written sentence. Mechanism-Signature asks four orthogonal questions that point at the **native home** of the rule, regardless of whether it can also be written as English prose.

This is **pre-routing, not re-routing**. The final decision still uses the Enforcement Layer Ladder in `routing-logic.md`. Pre-routing just sets the starting point so the Ladder does not sweep every learning past Rungs 1-3 by reflex.

## The four questions

Answer in order. The **first** YES assigns the candidate Rung and you stop.

### Q1 — Is the rule deterministic and Bash-pattern-matchable?

**Signal**: the misbehavior is a Bash command with a matchable pattern (glob or substring). No Claude judgment needed once the pattern is defined.

**YES examples**:
- "Do not use `git -C <path>`"
- "Prefer `pnpm` over `npm` / `npx`"
- "Block `rm -rf ~` and variants"

**NO examples**:
- "Be careful when writing git commands" (not matchable — "careful" is judgment)
- "Use the right CLI for the context" (ambiguous pattern)

→ **Candidate Rung: 1A** (add to `~/.claude/scripts/bash-policy.yaml`). Phase 3 still evaluates whether an existing rule covers it; if so, prefer tightening the rule over adding a new one.

### Q2 — Is the rule deterministic but NON-Bash (hook)?

**Signal**: the misbehavior is deterministic but triggered by a tool-use event other than Bash (Edit, Write, Skill invocation, UserPromptSubmit content match). Claude judgment is not required — a hook can detect and act.

**YES examples**:
- "Block `Edit` / `Write` against `.env` and `credentials*`" → PreToolUse hook
- "When session stops, write summary to Obsidian" → Stop hook (already implemented as `claude-memo.ts`)
- "When `UserPromptSubmit` contains `/skill-name`, intercept before skill load"

**NO examples**:
- "Before editing, think about whether the change is safe" (requires judgment)
- "Remind Claude to run tests" (no deterministic trigger)

→ **Candidate Rung: 1B** (new or extended hook script under `~/.claude/scripts/`).

### Q3 — Does the rule gate tool access (allow / deny / constrain)?

**Signal**: the rule is structurally about what tools are usable where, not how to use them. `permissions.allow` / `permissions.deny` in `settings.json` is the native home.

**YES examples**:
- "Never `WebFetch` against internal hostnames"
- "Allow `Edit(~/.claude/**)` without confirmation"
- "Deny `Bash(sudo *)` except for a specific whitelist"

**NO examples**:
- "Use WebFetch carefully for authenticated URLs" (judgment, not access gate)
- "Check before running sudo" (judgment, not structural deny)

→ **Candidate Rung: 2** (permissions entry).

### Q4 — Is the rule a multi-step workflow with parameterizable inputs?

**Signal**: the rule describes a procedure with 3+ steps, tool orchestration, and at least one clear parameter (URL, file path, name, target). It passes the `/invoke` litmus test from `skill-opportunity-detection.md`.

**YES examples**:
- "Convert Google Doc → markdown → extract images → report" (gdocs-to-md)
- "Check CI → read logs → identify failure → fix → push → wait" (iterate-pr)
- "Parse user request → explore codebase → draft plan → critique → decompose" (plan)

**NO examples**:
- "Always use `gh` CLI for GitHub URLs" (preference, not workflow)
- "Prefer named exports" (code style, not invocable procedure)

→ **Candidate Rung: 3**. But before landing here, `skill-tdd-gate.md` MUST produce a reproducible RED test (agent fails without the skill). If RED is not reproducible, demote to Rung 4 or discard.

### No YES? → Rung 4

If all four questions are NO, the rule is a principle, fact, or preference with no native enforcement home. Only then does it become a Rung 4 candidate — and it must pass the Rung 4 acceptance bar in `routing-logic.md` (past-session evidence + expiry-or-redundancy).

## Decision table

| Q1 Bash-deterministic | Q2 Non-Bash hook | Q3 Access-gate | Q4 Multi-step workflow | Candidate Rung |
|---|---|---|---|---|
| YES | — | — | — | 1A (bash-policy) |
| NO | YES | — | — | 1B (hook script) |
| NO | NO | YES | — | 2 (permissions) |
| NO | NO | NO | YES | 3 (skill / reference / description fix) |
| NO | NO | NO | NO | 4 (CLAUDE.md) — must pass strengthened bar |

Each row's Rung is a **starting point**, not a verdict. Phase 3 then runs the full Enforcement Layer Ladder to confirm, and the Ladder may downgrade further (e.g., Rung 3 → Rung 4 if Skill-TDD Gate rejects).

## Worked example

**Learning**: "User corrected `git -C /path diff` to `cd /path && git diff` to avoid permission prompts."

- Q1 (Bash-deterministic): YES — the pattern `git -C *` is matchable. **Candidate Rung: 1A.**

Phase 3 then checks: is there already a `git -C *` rule in `bash-policy.yaml`? If yes, done (already covered). If not, add one. Either way, DO NOT add a CLAUDE.md line — Rung 4 is skipped because Rung 1A applies.

**Before this heuristic**: this learning historically landed on Rung 4 as "Avoid `git -C` — use `cd && git` instead" in CLAUDE.md. That CLAUDE.md line depends on Claude remembering to apply it on every Bash call — ~50-80% reliability. The Rung 1A bash-policy entry is 100%.

## Anti-patterns

- **Multi-YES answers**: if two questions are YES, take the earliest (smallest Rung number). The `git -C` example is both Q1 (Bash-matchable) and Q4 (part of a "check before git command" workflow). Rung 1A wins because it is deterministic and cheapest.
- **Forcing YES to avoid Rung 4**: if the honest answer to all four is NO, do not invent a workflow or a deterministic pattern just to dodge Rung 4. The strengthened Rung 4 bar exists precisely for honest Rung 4 candidates.
- **Skipping the follow-up Ladder**: the 4-question pre-routing only narrows the starting point. The full Ladder in `routing-logic.md` still runs and may override (e.g., Rung 3 → Rung 4 if Skill-TDD Gate rejects).

## Relationship to existing artifacts

- `routing-logic.md` — Enforcement Layer Ladder remains the authoritative decision tree. Mechanism-Signature is a preamble, not a replacement.
- `skill-tdd-gate.md` — Rung 3 candidates must additionally pass the TDD Gate.
- `skill-opportunity-detection.md` — Q4's workflow test reuses the `/invoke` litmus and Conditions A-E.
