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
- `draft` → create the PR as a draft (CI will still be monitored)
- `ja` → write the PR title and body in Japanese (default: English)

## Step 1: Create the PR

Run the `/create-pr` skill. Pass through any `$ARGUMENTS` as-is (e.g., `draft`, `ja`).

Do NOT duplicate create-pr's workflow here — invoke the skill and let it handle all PR creation logic.

## Step 2: Iterate Until CI Passes

Run the `/iterate-pr` skill immediately after Step 1 without waiting for user input.

Do NOT duplicate iterate-pr's workflow here — invoke the skill and let it handle CI monitoring, failure fixing, and the iteration cycle.

## Exit Conditions

**Success**: All CI checks green. Report PR URL and status to user.

**Ask for help**:
- Same failure persists after 3 fix attempts
- CI failure requires user decision (e.g., breaking API change, design question)
- Infrastructure-level CI failure unrelated to branch changes
