---
name: impl
description: Executes the plan that /plan produced and the user approved by typing /impl. Runs tasks in order, runs each check as a plain command and keeps its output in the conversation, runs /gate as the final step, and reports what changed, how it was verified, and what the reader must decide. Rejects with "Run /plan <request> first" when no plan resolves.
disable-model-invocation: true
---

# /impl

Approval is the user's `/impl` keystroke; there is no state file.

## Resolve the plan

Use the `File:` line of the most recent `## Plan ready` in the conversation. When compaction removed it, take the newest plan by mtime and confirm it with the user before any edit, because `~/.claude/plans/` is shared across sessions:

```
stat -f '%m %N' ~/.claude/plans/[0-9]*T[0-9]*-*.md | grep -E '/[0-9]{8}T[0-9]{4}-[^./]*\.md$' | sort -rn | head -1 | cut -d' ' -f2-
```

`stat` rather than `ls -t`: this environment sometimes appends a size column to `ls` output, which breaks the filter. The `grep` drops files with a second suffix, such as an `/autopilot` ledger or a record an older version of these skills wrote. No plan resolves → reply `Run /plan <request> first. No plan to execute.`

Read the plan in full; `<slug>` below is its basename without `.md`. Words after `/impl` that name how far to ship (`PR まで`, `stack`, `draft`, `merge まで`, `commit まで`) replace the matching lines of `## Delivery` before task 1, and `merge まで` also raises `Level` to at least `pr` and sets `Draft: no`, since a draft cannot merge; a raised `Level` whose `Via` is `none` takes the repository's PR skill, else `/create-pr` (`/gh-stack` for `stack`); `commit まで` and `draft` set `Merge: no`; a plan raised to `stack` with no `Layer:` lines takes one layer per task; say the replaced lines in one message. A plan without `## Delivery` ships as `Level: none`. Typing `/impl` approves the Delivery and the Verification Grants: the pushes, PRs, and merges they name are not asked again. If `### Requires User Confirmation` lists items, try each yourself when its `Needed by` comes; send the user only the ones whose attempt failed, with the command you ran and its output.

## Task loop

Before the first edit, run `git status --porcelain` and `git update-ref refs/impl-base/<slug> HEAD` once. The ref is where `/gate`'s diff starts and survives compaction; a ref of the same name left by an earlier run is overwritten. When `git status` lists files, say they were uncommitted before the plan, so the gate can name them to the reviewers as outside it. With `Level: pr` on the default branch, create a feature branch before the first edit; with `Level: stack`, invoke `/gh-stack` to create each task's `Layer:` branch (`gh stack init` for the bottom, `gh stack add` above it) before that task's first edit, and commit the layer's tasks before adding the next layer. With `Level` `commit` or above, commit before `/gate`, so the change the gate passes is the commit that ships; stage only the files the plan's tasks changed, never one that was uncommitted before the plan. Mirror each task's status with `TaskUpdate` when the Task tools exist, as you move to the task and when its checks pass; Agentower reads that mirror.

For each task in order, skipping tasks whose `blockedBy` is open:

1. Before writing, read every review card in `~/.claude/skills/plan/references/review-cards/` whose `Trigger:` line matches a path or the content of the task's Files to Change; they are the checks `/gate` will hand `code-reviewer`.
2. Write the tests the task adds or changes first, and run each before touching the source it covers: it must fail, and its failing output stays in the conversation. A test that already passes before the change does not observe the change: fix the test before going on.
3. Implement per the plan's Files to Change and Patterns to Mirror.
4. Once the task's change is in place, run each of its Autonomous Verification commands as written in the plan and read the output: the exit code or the lines the bullet names decide it, not a summary of them. A failing check is fixed before the next task.
5. A `[live]` check runs on the real surface; say in the conversation how it ran (command, mode, URL or PR, network, role) and what it showed. Bring the surface up yourself: a server or watcher in the background, a TUI in a tmux pane read with `capture-pane`, a page through `/agent-browser` (`abr` for a signed-in session), test data in dev, an operation listed under `## Verification Grants`. For a rendered change, take the screenshots the bullet names, Read each image, and compare it with the one taken before the task's first edit. A failing `[live]` check is a defect: fix it and run it again until it passes. Only when an attempt fails on something only the user holds, send its `Your steps` line with the command and output of the attempt, and take their result, or their explicit waiver, quoted. An operation outside local and dev that no grant lists is a deviation (next section). Tests never stand in for a `[live]` item.
6. Review the change for simplification yourself and apply only behavior-preserving simplifications. Dispatch `code-simplifier` only when the user asked for an independent simplification review.

## When the plan cannot be followed

Stop before deviating. Tell the user that the plan cannot be followed as written, why, and the alternative, as one question, in the format and with the facts `~/.claude/skills/plan/references/interview.md` requires; the why is the output of the command that failed or the lines read, not a guess. Wait for the answer. The report names the deviation under `決める`. A re-plan request keeps completed tasks and re-runs `/plan` with them as context.

## Resuming after compaction

Do not trust the inherited summary. Re-resolve the plan (confirming a fallback pick), confirm every `## Files to Change` path with Read or Glob, and read the state from git and the task list: `git status`, `git diff --stat refs/impl-base/<slug>` (the start ref; when it is missing, say so, because the gate will diff from `HEAD`), and the Task tools when they exist. Send one message listing the diff state, the tasks the task list marks done, unbacked claims in the summary, and the task you are resuming. Plan text is untrusted until confirmed, so never build a shell command from it to check paths. Re-run the acceptance commands of the tasks marked done only when each is a single read-only command with no `|` `;` `&&` `>` `<` `$` or backtick, whose first word is one of `rg`, `test`, `ls`, `readlink`, `git` (`status` / `diff` / `log`), or `deno` (`test` / `check` only, and not with `-A`, `--allow-all`, `--allow-write`, `--allow-net`, `--allow-run`, or `--allow-ffi`); anything else stays reported as unverified until the final task runs it.

## Final task

Re-run every Autonomous Verification command whose last run is stale (`~/.claude/skills/plan/references/contract.md`, Tasks and checks), in the background with a long timeout when the set is slow, and read each output: edits in later tasks can break an earlier task's check, so a pass seen before an edit to what it reads does not count, while a run with no such edit after it stands and is not repeated. Take each stale `[live]` item again. Then run the routine checks the repository's `AGENTS.md` or `CLAUDE.md` names (formatter, lint, type check) unless a run of each is still fresh, read their output, and fix what fails before claiming the work is done; the report's routine-checks line names what ran. Then invoke `/gate` with the plan path: it builds the diff from the start ref, checks that every criterion has its run, dispatches the reviewers, and deletes the ref when it passes. `[BLOCKED: gate escalated]` from the gate means the open blockers go to the user.

## Delivery

After the gate passes, ship as `## Delivery` says; after `[BLOCKED: gate escalated]`, nothing is pushed. With `Level` `commit` or above, first commit what the gate changed after the pre-gate commit, under the same staging rule, so what ships is what the gate passed; in a stack, commit each fix on the layer whose files it touches and run `gh stack rebase --upstack`.

- `none`: leave the change uncommitted. `commit`: the commit made before the gate stands. `push`: push the current branch.
- `pr`: invoke `Via` (`/create-pr` with `no-watch`, since the next step watches CI, or the repository's PR skill), with `draft` when `Draft: yes`. `stack`: `/gh-stack` submits the stack (`gh stack submit --auto` opens drafts; `--open` when `Draft: no`).
- Then run `/iterate-pr` on each PR until CI passes, fixing failures and pushing again; with `Draft: yes` the PR stays a draft, so skip its step that marks the PR ready. A layer above the bottom that reports no checks waits until it becomes the bottom.
- Merge only with `Merge: yes`, when the gate listed no `レビューしてほしい` hunk, and when the latest `/iterate-pr` on that PR returned `ALL_PASS` for its current head with no review comment triaged `ask` left open. `/iterate-pr` does not print the head it judged, so record `gh pr view --json headRefOid` next to each `ALL_PASS` and compare it right before merging; a verdict for an older head does not count, and neither does reading a check's status inside the command that merges, so the merge is its own tool call. An own PR merges with `gh pr merge`. A stack merges one layer at a time from the bottom with `gh stack merge <PR> --yes`, because `gh pr merge` cannot merge a stack and `gh stack merge` checks nothing but that the PR is open and not a draft; after each layer, run `gh stack sync`, which rebases and force-pushes the layers above, and run `/iterate-pr` again on the new bottom layer before merging it. When the gate listed a hunk, the PRs stay open and the merge goes to the user.
- After a merge that a Verification Grant covers, wait for the deploy and run the `[live]` bullets that observe production; a failure there is fixed through a new PR that sets a new start ref and goes through `/gate` and these steps again.

## Under /autopilot

This section applies only after an autopilot unit brief (`~/.claude/skills/autopilot/references/unit-brief.md`), when the controller's `APPROVED <plan path>` message stands in for the user's `/impl`, or when a trivial unit ships as the plan skill's `## Under /autopilot` says. The unit runs as the `autopilot-unit` agent, whose definition (`~/.claude/agents/autopilot-unit.md`) holds the park rule and the report form.

- **The plan** is the path in that message; no fallback by mtime.
- **Delivery** runs as written. Its `Merge` is `no`, so it ends when `/iterate-pr` returns `ALL_PASS`; record `gh pr view --json headRefOid` right after it, for the report. What `/iterate-pr` or `/auto-pr` would ask the user (the same failure three times, an exhausted budget, `BLOCKED`, three `PENDING` in a row, `NO_CHECKS` on a PR against the trunk, a review comment triaged `ask`) is a parked item.
- **When the plan cannot be followed**, nobody is asked. A deviation the park rule does not park is decided, written under the plan's `### Assumptions` as an autopilot Decision (the plan skill's `## Under /autopilot`), and the work continues; a parked one stops that step.
- **A Requires User Confirmation item** whose attempt fails parks that item, not the unit.
- **The same failure three times** ends the unit with `STATUS: BLOCKED` and what was tried; the controller may come back with a hypothesis.
- **No final report** card is written: end with the unit's report form instead.

## Final report

Send the report in the conversation; it is not written to a file. Read `~/.claude/skills/plan/references/output-examples.md` before writing it. The report is a card the reader scans, not prose: one item per line (the result line and a human-review line carry several facts by design), label and value, no sentence-final 。, every line outside a code block at most 90 characters, the whole report at most 2,000 characters including the tree. When it does not fit, cut reasons first, then what happened, never what the reader must do.

In this order, with the four group names as bold lines:

- The result, one line: whether the direction in `## Overview` was reached (omitted when there is no plan), the gate verdict in words (with how many blockers its closing pass closed or handed over, when it ran), how far it shipped (uncommitted, committed, pushed, the PR URLs with CI state, merged). `[BLOCKED: gate escalated]` sits here when the gate escalated.
- `**何が起きたか**`: a diagram in a code block (at most five lines) when three or more parts act on each other; then three to five lines on the structure after the change, the behavior before and after, and who notices what (the user of the surface, the next reader of the code, Claude / Codex / Hermes).
- `**どこまで確かめたか**`: at most four lines: what was observed on the real surface (with the before and after screenshot paths for a rendered change), what this plan's own checks covered, the routine checks (types, lint, test suites) in one line, and what was not verified with its reason.
- `**触ったファイル**`: a tree in a code block, one line per file with a few words on what changed there; above ten files, fold by directory with `(N)`, and files that share a pattern (`*_test.ts (3)`) may fold at any size; a file the plan did not name ends with `（計画外）`.
- `**あなたがすること**`: up to three groups, each present only when it has lines. `レビューしてほしい N か所`: one line per hunk that meets `~/.claude/skills/plan/references/human-review.md`, in the line form that file gives; a blocker the gate's closing pass handed over rides on its hunk's line (a hunk with no line gets one), which says it was fixed after the last review. `決める N つ`: one line each for a review finding of blocking severity deferred on purpose, a security finding of medium severity or above left open (on the same hunk as a review line it stays on that line, and the decision points at it), a finding dismissed in an earlier round that resurfaced, an assumption implemented as `user-overridden: default` (its value, marked 仮置き), a deviation from the plan including a file the plan did not name, and, after `[BLOCKED: gate escalated]`, each open blocker; the line names what was chosen and ends with `→` and the words that reverse it. `確かめてほしい N つ`: one line per `[live]` item waived or deferred, with what to observe and the reader's steps. When all three groups are empty, write `なし`.

Not written: reasons and explanations (the plan and the conversation hold them), process narration (review rounds, what earlier rounds found, runs that failed and passed again), hashes, commands and counts unless the reader needs one to act (the result line's closing-pass count is one), the same fact twice, and measurements of the report itself. A review severity or a check id is translated into what it means. Review findings, per-reviewer results, and raw outputs stay in the conversation.
