---
name: skill-design
description: Guidance for writing, editing, or reviewing a Claude Code or Codex skill (SKILL.md, its description, references, and scripts). Use when creating, changing, or evaluating a skill.
---

# Skill Design

How skills are written in this repository. Claude Code and Codex read the same `SKILL.md` for a shared skill; where each kind lives is in `AGENTS.md` under "Skills layout". This guidance takes precedence over generic skill-authoring advice loaded next to it, such as skill-creator's advice to make descriptions "pushy", because that advice lost when it was measured here (see the description lesson below).

## What the platform does

Checked on 2026-11-18 against https://code.claude.com/docs/en/skills, https://developers.openai.com/codex/skills and https://agentskills.io/specification. These numbers change between releases. When you create or restructure a skill and this date is more than two months old, or a release note mentions skills, fetch the pages, update this section and its date, and only then rely on it.

| Part | In context | Limit |
|---|---|---|
| `name` + `description` (+ `when_to_use`) | Every session, for every skill the model may invoke, before any is chosen | Claude Code: all entries share 1% of the context window (`skillListingBudgetFraction`, which this repository's `settings.json` raises), each entry is cut at 1,536 characters, and on overflow the least-invoked skills lose their descriptions first. Codex: 2% of the window, shortening descriptions first. The open spec caps `description` at 1,024 characters |
| `SKILL.md` body | From invocation to the end of the session | Under 500 lines. After compaction Claude Code re-attaches the first 5,000 tokens of each invoked skill, 25,000 in total, most recent first, so what must survive goes near the top |
| `references/`, `scripts/`, `assets/` | Only when read or run | None until used |

| Who starts it | Frontmatter | The description is |
|---|---|---|
| The user only: side effects, cost, or a timing the user picks | `disable-model-invocation: true`; for Codex also `policy.allow_implicit_invocation: false` in `agents/openai.yaml` | Not in the model's context; one short line for the `/` menu |
| The model only: background knowledge | `user-invocable: false` | Routing text |
| Both (default) | none | Routing text |

- `paths` hides a skill from the listing until a file matching its globs is read, then lists it; it does not load the body (observed 2026-11-18). The other Claude Code fields (`allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `hooks`, `arguments`) are on the docs page; read it before using one.
- `name` is lowercase letters, digits, and single hyphens, up to 64 characters, and matches the directory; every `/name` in `CLAUDE.md` or another skill uses the same spelling. Frontmatter that does not parse still loads the skill, with an empty description, so `claude plugin validate <dir>` after editing it is cheap insurance.
- Codex reads only `name` and `description`, and `when_to_use` counts toward Claude Code's per-entry cap, so everything goes in `description`. Write `[arg]`, not `<arg>`: Claude Code shows angle brackets as `&lt;` and `&gt;`. Add `argument-hint` to any skill that takes arguments, so the `/` menu shows what to type. A skill's text goes through Claude Code's substitutions when it loads, so do not quote the arguments placeholder or the shell-command syntax literally in prose: the placeholder renders empty, and the shell form runs (or, without Bash permission, blocks the skill from loading).
- `/skill-doctor` shows which skills go unused and what they cost in context; `/doctor prompt-audit` flags instructions written for older models.

## What has worked here

**Start from material, not from what the model already knows.** A skill earns its place with what the model would not do unaided: the user's decisions, this repository's conventions, sequences where only one order is safe, failures already seen. Before writing a new skill or restructuring one, gather that material: how the task went when it was done without the skill (past transcripts, memory, the Obsidian vault), how public skill collections handle the same job, and the domain's own sources. Skills written from general knowledge measured no better than none (SkillsBench, -1.3pp), and ui-design's first run, which named its references from memory, came out further from the real thing than a session without the skill that searched four times first. Not everything needs a skill: a one-line rule belongs in `CLAUDE.md` or `AGENTS.md`, a check that must hold every time in a hook or script, and a fix to an existing skill beats a new one.

**Write principles with their reasons, and fix a procedure only where one order is safe.** Current models follow a skill literally, so whatever it fixes is applied where it does not fit. ui-design's board and six fixed stages flattened its mockups until the skill was rewritten as lessons; consult's fixed steps and reply form read as formal, and the user stopped using it. State the outcome, the constraints, and how to check the result, each with its reason, and leave the plan to the model: a rule that carries its reason extends to cases it did not list, while capitals (MUST, NEVER) make it spill into neighboring ones. Numbered steps and exact commands belong to destructive operations, auth flows, and strings a script parses.

**Choose the form by how the behavior fails.** What must hold every time does not belong in prose: written prohibitions did not keep exploratory-testing's sessions inside their sandbox, and a wrapper script and a hook did. Put such a rule in a script the skill runs, or in a hook (the skill's `hooks` frontmatter or `settings.json`). When the output comes out in the wrong shape, show the shape with several examples that differ, labeled illustrative, rather than forbidding the wrong one: in superpowers' tests a prohibition invited negotiation and did worse than no guidance, and a single example gets copied in length and tone. When the model skips a judgment, give the judgment its reason before reaching for louder words.

**Use the user's examples for their purpose.** Cases the user lists while describing a skill illustrate what they want; turning them into the skill's sections made dialogue chase the examples instead of the goal. Write down what the examples share.

**Keep the description to what routing needs: one or two sentences, most under 250 characters.** It is the most expensive text per character, because every session pays for it whether or not the skill runs. Say what the skill does and when to use it, in the third person, front-loading the task and the nouns users and files bring with them (`SKILL.md`, `terraform plan`, a PR). Leave out what the body covers ("covering A, B, and C") and the workflow: the body says what it covers once it is loaded, and a model that reads a summary of the workflow follows the summary instead of opening the body. The model matches intent, paraphrase and other languages included, so trigger-phrase lists and their translations only cost characters, while removing one domain noun dropped a measured query from 4/5 fires to 1/5. Add an exclusion only after a measured false trigger; none appeared here with or without one. The body loads only after the description matched, so every situation the body handles must fall within the description's intent.

**Make the skill reach the moment it is for.** A reminder to invoke a skill, written inside that skill, is read only once the skill is already loaded; put it where it is seen first, or better, tie the skill to an event. Editing an existing skill rarely routed here by description alone, because the model reads the file before it chooses a skill, which is why this repository's `write-policy.ts` hook adds the core of this guidance on the first `SKILL.md` edit of a session. When moving content out of `CLAUDE.md` into a skill, leave the one-line rules in `CLAUDE.md` and move only the detail.

**Write instructions that agree with their surroundings.** A skill runs next to `CLAUDE.md`, the output style, and other skills. Of 196 corrections traced to the instructions in force at the time, 29 came from a line asking for the opposite of what another instruction or the user wanted, such as bundling questions against the output style's one decision per reply. Before adding a rule, look for one it contradicts in the instructions it runs beside. Name another skill or tool and let its own documentation carry the details, rather than restating its flags.

**Check a skill against what it replaces.** Passing scenarios written for a skill did not predict its value: consult passed all three scenarios of its improvement loop and was dropped after real use, when sessions with and without it measured the same. Compare a new skill with the same task done without it, and an edit with the previous version; decide before looking what result would make you keep it, and read the transcripts as well as the outputs. The minimum after any change is one `claude -p` run (or `codex exec`) with a request the skill should handle, in a fresh session, since the context of writing the skill hides its gaps. Replays of past sessions cost minutes and dollars each and two runs per arm could not separate two wordings, so keep them for changes to how a skill behaves, and read `references/replay-pitfalls.md` first. Qualities the user judges by feel, such as a conversation's tone or a design's look, are judged in real use; say so rather than claiming a replay settled them. A skill that shows no lift over none gets folded.

**Grow a skill from observed failures, and prune what lost its reason.** Add a rule when the failure it prevents has been seen, and count real use in transcripts before adding to a skill that already works. Remove rules whose reason no longer holds: accumulated cautions are followed faithfully and turn into needless confirmations and stiff text. A skill that dispatches subagents, replays sessions, or fetches pages on every run adds that cost to every use, so run heavy steps when the user asks or a stated trigger fires, not by default.

**Present information before asking for a decision, and scope side effects to what the user acted on.** Show the data a choice rests on (commands, impact, rationale) before asking for it, and apply an irreversible operation only to the items the user explicitly chose.

## Measuring a description

`scripts/measure-trigger.ts` runs each query of an eval set through `claude -p`, stops at the first tool call, and counts how often the skill fired; `references/measuring-triggers.md` covers building the set and reading the counts. Use it to compare candidates after a skill misfired in real use. A single-turn fire rate overstates loading in a working session, where the model often reads files before it looks at the listing: the 2026-11-15 description of this skill fired 16/24 on its eval set and loaded in 2 of 6 real editing sessions.

## Files

```
skill-name/
+-- SKILL.md            # Required: what to do and when to open the rest
+-- references/         # Loaded on demand
+-- scripts/            # Run as black boxes; tests next to them as *_test.ts
+-- agents/openai.yaml  # Codex only: invocation policy and UI metadata
```

- Write the skill in English. Strings the agent prints verbatim to the user (prompts, option labels, report headings) may stay in the user's language inside code blocks or backticks.
- Link each reference from `SKILL.md` with when to read it ("read `references/x.md` when the API returns a non-200 status"), one level deep: a reference that links to another gets read partially. Give a reference over 100 lines a table of contents.
- Bundle a script for a deterministic operation, or when every run reinvents the same helper, and say whether to run it or read it.
