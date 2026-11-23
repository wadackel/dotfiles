---
name: correct
description: "Keeps a mistake that has happened before from recurring: finds its earlier occurrences, then fixes it with architecture, types and checks, tests, or written rules last. Use when investigating a fix or a correction shows the mistake happened before, or when asked to prevent one."
---

# Correct

The operator keeps correcting agents in this repo for the same mistakes. Change the repo so the next agent can't make them.

Assume every contributor is an agent that sees only the files it opened, copies the nearest example, and takes the shortest path that compiles. Design the repo so a change that looks right from one file is right for the whole repo.

## Find the mistake classes

First, read past agent sessions, recent commits, reverts, review comments, issues, agent instruction files, and comments that explain workarounds. Group the mistakes into classes. A class counts once it has happened twice; a mistake that has happened once goes to the operator with the fix you propose, and they decide.

## Fix each class at the highest level that works

1. **Eliminate it with architecture.** Give each piece of state one owner and each task one supported way. Hide internals so the wrong import fails. Replace hand-synced lists with one source of truth. Delete old ways and dead code an agent would copy.
2. **Enforce it with types so the bad state can't be written.** If bad code still compiles, add a lint or CI check whose error names the file, type, or function to use instead. If the pattern is already common, fail only when a change adds more.
3. **Test the behavior.** Fix or delete any test that still passes when the behavior it checks breaks, or that fails when only the internals change.
4. **Write docs or agent rules last, only for judgment calls.** Nothing fails when an agent skips them.

## Fix and prove

Then take the classes one at a time, most frequent first: show the operator the class, its evidence, and the fix, and fix it once they agree, one commit each. Prove each new check fails on a real past mistake. Run the same command locally and in CI. Exceptions go on the offending line with a reason, an expiry date, and a human's approval.

## Keep the record

Last, write the class, its evidence, the level you picked, and why a higher level didn't work in the commit message, with the evidence generalized (no quotes from agent sessions, no names from other repos). If a rule was already there and nothing enforces it, that's a repeat, so fix it at the highest level in the same change. Drop a rule once its mistake can't happen. If the operator declined a fix for the class before, say when and why.

**Reply:** each class with its evidence, the level you picked, and why a higher level didn't work.
