---
name: rebase
description: |
  Rebases the current branch onto the latest remote base branch (origin/main or origin/master).
  Handles uncommitted changes automatically via git stash.
  Use when asked to "rebase", "rebaseして", "最新に追従して", "ベースブランチに合わせて",
  "mainに追従", "masterに追従", "rebase on latest", or any request to sync/update
  the current branch with the upstream default branch.
  Also use when the user mentions merge conflicts from an outdated branch or wants to
  bring their feature branch up to date before creating a PR.
---

# Rebase onto Latest Base Branch

Rebase the current feature branch onto the latest remote base branch, safely handling uncommitted changes.

## Workflow

### 1. Check preconditions

- Confirm you are inside a git repository
- Confirm the current branch is NOT the base branch itself (abort with a message if it is — rebasing main onto main is a no-op)
- Check for an in-progress rebase (`git status` showing "rebase in progress"). If found, ask the user how to proceed rather than starting a new rebase

### 2. Stash uncommitted changes (if any)

Run `git status --porcelain`. If there is output (tracked modifications, untracked files, etc.):

```bash
git stash push -u -m "auto-stash before rebase"
```

The `-u` flag includes untracked files. Remember that a stash was created so you can restore it later.

### 3. Fetch and detect the base branch

```bash
git fetch origin
```

Detect the base branch by checking which remote branch exists:

```bash
git rev-parse --verify origin/main >/dev/null 2>&1 && echo "main" || echo "master"
```

Use the result as `<base>`.

### 4. Rebase

```bash
git rebase origin/<base>
```

### 5. Handle the result

**Success**: Report what happened — how many commits were replayed, the base branch used.

**Conflict**: Do NOT attempt to resolve conflicts automatically. Report:
- Which files have conflicts
- The current rebase state
- How to continue (`git rebase --continue`) or abort (`git rebase --abort`)
- If changes were stashed, remind the user that the stash still needs to be popped after resolving conflicts

If the conflict scope is **heavy** — 5+ files with conflicts, or `git status` shows many "both modified" entries — present the reset + cherry-pick fallback as an option alongside continue/abort:

```
Heavy conflict (N files). Two options beyond `--continue` / `--abort`:

A. Resolve in-place: keep working on the rebase, `git rebase --continue` per commit.
B. Reset and cherry-pick: abort the rebase, hard-reset the branch to origin/<base>,
   then cherry-pick each original commit one-by-one so conflicts are resolved per
   commit rather than per file. Useful when many small commits each touch the same
   files and the in-place rebase keeps producing the same conflicts.

   Steps for option B (do NOT run without confirmation):
     git rebase --abort
     ORIG=$(git rev-parse HEAD)          # remember original tip for reference
     git reset --hard origin/<base>
     git cherry-pick <commit1> <commit2> ...   # SHAs from `git log $ORIG --oneline`
```

Do NOT execute option B yourself. Stop and wait for the user to choose. If the user picks B, walk through the steps interactively (one cherry-pick at a time) so each conflict is contained.

Then stop and wait for the user.

### 6. Restore stashed changes

Only if a stash was created in step 2 AND the rebase succeeded:

```bash
git stash pop
```

If the stash pop itself causes conflicts, report them to the user.

## Important

- Never force-push or modify remote branches as part of this workflow
- Never use `--interactive` (`-i`) flag — it requires terminal interaction
- If the user is on a detached HEAD, ask what branch they intended to rebase before proceeding
