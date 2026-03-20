---
name: iterate-pr
description: Iterates on the current branch's pull request until all CI checks pass and review feedback is addressed. Automates the feedback-fix-push-wait cycle with gh CLI. Use when you need to fix CI failures, address review feedback, or continuously push fixes until all checks are green. Also use when asked to "fix CI", "iterate PR", "CIを通して", "PRを直して", "CI失敗を修正して", "レビュー指摘を対応して".
---

# Iterate on PR Until CI Passes

Continuously iterate on the current branch until all CI checks pass and review feedback is addressed.

**Requires**: GitHub CLI (`gh`) authenticated and available.

## Process

### Step 1: Identify the PR

```bash
gh pr view --json number,url,headRefName,baseRefName,isDraft
```

If no PR exists for the current branch, stop and inform the user.

### Step 2: Check for Merge Conflicts

Before proceeding, verify the branch has no merge conflicts:

```bash
gh pr view --json mergeable,mergeStateStatus
```

If `mergeable` is `CONFLICTING`:
1. Fetch and rebase: `git fetch origin <base-branch> && git rebase origin/<base-branch>`
2. Resolve conflicts in the conflicting files
3. `git add <resolved-files> && git rebase --continue`
   - If `index.lock` error occurs: `rm <repo>/.git/worktrees/<name>/index.lock` then retry
4. `git push --force-with-lease origin $(git branch --show-current)`
5. Return to Step 1

### Step 3: Check CI Status First

Always check CI/GitHub Actions status before looking at review feedback:

```bash
gh pr checks --json name,state,bucket,link,workflow
```

The `bucket` field categorizes state into: `pass`, `fail`, `pending`, `skipping`, or `cancel`.

### Step 4: Gather Review Feedback

Once CI checks have completed (or at least the bot-related checks), gather human and bot feedback:

**Review Comments and Status:**
```bash
gh pr view --json reviews,comments,reviewDecision
```

**Inline Code Review Comments:**
```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments
```

**PR Conversation Comments (includes bot comments):**
```bash
gh api repos/{owner}/{repo}/issues/{pr_number}/comments
```

### Step 5: Investigate Failures

For each CI failure, get the actual logs:

```bash
# List recent runs for this branch
gh run list --branch $(git branch --show-current) --limit 5 --json databaseId,name,status,conclusion

# View failed logs for a specific run
gh run view <run-id> --log-failed
```

Do NOT assume what failed based on the check name alone. Always read the actual logs.

### Step 6: Validate Feedback

For each piece of feedback (CI failure or review comment):

1. **Read the relevant code** - Understand the context before making changes
2. **Verify the issue is real** - Not all feedback is correct; reviewers and bots can be wrong
3. **Check if already addressed** - The issue may have been fixed in a subsequent commit
4. **Skip invalid feedback** - If the concern is not legitimate, move on

### Step 7: Address Valid Issues

Make minimal, targeted code changes. Only fix what is actually broken.

### Step 8: Local Verification Before Push

Before committing and pushing, verify the fix locally by reproducing the failed CI check:

1. **Identify the reproduction command**: Read the CI workflow YAML (`.github/workflows/`) or the failed job's logs to determine what command was executed. For example:
   - A `typecheck` job might run `pnpm -F <pkg> build` (not just `tsc --noEmit`)
   - A `gen` job might run `pnpm -F <pkg> generate` followed by `git diff --exit-code`
   - A `test_*` job might run a specific test script with coverage thresholds

2. **Run the command locally**: Execute the same command (or its local equivalent) and confirm it passes.

3. **If the local check fails**: Fix the issue and repeat from Step 7 until it passes. Do NOT push until local verification succeeds.

4. **If the failed job cannot be reproduced locally** (e.g., environment-specific, requires external services, Storybook VRT): Skip this step for that specific job and note it when pushing.

This step prevents wasted CI cycles. Most CI failures (build errors, type errors, test failures, coverage thresholds, generate diffs) are reproducible locally.

### Step 9: Commit and Push

Check what changed before staging:

```bash
git status --porcelain
```

Review the list and stage only the intended files (avoid accidentally including `.env`, credentials, or unrelated files):

```bash
git add <file1> <file2> ...
git commit -m "fix: <descriptive message of what was fixed>"
git push origin $(git branch --show-current)
```

### Step 10: Wait for CI

Use the built-in watch functionality:

```bash
gh pr checks --watch --interval 30
```

This waits until all checks complete. Exit code 0 means all passed, exit code 1 means failures.

Alternatively, poll manually if you need more control:

```bash
gh pr checks --json name,state,bucket | jq '[.[] | select(.bucket == "fail" or .bucket == "pending" or .bucket == "cancel")]'
```

### Step 11: Mark Ready for Review

If all CI checks passed (`bucket: pass` for all) and the PR was draft (`isDraft: true` from Step 1), remove the draft status:

```bash
gh pr ready
```

Only run this once per session (skip if already marked ready).

### Step 12: Repeat

Return to Step 3 if:
- Any CI checks failed
- New review feedback appeared

Continue until all checks pass and no unaddressed feedback remains.

## Exit Conditions

**Success:**
- All CI checks are green (`bucket: pass`)
- No unaddressed human review feedback

**Ask for Help:**
- Same failure persists after 3 attempts (likely a flaky test or deeper issue)
- Review feedback requires clarification or decision from the user
- CI failure is unrelated to branch changes (infrastructure issue)

**Stop Immediately:**
- No PR exists for the current branch
- Branch is out of sync and needs rebase (inform user)

## Tips

- Use `gh pr checks --required` to focus only on required checks
- Use `gh run view <run-id> --verbose` to see all job steps, not just failures
- If a check is from an external service, the `link` field in checks JSON provides the URL to investigate
