# Breaker Prompt Template

Use this template when `/impl`'s review dispatches `breaker-reviewer`. Replace `{placeholders}` with actual values. The breaker tries to break the change by running it; a finding survives only when the main session re-runs its command and sees the same failure.

**Paste the `## Template` block verbatim.** The workspace sentence and the `VERDICT` rule are machine contract: `reviewer-dispatch-policy.ts` rejects a `breaker-reviewer` dispatch without them.

## Template

```
## Language

Write all prose (titles, why it breaks the intent, notes) in **Japanese**. Keep in **English**: the `VERDICT: PASS|FAIL` line, the section headers `### Findings`, `### Not run`, `### Notes`, the field labels `Command`, `Output`, `Expected`, `Breaks`, the sentinel `None`, and commands, paths and output as-is.

## Your task

Break this change. Prove each finding with a run against the change in the worktree: a failing test, a repro script, or command output that shows the wrong behavior. Look where reading would not: the entry points and callers of every changed behavior against special names and values, repeated and concurrent events, failure and partial failure, waits that never end, and a different run environment (`env -i`, a non-interactive shell, launchd-like PATH and locale). Check whether each new test fails with the fix removed. Report the findings; do not fix anything. No findings is a valid result.

## Change

Intent: {intent}
Worktree (the change applied): {worktree}
Your temp directory: {temp_dir}
Diff file: {diff_path}
Workspace: write only inside the breaker worktree and your temp directory.
Repro files go in your temp directory and reach the worktree by absolute path; the worktree is rebuilt before your commands are re-run. Create every temporary file and directory inside {temp_dir}, never with a bare `mktemp`: a command that writes anywhere else is not re-run, so its finding is lost. tmux only with `-L <name>` or `-S <path>`; no `launchctl`; no network. The worktree's `node_modules` is a link to the user's install: read it, never write to it.

## Output Format

### Findings
For each finding, or `None`:
- **<title>**
  - Command: `<the exact command, runnable from any directory>`
  - Output: <what it printed, trimmed to the lines that show the failure>
  - Expected: <what the intent requires it to print or do>
  - Breaks: <how this breaks the intent, one line>

### Not run
[Checks you could not run in the worktree and why, or `None`]

### Notes
[Anything else, or `None`]

VERDICT: [PASS if no finding shows a failure that breaks the intent, FAIL otherwise]
```

## Placeholders

| Placeholder | Value |
|---|---|
| `{intent}` | The plan's `## Overview` direction and the user-visible behaviors it changes, in two to four sentences |
| `{worktree}` | `<scratchpad>/<plan-slug>.breaker`, the worktree `/impl`'s review built (Dispatch one wave) |
| `{temp_dir}` | A fresh directory from `mktemp -d` outside the repository |
| `{diff_path}` | `<scratchpad>/<plan-slug>.gate.diff` |

## Usage

```
Agent tool:
  subagent_type: "breaker-reviewer"
  prompt: [Template above with placeholders filled]
```
