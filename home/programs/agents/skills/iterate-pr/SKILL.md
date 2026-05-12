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

### Step 3: Gather CI Status, Review Feedback, and Failure Logs (SubAgent)

Spawn a **fresh** SubAgent to collect all CI and review information in a single pass. This offloads log retrieval and review collection from the main context.

```
Agent tool:
  subagent_type: "general-purpose"
  model: "sonnet"
  prompt: [built from references/ci-monitor-prompt.md template]
```

Pass to the SubAgent: `{owner}`, `{repo}`, `{pr_number}`, `{branch_name}` — all extracted from the Step 1 `gh pr view` output.

The SubAgent checks CI status, gathers review feedback, and if failures exist, retrieves and summarizes the relevant logs. It returns a prose summary ending with a VERDICT line:

- `VERDICT: ALL_PASS` — all checks green, no unaddressed review feedback
- `VERDICT: NEEDS_FIX` — failed checks or review feedback requiring action
- `VERDICT: BLOCKED` — CI infrastructure issue unrelated to branch changes
- `VERDICT: PENDING` — all checks still pending (re-run Step 3 after a brief wait; after 3 consecutive PENDING verdicts, ask the user)

See [references/ci-monitor-prompt.md](references/ci-monitor-prompt.md) for the full prompt template.

### Step 4: Gather Review Feedback

Review feedback is collected as part of Step 3's SubAgent invocation. See Step 3 for details.

### Step 5: Investigate Failures

Failure logs are collected and summarized as part of Step 3's SubAgent invocation. See Step 3 for details.

### Step 6: Validate Feedback

Based on the SubAgent's summary from Step 3, decide the course of action:

- **VERDICT: ALL_PASS** — Skip to Step 11 (Mark Ready)
- **VERDICT: NEEDS_FIX** — Continue to Step 7 with the failure details and review feedback from the summary
- **VERDICT: BLOCKED** — Stop and inform the user (CI infrastructure issue)
- **VERDICT: PENDING** — Wait briefly, then re-run Step 3 (max 3 consecutive times before asking the user)

For each piece of feedback (CI failure or review comment) in the summary:

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

### Step 10: Wait for CI (SubAgent)

Spawn a **fresh** SubAgent to wait for CI completion and collect results.

```
Agent tool:
  subagent_type: "general-purpose"
  model: "sonnet"
  prompt: [built from references/ci-watch-prompt.md template]
```

Pass the same `{owner}`, `{repo}`, `{pr_number}`, `{branch_name}` values from Step 1.

The SubAgent runs `gh pr checks --watch --interval 30` to block until all checks complete, then collects the final status and any failure logs. It returns a prose summary ending with:

- `VERDICT: ALL_PASS` — all checks passed
- `VERDICT: NEEDS_FIX` — failures detected (summary includes failure details)

See [references/ci-watch-prompt.md](references/ci-watch-prompt.md) for the full prompt template.

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
- SubAgent returns `VERDICT: ALL_PASS` — all CI checks green, no unaddressed review feedback

**Ask for Help:**
- Same failure persists after 3 fix attempts (likely a flaky test or deeper issue)
- SubAgent returns `VERDICT: BLOCKED` (CI infrastructure issue)
- 3 consecutive `VERDICT: PENDING` results (CI may not be configured for this branch)
- Review feedback requires clarification or decision from the user

**Stop Immediately:**
- No PR exists for the current branch
- Branch is out of sync and needs rebase (inform user)

## Tips

- Use `gh pr checks --required` to focus only on required checks
- Use `gh run view <run-id> --verbose` to see all job steps, not just failures
- If a check is from an external service, the `link` field in checks JSON provides the URL to investigate
- Review comments collected by the SubAgent in Step 3 may become stale if the reviewer posts additional feedback while you are fixing code. New comments will be picked up in the next iteration cycle (Step 12 → Step 3)
