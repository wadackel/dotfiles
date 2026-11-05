---
name: plan
description: Design-first entrypoint for implementation work. Agrees on direction with the user, writes a plan file that /impl executes, and sizes the process to the request (trivial work is done inline without a plan file). Use for "/plan <request>", "計画して", "設計してから実装して", or any implementation request that is not a pure question.
argument-hint: "[feature description]"
disable-model-invocation: true
---

# /plan

Read `references/interview.md` before the first question and `references/contract.md` before writing the plan file: they hold the question format, the ask-or-decide judgment, and every fixed string. This file holds the phases.

## PARSE

Restate the request in one sentence for yourself; it is carried into A1's question, never emitted alone. Estimate complexity with a few Grep/Glob probes and remember what you probed:

| Level | Signals | Process |
|---|---|---|
| trivial | typo, comment, one config value, one-line edit | no plan file: A1, then implement inline, verify, `/gate --diff-only` |
| small | one addition along an existing pattern, 1–3 files | plan file, one question turn, one self-review |
| medium | multi-file feature on existing conventions | plan file, interview as needed, one self-review |
| large | cross-cutting change, new architectural piece | as medium |
| xl | several subsystems | ask first whether to split into independent projects |

If the request cannot be restated in one sentence, ask a clarifying question in the interview format before anything else.

## AGREE

Agree on purpose and approach before drafting. One turn per dependency level, in the format from `interview.md`; decide for yourself what a CLAUDE.md rule, a decision already made in this conversation, or the code's dominant convention already settles, and record it under `### Assumptions`.

- **A1 Direction check** (one question): the restate plus a direction or behavior question with concrete options and a marked recommendation; a scope candidate the probes found becomes a `user-overridden: default` assumption shown in the handoff marked 仮置き, not the question. Never ask a bare "is this right?" yes/no. For trivial, this is the only question: it carries the restate, the one-line design, and proceed/adjust. For small and above, skip A1 when the user has stated or chosen the direction (an agent proposal the user has not answered is not settled); an adjacent candidate the probes found then goes into Files to Change when that direction covers it, otherwise under `## NOT Building` in one line, recorded as a `user-overridden: default` assumption under `### Assumptions` and shown in the handoff marked 仮置き.
- **A2 Re-ask** on an empty or ambiguous answer, still one turn per dependency level.
- **A3 List approaches** only when their difference changes the user's outcome or constraints, each with its tradeoff axis in one sentence; routine reversible mechanics are chosen autonomously and listed in one line under `### Alternatives Considered`.
- **A4 Recommend** one, with one or two sentences of reasoning.
- **A5 Approve approach** (one question): go with recommended / pick another / modify. Skip only when A1's answer already chose the approach or A3 made no comparison.
- **A6** Offer `/agent-browser` in a standalone message when upcoming questions are visual.
- **A7 Direction statement** (not a gate): emit `Proceeding with: <one-sentence direction>` and continue; the plan's `## Overview` opens with the same sentence, so it survives compaction.

AGREE yields `### Assumptions`, `### Self-resolved`, and `### Unresolved Items` for the plan body (fields in `contract.md`). Each Self-resolved entry ends with `source: [Direct|Supported|Inferred] <probe command + file:lines>`, a `[Direct]` one followed by `→ <output excerpt>`; a claim the Approach relies on is Direct, or Supported only by an observed mechanism whose target does not exist yet or by a delegate observation recorded verbatim with secrets replaced by `<redacted: what it is>`. User-only questions never go to Unresolved Items.

**Trivial path**: after A1, make the change, run the verification you named, run `/gate --diff-only`, and report per `## Final report` in the impl skill. No plan file, no `/impl`.

## EXPLORE

Find three things: patterns to mirror (`file:lines` and a snippet), the execution path the change flows through (every caller and consumer of the interface), and the existing behavior with the tests that observe it. Read directly for a small surface; dispatch unnamed `Explore` agents only for disjoint regions. For a behavior revision, also observe what actually happens (run the CLI, fire the hook, read effective config). Keep only findings that decide something.

## DRAFT

Write `~/.claude/plans/YYYYMMDDTHHmm-<slug>.md` with the headings the complexity requires (`contract.md`); prose in the user's language, headings and machine lines in English. Tag every Autonomous Verification bullet; a user-observable behavior change carries a `[live]` bullet, and one the agent cannot run goes under Requires User Confirmation in the five-field form. Size the plan to what the task needs, without filler sections or restated context.

Run `~/.agents/scripts/check-plan.ts <plan>`; fix every `error`, carry `warn` lines into DEEPEN. Then state the plan path, its headings, and the key design decisions briefly and proceed. Do not ask whether to proceed; drift is DEEPEN's job.

## DEEPEN

Skipped for trivial. Read the plan once as its own reviewer; no subagent is dispatched. Independent plan reviewers cost a wait of several minutes per plan, and a blind replay of the hardest defects they had caught found the same defects in plans written with no reviewer at all; what they still miss surfaces in `/impl`'s checks and in `/gate`. Check, in this order:

- Every claim the Approach relies on carries its `source:`, and its excerpt says what the plan claims.
- Every behavior the change alters has an Autonomous Verification bullet that fails without the change, and a `[live]` one when the user can see it.
- Every entry point or caller of a changed behavior is named, and special inputs and states are covered: special names and values, repeats, concurrency, failure and partial failure, waits without an end, a different run environment (launchd, cron, a non-interactive shell, CI).
- No decision only the user can make was settled here: `user-overridden: default` is for scope boundaries only.
- Over-engineering: mark suspects `<!-- over-eng? -->` without deleting.

Fix what you find in the plan with the Edit tool or by rewriting the whole file, never through a script's `String.replace`, whose replacement string expands `$`, and queue a User decision (`interview.md`) for what only the user can settle. Nothing is logged to a file. Then ask the queued items, one turn per dependency level per `interview.md`.

## DECOMPOSE

One task is one verifiable unit: target files, expected behavior, and acceptance commands with expected output; red and green steps stay together, and the only standalone verification task is the final one. An Autonomous Verification bullet is one command that `/impl` runs as written, and a count or content condition is written so the command's exit code decides it (`rg` exits 1 on no match; `awk '… END{exit n!=N}'` for a count). A suite-style check (a whole test directory, `nix flake check`) goes on the last implementation task once; the final task runs every bullet again. Register the tasks with the Task tools when available (pass 1 implementation tasks, pass 2 the final task, literally `Final Audit + Review`, with `addBlockedBy`).

## ACTIVATE

Re-run `check-plan.ts`; a plan with any `error` cannot be activated. Read `references/output-examples.md`, then write the handoff.

The reader decides whether to type `/impl`. After one read they can say in their own words what will change and where, which choices were made for them, and what has to hold for the work to count as done.

Open with the direction from `## Overview` in one or two sentences, then show the change in the shape its material has (output style, Shape). Of the design decisions and `### Assumptions`, show the ones the reader could have chosen differently, each next to what it was chosen over, and say in one line how many others the plan file holds. A `user-overridden: default` assumption is shown in that table marked 仮置き. The Task Outline stays in the plan file.

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
