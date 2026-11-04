---
name: gate
description: Final gate for /impl and standalone code review. Runs the evidence audit (`plan-state.ts coverage` / `complete`) and one parallel wave of reviewers (code-reviewer carrying the matching review cards, plus security-auditor and the blast-radius reviewers, and breaker-reviewer when asked or when the change crosses a human-review boundary) with bounded re-review, then reports only what the reader must decide. Use at the end of /impl, or on request ("レビューして", "gate", "subagent review", "タスクレビュー", "壊して"); `--diff-only` reviews a diff that has no plan, `--break` adds the breaker.
---

# /gate

Two modes. **Plan mode** (default under `/impl`): the plan path given as the argument, or else the one from `## Plan ready`, and its `<plan>.evidence.json`. The argument wins because a caller that overlaps several plans in one conversation, such as `/autopilot`, knows which plan this gate is for while the latest `## Plan ready` may belong to another. **`--diff-only`**: a baseline sha (default `HEAD~1`) and no plan, for trivial work and ad-hoc review. `--break` (or "壊して") asks for the breaker in plan mode. Fixed strings are in `~/.claude/skills/plan/references/contract.md`.

## 1. Collect

- Plan mode: `~/.agents/scripts/plan-state.ts diff <plan>` writes `~/.claude/plans/<slug>.gate.diff` from the working tree recorded when the plan started to the current working tree, uncommitted changes and new files included, and prints the path, `tree <oid>` (keep it: the next round's fix diff starts there) and the changed files. A warning that the sidecar has no `baseline_tree` means changes left uncommitted before the start show up too; name those files to the reviewers as outside the plan. Then `plan-state.ts coverage <evidence>` (the plan sits next to the sidecar): exit 1 lists Autonomous Verification bullets with no `cc-<n>` check; declare the missing checks or run the missing verification before dispatching anyone. Then `plan-state.ts rerun <evidence>` (background, long timeout) re-executes the stale, failed and red `run` checks, and rows marked `skipped (record)` are re-taken by hand; only then `reconcile`, which reopens a task completed earlier whose evidence is now stale; `review` in §5 closes it again once its records are current.
- `--diff-only`: write `git diff <baseline>..HEAD` to `<scratchpad>/<timestamp>.gate.diff` (the hook matches the `.gate.diff` suffix) and list the changed files with `--name-only`.
- Reviewers read the file concurrently.

## 2. Select reviewers

`code-reviewer` always, carrying every review card in `~/.claude/skills/plan/references/review-cards/` (`typescript`, `react`, `a11y`, `nix`, `rust`, `go`, `dart`, `deno`) whose `Trigger:` line, line 2 of the card, matches the changed files or added lines, and `references/comments-card.md` when its `Trigger:` matches. The language cards are the distilled checklists of the former language specialists and the same cards `/impl` reads before writing; the `Trigger:` line is the only place a card's trigger is written, so the two skills cannot drift. Then add every separate reviewer whose trigger matches; matches are orthogonal, so all fire together.

| Separate reviewer | Trigger |
|---|---|
| `database-reviewer` | `.sql`, `migrations/`, `schema.(sql\|prisma\|ts)`: a change to a persisted format |
| `cloud-architecture-reviewer` | `.tf` `.tfvars`, k8s / Helm yaml, `Dockerfile`, `docker-compose`, `serverless`, `.github/workflows/*.yml` |
| `security-auditor` | a data-flow trigger in `references/security-triggers.md` |
| `breaker-reviewer` (plan mode only) | `--break` or "壊して", or a hunk of the diff body that `~/.claude/skills/plan/references/human-review.md` lists (judged on the hunks, not the file names) |

Skip the wave only for a diff that touches `.md` / `.txt` alone and does not call for the breaker; record that decision in the sidecar.

## 3. Dispatch one wave

All selected reviewers go out in one message, unnamed (a named agent idles until TaskStop). `code-reviewer` gets `references/spec-quality-reviewer-prompt.md` (task spec, plan section, diff, diff path, file list, `~/.claude/CLAUDE.md`, and the matched cards pasted verbatim as `{focus_cards}`, or `(none)`); `database-reviewer`, `cloud-architecture-reviewer` and `security-auditor` get `references/domain-reviewer-prompt.md` with `{review_focus}` naming its domain and what a sibling owns. Reviewers without Bash (`code-reviewer`, `security-auditor`) also get the diff body inline.

For `breaker-reviewer`, first run `plan-state.ts materialize <plan>`: it fills `~/.claude/plans/<slug>.breaker`, a worktree holding the change, and prints its path. Create a temp directory with `mktemp -d`, then dispatch `breaker-reviewer` with `references/breaker-prompt.md`. When the dispatch fails (the agent definition is not loaded in this session), go on without it and say so in the sidecar and the report.

Paste each template's `## Template` block verbatim. The read-only (for the breaker, workspace) sentence, the `Diff file:` line, and the `VERDICT` rule are machine contract: `reviewer-dispatch-policy.ts` rejects a dispatch without them, because reviewers not told the rule returned PASS over blocker findings in 45% of 774 measured dispatches. Pass no opinion from the main session.

## 4. Judge and re-review

A reviewer FAILs on any `MUST_FIX` / `SHOULD_FIX` (or `CRITICAL` / `HIGH`), or for `code-reviewer` any spec Issue. A finding in code outside the diff and predating the diff does not count toward FAIL at any severity: it goes to the reader under `決める`, because only what this change introduced may block.

**Breaker findings.** Keep a finding only after re-running it yourself. Before running, check its command against the breaker's rules (paths inside the breaker worktree or its temp directory, tmux only with `-L` / `-S`, no `launchctl`, no network, no installed `plan-state.ts` against the real plans), and read every script it runs from the temp directory, because the breaker-only refusals do not apply to your own Bash calls; a command that breaks them is not run and goes to `決める`. Run `plan-state.ts materialize <plan>` to refill the worktree, then the command: a finding whose failure does not reproduce is dropped. One that reproduces and breaks the plan's intent is a blocker. Run it again after `plan-state.ts materialize <plan> --before`: one that also fails there predates the change and goes to `決める`. After fixing a breaker blocker, refill with `materialize` and re-run the same command instead of dispatching the breaker again.

**Blockers and re-review.** The blockers are `MUST_FIX`, `CRITICAL`, a `code-reviewer` spec Issue, a reproduced breaker finding, and a `security-auditor` `HIGH`. Fix every blocker. Fix a `SHOULD_FIX` / `HIGH` from the other reviewers too, or defer it to `決める`, and record it; it does not trigger a re-review. For each reviewer that reported a fixed blocker (the breaker excepted), write the fix diff with `plan-state.ts diff <plan> --from <tree printed at the previous dispatch> --rereview <n>` and dispatch it with `references/rereview-diagnostic-prompt.md` holding its previous findings. A diagnostic reply carrying `ESCALATE: fix introduced a new blocker` counts as FAIL.

The Claude gate has two rounds: the first wave and one re-review, and no reviewer is dispatched after them.

**Closing pass.** Any blocker still open after the re-review, such as one the re-review kept open, one it says the fix introduced, or a breaker blocker whose command still reproduces, gets one closing pass by the main session, and nothing runs after it: no reviewer, no second pass. A spec Issue escalates, whichever case it would otherwise fit. Take each other blocker through the first case that fits:

1. **Handed to the reader**: a `security-auditor` blocker, or one on a hunk that `~/.claude/skills/plan/references/human-review.md` lists. A passing test shows the case it names, not that the boundary holds, so a test does not close these. Fix it, keep the suites green, take a `fix-<n>` as in case 2 when a test can show the failure, and carry it on that hunk's `レビューしてほしい` line, saying it was fixed after the last review; a hunk that has no line yet gets one, with the security finding as its boundary. One you cannot fix escalates.
2. **Closed by a run**: a failure a test or a command can show. A spec Issue never closes this way, because a session that misread the spec writes the same misreading into the test. Declare it on the final task with `plan-state.ts require <plan> <final task id>` and `[{"id":"fix-<n>","kind":"file-state"}]` on stdin, run it with `plan-state.ts run <plan> <final task id> fix-<n> --red -- <command>` before the fix (when the fix is already in, take it out for that run and put it back), then fix and `run` the same argv without `--red`. A red record followed by a pass at the current target closes the blocker. Number `fix-<n>` after the highest one the sidecar already holds, so a later gate on the same plan never reuses one: a `run` with another argv supersedes the earlier record. The command is one `run` accepts and works on the repository's working tree: a breaker blocker's repro becomes a test in the repository or a direct command, never a path into the breaker worktree or its temp directory (`rerun` replays it after `materialize --remove`) and never a `bash <script>` wrapper, which `run` refuses. Under `--diff-only`, which has no sidecar, write the red and green outputs verbatim to the gate log instead.
3. **Escalated**: everything else, such as a spec Issue, a finding no command can show, a fix you cannot make, a red run that does not fail, suites that stay red. Append `[BLOCKED: gate escalated]` to the final task and hand these to the user.

One escalated blocker ends the gate `[BLOCKED: gate escalated]`; the blockers closed or handed over in the same pass stay recorded and reported as such.

The gate passes when no blocker is open: every reviewer's fixed blocker got a re-review that returned PASS or went through the closing pass as case 1 or 2, every breaker blocker's command no longer reproduces after `materialize` or went through the closing pass as case 1 or 2, and every other `SHOULD_FIX` / `HIGH` was fixed or deferred to `決める`; no further wave runs after that.

Whatever the outcome (PASS, escalation, interruption), finish with `plan-state.ts materialize <plan> --remove` whenever `materialize` ran, the failed breaker dispatch included.

## 5. Close the evidence (plan mode)

When anything changed after the §1 `rerun` (a fix from this gate), run `plan-state.ts rerun <evidence>` again and re-take its `skipped (record)` rows first: `review` closes only the tasks whose checks are current, and nothing else closes them; `complete` then requires the closing pass's `fix-<n>` at the current target as well. On the final task (`Final Audit + Review`): `~/.agents/scripts/plan-state.ts review <plan> <wave> -- <reviewer>…` with the verdict on stdin as a quoted heredoc (`<<'EOF'`) holding exactly `### MUST_FIX\n- None\nVERDICT: PASS`. It starts the final task when needed, completes the earlier tasks whose checks are current, declares `review-<wave>` and records it at the current target, so no `require`, `snapshot` or `record` of the review check goes before it. Then `plan-state.ts complete <plan> <final task id>`: it requires every task's latest record at the current target. A rejection (`stale verification` with the paths that changed since the record, `missing verification`, `red only`) names the task and check to redo; `run` it again or re-observe and `record`, rather than editing the sidecar. After that, `implementation tasks are incomplete` means `review` ran before those records were current: run `review` again, which closes them, and then `complete`.

## 6. Record and reply

Append to `~/.claude/plans/<slug>.gate.log.md` under `### Round N` (read the file first for N): the coverage output, the reviewer selection with its reasons, every reviewer's final reply verbatim (a credential, token, or signed URL quoted in a finding becomes `<redacted: where it lives>`), each breaker finding with your re-run's result (reproduced, not reproduced, predates the change, not run), per bucket the blockers fixed, findings deferred to the user, and non-blockers dismissed with a one-line reason each, each blocker taken through the closing pass with its case and what backs it (the `fix-<n>` check, the review line, or why it escalated), and the `レビューしてほしい N か所` lines. Nothing else is dropped from the sidecar. When the write fails, put the block in the reply instead and say so.

Before recording, write the final diff with `plan-state.ts diff <plan> --rereview <next n>`, which leaves the first wave's `.gate.diff` as the reviewers read it (under `--diff-only`, the collected diff plus the fixes), and apply `~/.claude/skills/plan/references/human-review.md` to it, whether or not the review wave ran, so a fix that got no re-review is judged too. Each matching hunk, and each hunk a closing-pass blocker was handed over on, becomes one of the `レビューしてほしい N か所` lines under `**あなたがすること**` in the report, in the line form that file gives.

The reply carries only what changes the reader's next action:

- Under `/impl`, the gate writes no reply of its own: it hands the verdict and the items below to the final report.
- Standalone, the reply follows `## Final report` in `~/.claude/skills/impl/SKILL.md`, with `**見つかったこと**` (what was reviewed and what came out) in place of `**何が起きたか**`. When the closing pass ran, the result line says how many blockers it closed or handed over. Under `**あなたがすること**`, `レビューしてほしい N か所` carries the human-review hunks, a blocker handed over in the closing pass on its hunk's line; `決める N つ` carries a `SHOULD_FIX` / `HIGH` deferred on purpose, a security `MEDIUM` or above left open, a breaker finding that predates the change or was not run, and a finding dismissed in an earlier round that resurfaced, which is listed there rather than dismissed again; `確かめてほしい N つ` carries a `[live]` item waived or deferred to a later run. Each line names the place and what reverses it, with the severity translated into what it means for the reader.
- With `--diff-only`, the checks named are the review surfaces, and `Sidecar:` names the scratchpad `.gate.diff` and the log.
- Nothing else: no per-reviewer lines, no round counts, no themed tallies of NITs.

A gate that ends `[BLOCKED: gate escalated]` carries that marker in the result line and lists the human-review hunks under `レビューしてほしい N か所` and each open blocker under `決める N つ`.
