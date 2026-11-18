---
name: auto-pr
description: Creates a pull request AND iterates until all CI checks pass — a single command replacing the create-pr + iterate-pr sequence. Use when asked to "PRを作ってCIが通るまでやって", "auto-pr", "PRを出してmergeできる状態にして", or any request to fully complete the PR lifecycle end-to-end. Distinct from /create-pr (PR creation only) and /iterate-pr (fixing an existing PR).
argument-hint: "[draft] [ja]"
---

# Auto PR

Create a pull request and iterate until all CI checks pass.

This skill is the composition of `/create-pr` followed immediately by `/iterate-pr`. Use it when the goal is to complete the entire PR lifecycle without interruption.

**Use `/create-pr` instead** when you only want to open the PR and stop there.
**Use `/iterate-pr` instead** when a PR already exists and you just need to fix CI.

## Arguments

Parse `$ARGUMENTS` for:
- `draft` → create the PR as a draft. CI is still monitored, and `/iterate-pr` marks the PR ready once everything passes; that is the intended end state, not something to undo
- `ja` → write the PR title and body in Japanese. **Only apply when explicitly present in `$ARGUMENTS`**

## Step 1: Create the PR

Run the `/create-pr` skill as `/create-pr no-watch <$ARGUMENTS>`. `no-watch` is the only flag you add: it skips create-pr's post-creation CI watch because Step 2 watches CI itself, and watching twice wastes a run. Every other flag is passed through exactly as-is — do not add flags that were not in the original arguments.

Example: `/auto-pr draft` invokes `/create-pr no-watch draft`.

Do NOT duplicate create-pr's workflow here — invoke the skill and let it handle all PR creation logic.

## Step 2: Iterate Until CI Passes

Run the `/iterate-pr` skill immediately after Step 1 without waiting for user input. In Claude Code it runs in a separate context in the background: end your turn after invoking it and leave the branch alone while it runs, since it may rebase and push it; its report arrives as a message. Act on the report's labelled `VERDICT` line, never on a log line (one starting with `| `). On `NEEDS_FIX` the fix is yours, made in this session, which knows why the change was made: follow `references/fix-and-push.md` of the iterate-pr skill, which runs `/iterate-pr` again.

Do NOT duplicate iterate-pr's workflow here — invoke the skill and let it handle CI monitoring, reruns, rebases, and the review triage.

## Exit Conditions

**Success**: `/iterate-pr` reports `ALL_PASS`. Report the PR URL and status, and each dismissed comment and each comment needing a decision, individually.

**Ask for help**:
- Same failure persists after 3 fix attempts
- CI failure requires user decision (e.g., breaking API change, design question)
- `/iterate-pr` reports `BLOCKED`, `NO_CHECKS`, `PENDING`, or `NO_PR`
