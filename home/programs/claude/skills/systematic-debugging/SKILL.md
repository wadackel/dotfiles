---
name: systematic-debugging
description: >-
  Systematic 4-phase debugging process (investigate, analyze, hypothesize, fix).
  Auto-loads when encountering bugs, test failures, errors, unexpected behavior,
  "this doesn't work", wrong output, failing CI, or when tempted to propose a
  fix before understanding the root cause. Always use this skill before proposing
  code fixes for any error or failure — even if the fix seems obvious.
  Also use in plan mode when planning bug investigation or fix approaches.
  Manual trigger: /systematic-debugging.
  デバッグ、バグ修正、テスト失敗、エラー調査、動かない、おかしい、原因不明の時に使用。
---

# Systematic Debugging

## Why This Process Matters

Random fixes are expensive — each failed attempt pollutes the debugging state
with unintended side effects, making the real root cause harder to find.
Investigating first typically takes 15-30 minutes; thrashing through guesses
takes 2-3 hours and often introduces new bugs.

Investigate the root cause before attempting any fix. Complete each phase
before proceeding to the next.

## Relationship to CLAUDE.md

CLAUDE.md Bug Fixes rules remain authoritative. This skill adds procedural
detail (the 4-phase process). Apply "present alternatives (workaround vs
root-cause)" after Phase 1 completion. /plan covers plan-mode
investigation; this skill's unique value is implementation-phase debugging.

## The Four Phases

### Phase 1: Root Cause Investigation

Before attempting any fix — fixing without understanding creates more problems
than it solves, because each wrong fix changes the system state and obscures
the original issue.

1. **Read error messages carefully** (full stack trace, line numbers, error codes)
   - Error messages often contain the exact solution; skipping them wastes time
2. **Reproduce consistently** (exact steps, every time?)
   - If not reproducible, gather more data rather than guessing
3. **Check recent changes** (git diff, new deps, config changes)
4. **Gather evidence in multi-component systems**
   - Log data at each component boundary
   - Run once to gather evidence showing WHERE it breaks
   - This reveals which layer fails (e.g., secrets -> workflow OK, workflow -> build FAILS)
5. **Trace data flow** — read `references/root-cause-tracing.md` for the
   backward tracing technique
   - Where does the bad value originate? Trace up until the source is found

**Checkpoint:** Output `## Phase 1 Summary` with confirmed symptoms,
ruled-out causes, and remaining hypotheses.

(Per CLAUDE.md: include direct observation means in the plan)

### Phase 2: Pattern Analysis

Comparing against working examples is faster and more reliable than reasoning
about the broken code in isolation — differences between working and broken
code directly point to the cause.

1. **Find working examples** — similar working code in the same codebase
2. **Compare against references** — read reference implementation completely
3. **Identify differences** — list every difference, however small
4. **Understand dependencies** — what components, config, environment needed

**Checkpoint:** Output `## Phase 2 Summary` with differences found.

### Phase 3: Hypothesis Testing

Testing one variable at a time is essential because multiple simultaneous
changes make it impossible to know which change had what effect.

1. **Form single hypothesis**: "I think X is the root cause because Y"
2. **Test minimally** — smallest possible change, one variable at a time
3. **Verify** — worked -> Phase 4. Didn't work -> new hypothesis, don't stack fixes

(Per CLAUDE.md: fix approach must be falsified — consider why it could be wrong)

**Checkpoint:** Output `## Phase 3 Result` with hypothesis and test outcome.

### Phase 4: Implementation

1. **Create failing test case** (simplest possible reproduction)
2. **Implement single fix** — root cause only, one change, no "while I'm here"
3. **Verify** — test passes, no regressions
4. **If fix doesn't resolve the symptom:**
   Return to Phase 1 with the new information.
   If each fix reveals new problems in different places, the issue is likely
   architectural — discuss with the user before attempting more fixes.

(Per CLAUDE.md: baseline -> implement -> re-measure -> compare -> conclude)

After fixing, consider defense-in-depth: add validation at each layer data
passes through (entry point, business logic, environment guard), not just
the symptom point — this prevents the same class of bug from recurring.

For flaky tests with arbitrary delays: replace setTimeout/sleep with
condition-based waiting (waitFor pattern polling for the actual condition),
because arbitrary delays are inherently fragile across different machines and loads.

## When Process Reveals No Root Cause

If systematic investigation reveals the issue is truly environmental,
timing-dependent, or external:

1. Document what was investigated
2. Implement appropriate handling (retry, timeout, error message)
3. Add monitoring/logging for future investigation

But 95% of "no root cause" conclusions come from incomplete investigation.

## Red Flags — Recognize and Resist

These thought patterns feel productive but lead to wasted time. When you
notice one, return to Phase 1.

| Thought | Why it leads to wasted time |
|---------|----------------------------|
| "Quick fix for now, investigate later" | The first fix sets the pattern; "later" rarely comes |
| "Just try changing X and see" | Guessing without evidence; even if it works, you won't know why |
| "Add multiple changes, run tests" | Can't isolate which change fixed it (or broke something else) |
| "It's probably X, let me fix that" | Seeing symptoms is not understanding the root cause |
| "I don't fully understand but this might work" | Partial understanding guarantees future bugs |
| "Issue is simple, don't need the full process" | Simple bugs have root causes too; the process is fast for simple bugs |
| "Emergency, no time for process" | Systematic debugging is faster than guess-and-check thrashing |
| Proposing solutions before tracing data flow | Investigation must come first |
| Each fix reveals new problem elsewhere | This signals an architectural problem, not a single bug |

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| 1. Root Cause | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY |
| 2. Pattern | Find working examples, compare | Identify differences |
| 3. Hypothesis | Form theory, test minimally | Confirmed or new hypothesis |
| 4. Implementation | Create test, fix, verify | Bug resolved, tests pass |
