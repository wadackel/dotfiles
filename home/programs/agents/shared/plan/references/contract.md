# Contract

The fixed strings that the plan, impl, and gate skills (Claude), `$plan` / `$impl` (Codex), `check-plan.ts`, `plan-state.ts`, `reviewer-dispatch-policy.ts`, and the reviewer prompts read or write. `check-plan.ts` mirrors the headings and the Requires User Confirmation vocabulary; `codex-plan-clarification-contract_test.ts` pins each entry against the files that carry it. Question judgment is in `interview.md`.

## Plan file

Path: `~/.claude/plans/YYYYMMDDTHHmm-<slug>.md` (Claude) or `~/.codex/plans/…` (Codex); slug ≤ 40 chars, lowercase kebab. Headings are English literals; prose is the user's language.

| Heading | trivial | small | medium+ |
|---|---|---|---|
| `## Context` | ✓ | ✓ | ✓ |
| `## Overview` | | ✓ | ✓ |
| `## Approach` (with `### Alternatives Considered`) | | ✓ | ✓ |
| `## NOT Building` | | ✓ | ✓ |
| `## Mandatory Reading` | | | ✓ |
| `## Patterns to Mirror` | | | ✓ |
| `## Intentional Conventions` | | | ✓ |
| `## Files to Change` | ✓ | ✓ | ✓ |
| `## Task Outline` | ✓ | ✓ | ✓ |
| `## Test Strategy` | | ✓ | ✓ |
| `## Completion Criteria` with `### Autonomous Verification`, `### Requires User Confirmation`, `### Baseline` | ✓ | ✓ | ✓ |
| `## Risks + Open Questions` | | ✓ | ✓ |

`check-plan.ts` requires Context, Files to Change, Task Outline, and Completion Criteria; the trivial column applies when a trivial plan is written anyway.

## AGREE subsections

Written immediately before `## Overview`. The critic parses them by structure.

- `### Assumptions` — `observation` / `value` / `reason`, plus `user-overridden: true` when the user chose the value, or `user-overridden: default` when the plan adopted the recommendation for a scope boundary as a provisional default (shown in the handoff and the final report as 仮置き).
- `### Self-resolved` — entries with `observation` / `value` and a closing line `source: [Direct|Supported|Inferred] <probe command + file:lines>`, a `[Direct]` one followed by `→ <output excerpt>` (the lines the claim rests on), e.g. `source: [Direct] sed -n '12,14p' src/app.ts → 12:const limit = 5` or `source: [Supported] adversarial agent report, round 1`. `[Unknown]` never appears here. A claim the Approach relies on is `[Direct]`, or `[Supported]` only by an observed mechanism whose target does not exist yet or by a delegate observation recorded verbatim with secrets, tokens, credentialed URLs, and personal data replaced by `<redacted: what it is>`.
- `### Unresolved Items` — `item` / `reason` / `next`; `(none)` when empty. User-only questions never go here.

Grades: `[Direct]` you ran the command or read the lines this session (name it); `[Supported]` one inference step from something you read, or a report not re-read (name it); `[Inferred]` a guess, say "likely"; `[Unknown]` you looked and could not tell (say what you tried; it goes under Unresolved Items).

A reviewer re-runs a quoted probe only when it is exactly one of `sed -n '<N>,<M>p' <path>`, `rg [-n|-c|-i|-A k|-B k|-C k|--glob '<g>'] '<pattern>' <path>`, or `readlink [-f] <path>` on one line with no `|` `;` `&` `>` `<` `$` or backtick and no other option (no `--pre`, `-z`, `-P`, `-f` for `rg`; `sed` is an address plus `p` only, never `-i` `-e` `-f` `-E`), where `<path>` is the file the entry cites. Every cited path is relative, under the repository root (no `~/`, absolute path, or `..`), resolves under the root via `readlink -f`, and has no component matching `.env*`, `*.env`, `.npmrc`, `.netrc`, `.pgpass`, `.aws`, `.git`, `*credentials*`, `*.pem`, `*.key`, `*.keystore`, `*.p12`, `*.pfx`, `*.jks`, `*.tfstate`, `*.tfvars`, `id_*`, or `hosts.yml`; otherwise it is neither run nor read and is recorded as unverifiable.

## Completion Criteria

Every `### Autonomous Verification` bullet starts with one tag:

- `[file-state]` — verifiable with Read / Grep / Glob.
- `[orchestrator-only]` — needs host access the reviewer sandbox lacks; the main session runs it and records evidence.
- `[live]` — observed on the real surface with the user's own run method — start command, mode, target URL or PR, network condition, account role — recorded in the task evidence; gating at every complexity, waivable only by explicit user decision (BLOCKED BY USER)
- `[outcome]` — circular by design (a review verdict); never a substitute for acceptance evidence.

A plan that changes user-observable behavior carries at least one `[live]` item. Bullets are numbered in order for `plan-state.ts coverage`: the n-th bullet's required check id is `cc-<n>` with the bullet's tag as its kind; `[outcome]` bullets take a number but need no check.

`### Requires User Confirmation` holds `- None` or items in this exact five-field form, labels in English:

```
- [live] Observe: <what the user will see> / Why not autonomous: <one line> / Needs: <sudo | auth | dialog | role switch | dev server | real PR | device | interactive session> / Your steps: <command, URL, role> / Needed by: <task N | final gate | next real run <trigger>>
```

`Needed by: task N` and `final gate` block completion until the user reports or waives; `next real run <trigger>` defers to an event this session cannot produce. `Your steps` must not inline tokens, passwords, or credentialed URLs — name the credential source instead.

## Tasks and evidence

- The final task subject is `Final Audit + Review`; `plan-state.ts` refuses any other last subject. Claude's `/plan` and Codex's `$plan` both create it.
- Evidence sidecar: `<plan basename>.evidence.json` next to the plan, written only through `plan-state.ts` (`init` / `start` / `require` / `snapshot` / `run` / `rerun` / `record` / `append-evidence` / `coverage` / `complete` / `reconcile`). Check kinds `file-state`, `orchestrator-only`, `live`, `audit`, `review`; statuses `pass`, `fail`, `blocked`, `waived`. The final task needs one `review` check; `audit` is accepted, not required. A `file-state` / `orchestrator-only` check holds one argv, recorded by `run`: an Autonomous Verification bullet is one command, so a criterion that needs two commands is two bullets. A suite-style check (a whole test directory, `nix flake check`) goes on the last implementation task once; `plan-state.ts rerun <evidence>` on the final task skips a check already passing at the current target, so it does not run twice.
- Other sidecars: `<plan>.log.md` (deepening log), `<plan>.gate.log.md` (gate record), `<plan>.gate.diff` and `<plan>.rereview-<n>.gate.diff` (review inputs; the hook matches `.gate.diff`), `<plan>.objects/` (the git objects `run` and `snapshot` write; never inside `.git`).
- Deepening log form, per round: `### Round N`, then one round line — `Round N: critic <min> min, Critical <n> (form <f> / behavior <b> / user <u>)[; adversarial <min> min, Falsified <n>, DQ <n>]; verdicts <critic>[ / <adversarial>]` when an independent reviewer ran (minutes: Claude the Agent completion notification's duration, Codex the wall clock from spawn to result), or `Round N: main review, Critical <n> (form <f> / behavior <b> / user <u>); verdicts <v>` for a Codex main-session review — then `Lint: …`, one line carrying check-plan's warn lines (never table rows), then the table `| # | Finding | Kind | Action |` with one row per critic Critical Issue and one per adversarial Falsified claim (a finding both reported may share one row, Kind from the critic side). Kind values: `form` = a defect of citation, grade, or format; `behavior` = a wrong or missing claim about code or behavior; `user` = needs the user's decision. plan-metrics splits rounds on the `Round N:` lines when a log has them.

## Activation

Approval rests on two things shown before the approval line: what counts as done, and which changes a person still reads in the diff. Claude shows them as `## 完了の条件` and `## レビューしてほしい変更`, Codex's Approval Summary as `**Completion Criteria**` and `**Human Review**`. The criteria, their four labels, and the report lines under `レビューしてほしい N か所` are in `human-review.md` next to this file.

Claude ends `/plan` with:

```
## Plan ready
- File: <plan path>
- Complexity: <trivial/small/medium/large/xl>
- Tasks: <count> (+ Final Audit + Review)
- Status: PENDING APPROVAL — type `/impl` to approve and execute
```

Codex ends `$plan` with an Approval Summary and `PENDING APPROVAL — $impl [plan-path]`. `/impl` resolves the plan from the `File:` line.

## Final report

Claude's `/impl` final report and the standalone `/gate` reply are a short card defined in `impl/SKILL.md`: a result line, then the bold groups `**何が起きたか**`, `**どこまで確かめたか**`, `**触ったファイル**` (a tree) and `**あなたがすること**` with the sub-groups `レビューしてほしい N か所`, `決める N つ` and `確かめてほしい N つ`, one fact per line. Fixed strings: the last line `Sidecar: <path>` (plan-metrics reads it as the end of the report); `レビューしてほしい N か所` for the human-review hunks (line form in `human-review.md`); `仮置き` for an assumption implemented as `user-overridden: default`; `[BLOCKED: gate escalated]` in the result line when the gate escalated. Codex `$impl` writes the same card, with `レビューしてほしい N か所` used the same way.

## Reviewer output

Dispatch prompts carry `do not create, modify, or delete files` and a `Diff file: <path>.gate.diff` line or inline `diff --git` hunks; the hook rejects a dispatch without them. Replies keep these in English:

- Final line `VERDICT: PASS` or `VERDICT: FAIL`, PASS only with no open blocker, `FAIL otherwise`. Codex reviews also carry exactly one `### MUST_FIX` section, `- None` when empty.
- Severity: `MUST_FIX`, `SHOULD_FIX`, `NIT`, `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`. Type: `MISSING`, `EXTRA`, `MISUNDERSTOOD`, `INCOMPLETE`. Category: `READABILITY`, `CONSISTENCY`, `MAINTAINABILITY`, `ROBUSTNESS`, `SIMPLICITY`.
- Sections: `## Summary`, `## Findings`, `### Must Fix`, `### Should Fix`, `### Nits`, `### Issues`, `### Notes`; empty ones say `None` or `(none)`. Fields: `File:Line`, `Type`, `Severity`, `Category`, `Description`, `Suggestion`, `Expected`.

Critic replies end with `### Verdict` holding `ITERATE` or `CONVERGED`; adversarial replies use `#### Falsified (CRITICAL)` / `#### Unverified` / `#### Verified` / `#### Design Questions` with the same verdict values.

## Escalation markers

`[BLOCKED: gate escalated]` appended to the final task when reviews exhaust three rounds; `BLOCKED BY USER` for a waived `[live]` item; `USER CONFIRMATION PENDING` when a `Needed by: final gate` item is unanswered.
