---
name: create-pr
description: Creates a GitHub pull request following project conventions. Use when the user asks to create a PR, submit changes for review, or open a pull request. Handles commit analysis, branch management, and PR creation using the gh CLI tool.
disable-model-invocation: true
---

# Create Pull Request

Create a well-structured GitHub pull request.

## Quick Start

```
/create-pull-request
```

Optionally pass a draft flag or title hint as arguments.

## Prerequisites Check

### 1. Check if `gh` CLI is installed

```bash
gh --version
```

If not installed, inform the user:
> The GitHub CLI (`gh`) is required but not installed. Please install it:
> - macOS: `brew install gh`
> - Other: https://cli.github.com/

### 2. Check if authenticated with GitHub

```bash
gh auth status
```

If not authenticated, guide the user to run `gh auth login`.

### 3. Verify clean working directory

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

### Create PR with gh CLI

**Use a temporary file for the PR body** to avoid shell escaping issues:

1. Write the PR body to `/tmp/pr-body.md`

2. Create the PR:
   ```bash
   gh pr create --title "PR_TITLE" --body-file /tmp/pr-body.md --base main
   ```

3. Clean up:
   ```bash
   rm /tmp/pr-body.md
   ```

For draft PRs, add `--draft` flag.

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
