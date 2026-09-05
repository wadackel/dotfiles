---
name: create-pr
description: Creates a GitHub pull request following project conventions. Use when the user asks to create a PR, submit changes for review, or open a pull request. Handles commit analysis, branch management, and PR creation using the gh CLI tool.
argument-hint: "[draft] [ja] [no-watch]"
---

# Create Pull Request

Create a well-structured GitHub pull request.

## Quick Start

```
/create-pr
/create-pr draft
/create-pr ja
/create-pr draft ja
/create-pr no-watch
```

## Argument Handling

Parse `$ARGUMENTS` for the following flags (order-independent):
- `draft` → create the PR as a draft
- `ja` → write the PR title and body in Japanese. **Only apply when `ja` is explicitly present in `$ARGUMENTS`** — never infer from conversation language or user locale
- `no-watch` → skip the post-creation CI watch (Post-Creation step 4). `/auto-pr` passes this because it runs `/iterate-pr` right after

## Prerequisites Check

Verify clean working directory:

```bash
git status
```

If there are uncommitted changes, ask the user whether to:
- Commit them as part of this PR
- Stash them temporarily
- Discard them (with caution)

## Gather Context

### 1. Identify the current branch

```bash
git branch --show-current
```

Ensure you're not on `main` or `master`. If so, ask the user to create or switch to a feature branch.

### 2. Find the base branch

```bash
git remote show origin | rg "HEAD branch"
```

### 3. Analyze recent commits

```bash
git log origin/main..HEAD --oneline --no-decorate
```

### 4. Review the diff

```bash
git diff origin/main..HEAD --stat
```

## Information Gathering

Gather the following from commits, branch name, and changed files:

1. **Summary**: What changes are being made and why?
2. **References**: Related issues, PRs, or external links. Look for patterns like `#123`, `fixes #123`, or `closes #123` in commit messages and branch names (e.g., `fix/issue-123`).

If the summary is unclear from context, ask the user to describe the changes.

## Branch Management

Before creating the PR:

1. **Rebase on latest main** (if needed):
   ```bash
   git fetch origin
   git rebase origin/main
   ```

2. **Refuse to push a parked WIP commit**: if `git log -1 --format=%s` prints `wip: auto-commit before rebase`, stop — the rebase skill left uncommitted work parked in a commit that must be unwound (its step 6) before anything is pushed.

3. **Push changes**:
   ```bash
   git push origin HEAD
   ```

   If the branch was rebased:
   ```bash
   git push origin HEAD --force-with-lease
   ```

## Create the Pull Request

### PR Body Format

First, check if a PR template exists in the repository:

```bash
cat .github/pull_request_template.md 2>/dev/null || echo "NO_TEMPLATE"
```

- **If a template exists**: Read and fill in its sections based on the gathered context. Follow the template structure strictly.
- **If no template exists**: Use the following default format:

```markdown
## Summary

<Concise description of the changes and their purpose>

## References

- <Related issues (e.g., closes #123), PRs, or external links>
- <If none, use "n/a">
```

Write in **English** by default. Only write in Japanese when `ja` was explicitly passed in `$ARGUMENTS`. Do NOT infer the language from the user's conversation language — always default to English. If the project's CLAUDE.md has a Language section, follow its rules.

Example: if `$ARGUMENTS` is empty or contains only `draft`, write in English regardless of what language the user is speaking.

### Create PR with gh CLI

Write the PR body to a temporary file using the **Write** tool:

- File path: `/tmp/pr-body-<random>.md` (use a short random suffix, e.g. 6 alphanumeric chars, to avoid conflicts across parallel sessions)

Before creating the PR, self-check the body with the **leave-no-trace** judgment (would it read naturally to someone who never saw the conversation?) and fix any conversation residue.

Then create the PR referencing the file:

```bash
gh pr create --title "PR_TITLE" --body-file /tmp/pr-body-<random>.md --base main
```

- If `draft` was passed in `$ARGUMENTS`, add the `--draft` flag

## Post-Creation

After creating the PR:

1. **Display the PR URL** so the user can review it
2. **Suggest next steps** if applicable:
   - Add reviewers: `gh pr edit --add-reviewer USERNAME`
   - Add labels: `gh pr edit --add-label "bug"`
3. **Clean up** the temporary file:
   ```bash
   rm /tmp/pr-body-<random>.md
   ```
4. **Watch CI once** (skip when `no-watch` was passed). Validate the base branch from Gather Context step 2 and the current branch name against `^[A-Za-z0-9._/-]+$` (both are embedded in commands; refuse and report otherwise), then compute the base inputs:
   ```bash
   git fetch origin <base>
   git rev-list --count HEAD..origin/<base>                                            # {behind_count}
   git diff --name-only "$(git merge-base HEAD origin/<base>)" origin/<base> | head -150   # {base_changed_files}; append "… and N more" with the total when truncated
   ```
   Fill [references/ci-watch-prompt.md](references/ci-watch-prompt.md) with `{owner}`, `{repo}`, `{pr_number}` (from the PR URL shown in step 1), `{branch_name}` (the current branch), `{base_branch}` (Gather Context step 2), `{behind_count}`, `{base_changed_files}` and dispatch it once as an **unnamed** Agent (`subagent_type: "general-purpose"`, `model: "sonnet"`). The Agent runs in the background and its result arrives as a completion notification, so do not wait on it: tell the user in one line that CI is being watched, that the classified report will follow when it completes, and that the report only arrives while this session is open. Then end the turn.

   When the notification arrives, relay the verdict, each failure's `CLASS:` / `run-id` / `facts` lines, and the Recommendation verbatim. Do not fix anything and do not rerun anything:
   - `NEEDS_FIX` or `NEEDS_REBASE` → add "run `/iterate-pr` to enter the fix loop"
   - `PENDING` → "the checks had not finished; run `/iterate-pr` later"
   - `NO_CHECKS` → "no check was registered for this PR"
   - `ALL_PASS` / `BLOCKED` → relay as-is

## Error Handling

1. **No commits ahead of main**: Ask if the user meant to work on a different branch
2. **Branch not pushed**: Push first with `git push -u origin HEAD` — after the same WIP-commit check as Branch Management step 2
3. **PR already exists**: Show existing PR with `gh pr view`, ask if they want to update it
4. **Merge conflicts**: Guide user through resolving conflicts or rebasing
