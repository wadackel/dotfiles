---
name: create-pr
description: Creates a GitHub pull request following project conventions. Use when the user asks to create a PR, submit changes for review, or open a pull request. Handles commit analysis, branch management, and PR creation using the gh CLI tool.
argument-hint: "[draft] [ja]"
disable-model-invocation: true
---

# Create Pull Request

Create a well-structured GitHub pull request.

## Quick Start

```
/create-pr
/create-pr draft
/create-pr ja
/create-pr draft ja
```

## Argument Handling

Parse `$ARGUMENTS` for the following flags (order-independent):
- `draft` → create the PR as a draft
- `ja` → write the PR title and body in Japanese (default: English)

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
git remote show origin | grep "HEAD branch"
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

2. **Push changes**:
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

Write in **English** by default. If `ja` was passed in `$ARGUMENTS`, write in **Japanese** instead.

### Create PR with gh CLI

Use a **heredoc** to pass the PR body inline, avoiding temporary files:

```bash
gh pr create --title "PR_TITLE" --body "$(cat <<'EOF'
PR body content here...
EOF
)" --base main
```

- If `draft` was passed in `$ARGUMENTS`, add the `--draft` flag

## Post-Creation

After creating the PR:

1. **Display the PR URL** so the user can review it
2. **Suggest next steps** if applicable:
   - Add reviewers: `gh pr edit --add-reviewer USERNAME`
   - Add labels: `gh pr edit --add-label "bug"`

## Error Handling

1. **No commits ahead of main**: Ask if the user meant to work on a different branch
2. **Branch not pushed**: Push first with `git push -u origin HEAD`
3. **PR already exists**: Show existing PR with `gh pr view`, ask if they want to update it
4. **Merge conflicts**: Guide user through resolving conflicts or rebasing
