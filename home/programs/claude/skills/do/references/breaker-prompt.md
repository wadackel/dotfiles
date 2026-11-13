# Breaker prompt

## Worktree

Build it from the tree the review diff was written from, and create a temp directory with `mktemp -d`:

```
git worktree add --detach <scratchpad>/<slug>.breaker <start>
git diff --binary <start> <tree> | git -C <scratchpad>/<slug>.breaker apply
ln -s <repository>/node_modules <scratchpad>/<slug>.breaker/node_modules    # only when the repository has one
```

Before any `git worktree remove --force` of it, check `test -d <path> && ! test -L <path>`: the breaker can write there, and a link to another worktree would take that one's uncommitted work with it.

## Template

Paste the block with the placeholders filled. `reviewer-dispatch-policy.ts` rejects the dispatch without the `Workspace:` sentence or the `VERDICT` rule.

```
## Language

Write prose in Japanese. Keep `VERDICT`, the section headers, the field labels, `None`, commands, paths and output as they are.

## Task

First repeat each observation below in the worktree and say whether it still shows the done state. Then break the change, proving each finding with a run. Look where reading would not: every entry point of a changed behavior against special names and values, repeated and concurrent events, partial failure, waits that never end, and another run environment (`env -i`, a non-interactive shell). Check whether each new test fails with the fix removed. Do not fix anything. No findings is a valid result.

Intent: {intent}
Done states and how each was observed: {observations}
Worktree (the change applied): {worktree}
Your temp directory: {temp_dir}
Diff file: {diff_path}
Workspace: write only inside the breaker worktree and your temp directory.
Create every temporary file inside {temp_dir}, never with a bare `mktemp`, and reach the worktree by absolute path: it is rebuilt before your commands are re-run, and a command that writes anywhere else is not re-run. tmux only with `-L <name>` or `-S <path>`; no `launchctl`; no network.

## Output

### Observations
- <done state>: holds | does not hold | could not run (<why>)

### Findings
For each finding, or `None`:
- **<title>**
  - Command: `<the exact command, runnable from any directory>`
  - Output: <the lines that show the failure>
  - Expected: <what the intent requires>
  - Breaks: <how this breaks the intent, one line>

VERDICT: PASS if every observation holds and no finding breaks the intent, FAIL otherwise
```

## Using the result

Read a finding's command, and any script it runs, before running it: the breaker's refusals do not cover your own Bash calls. Rebuild the worktree, run the command, and drop a finding that does not reproduce. Fix one that breaks the intent, then rebuild from a new snapshot and run the same command. One the start commit shows too is fixed when closing it is what the request is for, and otherwise goes to the user as a decision.
