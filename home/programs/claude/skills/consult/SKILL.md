---
name: consult
description: >-
  Fact-grounded consultation and evaluation: weighing options, judging whether
  a design or decision is sound (against prior art too), evaluating a run,
  re-examining a problem. States several readings of the request, re-checks
  memory and prior decisions as hypotheses, runs or measures what can be
  observed, searches broadly, and tries to falsify its own recommendation.
  Use when the user asks to think broadly, question premises, avoid guesses,
  or investigate thoroughly. Not for specs (requirements-interview), bugs with
  a known symptom (systematic-debugging), decided changes (/plan), or one-line
  answers. Manual trigger: /consult.
  徹底的に、幅広く検討、前提を疑って、推測を混ぜず、課題を再評価、本当に必要か、設計の良し悪し、の時に使用。
argument-hint: "[question or situation to consult on]"
---

# Consult

Answer a consultation from observed facts. The failures this skill exists to prevent are concrete: answering within the frame of a prior decision without re-checking it, answering from reading when a measurement was cheap, and taking the first reading of the request as the only one. Each one cost the user a turn of saying "徹底的に", "推測を混ぜず", or "幅広く" again.

## Steps

Work through the steps in order. Track them in the task list when the Task tools exist; a step that does not apply stays in the list with a one-line reason, so a skipped step is visible rather than silent.

1. **Goal and readings.** Write the goal behind the request in one sentence, then two or three readings of what the user wants back (a judgment, an explanation, options, a direction, a re-framing of the problem). Investigate under the broadest reading that still serves the goal, and say the readings in the first reply instead of waiting for a confirmation: the user can redirect, and a wrong narrow reading caught on the first turn is cheaper than one caught on the third.
2. **Premises as hypotheses.** List the premises the question leans on, with where each comes from: memory, a vault note, a decision earlier in this or a past conversation, a hypothesis embedded in the request ("たぶん X のせいだと思う"), the docs of the code at hand, and an explanation an agent wrote in a transcript, report, or summary being evaluated ("X failed because of Y"). Each is a claim to re-check against the current state, not a constraint on the answer, because records go stale and an embedded hypothesis is a candidate, not a conclusion. When the user says to set prior decisions aside, drop them from the frame entirely and mention only where the evidence contradicts them.
3. **Claim ledger.** Write down the claims the answer will rest on. For each, decide whether it can be observed, and observe the ones that can (see Running to know). A claim that cannot be observed in this session stays Inferred or Unknown (see Evidence words) and carries what was tried.
4. **Breadth.** Look in each kind of place below that could hold the answer, and record a search that came back empty as a finding in one line, since "looked and found nothing" tells the user where the answer is not. A place that cannot hold the answer for this question (the vault for a self-contained log, prior art for a question this repository's records settle) is skipped, and the reply says so in one line with the reason; "looked and found nothing" and "did not look, because" are different findings and are written differently. The named skills are the usual route to each place; a direct search of the same place (`rg` over the vault or the transcripts) counts as looking there.
   - the code and its git history, and running it;
   - the user's own history: session transcripts under `~/.claude/projects/`, daily notes, the **ctx-agent-history-search** skill;
   - the vault through `/llm-wiki query`, as one source among the others;
   - prior art outside: `/repo-dive` for repositories, `anthropic-skills:deep-research` for the web.
5. **Falsify the recommendation.** Before answering, name the fact that would reverse the recommendation and check it when it is cheap; if no criticism of the recommendation turns up, the search was too narrow. Dispatch an independent view (a subagent, or `/codex-cli`) when the recommendation rests on judgment that no measurement in the ledger settled, such as a design or a direction; skip it when the deciding facts were observed directly. Give it the materials and the question but not your conclusion, because a reviewer handed a hypothesis tends to return it confirmed.
6. **Reply.** Answer first, then the evidence, then what is still unknown, then what the user decides (see Reply).

The consultation can span turns. Keep the ledger current as the user adds facts or redirects, and run step 5 again when the recommendation changes.

## Running to know

When a claim can be settled by running something, run it instead of reasoning about it or asking: time the script, count the transcripts, parse the log, render the two layouts with `/agent-browser`, replay the prompt with `claude -p`. A guess from reading code is not a measurement of what the code does.

Keep experiments inside the machine and reversible without asking: read-only commands, runs of the code as it is, and throwaway files, prototypes, and copies of fixtures under the session scratchpad. Editing the repository's files, changing configuration, installing packages, and anything that writes or sends outside the machine are not part of a consultation; when settling a claim needs one, put it to the user as a decision with what it would show.

When an experiment fails or passes too easily, suspect the observation before the system: check that the command measured what the claim is about.

## Evidence words

Every claim in the reply sits in one grade, named as in `~/.claude/skills/plan/references/contract.md` (Grades):

- **Direct**: run or read in this session. Say what was run or read.
- **Supported**: one step of inference from something read, or a subagent's report not re-read. Name the source and the step.
- **Inferred**: a reading of the context that nothing confirms. Write it in Japanese as `推測` with the chain that led to it.
- **Unknown**: looked and could not tell. Say where you looked.

An agent's narration inside a transcript or report records what that agent believed at the time, not what happened: when evaluating a session, a cause it states is a claim to check against the raw record (tool inputs and their flags, exit codes, logs, crash reports), and repeating it as the cause without that check is Inferred at best.

Write the grade as words in the sentence, not as tags, and keep "because" and "the cause is" for Direct and Supported claims. A missing search result is not evidence of absence. When two sources disagree, show both instead of choosing the tidier one.

## Reply

Open with the answer or the judgment. Then, in this order:

1. The evidence the answer rests on, each item with how it was observed.
2. `わかっていないこと`: what could not be settled, with what was tried and what would settle it. If nothing is unknown, say why the evidence was complete; an empty list with no reason usually means something was skipped.
3. `決めてほしいこと`: only the calls that are the user's (preference, priority, risk, product direction), each with a recommendation. A fact that could be observed is not put to the user.

In the first reply of a consultation, the readings from step 1 take one or two lines right after the answer. The output style governs length and shape; this order is what this skill adds.

## When not to use it

- A request to turn intent into a spec, issue, or PRD: **requirements-interview**.
- A symptom whose cause is unknown, such as a failing test or an error: **systematic-debugging**.
- A change whose direction is decided: `/plan`.
- A question with a single short answer, such as a value in a config file or the time.
