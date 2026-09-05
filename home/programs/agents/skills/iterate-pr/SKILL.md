---
name: iterate-pr
description: Iterates on the current branch's pull request until all CI checks pass and review feedback is addressed. Automates the feedback-fix-push-wait cycle with gh CLI. Use when you need to fix CI failures, address review feedback, or continuously push fixes until all checks are green. Also use when asked to "fix CI", "iterate PR", "CIを通して", "PRを直して", "CI失敗を修正して", "レビュー指摘を対応して".
---

# Iterate on PR Until CI Passes

Continuously iterate on the current branch until all CI checks pass and review feedback is addressed.

**Requires**: GitHub CLI (`gh`) authenticated and available.

## Process

**Before every push in this skill** (Step 2, Step 6's NEEDS_REBASE path, Step 9): If `git log -1 --format=%s` prints `wip: auto-commit before rebase`, stop: the rebase skill left uncommitted work parked in a commit that must be unwound before anything is pushed. The parked commit was made with `git add -A && git commit --no-verify`, so it can carry files a pre-commit secret scanner never saw.

### Step 1: Identify the PR

```bash
gh pr view --json number,url,headRefName,baseRefName,isDraft
```

If no PR exists for the current branch, stop and inform the user.

Validate `headRefName` and `baseRefName` against `^[A-Za-z0-9._/-]+$` before using them: both are embedded in shell commands below, and git allows `;` `|` `$` and backticks in ref names, so a PR from a fork with a crafted branch name must be refused with a report to the user rather than substituted. The same applies to every `run-id` taken from a SubAgent summary: use it only when it matches `^[0-9]+$`, otherwise do not build the command and report the odd value.

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
4. Apply the WIP-commit check from the top of this section, then `git push --force-with-lease origin "<branch_name>"` with the literal, validated branch name from Step 1 (a `$(git branch --show-current)` substitution would slip past the deny rule for `main`)
5. Return to Step 1

### Step 3: Gather CI Status, Review Feedback, and Failure Logs (SubAgent)

Spawn a **fresh** SubAgent to collect all CI and review information in a single pass. This offloads log retrieval and review collection from the main context.

```
Agent tool:
  subagent_type: "general-purpose"
  model: "sonnet"
  prompt: [built from references/ci-monitor-prompt.md template]
```

Pass to the SubAgent: `{owner}`, `{repo}`, `{pr_number}`, `{branch_name}` — all extracted from the Step 1 `gh pr view` output. `{base_branch}` comes from the same output (`.baseRefName`). Compute `{behind_count}` and `{base_changed_files}` right before the dispatch — the SubAgent runs in the background and must not touch the working tree:

```bash
git fetch origin <base-branch>
git rev-list --count HEAD..origin/<base-branch>                                            # {behind_count}
git diff --name-only "$(git merge-base HEAD origin/<base-branch>)" origin/<base-branch> | head -150   # {base_changed_files}
```

When the file list was truncated, append `… and N more` with the total count.

The SubAgent checks CI status, gathers review feedback, and if failures exist, retrieves and summarizes the relevant logs. It returns a prose summary ending with a VERDICT line:

- `VERDICT: ALL_PASS` — all checks green, no unaddressed review feedback
- `VERDICT: NEEDS_FIX` — failed checks caused by the branch's own changes (or suspected flakes), or review feedback requiring action
- `VERDICT: NEEDS_REBASE` — the only failures are classified `STALE_BASE` (they come from files the base branch changed since the merge-base)
- `VERDICT: NO_CHECKS` — no check was registered for the PR within the SubAgent's 90-second wait
- `VERDICT: BLOCKED` — CI infrastructure issue unrelated to branch changes
- `VERDICT: PENDING` — all checks still pending (re-run Step 3 after a brief wait; after 3 consecutive PENDING verdicts, ask the user)

Each failure in the summary carries `CLASS: STALE_BASE | FLAKE_SUSPECTED | OWN_CHANGE`, its `run-id`, and a `facts` line.

See [references/ci-monitor-prompt.md](references/ci-monitor-prompt.md) for the full prompt template.

### Step 4: Gather Review Feedback

Review feedback is collected as part of Step 3's SubAgent invocation. See Step 3 for details.

### Step 5: Investigate Failures

Failure logs are collected and summarized as part of Step 3's SubAgent invocation. See Step 3 for details.

### Step 6: Validate Feedback

Based on the SubAgent's summary from Step 3, decide the course of action:

- **VERDICT: ALL_PASS** — Skip to Step 11 (Mark Ready)
- **VERDICT: NEEDS_FIX** — Continue to Step 7 with the failure details and review feedback from the summary. Exception: if every failure is `CLASS: FLAKE_SUSPECTED`, run `gh run rerun <run-id> --failed` once per `run-id` (digits only, per the Step 1 rule) and go to Step 10 instead. Keep a list of the run-ids you have rerun in the running report; a run-id already on that list, or more than 3 reruns in this `/iterate-pr` invocation, means the failure is treated as `OWN_CHANGE` and goes to Step 7. If the rerun is rejected (HTTP 403, no write permission), say so and go to Step 7
- **VERDICT: NEEDS_REBASE** — Confirm `git status --porcelain` is empty (if it is not, stop and report the dirty files — `git rebase` would refuse anyway) and apply the WIP-commit check from the top of this section (a freshly parked WIP commit leaves the tree clean, so the porcelain check alone does not catch it). Then `git fetch origin <base-branch> && git rebase origin/<base-branch>`, resolving conflicts exactly as in Step 2, then `git push --force-with-lease origin "<branch_name>"` with the literal branch name from Step 1 (a `$(git branch --show-current)` substitution would slip past the deny rule for `main`), and return to Step 3. At most 2 such rebases per `/iterate-pr` invocation; on the third, stop and inform the user
- **VERDICT: NO_CHECKS** — Stop and inform the user (no check was registered; CI may not be configured for this branch)
- **VERDICT: BLOCKED** — Stop and inform the user (CI infrastructure issue)
- **VERDICT: PENDING** — Wait briefly, then re-run Step 3 (max 3 consecutive times before asking the user)

For each CI failure in the summary, read the relevant code to understand the context before making changes.

For each review comment, sort it into `fix` / `dismiss` / `ask` with [references/review-comment-triage.md](references/review-comment-triage.md). Only `fix` items go to Step 7. `dismiss` and `ask` items are not touched; they are listed individually in the final report, and `ask` never stops the loop to question the user mid-run.

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

Review the list and stage only the intended files (avoid accidentally including `.env`, credentials, or unrelated files). If `git log -1 --format=%s` prints `wip: auto-commit before rebase`, stop: the rebase skill left uncommitted work parked in a commit that must be unwound before anything is pushed.

```bash
git add <file1> <file2> ...
git commit -m "fix: <descriptive message of what was fixed>"
git push origin "<branch_name>"   # the literal, validated branch name from Step 1
```

### Step 10: Wait for CI (SubAgent)

Spawn a **fresh** SubAgent to wait for CI completion and collect results.

```
Agent tool:
  subagent_type: "general-purpose"
  model: "sonnet"
  prompt: [built from references/ci-watch-prompt.md template]
```

Pass the same `{owner}`, `{repo}`, `{pr_number}`, `{branch_name}`, `{base_branch}` values from Step 1, and recompute `{behind_count}` and `{base_changed_files}` with the Step 3 commands right before the dispatch.

The SubAgent runs `gh pr checks --watch --interval 30` to block until all checks complete, then collects the final status and any failure logs. It returns a prose summary ending with:

- `VERDICT: ALL_PASS` — all checks passed
- `VERDICT: NEEDS_FIX` — failures detected (summary includes failure details and `CLASS:` lines)
- `VERDICT: NEEDS_REBASE` — only `STALE_BASE` failures
- `VERDICT: NO_CHECKS` — no check registered within the 90-second wait
- `VERDICT: BLOCKED` — CI infrastructure issue
- `VERDICT: PENDING` — the watch was cut off by the Bash tool's time limit before the checks completed. Dispatch the watch once more; if it comes back `PENDING` again, report to the user and stop

Handle `NEEDS_FIX`, `NEEDS_REBASE`, `NO_CHECKS`, and `BLOCKED` exactly as in Step 6.

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
- The final report lists every `dismiss`ed comment with its reason and every `ask` comment individually (see references/review-comment-triage.md)

**Ask for Help:**
- The same failure signature has appeared 3 times, regardless of how it was classified (a rerun of a run-id counts as one appearance)
- The rerun budget (3 per invocation) or the rebase budget (2 per invocation) is exhausted
- SubAgent returns `VERDICT: BLOCKED` (CI infrastructure issue)
- 3 consecutive `VERDICT: PENDING` results (CI may not be configured for this branch)
- Review feedback requires clarification or decision from the user

**Stop Immediately:**
- No PR exists for the current branch
- A `NEEDS_REBASE` rebase hits a conflict that cannot be resolved, or the working tree is dirty when a rebase is needed (inform user)

## Tips

- Use `gh pr checks --required` to focus only on required checks
- Use `gh run view <run-id> --verbose` to see all job steps, not just failures
- If a check is from an external service, the `link` field in checks JSON provides the URL to investigate
- Review comments collected by the SubAgent in Step 3 may become stale if the reviewer posts additional feedback while you are fixing code. New comments will be picked up in the next iteration cycle (Step 12 → Step 3)
