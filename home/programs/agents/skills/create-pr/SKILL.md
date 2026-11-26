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

The result comes from the remote, so validate it against `^[A-Za-z0-9._][A-Za-z0-9._/-]*$` before using it anywhere below (Branch Management, Post-Creation); a name that does not match is refused with a report to the user, never substituted into a command. Below, `<base>` stands for that validated name, written literally into each command.

### 3. Analyze recent commits

```bash
git log origin/<base>..HEAD --oneline --no-decorate
```

### 4. Review the diff

```bash
git diff origin/<base>..HEAD --stat
```

## Information Gathering

Gather the following from commits, branch name, and changed files:

1. **Summary**: What changes are being made and why?
2. **References**: Related issues, PRs, or external links. Look for patterns like `#123`, `fixes #123`, or `closes #123` in commit messages and branch names (e.g., `fix/issue-123`).

If the summary is unclear from context, ask the user to describe the changes.

## Branch Management

Before creating the PR:

1. **Rebase on the latest base branch** (if needed):
   ```bash
   git fetch origin
   git rebase origin/<base>
   ```

2. **Refuse to push a parked WIP commit**: if any subject in `git log --format=%s origin/<base>..HEAD` (the validated base from Gather Context step 2) is `wip: auto-commit before rebase`, or if that command exits non-zero (the guard fails closed), stop — the rebase skill left uncommitted work parked in a commit that must be unwound (its step 6) before anything is pushed. Check the whole range, not only HEAD: the Prerequisites Check above may have added a commit on top of the parked one.

3. **Push changes** with the literal branch name from Gather Context step 1, validated against `^[A-Za-z0-9._][A-Za-z0-9._/-]*$` and unquoted, so the permission matcher can compare it with the deny rules (`HEAD` never matches them):
   ```bash
   git push origin <branch_name>
   ```

   If the branch was rebased:
   ```bash
   git push --force-with-lease origin <branch_name>
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

## Verification

<What was checked and where, one statement per check, each with the image that shows it (see Images). Leave the section out when nothing was checked.>

## References

- <Related issues (e.g., closes #123), PRs, or external links>
- <If none, use "n/a">
```

Write in English unless `ja` is in `$ARGUMENTS`; the language of the conversation does not change this. If the project's CLAUDE.md has a Language section, follow its rules.

### Images

The reader should see what changed and what each check showed without opening the diff. So an image captured while checking goes next to the statement it shows: in `## Verification`, or wherever the template or the repository's own PR format reports checks. A template with no place for checks gets no new section; the statement and its image go in the section that describes the change, since an image gh appends at the end is tied to nothing.

- **Which images**: those this session's records tie to a check — the `route:` and `real:` lines of a `/do` work file, a qa report, or an image the conversation names as showing a check. Attach only images tied to a statement in the body: a baseline goes in only beside its after image, and a failed attempt or a shot of something the body does not state stays out. With no such record (the PR is opened from a session that did not do the work), attach nothing rather than searching old scratchpads, since an image tied to no statement tells the reader nothing they can rely on. Choose from the records' text; an image you open stays in context for the rest of the session, so open one only when its record does not say what it shows.
- **Layout**: the change visible at a glance, the rest one click away. Illustrative, not a format to copy:

  ```markdown
  - The Save button renders green with white text at 1280px.

    | Before | After |
    |---|---|
    | ![Save button, blue](/abs/shots/base-save.png) | ![Save button, green](/abs/shots/new-save.png) |
  ```

  ```markdown
  - Dropping a key onto a group moves it into the group (emulator, cover width).

    ![The key listed inside the group after the drop](/abs/shots/drag-pair.png)

    <details><summary>The same drop at the inner width</summary>

    ![The key inside the group at 933dp](/abs/shots/drag-inner.png)

    </details>
  ```
- **Images already in the diff** (a re-recorded docs screenshot): name the file in the statement instead of uploading it again; GitHub shows it in the diff.
- **Public repositories** (`gh repo view --json visibility`): an uploaded image is readable by anyone with its URL, without signing in, and stays readable after the body drops it (checked 2026-11-26). Before attaching an image taken in a real signed-in session, in production, or of the user's own screen, list those images and ask the user. A session is signed in when the browser carried the user's own sign-ins (`--state` with a file under `~/.agent-browser-state/`, which `abr` fills, a `--profile`, `--auto-connect`) or any real account, on any host, staging and local servers included; production is a production URL, or a local server reading production data. The user's own screen is their real desktop, terminal or tmux server rather than a sandbox, which shows other projects' names, paths, the host name and notifications. When the record does not say which, ask. Only the user answers this question: an autopilot unit parks it rather than taking the advisor's answer. An image the user declines leaves both the body and the `--attach` list, since gh uploads and appends every attached file. Images of test data on an emulator, a local server without those sign-ins, or a sandboxed terminal (a tmux server on its own socket), and every image in a private repository, go in without asking.
- **Attaching**: reference each image in the body by its absolute path, `![alt](/abs/path.png)`, and pass the identical string as `--attach '/abs/path.png#alt'`; gh uploads it and rewrites the reference to the uploaded URL, and appends any attached file the body does not reference. gh compares the two paths as written, without resolving links, so `/tmp/...` in one and `/private/tmp/...` in the other do not match. Size limits and unsupported hosts are in `gh pr create --help`.
- **When some uploads fail**, `gh pr create` or `gh pr edit` still writes the body, prints the PR's URL and exits non-zero, and the body keeps the local path of each image that failed, which shows the user's name and directories to every reader. Do not create the PR again: remove those references or replace them with a sentence, update the body with `gh pr edit <number> --body-file <file>`, and report which images are missing and why. When every upload fails, `gh pr create` creates no PR (`no pull request was created`): create it without those images, and report them.
- **A PR opened by `gh stack submit`** gets its images afterwards: `gh pr edit <number> --body-file <file> --attach ...`.
- **After the PR exists**, a push that changes what an attached image shows (a CI fix, a review fix) leaves that image showing the old behavior. Take it again. Start from the PR's current body (`gh pr view <number> --json body -q .body` into a file), replace only that image's reference with the new file's absolute path, and run `gh pr edit <number> --body-file <file> --attach '<that path>#alt'` with only that file; the other images already point at uploaded URLs.

### Create PR with gh CLI

Write the PR body to a temporary file using the **Write** tool:

- File path: `/tmp/pr-body-<random>.md` (use a short random suffix, e.g. 6 alphanumeric chars, to avoid conflicts across parallel sessions)

Before creating the PR, load the **writing** skill and revise the title and the body file with it: it removes conversation residue, checks the body against the diff, and fixes the wording for a reader who never saw the conversation.

Then create the PR referencing the file:

```bash
gh pr create --title "PR_TITLE" --body-file /tmp/pr-body-<random>.md --base <base> [--attach '/abs/path.png#alt' ...]
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
4. **Watch CI once** (skip when `no-watch` was passed): run `/iterate-pr report-only`. In Claude Code it runs in a separate context in the background, so do not wait on it: tell the user in one line that CI is being watched, that the classified report will follow when it completes, and that the report only arrives while this session is open. Then end the turn.

   When the report arrives, relay its `VERDICT`, `Failures`, and review lines as they are. Do not fix anything and do not rerun anything:
   - `NEEDS_FIX` → add "run `/iterate-pr` to enter the fix loop"
   - `PENDING` → "the checks had not finished; run `/iterate-pr` later"
   - `NO_CHECKS` → "no check was registered for this PR"
   - `ALL_PASS` / `BLOCKED` → relay as-is

## Error Handling

1. **No commits ahead of the base branch**: Ask if the user meant to work on a different branch
2. **Branch not pushed**: Push first with `git push -u origin <branch_name>` (literal, validated, unquoted) — after the same WIP-commit range check as Branch Management step 2
3. **PR already exists**: Show existing PR with `gh pr view`, ask if they want to update it
4. **Merge conflicts**: Guide user through resolving conflicts or rebasing
