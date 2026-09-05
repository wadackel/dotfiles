---
name: rebase
description: |
  Rebases the current branch onto the latest remote base branch (origin/main or origin/master).
  Uncommitted changes ride along in a temporary WIP commit that is unwound afterwards and
  checked by rebase-guard.
  Use when asked to "rebase", "rebaseして", "最新に追従して", "ベースブランチに合わせて",
  "mainに追従", "masterに追従", "rebase on latest", or any request to sync/update
  the current branch with the upstream default branch.
  Also use when the user mentions merge conflicts from an outdated branch or wants to
  bring their feature branch up to date before creating a PR.
---

# Rebase onto Latest Base Branch

Rebase the current feature branch onto the latest remote base branch, carrying uncommitted changes through a temporary WIP commit and verifying afterwards that none of them went missing.

## Workflow

### 1. Check preconditions

- Confirm you are inside a git repository
- Confirm the current branch is NOT the base branch itself (abort with a message if it is — rebasing main onto main is a no-op)
- Check for an in-progress rebase (`git status` showing "rebase in progress"). If found, ask the user how to proceed rather than starting a new rebase

### 2. Commit uncommitted changes as a WIP commit (if any)

Run `git status --porcelain` and show the output. If it lists a path that should not be committed (`.env`, key files, large build artifacts, anything surprising), stop and ask the user before continuing. If there is output:

```bash
git add -A && git commit --no-verify -m "wip: auto-commit before rebase"
WIP_SHA=$(git rev-parse HEAD)
```

Always print `WIP commit: <sha>` so the SHA is in the transcript — it is the recovery handle if anything goes wrong later (`git show <sha>`).

Why a WIP commit rather than a stash: a stash is shared across worktrees and a failed `stash pop` can drop changes without any error surfacing, which is how a 14-file loss was once reported as "restored". A commit is always recoverable from the reflog, and if the rebase touches the same lines the loss shows up as an ordinary conflict instead of vanishing. `--no-verify` is there so that repositories whose commit hooks reject a `wip:` subject (commitlint, husky) do not fail the parking step itself. It also skips `pre-commit`, so a secret scanner installed there does not see this commit: review the `git status --porcelain` list with that in mind, and say in the transcript that the WIP commit bypassed the hooks.

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

**Success**: Report what happened — how many commits were replayed, the base branch used — then continue to step 6.

**Conflict**: Do NOT attempt to resolve conflicts automatically. Report:
- Which files have conflicts
- The current rebase state
- How to continue (`git rebase --continue`) or abort (`git rebase --abort`)
- If a WIP commit exists: its SHA, and that nothing may be pushed while `git log -1 --format=%s` is `wip: auto-commit before rebase`. After `git rebase --abort`, HEAD is the WIP commit again: confirm the subject, then `git reset --mixed HEAD~1` to unwind it

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
     ORIG=$(git rev-parse HEAD)          # original tip; this IS the WIP commit when one was made
     git reset --hard origin/<base>
     git log --reverse --oneline origin/<base>..$ORIG   # oldest first
     git cherry-pick <oldest> ... <newest>               # the WIP commit comes last
     # then run step 6 to unwind the WIP commit and verify it
```

`git reset --hard` wipes the WIP commit's content from the working tree, so the WIP commit must be cherry-picked like any other commit — never leave it out of the list. Cherry-pick oldest first so it lands last, then step 6 unwinds it.

Do NOT execute option B yourself. Stop and wait for the user to choose. If the user picks B, walk through the steps interactively (one cherry-pick at a time) so each conflict is contained.

Then stop and wait for the user.

### 6. Unwind the WIP commit and verify it

Only if a WIP commit was created in step 2. If `$WIP_SHA` is empty (a new shell session since step 2), use the value printed as `WIP commit: <sha>`. First check what HEAD is:

```bash
git log -1 --format=%s
```

- If the subject is `wip: auto-commit before rebase`, unwind it and verify:

  ```bash
  git reset --mixed HEAD~1
  ~/.agents/scripts/rebase-guard.ts verify $WIP_SHA
  ```

- If the subject is anything else, do NOT reset — the rebase either skipped the WIP commit as already applied (its changes are already in the base) or is still in progress. Run the guard as-is; it reports `IN_HEAD` for absorbed files and exits 2 while a rebase is in progress:

  ```bash
  ~/.agents/scripts/rebase-guard.ts verify $WIP_SHA
  ```

Report the guard's output verbatim. Its states are `PRESENT` (change is in the working tree), `IN_HEAD` (already committed, typically absorbed by the base), `LOST` (file or mode is gone), and `UNCONFIRMED` (the patch no longer reverse-applies, usually because the base changed adjacent lines — inspect by hand). On exit 1, never write "restored" or "changes are back": say which files could not be confirmed and that `git show $WIP_SHA -- <path>` recovers the original content. On exit 2, report the reason it printed and stop.

## Important

- Never force-push or modify remote branches as part of this workflow
- Never push while `git log -1 --format=%s` is `wip: auto-commit before rebase` — the WIP commit must be unwound first
- Never use `--interactive` (`-i`) flag — it requires terminal interaction
- If the user is on a detached HEAD, ask what branch they intended to rebase before proceeding
- `rebase-guard.ts` lives in `~/.agents/scripts/`, which every agent (Claude, Codex, opencode) sees at the same path
