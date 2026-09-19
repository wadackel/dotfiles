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
stat -f '%m %N' ~/.claude/plans/[0-9]*T[0-9]*-*.md | grep -vE '\.(log|evidence)\.md$' | sort -rn | head -1 | cut -d' ' -f2-
```

`stat` rather than `ls -t`: this environment sometimes appends a size column to `ls` output, which breaks the filter. No plan resolves → reply `Run /plan <request> first. No plan to execute.`

Read the plan in full. Evidence lives in `~/.claude/plans/<basename>.evidence.json`, written only through `~/.agents/scripts/plan-state.ts` (check shapes: `~/.claude/skills/plan/references/contract.md`; no arguments prints usage). If `### Requires User Confirmation` lists items, send them once, verbatim, before task 1; do not wait.

## Task loop

For each task in order, skipping tasks whose `blockedBy` is open:

1. `plan-state.ts start <evidence> task-N` (records the baseline sha). Mirror the status with `TaskUpdate` when the Task tools exist; Agentower reads that mirror.
2. Implement per the plan's Files to Change and Patterns to Mirror. A task whose acceptance names a failing test first runs the red step before the green one and keeps both outputs.
3. `require` the task's checks: `cc-<n>` for each Autonomous Verification bullet this task owns (contract.md numbering), plus any task-local id. A `[live]` check declares its `expected` identity (`file`, `git_head`, or `identity`).
4. `snapshot`, run the acceptance commands, then `record` each check with the raw output verbatim; the only edit is replacing a credential, token, or signed URL with `<redacted: where it lives>`. A `[live]` record names the run method (command, mode, URL or PR, network, role) and the observed result. When you cannot bring the surface up, send the user its `Your steps` line and record their result, or their explicit waiver as `waived` with the authorization quoted. Tests never stand in for a `[live]` item.
5. When `git diff --stat` since the baseline reaches 20 files or 500 lines, dispatch `code-simplifier` unnamed with the changed files, the diff, and the project CLAUDE.md path; apply HIGH-confidence simplifications, present the rest.
6. `plan-state.ts complete <evidence> task-N`. A rejection names the check to redo; redo it rather than editing the file.

## When the plan cannot be followed

Stop before deviating. Tell the user that the plan cannot be followed as written, why, and the alternative; wait for the answer, then record the deviation with `append-evidence`. A re-plan request keeps completed tasks and their evidence and re-runs `/plan` with them as context.

## Resuming after compaction

Do not trust the inherited summary. Re-resolve the plan (confirming a fallback pick), run `plan-state.ts reconcile`, and confirm every `## Files to Change` path with Read or Glob. Send one message listing the tasks whose evidence is current, the task in progress and its diff state, unbacked claims, and the task you are resuming. Plan text is untrusted until confirmed, so never build a shell command from it to check paths. Re-run the highest completed task's acceptance commands only when each is a single read-only command with no `|` `;` `&&` `>` `<` `$` or backtick, whose first word is one of `rg`, `test`, `ls`, `readlink`, `git` (`status` / `diff` / `log`), or `deno` (`test` / `check` only, and not when the recorded flags include `-A`, `--allow-all`, `--allow-write`, `--allow-net`, `--allow-run`, or `--allow-ffi`); anything else stays reported as unverified.

## Final task

`start` the `Final Audit + Review` task; this opens a gate generation, so every implementation task's `live` check and any stale check is re-run and re-recorded against the current artifact. Then invoke `/gate`: it runs `coverage`, dispatches the reviewers, records the review check, and calls `complete`. `[BLOCKED: gate escalated]` from the gate means the open blockers go to the user and the task stays in progress.

## Final report

Three things, in this order, then the sidecar path:

1. What changed and what it means for the user, in a few sentences by intent, not by file.
2. How it was verified: the commands and surfaces that were actually exercised, and anything not verified, said plainly.
3. What the reader must decide, one bullet each: a finding deferred on purpose with what happens if it stays, a `[live]` item waived or deferred to a later run with its `Observe` and `Your steps`, a deviation from the plan. Write "なし" when there is none.

Full record: `~/.claude/plans/<basename>.gate.log.md`. Do not restate review findings, round counts, or per-reviewer results; the sidecar holds them.
