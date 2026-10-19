---
name: gate
description: Final gate for /impl and standalone code review. Runs the evidence audit (`plan-state.ts coverage` / `complete`) and one parallel wave of reviewers (code-reviewer carrying the matching review cards, plus security-auditor and the blast-radius reviewers) with bounded re-review, then reports only what the reader must decide. Use at the end of /impl, or on request ("レビューして", "gate", "subagent review", "タスクレビュー"); `--diff-only` reviews a diff that has no plan.
---

# /gate

Two modes. **Plan mode** (default under `/impl`): the plan path given as the argument, or else the one from `## Plan ready`, and its `<plan>.evidence.json`. The argument wins because a caller that overlaps several plans in one conversation, such as `/autopilot`, knows which plan this gate is for while the latest `## Plan ready` may belong to another. **`--diff-only`**: a baseline sha (default `HEAD~1`) and no plan, for trivial work and ad-hoc review. Fixed strings are in `~/.claude/skills/plan/references/contract.md`.

## 1. Collect

- Baseline: the first task's `baseline_sha` from the evidence file, or the given sha.
- Write `git diff <baseline>..HEAD` once to `~/.claude/plans/<slug>.gate.diff` (`<scratchpad>/<timestamp>.gate.diff` when no plan; the hook matches the `.gate.diff` suffix) and list changed files with `--name-only`. Reviewers read the file concurrently.
- Plan mode: `~/.agents/scripts/plan-state.ts coverage <evidence>` (the plan sits next to the sidecar). Exit 1 lists Autonomous Verification bullets with no `cc-<n>` check; declare the missing checks or run the missing verification before dispatching anyone. Then `~/.agents/scripts/plan-state.ts rerun <evidence>` (background, long timeout) re-executes the stale and failed `run` checks, and rows marked `skipped (record)` are re-taken by hand; only then `reconcile`, which reopens the tasks whose evidence is still stale, and each reopened task is `complete`d again once its records are current, because the final `complete` refuses while an implementation task is open.

## 2. Select reviewers

`code-reviewer` always, carrying every review card in `~/.claude/skills/plan/references/review-cards/` (`typescript`, `react`, `a11y`, `nix`, `rust`, `go`, `dart`, `deno`) whose `Trigger:` line, line 2 of the card, matches the changed files or added lines. The cards are the distilled checklists of the former language specialists and the same cards `/impl` reads before writing; the `Trigger:` line is the only place a card's trigger is written, so the two skills cannot drift. Then add every separate reviewer whose trigger matches; matches are orthogonal, so all fire together.

| Separate reviewer | Trigger (changed files or added lines) |
|---|---|
| `database-reviewer` | `.sql`, `migrations/`, `schema.(sql\|prisma\|ts)`: a change to a persisted format |
| `cloud-architecture-reviewer` | `.tf` `.tfvars`, k8s / Helm yaml, `Dockerfile`, `docker-compose`, `serverless`, `.github/workflows/*.yml` |
| `comment-reviewer` | any `.rs .go .ts .tsx .jsx .mts .cts .py .rb .lua .nix .sh .dart` (self-no-ops without added comments) |
| `security-auditor` | a data-flow trigger in `references/security-triggers.md` |

Skip the wave only for a diff that touches `.md` / `.txt` alone; record that decision in the sidecar.

## 3. Dispatch one wave

All selected reviewers go out in one message, unnamed (a named agent idles until TaskStop). `code-reviewer` gets `references/spec-quality-reviewer-prompt.md` (task spec, plan section, diff, diff path, file list, `~/.claude/CLAUDE.md`, and the matched review cards pasted verbatim as `{focus_cards}`, or `(none)`); `database-reviewer`, `cloud-architecture-reviewer`, `comment-reviewer` and `security-auditor` get `references/domain-reviewer-prompt.md` with `{review_focus}` naming its domain and what a sibling owns. `comment-reviewer`'s focus ends with the output of `~/.claude/scripts/comment-metrics.ts <diff path>` in a fenced block. Reviewers without Bash (`code-reviewer`, `security-auditor`, `comment-reviewer`) also get the diff body inline.

Paste each template's `## Template` block verbatim. The read-only sentence, the `Diff file:` line, and the `VERDICT` rule are machine contract: `reviewer-dispatch-policy.ts` rejects a dispatch without them, because reviewers not told the rule returned PASS over blocker findings in 45% of 774 measured dispatches. Pass no opinion from the main session.

## 4. Judge and re-review

A reviewer FAILs on any `MUST_FIX` / `SHOULD_FIX` (or `CRITICAL` / `HIGH`), or for `code-reviewer` any spec Issue. On FAIL, fix every blocker from every reviewer, write the fix diff to `~/.claude/plans/<slug>.rereview-<n>.gate.diff`, re-run the card selection and the reviewer table on that fix diff, and re-dispatch in full every reviewer whose trigger fires on it (`code-reviewer` with the cards the fix diff selects). The FAILed reviewer itself gets a full re-review when its FAIL held a `MUST_FIX`, `CRITICAL`, or spec Issue, or when it is `security-auditor`; a `SHOULD_FIX` / `HIGH`-only FAIL gets `references/rereview-diagnostic-prompt.md` with the previous findings and the fix diff. A diagnostic reply carrying `ESCALATE: fix introduced a new blocker` counts as FAIL and its next round is full.

Each reviewer has three rounds counting both forms; a re-dispatch caused only by another reviewer's fix does not consume its budget. Exhausting a budget stops the gate: append `[BLOCKED: gate escalated]` to the final task and hand the open blockers to the user. The wave is PASS when every dispatched reviewer returns PASS or only `NIT` / `MEDIUM` / `LOW`.

## 5. Close the evidence (plan mode)

On the final task (`Final Audit + Review`): `start` it if not started, `require` one `review` check per wave (`{"id":"review-<n>","kind":"review"}`), `snapshot` for the current target, then `record` with that `target`, `command` naming the reviewers and the sidecar round, and `output` of exactly `### MUST_FIX\n- None\nVERDICT: PASS`. Then `plan-state.ts complete <evidence> <final task id>`: it requires every task's latest record at the current target. A rejection (`stale verification` with the paths that changed since the record, `missing verification`) names the task and check to redo; `run` it again or re-observe and `record`, rather than editing the sidecar.

## 6. Record and reply

Append to `~/.claude/plans/<slug>.gate.log.md` under `### Round N` (read the file first for N): the coverage output, the reviewer selection with its reasons, every reviewer's final reply verbatim (a credential, token, or signed URL quoted in a finding becomes `<redacted: where it lives>`), per bucket the blockers fixed, findings deferred to the user, and non-blockers dismissed with a one-line reason each, and the `レビューしてほしい N か所` lines. Nothing else is dropped from the sidecar. When the write fails, put the block in the reply instead and say so.

Before recording, apply `~/.claude/skills/plan/references/human-review.md` to the final state, the collected diff plus every `rereview-<n>` fix diff, whether or not the review wave ran. Each matching hunk becomes one of the `レビューしてほしい N か所` lines under `**あなたがすること**` in the report, in the line form that file gives.

The reply carries only what changes the reader's next action:

- Under `/impl`, the gate writes no reply of its own: it hands the verdict and the items below to the final report.
- Standalone, the reply follows `## Final report` in `~/.claude/skills/impl/SKILL.md`, with `**見つかったこと**` (what was reviewed and what came out) in place of `**何が起きたか**`. Under `**あなたがすること**`, `レビューしてほしい N か所` carries the human-review hunks; `決める N つ` carries a `SHOULD_FIX` / `HIGH` deferred on purpose, a security `MEDIUM` or above left open, and a finding dismissed in an earlier round that resurfaced, which is listed there rather than dismissed again; `確かめてほしい N つ` carries a `[live]` item waived or deferred to a later run. Each line names the place and what reverses it, with the severity translated into what it means for the reader.
- With `--diff-only`, the checks named are the review surfaces, and `Sidecar:` names the scratchpad `.gate.diff` and the log.
- Nothing else: no per-reviewer lines, no round counts, no themed tallies of NITs.

A gate that ends `[BLOCKED: gate escalated]` carries that marker in the result line and lists the human-review hunks under `レビューしてほしい N か所` and each open blocker under `決める N つ`.
