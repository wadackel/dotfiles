---
name: gate
description: Final gate for /impl and standalone code review. Builds the diff with git from the ref /impl set at its start, checks that every completion criterion was run in the conversation, and runs one parallel wave of reviewers (code-reviewer carrying the matching review cards, plus security-auditor and the blast-radius reviewers, and breaker-reviewer when asked or when the change crosses a human-review boundary) with bounded re-review, then reports only what the reader must decide. Use at the end of /impl, or on request ("レビューして", "gate", "subagent review", "タスクレビュー", "壊して"); `--diff-only` reviews a diff that has no plan, `--break` adds the breaker.
---

# /gate

Two modes. **Plan mode** (default under `/impl`): the plan path given as the argument, or else the one from `## Plan ready`; `<slug>` is its basename without `.md`. The argument wins because a caller that ran without a `## Plan ready` block, such as an `/autopilot` unit, knows which plan this gate is for while the latest block in the conversation may belong to another plan or be absent. The base is the commit `git rev-parse -q --verify refs/impl-base/<slug>` prints, the ref `/impl` set at its start; keep that sha and use it as `<base>` for the rest of the gate, because §5 deletes the ref before §6 diffs again. Without the ref, as for a plan not run through `/impl`, the base is `HEAD`, and the report says so, since changes committed during the work then fall outside the diff. **`--diff-only`**: a baseline sha (default `HEAD~1`) and no plan, for trivial work and ad-hoc review; `<slug>` is then a timestamp. `--break` (or "壊して") asks for the breaker in plan mode. Fixed strings are in `~/.claude/skills/plan/references/contract.md`. `<scratchpad>` is this session's scratchpad directory.

## 1. Collect

**Snapshot.** The working tree, uncommitted changes and new files included, is captured as a tree through a copy of the index, so the real index stays as it is:

```
cp -p "$(git rev-parse --path-format=absolute --git-path index)" <scratchpad>/<slug>.index
GIT_INDEX_FILE=<scratchpad>/<slug>.index git add -A
GIT_INDEX_FILE=<scratchpad>/<slug>.index git write-tree
```

`-p` keeps the index's mtime, without which git trusts a same-size edit made in the last second as unchanged. Keep the printed tree: the next round's fix diff starts there.

- Plan mode: snapshot, then write `git diff -D --no-ext-diff --no-textconv --no-color <base> <tree>` to `<scratchpad>/<slug>.gate.diff` (the reviewer hook matches the `.gate.diff` suffix; `-D` leaves out the old content of a deleted file, which no reviewer judges, and the `--no-*` options keep a repository's diff driver or textconv from rewriting what the reviewers read) and list the changed files with `git diff --name-status <base> <tree>`. Files `/impl` found uncommitted at its start are outside the plan: name them to the reviewers as such.
- Coverage (plan mode): every Autonomous Verification bullet other than `[outcome]` needs a run in this conversation that is not stale (`~/.claude/skills/plan/references/contract.md`, Tasks and checks) and whose output shows the bullet's expected result. Run any bullet that lacks one now, before dispatching anyone; a `[live]` bullet that cannot be brought up goes to the user as its `Your steps` line.
- `--diff-only`: write `git diff <baseline>..HEAD` to `<scratchpad>/<timestamp>.gate.diff` and list the changed files with `--name-only`.
- Reviewers read the file concurrently.

## 2. Select reviewers

`code-reviewer` always, carrying every review card in `~/.claude/skills/plan/references/review-cards/` (`typescript`, `react`, `a11y`, `nix`, `rust`, `go`, `dart`, `deno`) whose `Trigger:` line, line 2 of the card, matches the changed files or added lines, and `references/comments-card.md` when its `Trigger:` matches. The language cards are the distilled checklists of the former language specialists and the same cards `/impl` reads before writing; the `Trigger:` line is the only place a card's trigger is written, so the two skills cannot drift. Then add every separate reviewer whose trigger matches; matches are orthogonal, so all fire together.

| Separate reviewer | Trigger |
|---|---|
| `database-reviewer` | `.sql`, `migrations/`, `schema.(sql\|prisma\|ts)`: a change to a persisted format |
| `cloud-architecture-reviewer` | `.tf` `.tfvars`, k8s / Helm yaml, `Dockerfile`, `docker-compose`, `serverless`, `.github/workflows/*.yml` |
| `security-auditor` | a data-flow trigger in `references/security-triggers.md` |
| `breaker-reviewer` (plan mode only) | `--break` or "壊して", or a hunk of the diff body that `~/.claude/skills/plan/references/human-review.md` lists (judged on the hunks, not the file names) |

Skip the wave only for a diff that touches `.md` / `.txt` alone and does not call for the breaker, and say so in the report.

## 3. Dispatch one wave

All selected reviewers go out in one message, unnamed (a named agent idles until TaskStop). `code-reviewer` gets `references/spec-quality-reviewer-prompt.md` (task spec, plan section, diff, diff path, file list, `~/.claude/CLAUDE.md`, and the matched cards pasted verbatim as `{focus_cards}`, or `(none)`); `database-reviewer`, `cloud-architecture-reviewer` and `security-auditor` get `references/domain-reviewer-prompt.md` with `{review_focus}` naming its domain and what a sibling owns. Reviewers without Bash (`code-reviewer`, `security-auditor`) also get the diff body inline.

For `breaker-reviewer`, first build its worktree at `<scratchpad>/<slug>.breaker` from the latest snapshot's tree:

```
git worktree remove --force <scratchpad>/<slug>.breaker    # only when one is left there, and only after the check below
git worktree add --detach <scratchpad>/<slug>.breaker <base>
git diff --binary <base> <tree> | git -C <scratchpad>/<slug>.breaker apply
ln -s <repository>/node_modules <scratchpad>/<slug>.breaker/node_modules    # only when the repository has one
```

Before any `worktree remove` of a breaker worktree (here, in §4 and in §5), check that the path is a real directory and not a link (`test -d <path> && ! test -L <path>`): the breaker can write there, and a link to another worktree of the repository would make `remove --force` delete that one with its uncommitted work. `git -C <scratchpad>/<slug>.breaker status --short` then lists the diff's files. Create a temp directory with `mktemp -d`, then dispatch `breaker-reviewer` with `references/breaker-prompt.md`. When the dispatch fails (the agent definition is not loaded in this session), go on without it and say so in the report.

Paste each template's `## Template` block verbatim. The read-only (for the breaker, workspace) sentence, the `Diff file:` line, and the `VERDICT` rule are machine contract: `reviewer-dispatch-policy.ts` rejects a dispatch without them, because reviewers not told the rule returned PASS over blocker findings in 45% of 774 measured dispatches. Pass no opinion from the main session.

## 4. Judge and re-review

A reviewer FAILs on any `MUST_FIX` / `SHOULD_FIX` (or `CRITICAL` / `HIGH`), or for `code-reviewer` any spec Issue. A finding in code outside the diff and predating the diff does not count toward FAIL at any severity: it goes to the reader under `決める`, because only what this change introduced may block.

**Breaker findings.** Keep a finding only after re-running it yourself. Before running, check its command against the breaker's rules (paths inside the breaker worktree or its temp directory, tmux only with `-L` / `-S`, no `launchctl`, no network), and read every script it runs from the temp directory, because the breaker-only refusals do not apply to your own Bash calls; a command that breaks them is not run and goes to `決める`. Rebuild the worktree (§3) so the breaker's own writes are gone, then run the command: a finding whose failure does not reproduce is dropped. One that reproduces and breaks the plan's intent is a blocker. Run it again in a worktree of the base alone, `<scratchpad>/<slug>.before`, built with the same `remove` (when one is left there), `worktree add` and `node_modules` link and no `apply`, since without the link every command that loads a dependency fails there too: one that also fails there predates the change and goes to `決める`. After fixing a breaker blocker, snapshot, rebuild the worktree from the new tree, and re-run the same command instead of dispatching the breaker again.

**Blockers and re-review.** The blockers are `MUST_FIX`, `CRITICAL`, a `code-reviewer` spec Issue, a reproduced breaker finding, and a `security-auditor` `HIGH`. Fix every blocker. Fix a `SHOULD_FIX` / `HIGH` from the other reviewers too, or defer it to `決める`; it does not trigger a re-review. For each reviewer that reported a fixed blocker (the breaker excepted), snapshot again, write `git diff <tree kept at the previous dispatch> <new tree>` to `<scratchpad>/<slug>.rereview-<n>.gate.diff`, and dispatch it with `references/rereview-diagnostic-prompt.md` holding its previous findings. A diagnostic reply carrying `ESCALATE: fix introduced a new blocker` counts as FAIL.

The Claude gate has two rounds: the first wave and one re-review, and no reviewer is dispatched after them.

**Closing pass.** Any blocker still open after the re-review, such as one the re-review kept open, one it says the fix introduced, or a breaker blocker whose command still reproduces, gets one closing pass by the main session, and nothing runs after it: no reviewer, no second pass. A spec Issue escalates, whichever case it would otherwise fit. Take each other blocker through the first case that fits:

1. **Handed to the reader**: a `security-auditor` blocker, or one on a hunk that `~/.claude/skills/plan/references/human-review.md` lists. A passing test shows the case it names, not that the boundary holds, so a test does not close these. Fix it, keep the suites green, show the failing and passing runs as in case 2 when a test can show the failure, and carry it on that hunk's `レビューしてほしい` line, saying it was fixed after the last review; a hunk that has no line yet gets one, with the security finding as its boundary. One you cannot fix escalates.
2. **Closed by a run**: a failure a test or a command can show. A spec Issue never closes this way, because a session that misread the spec writes the same misreading into the test. Run the command before the fix and keep its failing output in the conversation (when the fix is already in, take it out for that run and put it back), then fix and run the same command again: a failing run followed by a passing one after the last edit closes the blocker. The command works on the repository's working tree: a breaker blocker's repro becomes a test in the repository or a direct command, never a path into the breaker worktree or its temp directory, which are gone after the gate.
3. **Escalated**: everything else, such as a spec Issue, a finding no command can show, a fix you cannot make, a run that does not fail before the fix, suites that stay red. The gate ends `[BLOCKED: gate escalated]` and hands these to the user.

One escalated blocker ends the gate `[BLOCKED: gate escalated]`; the blockers closed or handed over in the same pass are still reported as such.

The gate passes when no blocker is open: every reviewer's fixed blocker got a re-review that returned PASS or went through the closing pass as case 1 or 2, every breaker blocker's command no longer reproduces in a rebuilt worktree or went through the closing pass as case 1 or 2, and every other `SHOULD_FIX` / `HIGH` was fixed or deferred to `決める`; no further wave runs after that.

## 5. Clean up

When this gate changed anything, re-run, once after the last fix, the Autonomous Verification commands and routine checks the fixes made stale (`~/.claude/skills/plan/references/contract.md`, Tasks and checks) and read their output, so the report's claims rest on the final tree; a fix confined to files no check reads re-runs nothing. Then, whatever the outcome (PASS, escalation, interruption), remove every worktree this gate built (`git worktree remove --force <scratchpad>/<slug>.breaker`, and `.before`), the failed breaker dispatch included, and the index copy. When the gate passes, delete the start ref with `git update-ref -d refs/impl-base/<slug>`; after an escalation it stays, so the gate re-run after the user's decision diffs from the same base. `git worktree list` and `git show-ref` show what is left.

## 6. Reply

Before replying, snapshot, write `git diff -D --no-ext-diff --no-textconv --no-color <base> <tree>` to `<scratchpad>/<slug>.final.gate.diff`, and apply `~/.claude/skills/plan/references/human-review.md` to that file (under `--diff-only`, the collected diff plus the fixes), whether or not the review wave ran, so a fix that got no re-review is judged too. Read the file rather than a bare `git diff` in Bash: the rtk hook rewrites that into a summary that drops hunks, and leaves a command redirected to a file alone. Each matching hunk, and each hunk a closing-pass blocker was handed over on, becomes one of the `レビューしてほしい N か所` lines under `**あなたがすること**` in the report, in the line form that file gives. Nothing else is written to a file.

The reply carries only what changes the reader's next action:

- Under `/impl`, the gate writes no reply of its own: it hands the verdict and the items below to the final report.
- Standalone, the reply follows `## Final report` in `~/.claude/skills/impl/SKILL.md`, with `**見つかったこと**` (what was reviewed and what came out) in place of `**何が起きたか**`. When the closing pass ran, the result line says how many blockers it closed or handed over. Under `**あなたがすること**`, `レビューしてほしい N か所` carries the human-review hunks, a blocker handed over in the closing pass on its hunk's line; `決める N つ` carries a `SHOULD_FIX` / `HIGH` deferred on purpose, a security `MEDIUM` or above left open, a breaker finding that predates the change or was not run, and a finding dismissed in an earlier round that resurfaced, which is listed there rather than dismissed again; `確かめてほしい N つ` carries a `[live]` item waived or deferred to a later run. Each line names the place and what reverses it, with the severity translated into what it means for the reader.
- With `--diff-only`, the checks named are the review surfaces.
- Nothing else: no per-reviewer lines, no round counts, no themed tallies of NITs.

A gate that ends `[BLOCKED: gate escalated]` carries that marker in the result line and lists the human-review hunks under `レビューしてほしい N か所` and each open blocker under `決める N つ`.
