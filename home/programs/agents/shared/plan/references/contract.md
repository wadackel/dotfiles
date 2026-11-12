# Contract

The fixed strings that the plan and impl skills (Claude), `$plan` / `$impl` (Codex), `check-plan.ts`, `reviewer-dispatch-policy.ts`, and the reviewer prompts read or write. `check-plan.ts` mirrors the headings, the Requires User Confirmation vocabulary, and the Delivery vocabulary; `codex-plan-clarification-contract_test.ts` pins each entry against the files that carry it. Question judgment is in `interview.md`.

## Plan file

Path: `~/.claude/plans/YYYYMMDDTHHmm-<slug>.md` (Claude) or `~/.codex/plans/…` (Codex); slug ≤ 40 chars, lowercase kebab. Headings are English literals; prose is the user's language.

| Heading | trivial | small | medium+ |
|---|---|---|---|
| `## Context` | ✓ | ✓ | ✓ |
| `## Overview` | | ✓ | ✓ |
| `## Approach` (with `### Alternatives Considered`) | | ✓ | ✓ |
| `## NOT Building` | | ✓ | ✓ |
| `## Delivery` | ✓ | ✓ | ✓ |
| `## Verification Grants` | | ✓ | ✓ |
| `## Mandatory Reading` | | | ✓ |
| `## Patterns to Mirror` | | | ✓ |
| `## Intentional Conventions` | | | ✓ |
| `## Files to Change` | ✓ | ✓ | ✓ |
| `## Task Outline` | ✓ | ✓ | ✓ |
| `## Test Strategy` | | ✓ | ✓ |
| `## Completion Criteria` with `### Autonomous Verification`, `### Requires User Confirmation`, `### Baseline` | ✓ | ✓ | ✓ |
| `## Risks + Open Questions` | | ✓ | ✓ |

`check-plan.ts` requires Context, Files to Change, Task Outline, and Completion Criteria, and `## Delivery` for a plan under `~/.claude/plans/` or `~/.codex/plans/`; the trivial column applies when a trivial plan is written anyway.

## Delivery

How far `/impl` or `$impl` ships the change after its review passes. Five lines, in this order:

```
- Level: <none | commit | push | pr | stack>
- Draft: <yes | no>
- Merge: <yes | no>
- Via: <the skill that ships it, or none>
- Basis: <the words or rule the level rests on, quoted, or no signal>
```

`none` leaves the change uncommitted; `commit` commits on the current branch; `push` also pushes it, for a repository whose rule is to commit on the default branch; `pr` opens one PR; `stack` opens a gh-stack stack, one layer per task group. `Draft` and `Merge` matter only for `pr` and `stack`; `Draft: yes` keeps the PRs drafts after CI passes; `check-plan.ts` refuses `Merge: yes` below `pr` or with `Draft: yes` (`delivery-merge`) and a line given twice. The handoff shows the Delivery, marked 仮置き when `Basis` is `no signal`.

## Verification Grants

Operations outside the local machine and dev environments that verification needs (a merge that deploys to production, observing or writing test data in production), granted by the user in AGREE before the plan is written. `- None`, or one line each, the same lines the AGREE question listed:

```
- <operation> / Env: <environment> / Undo: <how to undo, or none needed>
```

`/impl` and `$impl` perform a listed operation without asking again; one that is not listed stops the run as a deviation.

## AGREE subsections

Written immediately before `## Overview`. The critic parses them by structure.

- `### Assumptions` — `observation` / `value` / `reason`, plus `user-overridden: true` when the user chose the value, or `user-overridden: default` when the plan adopted the recommendation for a scope boundary as a provisional default (shown in the handoff and the final report as 仮置き). A `user-overridden: default` entry also carries `scope: <the boundary: what is in or out>`; `check-plan.ts` refuses one without it (`assumption-scope`), because a behavior or design value is asked, never provisional.
- `### Self-resolved` — entries with `observation` / `value` and a closing line `source: [Direct|Supported|Inferred] <probe command + file:lines>`, a `[Direct]` one followed by `→ <output excerpt>` (the lines the claim rests on), e.g. `source: [Direct] sed -n '12,14p' src/app.ts → 12:const limit = 5` or `source: [Supported] adversarial agent report, round 1`. `[Unknown]` never appears here. A claim the Approach relies on is `[Direct]`, or `[Supported]` only by an observed mechanism whose target does not exist yet or by a delegate observation recorded verbatim with secrets, tokens, credentialed URLs, and personal data replaced by `<redacted: what it is>`.
- `### Unresolved Items` — `item` / `reason` / `next`; `(none)` when empty. User-only questions never go here.

Grades: `[Direct]` you ran the command or read the lines this session (name it); `[Supported]` one inference step from something you read, or a report not re-read (name it); `[Inferred]` a guess, say "likely"; `[Unknown]` you looked and could not tell (say what you tried; it goes under Unresolved Items).

A reviewer re-runs a quoted probe only when it is exactly one of `sed -n '<N>,<M>p' <path>`, `rg [-n|-c|-i|-A k|-B k|-C k|--glob '<g>'] '<pattern>' <path>`, or `readlink [-f] <path>` on one line with no `|` `;` `&` `>` `<` `$` or backtick and no other option (no `--pre`, `-z`, `-P`, `-f` for `rg`; `sed` is an address plus `p` only, never `-i` `-e` `-f` `-E`), where `<path>` is the file the entry cites. Every cited path is relative, under the repository root (no `~/`, absolute path, or `..`), resolves under the root via `readlink -f`, and has no component matching `.env*`, `*.env`, `.npmrc`, `.netrc`, `.pgpass`, `.aws`, `.git`, `*credentials*`, `*.pem`, `*.key`, `*.keystore`, `*.p12`, `*.pfx`, `*.jks`, `*.tfstate`, `*.tfvars`, `id_*`, or `hosts.yml`; otherwise it is neither run nor read and is recorded as unverifiable.

## Completion Criteria

Every `### Autonomous Verification` bullet starts with one tag:

- `[file-state]` — verifiable with Read / Grep / Glob.
- `[orchestrator-only]` — needs host access the reviewer sandbox lacks; the main session runs it and keeps its output in the conversation.
- `[live]` — observed on the real surface with the user's own run method — start command, mode, target URL or PR, network condition, account role — reported in the conversation with that run method; gating at every complexity, waivable only by explicit user decision (BLOCKED BY USER)
- `[outcome]` — circular by design (a review verdict); never a substitute for acceptance evidence.

A plan that changes user-observable behavior carries at least one `[live]` item. Both plan skills write each bullet as the state to establish, not the command that observes it; a `[live]` bullet adds, on its next line indented without a list marker, a `観測:` line naming the surface and the means, and the impl skills say in the report when they used a different means.

`### Requires User Confirmation` holds `- None` or items in this exact five-field form, labels in English:

```
- [live] Observe: <what the user will see> / Why not autonomous: <one line> / Needs: <sudo | auth | dialog | role switch | real PR | device> / Your steps: <command, URL, role> / Needed by: <task N | final gate | next real run <trigger>>
```

An item is for what only the user holds: a sudo password, their own second factor, an OS dialog, a device, a role the agent's account lacks, a PR the plan's Delivery does not open, or an event after a merge or deploy that no Verification Grant covers. A local server or watcher, a TUI in a tmux pane read with `capture-pane`, and a browser session signed in through `abr` are brought up by the agent and are never an item.

`Needed by: task N` and `final gate` block completion until the user reports or waives; `next real run <trigger>` defers to an event this session cannot produce. `Your steps` must not inline tokens, passwords, or credentialed URLs — name the credential source instead.

## Tasks and checks

- The final task subject is `Final Audit + Review`. Claude's `/plan` and Codex's `$plan` both create it.
- `/impl` and `$impl` choose how to observe each criterion's state, observe again a criterion a later edit could have changed, and run a suite-style check (a whole test directory, `nix flake check`) once on the final tree. No record file is written; output stays in the conversation.
- Claude's `/impl` and Codex's `$impl` set the ref `refs/impl-base/<plan basename>` at their start; review diffs from it, and Claude's `/impl` review (when it passes) or Codex's `$impl` (at Finish) deletes it. The review's working files sit in the session scratchpad: `<slug>.gate.diff`, `<slug>.rereview-<n>.gate.diff` and `<slug>.final.gate.diff` (review inputs and the final diff `human-review.md` is applied to; the hook matches `.gate.diff`), and, removed when the review ends, `<slug>.index` (the index copy a snapshot uses) and `<slug>.breaker` / `<slug>.before` (the breaker's worktrees).

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

The final report of `/impl` (and its reply under `--review`) and of `$impl` is defined in each impl skill with the same headings and order. Fixed strings: `レビューしてほしい N か所` for the human-review hunks (line form in `human-review.md`); `仮置き` for an assumption implemented as `user-overridden: default`; `[BLOCKED: gate escalated]` when Claude's review escalated.

## Reviewer output

Dispatch prompts carry `do not create, modify, or delete files` and a `Diff file: <path>.gate.diff` line or inline `diff --git` hunks; the hook rejects a dispatch without them. Claude's `breaker-reviewer` runs commands, so its prompt carries `write only inside the breaker worktree and your temp directory` in place of the read-only sentence. Replies keep these in English:

- Final line `VERDICT: PASS` or `VERDICT: FAIL`, PASS only with no open blocker, `FAIL otherwise`. Codex reviews also carry exactly one `### MUST_FIX` section, `- None` when empty.
- Severity: `MUST_FIX`, `SHOULD_FIX`, `NIT`, `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`. Type: `MISSING`, `EXTRA`, `MISUNDERSTOOD`, `INCOMPLETE`. Category: `READABILITY`, `CONSISTENCY`, `MAINTAINABILITY`, `ROBUSTNESS`, `SIMPLICITY`.
- Sections: `## Summary`, `## Findings`, `### Must Fix`, `### Should Fix`, `### Nits`, `### Issues`, `### Notes`; empty ones say `None` or `(none)`. Fields: `File:Line`, `Type`, `Severity`, `Category`, `Description`, `Suggestion`, `Expected`.

Critic replies end with `### Verdict` holding `ITERATE` or `CONVERGED`; adversarial replies use `#### Falsified (CRITICAL)` / `#### Unverified` / `#### Verified` / `#### Design Questions` with the same verdict values.

## Escalation markers

`[BLOCKED: gate escalated]` in the report's opening when a blocker is still open at the end (Claude's `/impl` review: after the first wave, one re-review, and one closing pass in which the main session escalates a spec Issue, hands a security or human-review boundary blocker to the reader, closes another that a run failing before the fix and passing after it shows fixed, and escalates the rest; Codex `$impl`: as its skill says); `BLOCKED BY USER` for a waived `[live]` item; `USER CONFIRMATION PENDING` when a `Needed by: final gate` item is unanswered.
