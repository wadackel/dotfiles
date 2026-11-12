---
name: impl
description: Executes the plan that /plan produced and the user approved by typing /impl. Runs the tasks in order, establishes each completion criterion, reviews the whole change with reviewer subagents, ships as the plan's Delivery says, and reports what the reader must judge. `/impl --review [<baseline>]` reviews a change that has no plan (trivial work, another person's PR); `--break` or "壊して" adds the breaker in plan mode. Rejects with "Run /plan <request> first" when no plan resolves.
disable-model-invocation: true
---

# /impl

Approval is the user's `/impl` keystroke; there is no state file. `/impl --review [<baseline>]` skips the plan and the tasks and runs `## Review` alone; a caller that cannot type a slash command (the trivial path of `/plan`, `/autopilot`) reads this file and follows `## Review` with `--review` itself. Fixed strings are in `~/.claude/skills/plan/references/contract.md`; `<scratchpad>` is this session's scratchpad directory.

## Resolve the plan

Use the `File:` line of the most recent `## Plan ready` in the conversation. When compaction removed it, take the newest plan by mtime and confirm it with the user before any edit, because `~/.claude/plans/` is shared across sessions:

```
stat -f '%m %N' ~/.claude/plans/[0-9]*T[0-9]*-*.md | grep -E '/[0-9]{8}T[0-9]{4}-[^./]*\.md$' | sort -rn | head -1 | cut -d' ' -f2-
```

`stat` rather than `ls -t`: this environment sometimes appends a size column to `ls` output, which breaks the filter. The `grep` drops files with a second suffix, such as an `/autopilot` ledger or a record an older version of these skills wrote. No plan resolves → reply `Run /plan <request> first. No plan to execute.`

Read the plan in full; `<slug>` below is its basename without `.md`. Words after `/impl` that name how far to ship (`PR まで`, `stack`, `draft`, `merge まで`, `commit まで`) replace the matching lines of `## Delivery` before task 1, and `merge まで` also raises `Level` to at least `pr` and sets `Draft: no`, since a draft cannot merge; a raised `Level` whose `Via` is `none` takes the repository's PR skill, else `/create-pr` (`/gh-stack` for `stack`); `commit まで` and `draft` set `Merge: no`; a plan raised to `stack` with no `Layer:` lines takes one layer per task; say the replaced lines in one message. A plan without `## Delivery` ships as `Level: none`. Typing `/impl` approves the Delivery and the Verification Grants: the pushes, PRs, and merges they name are not asked again. If `### Requires User Confirmation` lists items, try each yourself when its `Needed by` comes; send the user only the ones whose attempt failed, with the command you ran and its output.

## Task loop

Before the first edit, run `git status --porcelain` and `git update-ref refs/impl-base/<slug> HEAD` once. The ref is where the review's diff starts and survives compaction; a ref of the same name left by an earlier run is overwritten. When `git status` lists files, say they were uncommitted before the plan, so the review can name them to the reviewers as outside it. With `Level: pr` on the default branch, create a feature branch before the first edit; with `Level: stack`, invoke `/gh-stack` to create each task's `Layer:` branch (`gh stack init` for the bottom, `gh stack add` above it) before that task's first edit, and commit the layer's tasks before adding the next layer. With `Level` `commit` or above, commit before `## Review`, so the change the review passes is the commit that ships; stage only the files the plan's tasks changed, never one that was uncommitted before the plan. Mirror each task's status with `TaskUpdate` when the Task tools exist, as you move to the task and when its criteria are established; Agentower reads that mirror.

For each task in order, skipping tasks whose `blockedBy` is open:

1. Before writing, read every review card in `~/.claude/skills/plan/references/review-cards/` whose `Trigger:` line matches a path or the content of the task's target files; they are the checks the review hands `code-reviewer`.
2. When the task adds or fixes behavior a test can observe, write that test first and run it before touching the source it covers: it must fail, and its failing output stays in the conversation; a test that already passes does not observe the change. A config value, skill or document text, or a refactor the existing tests already cover gets no new test: run the changed thing instead.
3. Implement the task's change, following the plan's Approach and Patterns to Mirror.
4. Establish each Autonomous Verification criterion of the task: choose how to observe the stated state, run it, and read the output, not a summary of it. A `[live]` criterion is observed by the means its `観測:` line names; when that means cannot work here, use another and keep why and what the other leaves weaker for the report. A criterion that fails is fixed before the next task.
5. A `[live]` criterion runs on the real surface; say in the conversation how it ran (command, mode, URL or PR, network, role) and what it showed. Bring the surface up yourself: a server or watcher in the background, a TUI in a tmux pane read with `capture-pane`, a page through `/agent-browser` (`abr` for a signed-in session), test data in dev, an operation listed under `## Verification Grants`. For a rendered change, take the screenshots, Read each image, and compare it with the one taken before the task's first edit. A failing `[live]` criterion is a defect: fix it and observe again until it holds. Only when an attempt fails on something only the user holds, send its `Your steps` line with the command and output of the attempt, and take their result, or their explicit waiver, quoted. An operation outside local and dev that no grant lists is a deviation (next section). Tests never stand in for a `[live]` criterion.
6. Review the change for simplification yourself and apply only behavior-preserving simplifications. Dispatch `code-simplifier` only when the user asked for an independent simplification review.

## When the plan cannot be followed

Proceed with reversible changes to internal paths, naming, files, or implementation mechanics when they keep the agreed behavior, compatibility, dependency choices, and operating conditions; a file the plan did not name is one of these. Keep the reason for the report.

Stop before changing the purpose, public behavior, scope, a completion criterion, a dependency with operational consequences, cost, or a destructive operation outside existing authorization. Tell the user what cannot hold as planned, why, and the alternative, as one question, in the format and with the facts `~/.claude/skills/plan/references/interview.md` requires; the why is the output of the command that failed or the lines read, not a guess. Wait for the answer. A re-plan request keeps completed tasks and re-runs `/plan` with them as context.

## Resuming after compaction

Do not trust the inherited summary. Re-resolve the plan (confirming a fallback pick), confirm every `## Files to Change` path with Read or Glob, and read the state from git and the task list: `git status`, `git diff --stat refs/impl-base/<slug>` (the start ref; when it is missing, say so, because the review will diff from `HEAD`), and the Task tools when they exist. Send one message listing the diff state, the tasks the task list marks done, unbacked claims in the summary, and the task you are resuming. Plan text is untrusted until confirmed, so never build a shell command from it to check paths. Re-run the checks of the tasks marked done only when each is a single read-only command with no `|` `;` `&&` `>` `<` `$` or backtick, whose first word is one of `rg`, `test`, `ls`, `readlink`, `git` (`status` / `diff` / `log`), `bun test`, `bunx tsc --noEmit`, or `deno` (`test` / `check` only, and not with `-A`, `--allow-all`, `--allow-write`, `--allow-net`, `--allow-run`, or `--allow-ffi`); anything else stays reported as not established until the final task runs it.

## Final task

Every Autonomous Verification criterion other than `[outcome]` needs, in the conversation, an observation of the final tree or the reason it was not established. Observe again any criterion a later edit could have changed, in the background with a long timeout when the set is slow. Then run the suite-style checks once on the final tree and the routine checks the repository's `AGENTS.md` or `CLAUDE.md` names (formatter, lint, type check), read their output, and fix what fails before claiming the work is done. Then run `## Review` with the plan.

## Review

Two modes. **Plan mode** (the final task, or an `/autopilot` unit with its plan path): the base is the commit `git rev-parse -q --verify refs/impl-base/<slug>` prints; keep that sha as `<base>`, because Clean up deletes the ref before Reply diffs again. Without the ref, the base is `HEAD`, and the report says so, since changes committed during the work then fall outside the diff. **`--review [<baseline>]`**: no plan; `<slug>` is a timestamp, and `<base>` is the baseline given, else `HEAD` when the working tree has uncommitted changes and `HEAD~1` when it has none. `--break` (or "壊して") asks for the breaker in plan mode.

### Collect

**Snapshot.** The working tree, uncommitted changes and new files included, is captured as a tree through a copy of the index, so the real index stays as it is:

```
cp -p "$(git rev-parse --path-format=absolute --git-path index)" <scratchpad>/<slug>.index
GIT_INDEX_FILE=<scratchpad>/<slug>.index git add -A
GIT_INDEX_FILE=<scratchpad>/<slug>.index git write-tree
```

`-p` keeps the index's mtime, without which git trusts a same-size edit made in the last second as unchanged. Keep the printed tree: the next round's fix diff starts there. Write `git diff -D --no-ext-diff --no-textconv --no-color <base> <tree>` to `<scratchpad>/<slug>.gate.diff` (the reviewer hook matches the `.gate.diff` suffix; `-D` leaves out the old content of a deleted file, which no reviewer judges, and the `--no-*` options keep a repository's diff driver or textconv from rewriting what the reviewers read) and list the changed files with `git diff --name-status <base> <tree>`. Files the task loop found uncommitted at its start are outside the plan: name them to the reviewers as such. Reviewers read the file concurrently.

### Select reviewers

`code-reviewer` always, carrying every review card in `~/.claude/skills/plan/references/review-cards/` whose `Trigger:` line, line 2 of the card, matches the changed files or added lines, and `references/comments-card.md` when its `Trigger:` matches. The task loop reads the same cards before writing; the `Trigger:` line is the only place a card's trigger is written. Then add every separate reviewer whose trigger matches; matches are orthogonal, so all fire together.

| Separate reviewer | Trigger |
|---|---|
| `database-reviewer` | `.sql`, `migrations/`, `schema.(sql\|prisma\|ts)`: a change to a persisted format |
| `cloud-architecture-reviewer` | `.tf` `.tfvars`, k8s / Helm yaml, `Dockerfile`, `docker-compose`, `serverless`, `.github/workflows/*.yml` |
| `security-auditor` | a data-flow trigger in `references/security-triggers.md` |
| `breaker-reviewer` (plan mode only) | `--break` or "壊して", or a hunk of the diff body that `~/.claude/skills/plan/references/human-review.md` lists (judged on the hunks, not the file names) |

Skip the wave only for a diff that touches `.md` / `.txt` alone and does not call for the breaker, and say so in the report.

### Dispatch one wave

All selected reviewers go out in one message, unnamed (a named agent idles until TaskStop). `code-reviewer` gets `references/spec-quality-reviewer-prompt.md` (task spec, plan section, diff, diff path, file list, `~/.claude/CLAUDE.md`, and the matched cards pasted verbatim as `{focus_cards}`, or `(none)`); `database-reviewer`, `cloud-architecture-reviewer` and `security-auditor` get `references/domain-reviewer-prompt.md` with `{review_focus}` naming its domain and what a sibling owns. Reviewers without Bash (`code-reviewer`, `security-auditor`) also get the diff body inline.

For `breaker-reviewer`, first build its worktree at `<scratchpad>/<slug>.breaker` from the latest snapshot's tree:

```
git worktree remove --force <scratchpad>/<slug>.breaker    # only when one is left there, and only after the check below
git worktree add --detach <scratchpad>/<slug>.breaker <base>
git diff --binary <base> <tree> | git -C <scratchpad>/<slug>.breaker apply
ln -s <repository>/node_modules <scratchpad>/<slug>.breaker/node_modules    # only when the repository has one
```

Before any `worktree remove` of a breaker worktree (here, in Judge, and in Clean up), check that the path is a real directory and not a link (`test -d <path> && ! test -L <path>`): the breaker can write there, and a link to another worktree of the repository would make `remove --force` delete that one with its uncommitted work. `git -C <scratchpad>/<slug>.breaker status --short` then lists the diff's files. Create a temp directory with `mktemp -d`, then dispatch `breaker-reviewer` with `references/breaker-prompt.md`. When the dispatch fails (the agent definition is not loaded in this session), go on without it and say so in the report.

Paste each template's `## Template` block verbatim. The read-only (for the breaker, workspace) sentence, the `Diff file:` line, and the `VERDICT` rule are machine contract: `reviewer-dispatch-policy.ts` rejects a dispatch without them, because reviewers not told the rule returned PASS over blocker findings in 45% of 774 measured dispatches. Pass no opinion from the main session.

### Judge and re-review

A reviewer's verdict is FAIL on any `MUST_FIX` / `SHOULD_FIX` (or `CRITICAL` / `HIGH`), or for `code-reviewer` any spec Issue. A finding in code outside the diff and predating the diff counts toward nothing at any severity: it goes to the reader as a decision, because only what this change introduced may block.

**Breaker findings.** Keep a finding only after re-running it yourself. Before running, check its command against the breaker's rules (paths inside the breaker worktree or its temp directory, tmux only with `-L` / `-S`, no `launchctl`, no network), and read every script it runs from the temp directory, because the breaker-only refusals do not apply to your own Bash calls; a command that breaks them is not run and goes to the reader as a decision. Rebuild the worktree (Dispatch) so the breaker's own writes are gone, then run the command: a finding whose failure does not reproduce is dropped. One that reproduces and breaks the plan's intent is a blocker. Run it again in a worktree of the base alone, `<scratchpad>/<slug>.before`, built with the same `remove` (when one is left there), `worktree add` and `node_modules` link and no `apply`, since without the link every command that loads a dependency fails there too: one that also fails there predates the change and goes to the reader as a decision. After fixing a breaker blocker, snapshot, rebuild the worktree from the new tree, and re-run the same command instead of dispatching the breaker again.

**Blockers and re-review.** The blockers are `MUST_FIX`, `CRITICAL`, a `code-reviewer` spec Issue, a reproduced breaker finding, and a `security-auditor` `HIGH`. Fix every blocker. A `SHOULD_FIX` or another reviewer's `HIGH` is not a blocker for you: fix it, or defer it to the reader as a decision; it does not trigger a re-review. For each reviewer that reported a fixed blocker (the breaker excepted), snapshot again, write `git diff <tree kept at the previous dispatch> <new tree>` to `<scratchpad>/<slug>.rereview-<n>.gate.diff`, and dispatch it with `references/rereview-diagnostic-prompt.md` holding its previous findings. A diagnostic reply carrying `ESCALATE: fix introduced a new blocker` counts as FAIL.

The review has two rounds: the first wave and one re-review, and no reviewer is dispatched after them.

**Closing pass.** Any blocker still open after the re-review, such as one the re-review kept open, one it says the fix introduced, or a breaker blocker whose command still reproduces, gets one closing pass by the main session, and nothing runs after it: no reviewer, no second pass. A spec Issue escalates, whichever case it would otherwise fit. Take each other blocker through the first case that fits:

1. **Handed to the reader**: a `security-auditor` blocker, or one on a hunk that `~/.claude/skills/plan/references/human-review.md` lists. A passing test shows the case it names, not that the boundary holds, so a test does not close these. Fix it, keep the suites green, show the failing and passing runs as in case 2 when a test can show the failure, and carry it on that hunk's `レビューしてほしい` line, saying it was fixed after the last review; a hunk that has no line yet gets one, with the security finding as its boundary. One you cannot fix escalates.
2. **Closed by a run**: a failure a test or a command can show. A spec Issue never closes this way, because a session that misread the spec writes the same misreading into the test. Run the command before the fix and keep its failing output in the conversation (when the fix is already in, take it out for that run and put it back), then fix and run the same command again: a failing run followed by a passing one after the last edit closes the blocker. The command works on the repository's working tree: a breaker blocker's repro becomes a test in the repository or a direct command, never a path into the breaker worktree or its temp directory, which are gone after the review.
3. **Escalated**: everything else, such as a spec Issue, a finding no command can show, a fix you cannot make, a run that does not fail before the fix, suites that stay red. The review ends `[BLOCKED: gate escalated]` and hands these to the user.

One escalated blocker ends the review `[BLOCKED: gate escalated]`; the blockers closed or handed over in the same pass are still reported as such.

The review passes when no blocker is open: every reviewer's fixed blocker got a re-review that returned PASS or went through the closing pass as case 1 or 2, every breaker blocker's command no longer reproduces in a rebuilt worktree or went through the closing pass as case 1 or 2, and every other `SHOULD_FIX` / `HIGH` was fixed or deferred to the reader; no further wave runs after that.

### Clean up

When the review changed anything, run the suite-style and routine checks once after the last fix and observe again any criterion the fixes could have changed, so the report's claims rest on the final tree; a fix confined to files no check reads re-runs nothing. Then, whatever the outcome (PASS, escalation, interruption), remove every worktree the review built (`git worktree remove --force <scratchpad>/<slug>.breaker`, and `.before`), the failed breaker dispatch included, and the index copy. When the review passes, delete the start ref with `git update-ref -d refs/impl-base/<slug>`; after an escalation it stays, so the review re-run after the user's decision diffs from the same base. `git worktree list` and `git show-ref` show what is left.

### Reply

Before replying, snapshot, write `git diff -D --no-ext-diff --no-textconv --no-color <base> <tree>` to `<scratchpad>/<slug>.final.gate.diff`, and apply `~/.claude/skills/plan/references/human-review.md` to that file (under `--review`, the collected diff plus the fixes), whether or not the review wave ran, so a fix that got no re-review is judged too. Read the file rather than a bare `git diff` in Bash: the rtk hook rewrites that into a summary that drops hunks, and leaves a command redirected to a file alone. Each matching hunk, and each hunk a closing-pass blocker was handed over on, becomes one of the `レビューしてほしい N か所` lines in the report. Nothing else is written to a file. In plan mode the review writes no reply of its own: its verdict and items go into the final report. Under `--review`, reply as `## Final report` below describes, without that heading, with **見つかったこと** (what was reviewed and what came out) in place of **使う人から見て変わること**.

## Delivery

After the review passes, ship as `## Delivery` says; after `[BLOCKED: gate escalated]`, nothing is pushed. With `Level` `commit` or above, first commit what the review changed after the pre-review commit, under the same staging rule, so what ships is what the review passed; in a stack, commit each fix on the layer whose files it touches and run `gh stack rebase --upstack`.

- `none`: leave the change uncommitted. `commit`: the commit made before the review stands. `push`: push the current branch.
- `pr`: invoke `Via` (`/create-pr` with `no-watch`, since the next step watches CI, or the repository's PR skill), with `draft` when `Draft: yes`. `stack`: `/gh-stack` submits the stack (`gh stack submit --auto` opens drafts; `--open` when `Draft: no`).
- Then run `/iterate-pr` on each PR until CI passes, fixing failures and pushing again; with `Draft: yes` the PR stays a draft, so skip its step that marks the PR ready. A layer above the bottom that reports no checks waits until it becomes the bottom.
- Merge only with `Merge: yes`, when the review listed no `レビューしてほしい` hunk, and when the latest `/iterate-pr` on that PR returned `ALL_PASS` for its current head with no review comment triaged `ask` left open. `/iterate-pr` does not print the head it judged, so record `gh pr view --json headRefOid` next to each `ALL_PASS` and compare it right before merging; a verdict for an older head does not count, and neither does reading a check's status inside the command that merges, so the merge is its own tool call. An own PR merges with `gh pr merge`. A stack merges one layer at a time from the bottom with `gh stack merge <PR> --yes`, because `gh pr merge` cannot merge a stack and `gh stack merge` checks nothing but that the PR is open and not a draft; after each layer, run `gh stack sync`, which rebases and force-pushes the layers above, and run `/iterate-pr` again on the new bottom layer before merging it. When the review listed a hunk, the PRs stay open and the merge goes to the user.
- After a merge that a Verification Grant covers, wait for the deploy and observe the `[live]` criteria that observe production; a failure there is fixed through a new PR that sets a new start ref and goes through `## Review` and these steps again.

## Under /autopilot

This section applies only after an autopilot unit brief (`~/.claude/skills/autopilot/references/unit-brief.md`), when the controller's `APPROVED <plan path>` message stands in for the user's `/impl`, or when a trivial unit ships as the plan skill's `## Under /autopilot` says. The unit runs as the `autopilot-unit` agent, whose definition (`~/.claude/agents/autopilot-unit.md`) holds the park rule and the report form.

- **The plan** is the path in that message; no fallback by mtime.
- **Delivery** runs as written. Its `Merge` is `no`, so it ends when `/iterate-pr` returns `ALL_PASS`; record `gh pr view --json headRefOid` right after it, for the report. What `/iterate-pr` or `/auto-pr` would ask the user (the same failure three times, an exhausted budget, `BLOCKED`, three `PENDING` in a row, `NO_CHECKS` on a PR against the trunk, a review comment triaged `ask`) is a parked item.
- **When the plan cannot be followed**, nobody is asked. A deviation the park rule does not park is decided, written under the plan's `### Assumptions` as an autopilot Decision (the plan skill's `## Under /autopilot`), and the work continues; a parked one stops that step.
- **A Requires User Confirmation item** whose attempt fails parks that item, not the unit.
- **The same failure three times** ends the unit with `STATUS: BLOCKED` and what was tried; the controller may come back with a hypothesis.
- **No final report** is written: end with the unit's report form instead.

## Final report

Send it in the conversation, in the conversation's language; nothing is written to a file. Read `~/.claude/skills/plan/references/output-examples.md` before writing it. The reader decides three things from it: whether to accept the change without reading the diff, what to decide now, and what to take up next. Write it from the side of the request, not of the work: answer what was asked, state conclusions as conclusions, and keep a reason wherever the reader needs it to trust or decide. The test of length is whether the reader can decide on one read; leave out process narration (review rounds, runs that failed and passed again), hashes, and raw output, and translate a review severity or a check id into what it means.

Open with a few lines: whether the request is met, with an answer to each concern or condition the user raised while planning; how many things were not established, when any were; how far it shipped (uncommitted, committed, pushed, the PR URLs with CI state, merged); and `[BLOCKED: gate escalated]` when the review escalated. Then these sections, with these headings in this order, each only when it has content:

- **使う人から見て変わること**: the behavior before and after for whoever uses the changed surface (a screen, an API, a CLI, the next reader of the code, Claude / Codex / Hermes); an example, pseudo-code, or a diagram when words alone would not build the picture.
- **変更したファイル**: a tree in a code block, one line per file with a few words on what changed there; fold a directory with `(N)` when the tree runs long. Mark a line `← レビューしてほしい` for a hunk `~/.claude/skills/plan/references/human-review.md` lists, `（計画外）` for a file the plan did not name, and `（削除あり）` where existing content was removed; a file the plan did not name, or a path, name, or mechanism changed from the plan, says why on its line. A tree with no mark tells the reader the code need not be read. Below the tree, `レビューしてほしい N か所` with one line per marked hunk, in the line form that file gives; a blocker the closing pass handed over rides on its hunk's line.
- **確かめたこと**: each completion criterion established and how; a `[live]` one observed by other means than its `観測:` line says which and what that leaves weaker. The routine checks in one line.
- **確かめていないこと**: each criterion or risk not established: what, why, what happens if it is wrong, and how it could be established, including a means you could use yourself with a grant. A `[live]` item waived or handed to the user goes here with their steps.
- **次に進められること**: the state outside the diff (whether the issue the work belongs to can close, PR and CI state, links) and what can be taken up next.
- **あなたに決めてほしいこと**: the count, then the first one as a question in the format `~/.claude/skills/plan/references/interview.md` gives; the rest are asked one per turn after it is answered. They are: a `SHOULD_FIX` or another reviewer's `HIGH` deferred on purpose, a security finding of medium severity or above left open, a finding dismissed in an earlier round that resurfaced, an assumption implemented as `user-overridden: default` (its value, marked 仮置き), a finding that predates the change, a breaker finding not run because its command broke the breaker's rules, and, after `[BLOCKED: gate escalated]`, each open blocker.
