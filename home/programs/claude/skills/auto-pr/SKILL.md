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
- `ja` → write the PR title and body in Japanese

## Step 1: Create the PR

Follow the full `/create-pr` workflow:

1. Check for uncommitted changes (`git status`). If any exist, commit or stash before proceeding.
2. Ensure the branch is not `main`/`master`.
3. Rebase on latest main if needed, then push.
4. Write the PR body to `/tmp/pr-body-<random>.md` using the Write tool.
5. Create the PR:
   ```bash
   gh pr create --title "TITLE" --body-file /tmp/pr-body-<random>.md --base main [--draft]
   ```
6. Display the PR URL.
7. Clean up the temp file.

## Step 2: Iterate Until CI Passes

Immediately follow the full `/iterate-pr` workflow without waiting for user input:

1. Check CI status: `gh pr checks --json name,state,bucket,link,workflow`
2. If all checks pass → done (report success to user).
3. If any checks fail:
   - Read the actual failure logs: `gh run view <run-id> --log-failed`
   - Fix the root cause
   - Commit and push the fix
   - Wait: `gh pr checks --watch --interval 30`
   - Repeat from step 1
4. If the PR was draft and all CI passes, mark ready: `gh pr ready`

## Exit Conditions

**Success**: All CI checks green. Report PR URL and status to user.

**Ask for help**:
- Same failure persists after 3 fix attempts
- CI failure requires user decision (e.g., breaking API change, design question)
- Infrastructure-level CI failure unrelated to branch changes
