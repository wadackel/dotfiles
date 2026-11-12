---
name: plan
description: Design-first entrypoint for implementation work. Agrees on direction with the user, writes a plan file that /impl executes, and sizes the process to the request (trivial work is done inline without a plan file). Use for "/plan <request>", "計画して", "設計してから実装して", or any implementation request that is not a pure question.
argument-hint: "[feature description]"
disable-model-invocation: true
---

# /plan

Read `references/interview.md` before the first question and `references/contract.md` before writing the plan file: they hold the question format, the ask-or-decide judgment, and every fixed string. This file holds the phases.

## PARSE

Restate the request in one sentence for yourself; it is carried into A1's question, never emitted alone. Estimate complexity with a few Grep/Glob probes and remember what you probed; they size the work, and directions come from SURVEY:

| Level | Signals | Process |
|---|---|---|
| trivial | typo, comment, one config value, one-line edit | no plan file: A1, then implement inline, verify, `/gate --diff-only` |
| small | one addition along an existing pattern, 1–3 files | plan file, one question turn, one self-review |
| medium | multi-file feature on existing conventions | plan file, interview as needed, one self-review |
| large | cross-cutting change, new architectural piece | as medium |
| xl | several subsystems | ask first whether to split into independent projects |

If the request cannot be restated in one sentence, ask a clarifying question in the interview format before anything else.

## SURVEY

Skipped for trivial. Before any question about direction, dispatch one subagent with the brief in `references/survey.md` and wait for its report. Then, before reading further yourself, write down from the report alone what `references/survey.md` asks under **Using the report**: the goal with its source, the criteria and the axis, the directions along it, and where the mechanism could live with the places no direction occupies. Only then read what A1 needs. The report's found items become premise lines marked follow or depart; its searched-but-not-found lines stay facts about the search, never questions to the user.

## AGREE

Agree on purpose and approach before drafting. One question per turn, in the format and with the facts `interview.md` requires; decide for yourself what a CLAUDE.md rule, a decision already made in this conversation, or the code's dominant convention already settles, and record it under `### Assumptions`.

- **A1 Direction check** (one question): the restate plus a direction or behavior question with concrete options and a marked recommendation; a scope candidate the probes found becomes a `user-overridden: default` assumption shown in the handoff marked 仮置き, not the question. Never ask a bare "is this right?" yes/no. Every question that compares designs or behaviors, A1 and the later ones, carries the premise block `interview.md` describes under **Show what the options rest on**. For trivial, this is the only question: it carries the restate, the one-line design, and proceed/adjust. For small and above, skip A1 when the user has stated or chosen the direction (an agent proposal the user has not answered is not settled); an adjacent candidate the probes found then goes into Files to Change when that direction covers it, otherwise under `## NOT Building` in one line, recorded as a `user-overridden: default` assumption under `### Assumptions` and shown in the handoff marked 仮置き.
- **A2 Re-ask** on an empty or ambiguous answer, still one question per turn.
- **A3 List approaches** only when their difference changes the user's outcome or constraints, each with its tradeoff axis in one sentence; routine reversible mechanics are chosen autonomously and listed in one line under `### Alternatives Considered`.
- **A4 Recommend** one, with one or two sentences of reasoning.
- **A5 Approve approach** (one question): go with recommended / pick another / modify. Skip only when A1's answer already chose the approach or A3 made no comparison.
- **A6** Offer `/agent-browser` in a standalone message when upcoming questions are visual.
- **A7 Direction statement** (not a gate): emit `Proceeding with: <one-sentence direction>` and continue; the plan's `## Overview` opens with the same sentence, so it survives compaction.

**Delivery** (decided, not asked). Infer how far `/impl` ships into `## Delivery` (`contract.md`), from these signals, strongest first: a PR or stack already shipped in this conversation; shipping words in the user's answers ("gh-stackを使って", "PRを分割しよう"); shipping words in the request ("PR まで", "mergeまで", "draft で"); a rule in the repository's `AGENTS.md` / `CLAUDE.md`. An issue URL or "対応を進めたい" alone is not a signal. With no signal, `Level: none` and `Basis: no signal`. Two or more PRs make `Level: stack`. `Merge: yes` only on a merge word or a Verification Grant, never from habit, and it raises `Level` to at least `pr`. `Draft: yes` unless the words say otherwise or `Merge: yes`. `Via` is a repository PR skill when one is listed (such as `/wadackel-pr`), else `/create-pr` for `pr` and `/gh-stack` for `stack`; `none` below `pr`.

**Verification Grants** (one question). Verification runs on its own on the local machine and in dev environments: start a server or watcher in the background, drive a TUI in a tmux pane, open pages with `/agent-browser` (signed in through `abr`), write test data in dev, and watch the CI and preview of a PR the Delivery opens. When the change can only be observed outside that (no dev environment and a merge deploys to production, a production-only integration), ask once, before DRAFT, listing each operation in the line form the plan records (`- <operation> / Env: <environment> / Undo: <how to undo>`), and write the granted ones under `## Verification Grants`; `- None` otherwise. Deleting shared resources and anything that notifies people stay outside every grant unless listed by name.

AGREE yields `### Assumptions`, `### Self-resolved`, and `### Unresolved Items` for the plan body (fields in `contract.md`). Each Self-resolved entry ends with `source: [Direct|Supported|Inferred] <probe command + file:lines>`, a `[Direct]` one followed by `→ <output excerpt>`; a claim the Approach relies on is Direct, or Supported only by an observed mechanism whose target does not exist yet or by a delegate observation recorded verbatim with secrets replaced by `<redacted: what it is>`. User-only questions never go to Unresolved Items.

**Trivial path**: after A1, make the change, run the verification you named, run `/gate --diff-only`, and report per `## Final report` in the impl skill. No plan file, no `/impl`.

## EXPLORE

Start from the survey report and what SURVEY read. Find three things: patterns to mirror (`file:lines` and a snippet), the execution path the change flows through (every caller and consumer of the interface), and the existing behavior with the tests that observe it. Read directly for a small surface; dispatch unnamed `Explore` agents only for disjoint regions. For a behavior revision, also observe what actually happens (run the CLI, fire the hook, read effective config). Keep only findings that decide something.

## DRAFT

Write `~/.claude/plans/YYYYMMDDTHHmm-<slug>.md` with the headings the complexity requires (`contract.md`); prose in the user's language, headings and machine lines in English. Tag every Autonomous Verification bullet; a behavior change carries a `[live]` bullet that runs the changed thing where it actually runs (the CLI, the fired hook, a headless `claude -p` for a skill or instruction, the page), because a run outranks tests, types and reading. A change to what a screen renders carries a `[live]` bullet that captures it before and after (`/agent-browser` screenshots at the page's breakpoints, 375px and 1280px when none are defined; `tmux capture-pane` for a TUI) and reads the images. Requires User Confirmation holds only what `contract.md` says only the user holds, in the five-field form; never hand a check to another person, issue, or later plan. Size the plan to what the task needs, without filler sections or restated context.

Run `~/.agents/scripts/check-plan.ts <plan>`; fix every `error`, carry `warn` lines into DEEPEN. Then state the plan path, its headings, and the key design decisions briefly and proceed. Do not ask whether to proceed; drift is DEEPEN's job.

## DEEPEN

Skipped for trivial. Read the plan once as its own reviewer; no subagent is dispatched. Independent plan reviewers cost a wait of several minutes per plan, and a blind replay of the hardest defects they had caught found the same defects in plans written with no reviewer at all; what they still miss surfaces in `/impl`'s checks and in `/gate`. Check, in this order:

- Every claim the Approach relies on carries its `source:`, and its excerpt says what the plan claims.
- Every existing thing the survey found that the change touches or resembles is in the plan with its path, whether the change follows or departs from it, and the reason for a departure; a departure the user has not agreed to is a User decision.
- Every behavior the change alters has an Autonomous Verification bullet that fails without the change, and a `[live]` one when the user can see it.
- Every entry point or caller of a changed behavior is named, and special inputs and states are covered: special names and values, repeats, concurrency, failure and partial failure, waits without an end, a different run environment (launchd, cron, a non-interactive shell, CI).
- No Requires User Confirmation item is something the agent can bring up itself, no check is handed to another person, issue, or later plan, and every operation outside local and dev that a `[live]` bullet needs is under `## Verification Grants`.
- A change to what a screen renders has a `[live]` bullet that captures it before and after and reads the images.
- `## Delivery` rests on the signal its `Basis` quotes, and a stack has one layer per task group.
- No decision only the user can make was settled here: `user-overridden: default` is for scope boundaries only.
- Over-engineering: mark suspects `<!-- over-eng? -->` without deleting.

Fix what you find in the plan with the Edit tool or by rewriting the whole file, never through a script's `String.replace`, whose replacement string expands `$`, and queue a User decision (`interview.md`) for what only the user can settle. Nothing is logged to a file. Then ask the queued items, one per turn per `interview.md`.

## DECOMPOSE

One task is one verifiable unit: target files, expected behavior, and acceptance commands with expected output; red and green steps stay together, and the only standalone verification task is the final one. An Autonomous Verification bullet is one command that `/impl` runs as written, and a count or content condition is written so the command's exit code decides it (`rg` exits 1 on no match; `awk '… END{exit n!=N}'` for a count). A suite-style check (a whole test directory, `nix flake check`) goes on the last implementation task once; the final task re-runs every bullet whose run is stale (`contract.md`). With `Level: stack`, each implementation task opens with `Layer: <branch>`, bottom layer first, and a task stays inside one layer. Register the tasks with the Task tools when available (pass 1 implementation tasks, pass 2 the final task, literally `Final Audit + Review`, with `addBlockedBy`).

## ACTIVATE

Re-run `check-plan.ts`; a plan with any `error` cannot be activated. Read `references/output-examples.md`, then write the handoff.

The reader decides whether to type `/impl`. After one read they can say in their own words what will change and where, which choices were made for them, and what has to hold for the work to count as done.

Open with the direction from `## Overview` in one or two sentences, then show the change in the shape its material has (output style, Shape). Of the design decisions and `### Assumptions`, show the ones the reader could have chosen differently, each next to what it was chosen over, and say in one line how many others the plan file holds. A `user-overridden: default` assumption is shown in that table marked 仮置き. The Delivery is always shown, as a row of that table or in one sentence when there is no table (level, draft, merge, and its basis), marked 仮置き when its basis is `no signal`, with the words that override it after `/impl` (`/impl PR まで`, `/impl stack`, `/impl merge まで`); granted operations are a row of their own. The Task Outline stays in the plan file.

The handoff then closes in this order whatever the plan, because approval rests on it:

1. `## 完了の条件`: every Autonomous Verification bullet except `[outcome]`, then every Requires User Confirmation item, each as its own list item or table row and never merged with another, with `[live]` the only tag shown and those first. The subject of each is the fact to be established, and the command or path closes it in words; never paste the plan's `rg` or command lines. A label line, not a list item, may group them so the ones that carry the weight stand out.
2. `## レビューしてほしい変更`: the `## Files to Change` entries that meet `references/human-review.md`, each with its label and what changes, or `なし`.
3. One sentence, not a question: `上の条件が通れば、diff を読まずに受け入れられる状態です。条件を足すなら直す点を伝えてください。`, prefixed with `レビューしてほしい変更を確かめたうえで、` when that section is not `なし`.
4. The plan path, then the block below.

When the user adds a condition, append it as the last Autonomous Verification bullet, name it in the owning task under `## Task Outline`, re-run `check-plan.ts`, and emit this output again. When the user overrides a 仮置き, update the Assumption, re-run `check-plan.ts`, and emit this output again.

```
## Plan ready
- File: <plan path>
- Complexity: <trivial/small/medium/large/xl>
- Tasks: <count> (+ Final Audit + Review)
- Status: PENDING APPROVAL — type `/impl` to approve and execute
```

Approval is the user typing `/impl`; write no state file.

## Under /autopilot

This section applies only when the prompt is an autopilot unit brief (`~/.claude/skills/autopilot/references/unit-brief.md`), run by the `autopilot-unit` agent, whose definition (`~/.claude/agents/autopilot-unit.md`) holds the park rule and the report form. The user is away; the brief's goal and unit are the direction, and the autopilot advisor approves the plan in the user's place.

- **Of `references/`, read only `contract.md`.** `interview.md` and `output-examples.md` serve questions and the handoff, neither of which happens here.
- **AGREE asks nothing.** A1, A5, and the Verification Grants question are skipped. A question that would go to the user follows the park rule: a parked one stops with `STATUS: PARKED` in the report form; any other is decided by you and written under `### Assumptions` as an ordinary assumption whose `reason:` starts with `autopilot Decision:` and names the alternative it was chosen over. `user-overridden` is not used, since the user chose nothing. This overrides `interview.md`'s rule that design decisions are asked; the autopilot final report is where the user makes them.
- **`## Delivery` and `## Verification Grants`** are the brief's lines, copied as written.
- **DEEPEN** runs as above; a queued User decision follows the park rule instead of being asked.
- **ACTIVATE** writes no handoff and no `## Plan ready` block: once `check-plan.ts` reports no `error`, end with `PLAN <plan path>` and stop until the controller answers.
- **Trivial** writes no plan and needs no approval: make the change, verify it, commit on the worktree's branch, run `/gate --diff-only <start sha>`, then ship it as `/impl`'s Delivery and its `## Under /autopilot` say, and end with the report form.
