---
name: simplify-review
description: "Reviews plans and code for over-engineering, then proposes simplifications. Spawns a fresh subagent (plan-simplifier or code-simplifier) with no prior context to objectively detect unnecessary complexity — abstractions without callers, speculative features, excessive error handling, premature optimization. Use when asked to 'simplify', 'シンプルにして', 'simplify review', '過剰設計をレビュー', '簡素化', 'YAGNI check', or when /plan Phase 4 converges and the plan contains 5+ implementation steps. Also use proactively before ExitPlanMode for non-trivial plans, or at task completion when the diff is large (20+ changed files or 500+ lines)."
argument-hint: "[plan|code|auto]"
---

# Simplify Review

Detects over-engineering in plans and code by spawning a fresh subagent (`plan-simplifier` / `code-simplifier`) that reviews from a clean perspective. The reviewer has no knowledge of the design journey — only the artifact and its context — so it naturally spots complexity that feels justified to the author but isn't justified by the requirements.

This skill is a thin orchestrator: it collects context (user request, plan text, git diff), dispatches the appropriate simplifier agent via the Agent tool, then triages the returned proposals. Most invocations happen via `/plan` Phase 4 Step 6 or `/impl` diff-threshold trigger — those skills spawn the simplifier agents directly, not through this skill.

## Why This Matters

Iterative plan deepening improves quality, but each round can also **add** complexity: extra error handling "just in case", abstractions for hypothetical future use, defensive patterns against scenarios that can't happen. Humans catch this through experience ("this feels over-built"). This skill codifies that instinct.

## Quick Start

```
/simplify-review          # Auto-detect: plan mode → plan review, else → code review
/simplify-review plan     # Force plan review
/simplify-review code     # Force code review
```

## When to Use

| Context | Trigger |
|---|---|
| After `/plan` Phase 4 converges | Proactive — run before ExitPlanMode |
| User says "simplify", "YAGNI check", etc. | Manual |
| Task completion with large diff | Proactive — before verification |
| User review feedback says "too complex" | Reactive |

## Workflow

### Step 1: Determine Review Mode

Parse `$ARGUMENTS`:
- `plan` → Plan Simplification (Step 2a)
- `code` → Code Simplification (Step 2b)
- `auto` or empty → Detect context:
  - In plan mode → Plan Simplification
  - Has uncommitted changes or recent task completion → Code Simplification
  - Both applicable → Run Plan first, then Code

### Step 2a: Plan Simplification

#### Context Collection

1. Read the current plan file
2. Read CLAUDE.md for project conventions (design principles, coding conventions)
3. Extract the original user request (from conversation or plan's Context section)

#### Dispatch `plan-simplifier` subagent

Invoke the Agent tool with `subagent_type: "plan-simplifier"`. Pass the three context blocks inlined in the prompt:

```
Agent({
  subagent_type: "plan-simplifier",
  description: "Simplify review for plan",
  prompt: `## Original User Request

<the user's original request text>

## Plan to Review

<full plan file contents>

## Project Design Principles

<CLAUDE.md summary covering YAGNI / KISS / DRY and relevant conventions>`
})
```

The agent returns:
- Simplification proposals (each with rationale, before/after, risk assessment)
- Verdict: `SIMPLIFY` (has proposals) or `MINIMAL` (already lean)

### Step 2b: Code Simplification

#### Context Collection

1. Get changed files: `git diff --name-only` (uncommitted) or `git diff <baseline_sha>..HEAD --name-only`
2. Get diff: `git diff` or `git diff <baseline_sha>..HEAD`
3. Identify the path to the project's CLAUDE.md

#### Dispatch `code-simplifier` subagent

Invoke the Agent tool with `subagent_type: "code-simplifier"`. Pass:

```
Agent({
  subagent_type: "code-simplifier",
  description: "Simplify review for code diff",
  prompt: `## Changed Files

<list of changed file paths>

## Changes (git diff)

<unified diff output>

## Project Guidelines

Read the project guidelines at: <absolute path to CLAUDE.md>

Pay special attention to design principles (YAGNI, KISS, DRY) and coding conventions.`
})
```

The agent returns:
- Simplification proposals categorized by type and confidence
- Verdict: `SIMPLIFY` or `MINIMAL`

### Step 3: Triage Proposals

Process each proposal returned by the subagent:

#### Confidence-Based Triage

| Confidence | Criteria | Action |
|---|---|---|
| **HIGH** | Objective, mechanical improvement (dead code removal, redundant null check, unused import) | Main session may auto-apply |
| **MEDIUM** | Clear improvement but involves judgment (simpler algorithm, flatten abstraction) | Present to user for approval |
| **LOW** | Trade-off involved (fewer abstractions vs. extensibility, less error handling vs. robustness) | Present to user, recommend but don't push |

#### Auto-Apply Rules

The main session auto-applies HIGH-confidence proposals **only when all of these hold**:
- The change is purely subtractive (removes code/steps) or a direct substitution
- No behavioral change — functionality is preserved
- No scope reduction — the set of supported actions/endpoints/contexts is unchanged
- No removal of correctness mechanisms — items the plan explicitly identifies as needed for correctness (guards, synchronization, validation) require code-level verification before removal and cannot be auto-applied
- The proposal aligns with CLAUDE.md design principles (YAGNI, KISS, DRY)
- The change does not affect public APIs or user-facing interfaces

When auto-applying, log what was applied and why. The user sees the summary in Step 4.

### Step 4: Present Results

#### Format

```markdown
## Simplify Review Results

### Auto-Applied (HIGH confidence)
- [x] Removed unused `ErrorBoundary` wrapper in `src/components/Form.tsx` — no error sources in children
- [x] Eliminated redundant type guard — TypeScript narrows this automatically

### Proposed (needs approval)
#### [MEDIUM] Flatten `ConfigManager` abstraction
**Before**: 3-class hierarchy (ConfigManager → ConfigLoader → ConfigValidator)
**After**: Single `loadConfig()` function with inline validation
**Rationale**: Only one config format exists; the abstraction adds indirection without benefit
**Risk**: Low — if a second format is added later, extract at that point

#### [LOW] Remove retry logic in `fetchUserData`
**Before**: Exponential backoff with 3 retries
**After**: Single attempt with error propagation
**Rationale**: Called only from server-side with reliable network; retries mask real failures
**Risk**: Medium — if network reliability assumptions change, retry needs re-adding

### No Change Needed
[Items the reviewer examined but found appropriate]

**Verdict**: SIMPLIFY (2 auto-applied, 2 proposed)
```

### Step 5: Apply Approved Changes

After user approval (or for auto-applied items):
1. Apply the changes
2. Run relevant tests/checks to confirm no behavioral regression
3. If a change breaks something, revert it and report

## Integration Points

### With plan

`/plan` Phase 4 Step 6 spawns `plan-simplifier` **directly via the Agent tool** (not through this skill) in parallel with the adversarial Explore subagent. This skill's manual `/simplify-review plan` path produces the same effect for ad-hoc review.

### With impl

`/impl` Step 4.5 (diff ≥ 20 files or ≥ 500 lines) spawns `code-simplifier` **directly via the Agent tool** (not through this skill). This skill's manual `/simplify-review code` path covers on-demand review outside the automated threshold.

### With subagent-review

Simplify-review is complementary, not a replacement. `subagent-review` checks spec compliance and code quality; `simplify-review` specifically targets unnecessary complexity.

Run order when both apply:
```
Implementation → simplify-review (code-simplifier) → /subagent-review → next task
```

### With task completion

For the final verification gate, simplify-review can run as part of the pre-completion checklist when the diff exceeds thresholds (20+ files or 500+ lines changed).

## Simplification Heuristics

The subagent evaluates against these patterns. They're encoded in the agent system prompts but documented here for reference.

### Plan-Level Over-Engineering Signals

1. **Speculative generalization**: Abstractions designed for use cases that don't exist yet
2. **Premature error taxonomy**: Complex error hierarchies when a simple error message suffices
3. **Configuration surface area**: Making things configurable that have exactly one valid value
4. **Indirection without benefit**: Wrapper layers that add no logic, just pass-through
5. **Defensive design against impossible states**: Handling states the system can never reach
6. **Feature flags for initial implementation**: Adding toggles before the feature is even validated

### Code-Level Over-Engineering Signals

1. **Dead abstractions**: Interfaces with one implementation, base classes with one subclass
2. **Redundant validation**: Re-checking invariants guaranteed by the type system or caller
3. **Over-parameterization**: Functions with configuration objects when a simple call suffices
4. **Speculative caching**: Cache layers without measured performance problems
5. **Unnecessary indirection**: Factory/builder/strategy patterns for straightforward construction
6. **Defensive copying**: Deep cloning when ownership is clear

## Design Decisions

**Why a fresh subagent (not inline review):**
The main session has followed the entire design journey. It knows *why* each decision was made, which makes it blind to unnecessary complexity — every piece feels justified in context. A fresh subagent sees only the artifact and naturally asks "is this needed?" without the sunk-cost bias.

**Why dedicated `plan-simplifier` / `code-simplifier` subagents (not a generic `Plan` or `code-reviewer` agent):**
Earlier versions of this skill dispatched a generic subagent with a placeholder-filled prompt template loaded from `references/`. That two-step indirection was unreliable when invoked in parallel with other Agent calls — the Skill tool merely loads skill content into context without spawning the subagent, so "parallel simplify-review" effectively degraded to serial or skipped. First-class agent definitions (`plan-simplifier.md` / `code-simplifier.md`) spawn directly via the Agent tool, guaranteeing true parallel execution from `/plan`.

**Why two separate agents (plan vs code):**
Input shape (plan text vs git diff) and evaluation focus (structure vs implementation) differ enough that merging them into one agent with a mode switch would bloat the system prompt without benefit. The split mirrors the `code-reviewer` / `refactoring-specialist` convention.

**Why opus for both agents:**
Detection quality matters more than latency. Over-engineering signals are subtle and easy to miss at smaller model sizes.

**Why confidence-based triage instead of binary PASS/FAIL:**
Simplification is inherently subjective. Some proposals are obvious wins (dead code), others are judgment calls (fewer abstractions). The confidence system lets the main session auto-apply safe changes while escalating trade-offs to the user.

**Why auto-apply HIGH confidence:**
Requiring user approval for every dead code removal or unused import creates noise. The guardrails (subtractive only, no behavioral change, CLAUDE.md aligned) ensure auto-applied changes are safe. Logging provides transparency.
