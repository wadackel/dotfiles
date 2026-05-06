---
name: simplify-review
description: "Reviews plans and code for over-engineering, then proposes simplifications. Spawns a fresh subagent (plan-simplifier or code-simplifier) with no prior context to objectively detect unnecessary complexity — abstractions without callers, speculative features, excessive error handling, premature optimization. Use when asked to 'simplify', 'シンプルにして', 'simplify review', '過剰設計をレビュー', '簡素化', 'YAGNI check', or when /plan Phase 4 converges and the plan contains 5+ implementation steps. Also use proactively before finalizing non-trivial plans, or at task completion when the diff is large (20+ changed files or 500+ lines)."
argument-hint: "[plan|code|auto]"
---

# Simplify Review

Detects over-engineering in plans and code by spawning a fresh subagent (`plan-simplifier` / `code-simplifier`) that reviews from a clean perspective. The reviewer has no knowledge of the design journey — only the artifact and its context — so it naturally spots complexity that feels justified to the author but isn't justified by the requirements.

This skill is a **manual entry point** for ad-hoc review. The default automated paths bypass it: `/plan` Phase 4 Step 6 dispatches `plan-simplifier` directly via the Agent tool, and `/impl` Step 4.5 (diff ≥ 20 files or ≥ 500 lines) dispatches `code-simplifier` directly via the Agent tool. Those skills are the canonical source of truth for the dispatch prompts; this skill orchestrates only the manual `/simplify-review` invocation.

## Why This Matters

Iterative plan deepening improves quality, but each round can also **add** complexity: extra error handling "just in case", abstractions for hypothetical future use, defensive patterns against scenarios that can't happen. Humans catch this through experience ("this feels over-built"). This skill codifies that instinct.

## Quick Start

```
/simplify-review          # Auto-detect: plan mode → plan review, else → code review
/simplify-review plan     # Force plan review of the current plan file
/simplify-review code     # Force code review of the current diff
```

## When to Use

| Context | Trigger |
|---|---|
| User says "simplify", "YAGNI check", "過剰設計をレビュー" | Manual |
| Re-running simplify on an already-iterated plan / diff | Manual |
| Plan or diff that the automated paths missed | Manual |
| User review feedback says "too complex" | Reactive |

For the automated paths (`/plan` Phase 4 Step 6 and `/impl` Step 4.5 threshold), the simplifier subagent is dispatched directly by those skills — no need to invoke `/simplify-review`.

## Manual Workflow

On `/simplify-review` invocation, parse `$ARGUMENTS`:

- `plan` → dispatch `plan-simplifier` with the current plan file, the original user request, and a CLAUDE.md design-principles summary. (See `/plan` Phase 4 Step 6 for the canonical prompt shape.)
- `code` → dispatch `code-simplifier` with `git diff` (or `git diff <baseline_sha>..HEAD`) plus the project CLAUDE.md path. (See `/impl` Step 4.5 for the canonical prompt shape.)
- `auto` or empty — detect: plan mode active → `plan`; otherwise uncommitted changes or a recent task completion → `code`; both applicable → run `plan` first, then `code`.

Both subagents return categorized proposals (per-proposal: confidence, rationale, before / after, risk) plus a verdict of `SIMPLIFY` or `MINIMAL`. Triage them with the protocol below, apply approved changes, and present a results summary.

## Triage Protocol

### Confidence-Based Triage

| Confidence | Criteria | Action |
|---|---|---|
| **HIGH** | Objective, mechanical improvement (dead code removal, redundant null check, unused import) | Main session may auto-apply (see Auto-Apply Rules) |
| **MEDIUM** | Clear improvement but involves judgment (simpler algorithm, flatten abstraction) | Present to user for approval |
| **LOW** | Trade-off involved (fewer abstractions vs. extensibility, less error handling vs. robustness) | Present to user, recommend but don't push |

### Auto-Apply Rules

The main session auto-applies HIGH-confidence proposals **only when all of these hold**:

- The change is purely subtractive (removes code/steps) or a direct substitution
- No behavioral change — functionality is preserved
- No scope reduction — the set of supported actions/endpoints/contexts is unchanged
- No removal of correctness mechanisms — items the plan explicitly identifies as needed for correctness (guards, synchronization, validation) require code-level verification before removal and cannot be auto-applied
- The proposal aligns with CLAUDE.md design principles (YAGNI, KISS, DRY)
- The change does not affect public APIs or user-facing interfaces

When auto-applying, log what was applied and why; surface MEDIUM / LOW proposals to the user before changes. After applying, run relevant tests / static checks to confirm no behavioral regression; revert and report on regression.

## Integration Points

- `/plan` Phase 4 Step 6 dispatches `plan-simplifier` directly via the Agent tool (canonical prompt shape lives there).
- `/impl` Step 4.5 (diff ≥ 20 files or ≥ 500 lines) dispatches `code-simplifier` directly via the Agent tool (canonical prompt shape lives there).
- `/subagent-review` is complementary: it checks spec compliance + code quality + domain + security at the final gate. `simplify-review` targets unnecessary complexity specifically. Run order when both apply: implementation → `simplify-review` (code-simplifier) → `/subagent-review` → next task.

## Simplification Heuristics

Encoded in the agent system prompts; documented here for reference.

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

**Why a fresh subagent (not inline review):** The main session has followed the entire design journey. It knows *why* each decision was made, which makes it blind to unnecessary complexity — every piece feels justified in context. A fresh subagent sees only the artifact and naturally asks "is this needed?" without the sunk-cost bias.

**Why dedicated `plan-simplifier` / `code-simplifier` subagents (not a generic `Plan` or `code-reviewer` agent):** Earlier versions dispatched a generic subagent with a placeholder-filled prompt template loaded from `references/`. That two-step indirection was unreliable when invoked in parallel with other Agent calls — the Skill tool merely loads skill content into context without spawning the subagent, so "parallel simplify-review" effectively degraded to serial or skipped. First-class agent definitions spawn directly via the Agent tool, guaranteeing true parallel execution.

**Why two separate agents (plan vs code):** Input shape (plan text vs git diff) and evaluation focus (structure vs implementation) differ enough that merging them into one agent with a mode switch would bloat the system prompt without benefit.

**Why confidence-based triage instead of binary PASS/FAIL:** Simplification is inherently subjective. Some proposals are obvious wins (dead code), others are judgment calls. Confidence-based triage lets the main session auto-apply safe changes while escalating trade-offs to the user.

**Why auto-apply HIGH confidence:** Requiring user approval for every dead code removal creates noise. The guardrails (subtractive only, no behavioral change, CLAUDE.md aligned) ensure auto-applied changes are safe.

**Why this skill body is a manual entry point only (no Step 1-5 workflow):** the default automated paths (`/plan` Phase 4 Step 6, `/impl` Step 4.5) call the simplifier agents directly without going through this skill. Re-stating their full dispatch prompts here violated DRY and let the canonical prompt shape drift across files. The dispatch source of truth lives in `/plan` and `/impl`; this skill provides only the manual entry plus the triage / auto-apply protocol that the main session applies after dispatch returns.
