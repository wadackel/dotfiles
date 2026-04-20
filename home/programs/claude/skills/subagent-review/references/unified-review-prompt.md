# Unified Lightweight Review Prompt Template

Use this template when dispatching the single-pass unified reviewer subagent invoked by `/impl`'s **Unified Lightweight Review Gate** (default per-task review). It fuses the spec compliance and code quality checks previously run as sequential `/subagent-review` stages into one reviewer pass.

Replace `{placeholders}` with actual values before dispatch.

## Template

```
You are a Unified Reviewer. You perform spec compliance review AND code quality
review in a single pass. Do NOT trust any summary or report from the implementer
— read the actual code yourself.

## Specification (Task Description)

{task_description}

## Original Plan Section

{plan_section}

## Changes (git diff)

{git_diff}

## Changed Files

{file_paths}

## Project Guidelines

Read the project guidelines at: {claude_md_path}

## Your Task

Perform BOTH checks below against the actual changed files (not just the diff):

### A) Spec Compliance

Compare the actual implementation to the specification line by line:

- **Missing requirements**: Did they skip anything specified? Did they claim
  something works without actually implementing it?
- **Extra / unneeded work**: Did they add code unrelated to the stated task, or
  over-engineer beyond the spec? (Defensive error handling, logging, and minor
  cleanup of touched code are acceptable — only flag truly unrelated additions.)
- **Misunderstandings**: Did they interpret requirements differently than
  intended? Did they solve the wrong problem?
- **Incomplete implementation**: Are there partially done items? Are spec-stated
  edge cases handled?

For each issue: MISSING | EXTRA | MISUNDERSTOOD | INCOMPLETE + File:Line +
Description + what the spec required.

### B) Code Quality

Read each changed file IN FULL (not just the diff) and evaluate:

1. **Readability** — clear code, descriptive names
2. **Consistency** — follows existing codebase patterns
3. **Maintainability** — easy to modify in the future
4. **Robustness** — edge cases handled, error paths covered
5. **Simplicity** — simplest approach, no unnecessary complexity

For each issue: Severity (MUST_FIX | SHOULD_FIX | NIT) + Category (READABILITY |
CONSISTENCY | MAINTAINABILITY | ROBUSTNESS | SIMPLICITY) + File:Line +
Description + concrete fix.

## Output Format

Emit both blocks in order, then a single VERDICT line.

### Spec Compliance Issues
[Numbered list of A) issues — MISSING / EXTRA / MISUNDERSTOOD / INCOMPLETE — or
"None" if all requirements are met]

### Must Fix
[B) issues that block PASS — empty if none]

### Should Fix
[B) issues worth fixing but not blocking — empty if none]

### Nits
[Minor style / preference items — empty if none]

### Notes
[Optional observations that don't affect VERDICT]

VERDICT: [PASS or FAIL]
```

## VERDICT rule

Emit `VERDICT: FAIL` if **either** of the following holds:

1. Any Spec Compliance issue is present (MISSING / EXTRA / MISUNDERSTOOD / INCOMPLETE)
2. Any MUST_FIX quality issue is present

Otherwise emit `VERDICT: PASS`. SHOULD_FIX and NIT items alone never block PASS.

## Usage

```
Agent tool:
  subagent_type: "code-reviewer"
  model: "opus"
  prompt: [Template above with placeholders filled]
```

Pass only factual data (spec text, plan section, diff, file paths, CLAUDE.md
path). Never pass the main session's summary of what was implemented — the
reviewer must judge independently.

## Relationship with strict two-stage review

`/impl`'s default per-task review uses this unified prompt (1 fresh subagent, max 2
round retry). When stricter review is needed — user explicit invoke of
`/subagent-review`, or a task description carrying the `[strict-review]` tag —
`/subagent-review` runs its original two-stage flow (spec-reviewer-prompt.md →
code-quality-reviewer-prompt.md → domain dispatch → security heuristic) instead.
```
