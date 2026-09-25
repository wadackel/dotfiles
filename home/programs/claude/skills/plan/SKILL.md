---
name: plan
description: Design-first entrypoint for implementation work. Agrees on direction with the user, writes a plan file that /impl executes, and sizes the process to the request (trivial work is done inline without a plan file). Use for "/plan <request>", "計画して", "設計してから実装して", or any implementation request that is not a pure question.
argument-hint: "[feature description] [--max-rounds=N]"
disable-model-invocation: true
---

# /plan

Read `references/interview.md` before the first question and `references/contract.md` before writing the plan file: they hold the question format, the ask-or-decide judgment, and every fixed string. This file holds the phases.

## PARSE

Strip a `--max-rounds=N` token (DEEPEN cap). Restate the request in one sentence for yourself; it is carried into A1's question, never emitted alone. Estimate complexity with a few Grep/Glob probes and remember what you probed:

| Level | Signals | Process |
|---|---|---|
| trivial | typo, comment, one config value, one-line edit | no plan file: A1, then implement inline, verify, `/gate --diff-only` |
| small | one addition along an existing pattern, 1–3 files | plan file, one question, one critic round |
| medium | multi-file feature on existing conventions | plan file, interview as needed, critic + adversarial |
| large | cross-cutting change, new architectural piece | as medium, up to five critic rounds |
| xl | several subsystems | ask first whether to split into independent projects |

If the request cannot be restated in one sentence, ask a clarifying question in the interview format before anything else.

## AGREE

Agree on purpose and approach before drafting. One question per turn, in the format from `interview.md`; decide for yourself what a CLAUDE.md rule, a decision already made in this conversation, or the code's dominant convention already settles, and record it under `### Assumptions`.

- **A1 Direction check** (one question): the restate plus a scope or boundary question with concrete options and a marked recommendation. Never ask a bare "is this right?" yes/no. For trivial, this is the only question: it carries the restate, the one-line design, and proceed/adjust. For small and above, skip A1 when the user has stated or chosen the direction (an agent proposal the user has not answered is not settled); an adjacent candidate the probes found then goes into Files to Change when that direction covers it, otherwise under `## NOT Building` in one line. When A1 is asked, a found candidate is the scope option.
- **A2 Re-ask** on an empty or ambiguous answer, still one question per message.
- **A3 List approaches** only when their difference changes the user's outcome or constraints, each with its tradeoff axis in one sentence; routine reversible mechanics are chosen autonomously and listed in one line under `### Alternatives Considered`.
- **A4 Recommend** one, with one or two sentences of reasoning.
- **A5 Approve approach** (one question): go with recommended / pick another / modify. Skip only when A1's answer already chose the approach or A3 made no comparison.
- **A6** Offer `/agent-browser` in a standalone message when upcoming questions are visual.
- **A7 Direction statement** (not a gate): emit `Proceeding with: <one-sentence direction>` and continue; the plan's `## Overview` opens with the same sentence, so it survives compaction.

AGREE yields `### Assumptions`, `### Self-resolved`, and `### Unresolved Items` for the plan body (fields in `contract.md`). Each Self-resolved entry ends with `source: [Direct|Supported|Inferred] <probe command + file:lines>`; a claim the Approach relies on is Direct, or Supported only by an observed mechanism whose target does not exist yet or by a delegate observation recorded verbatim with secrets replaced by `<redacted: what it is>`. User-only questions never go to Unresolved Items.

**Trivial path**: after A1, make the change, run the verification you named, run `/gate --diff-only`, and report in the impl skill's final-report shape. No plan file, no sidecar, no `/impl`.

## EXPLORE

Find three things: patterns to mirror (`file:lines` and a snippet), the execution path the change flows through (every caller and consumer of the interface), and the existing behavior with the tests that observe it. Read directly for a small surface; dispatch unnamed `Explore` agents only for disjoint regions. For a behavior revision, also observe what actually happens (run the CLI, fire the hook, read effective config). Keep only findings that decide something.

## DRAFT

Write `~/.claude/plans/YYYYMMDDTHHmm-<slug>.md` with the headings the complexity requires (`contract.md`); prose in the user's language, headings and machine lines in English. Tag every Autonomous Verification bullet; a user-observable behavior change carries a `[live]` bullet, and one the agent cannot run goes under Requires User Confirmation in the five-field form. Size the plan to what the task needs, without filler sections or restated context.

Run `~/.agents/scripts/check-plan.ts <plan>`; fix every `error`, carry `warn` lines into DEEPEN. Then state the plan path, its headings, and the key design decisions briefly and proceed. Do not ask whether to proceed; drift is DEEPEN's job.

## DEEPEN

Skipped for trivial. Dispatch the critic (`Agent({subagent_type: "Plan", model: "opus"})` with `references/critic-prompt.md`) and, for medium and above unless the plan is doc-only, the adversarial agent (`subagent_type: "Explore"`, `references/adversarial-prompt.md`) in one message, both unnamed. Rounds: one by default, `--max-rounds=N` up to five; a Round 1 `ITERATE` caused by a Dimension 7 veto or a restructuring fix earns one more round. Log each round to `<plan>.log.md`.

Triage every finding, including those attached to `CONVERGED`: apply it inline with a `-- Why:` note, queue a User decision (`interview.md`) for the user, or reject it against a prior user decision. Read the plan once for over-engineering and mark suspects `<!-- over-eng? -->` without deleting. Then ask the queued items one per turn per `interview.md`.

## DECOMPOSE

One task is one verifiable unit: target files, expected behavior, and acceptance commands with expected output; red and green steps stay together, and the only standalone verification task is the final one. Register the tasks with the Task tools when available (pass 1 implementation tasks, pass 2 the final task with `addBlockedBy`); the evidence sidecar is the record either way. Then initialize the evidence sidecar, subjects in task order and the last one literally `Final Audit + Review`:

```
~/.agents/scripts/plan-state.ts init ~/.claude/plans/<basename>.evidence.json <basename>.md '["<task 1>", …, "Final Audit + Review"]'
```

## ACTIVATE

Re-run `check-plan.ts`; a plan with any `error` cannot be activated. Emit the design decisions and the `### Assumptions` as one line each, the plan path, then the block below. Do not repeat Files to Change, the Task Outline, or the rest of the plan body.

```
## Plan ready
- File: <plan path>
- Complexity: <trivial/small/medium/large/xl>
- Tasks: <count> (+ Final Audit + Review)
- Status: PENDING APPROVAL — type `/impl` to approve and execute
```

Approval is the user typing `/impl`; write no state file.
