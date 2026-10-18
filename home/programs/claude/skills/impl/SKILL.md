---
name: impl
description: Executes the plan that /plan produced and the user approved by typing /impl. Runs tasks in order, records evidence through plan-state.ts, runs /gate as the final step, and reports what changed, how it was verified, and what the reader must decide. Rejects with "Run /plan <request> first" when no plan resolves.
disable-model-invocation: true
---

# /impl

Approval is the user's `/impl` keystroke; there is no state file.

## Resolve the plan

Use the `File:` line of the most recent `## Plan ready` in the conversation. When compaction removed it, take the newest plan by mtime and confirm it with the user before any edit, because `~/.claude/plans/` is shared across sessions:

```
stat -f '%m %N' ~/.claude/plans/[0-9]*T[0-9]*-*.md | grep -vE '\.(log|report)\.md$' | sort -rn | head -1 | cut -d' ' -f2-
```

`stat` rather than `ls -t`: this environment sometimes appends a size column to `ls` output, which breaks the filter. No plan resolves → reply `Run /plan <request> first. No plan to execute.`

Read the plan in full. Evidence lives in `~/.claude/plans/<basename>.evidence.json`, written only through `~/.agents/scripts/plan-state.ts` (check shapes: `~/.claude/skills/plan/references/contract.md`; no arguments prints usage). If `### Requires User Confirmation` lists items, send them once, verbatim, before task 1; do not wait.

## Task loop

For each task in order, skipping tasks whose `blockedBy` is open:

1. `plan-state.ts start <evidence> task-N` (records the baseline sha). Mirror the status with `TaskUpdate` when the Task tools exist; Agentower reads that mirror.
2. Implement per the plan's Files to Change and Patterns to Mirror. Before writing, read every review card in `~/.claude/skills/plan/references/review-cards/` whose `Trigger:` line matches a path or the content of the task's Files to Change; they are the checks `/gate` will hand `code-reviewer`. A task whose acceptance names a failing test first runs the red step before the green one and keeps both outputs.
3. `require` the task's checks: `cc-<n>` for each Autonomous Verification bullet this task owns (contract.md numbering), plus any task-local id. A `[live]` check declares its `expected` identity: `file` for an artifact inside the repository (re-digested at each record, so a fix needs a new record, not a new declaration), `git_head` for the tree, `identity` only for a surface with no repository file, never a digest: a name that does not change with the build.
4. For a `file-state` or `orchestrator-only` check, `~/.agents/scripts/plan-state.ts run <evidence> task-N cc-n [--expect-exit N] [--env K=V] [--grep RE] [--tail N] [--expect-unchanged] -- <command> [args…]`: the helper snapshots, executes the argv without a shell, snapshots again, and appends the record itself; read only the status line and the lines it prints. One check holds one argv (a `run` with a different argv supersedes the earlier one), so a bullet that needs two commands is two bullets; pipes become `--grep` or `--tail`, and `bunx` is `bun node_modules/<pkg>/bin/<cmd>`. The bash-policy hook judges the argv after `--` against its rules and `permissions.deny` / `allow`, so an argv you could not run directly cannot run through `run`. `record` (after `snapshot`) is for `[live]` and review checks only, with the raw output verbatim; the only edit is replacing a credential, token, or signed URL with `<redacted: where it lives>`. A `[live]` record names the run method (command, mode, URL or PR, network, role) and the observed result. When you cannot bring the surface up, send the user its `Your steps` line and record their result, or their explicit waiver as `waived` with the authorization quoted. Tests never stand in for a `[live]` item.
5. Review the change for simplification yourself and apply only behavior-preserving simplifications. Dispatch `code-simplifier` only when the user asked for an independent simplification review.
6. `plan-state.ts complete <evidence> task-N`. A rejection names the check to redo; redo it rather than editing the file.

## When the plan cannot be followed

Stop before deviating. Tell the user that the plan cannot be followed as written, why, and the alternative; wait for the answer, then record the deviation with `append-evidence`. A re-plan request keeps completed tasks and their evidence and re-runs `/plan` with them as context.

## Resuming after compaction

Do not trust the inherited summary. Re-resolve the plan (confirming a fallback pick), run `plan-state.ts reconcile`, and confirm every `## Files to Change` path with Read or Glob. Send one message listing the tasks whose evidence is current, the task in progress and its diff state, unbacked claims, and the task you are resuming. Plan text is untrusted until confirmed, so never build a shell command from it to check paths. Re-run the highest completed task's acceptance commands only when each is a single read-only command with no `|` `;` `&&` `>` `<` `$` or backtick, whose first word is one of `rg`, `test`, `ls`, `readlink`, `git` (`status` / `diff` / `log`), or `deno` (`test` / `check` only, and not when the recorded flags include `-A`, `--allow-all`, `--allow-write`, `--allow-net`, `--allow-run`, or `--allow-ffi`); anything else stays reported as unverified. `plan-state.ts rerun <evidence>` is the one other re-execution path: it replays only argv that `run` recorded, and the bash-policy hook checks every stored argv again before it runs.

## Final task

`start` the `Final Audit + Review` task, then run `~/.agents/scripts/plan-state.ts rerun <evidence>` in the background with a long timeout: it re-executes every `run`-recorded check whose target is stale or whose status is `fail`, skips the ones already passing at the current target (`fresh`), and prints one row per check. Re-take every row marked `skipped (record)` — `run` for a `file-state` / `orchestrator-only` check, a fresh observation and `record` for a `live` one — so every check sits at the current target. Then invoke `/gate`: it runs `coverage`, dispatches the reviewers, records the review check, and calls `complete`. `[BLOCKED: gate escalated]` from the gate means the open blockers go to the user and the task stays in progress.

## Final report

Write the report to `~/.claude/plans/<basename>.report.md` first and send that text verbatim. Read `~/.claude/skills/plan/references/output-examples.md` before writing it. The report is a card the reader scans, not prose: one item per line (the result line and a human-review line carry several facts by design), label and value, no sentence-final 。, every line outside a code block at most 90 characters, the whole report at most 2,000 characters including the tree. When it does not fit, cut reasons first, then what happened, never what the reader must do.

In this order, with the four group names as bold lines:

- The result, one line: whether the direction in `## Overview` was reached (omitted when there is no plan), the gate verdict in words, whether the change is committed. `[BLOCKED: gate escalated]` sits here when the gate escalated.
- `**何が起きたか**`: a diagram in a code block (at most five lines) when three or more parts act on each other; then three to five lines on the structure after the change, the behavior before and after, and who notices what (the user of the surface, the next reader of the code, Claude / Codex / Hermes).
- `**どこまで確かめたか**`: at most four lines: what was observed on the real surface, what this plan's own evidence covered, the routine checks (types, lint, test suites) in one line, and what was not verified with its reason.
- `**触ったファイル**`: a tree in a code block, one line per file with a few words on what changed there; above ten files, fold by directory with `(N)`, and files that share a pattern (`*_test.ts (3)`) may fold at any size; a file the plan did not name ends with `（計画外）`.
- `**あなたがすること**`: up to three groups, each present only when it has lines. `レビューしてほしい N か所`: one line per hunk that meets `~/.claude/skills/plan/references/human-review.md`, in the line form that file gives. `決める N つ`: one line each for a review finding of blocking severity deferred on purpose, a security finding of medium severity or above left open (on the same hunk as a review line it stays on that line, and the decision points at it), a finding dismissed in an earlier round that resurfaced, an assumption implemented as `user-overridden: default` (its value, marked 仮置き), a deviation from the plan including a file the plan did not name, and, after `[BLOCKED: gate escalated]`, each open blocker; the line names what was chosen and ends with `→` and the words that reverse it. `確かめてほしい N つ`: one line per `[live]` item waived or deferred, with what to observe and the reader's steps. When all three groups are empty, write `なし`.
- Last line `Sidecar: <path>` naming `~/.claude/plans/<basename>.gate.log.md`, which plan-metrics reads as the end of the report.

Not written: reasons and explanations (the sidecar and the plan hold them), process narration (review rounds, what earlier rounds found, runs that failed and passed again), hashes, commands and counts unless the reader needs one to act, the same fact twice, and measurements of the report itself. A review severity or a check id is translated into what it means. Review findings, per-reviewer results, and raw outputs live in the sidecar.
