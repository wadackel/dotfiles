---
name: skill-design
description: Conventions for writing and editing Claude Code and Codex skills (SKILL.md): invocation mode, a minimal description, body structure, and checks after writing. Use when creating, editing, or reviewing a skill.
user-invocable: false
---

# Skill Design

Conventions for skills in this repository. Claude Code and Codex read the same `SKILL.md` for a shared skill; where each kind of skill lives is in `AGENTS.md` under "Skills layout".

These rules take precedence over generic skill-authoring advice loaded alongside them, including the skill-creator plugin's advice to make descriptions "pushy".

## What each part costs

| Part | In context | Limit |
|---|---|---|
| `name` + `description` (+ `when_to_use`) | Every session, before any skill is chosen, for every skill the model may invoke | All entries share a listing budget: 1% of the context window in Claude Code, 2% in Codex. Claude Code cuts each entry at 1,536 characters and, on overflow, drops the descriptions of the least-invoked skills; Codex shortens descriptions first |
| `SKILL.md` body | From invocation to the end of the session | Under 500 lines. After compaction Claude Code re-attaches only the first 5,000 tokens of each skill, 25,000 in total, so the rules that must survive go near the top |
| `references/`, `scripts/`, `assets/` | Only when read or run | None until used |

The description is the most expensive text per character in a skill: every session pays for it, whether or not the skill runs.

## Choose the invocation mode first

The mode decides whether the description is routing text at all.

| Who starts it | Frontmatter | The description is |
|---|---|---|
| The user only: side effects, or a timing the user picks | `disable-model-invocation: true`; for Codex also `policy.allow_implicit_invocation: false` in `agents/openai.yaml` | Not in the model's context. Write one short line for autocomplete |
| The model only: background knowledge | `user-invocable: false` | Routing text |
| Both (default) | none | Routing text |

`paths` restricts automatic loading to matching files. The other Claude Code fields (`allowed-tools`, `model`, `effort`, `context: fork`, `agent`, `hooks`, `arguments`) are documented at https://code.claude.com/docs/en/skills; read it before using one, since the field set changes between releases.

## Write the description

The model decides from the description whether to open the skill, and it reads intent, not keywords. A description therefore needs the task and the nouns of its domain, and nothing it would recognize anyway.

- **What it does, then when to use it**, in third person, in one or two sentences. Most fit in 100–250 characters; one past 300 needs a measured reason.
- **Front-load the task and its domain nouns.** Hosts truncate from the end, and the first words carry the routing. Keep the proper nouns that users and files bring with them (`SKILL.md`, `terraform plan`, Obsidian vault, a PR): removing one such noun dropped a measured query from 4/5 fires to 1/5.
- **No trigger-phrase lists, and no translations of them.** The model matches paraphrases and other languages to the stated intent; a list memorizes vocabulary and costs every session. Japanese requests route to an English description.
- **No exclusion sentence** ("Do NOT use for …") until a measurement shows a false trigger. In skill-improver's measurement no should-not-trigger query fired with or without one.
- **No inventory of the body** ("Covers A, B, C, and D"). The body says that once it is loaded.
- **No emphasis** ("Make sure to use this whenever …"). When a skill undertriggers on a measured query, add the intent or noun that query carries.
- Put everything in `description`. `when_to_use` counts toward the same Claude Code cap, and Codex reads only `name` and `description`.
- Write `[arg]`, not `<arg>`: Claude Code shows angle brackets as `&lt;` and `&gt;`.

Illustrative, this skill's own description before and after:

```yaml
# Before: 412 characters, an inventory of the body
description: Design principles and conventions for creating Claude Code skills. Covers SKILL.md authoring rules (English content, argument-hint for $ARGUMENTS skills), interaction flow principles (present info before asking decisions), tool/skill delegation patterns (delegate details, don't duplicate), and mandatory skill-improver execution after creation. Auto-loads when creating, editing, or reviewing skill definitions.

# After: 208 characters, the task and when
description: Conventions for writing and editing Claude Code and Codex skills (SKILL.md): invocation mode, a minimal description, body structure, and checks after writing. Use when creating, editing, or reviewing a skill.
```

## Write the body

- **Only what the model would not do unaided**: this repository's conventions, decisions already made, sequences where only one order is safe, and failures already observed. General knowledge costs tokens and dilutes the rest; skills written comprehensively measured worse than compact ones.
- **English throughout.** Strings the agent prints verbatim to the user (confirmation prompts, option labels, report headings) may stay in the user's language inside code blocks or backticks, so they read apart from the instructions.
- **Imperative voice**: "Run the test suite", not "You should run".
- **Examples pin an output shape the reader must reproduce exactly.** Give several that differ and label them illustrative, because a single example gets copied in length, tone, and structure. For judgment, state the rule and its reason instead.
- **`argument-hint`** on any skill that reads `$ARGUMENTS`, so autocomplete shows what to type. `$ARGUMENTS`, `${CLAUDE_SKILL_DIR}`, and `` !`command` `` are Claude Code substitutions; check the docs page above before relying on one in a shared skill.

### Instruction register

Current models follow a skill's text closely and literally, so its volume and granularity carry as much weight as its content.

- **State each rule once, at normal volume, with its reason.** Capitalized MUST / NEVER / CRITICAL makes a rule over-apply to neighboring cases, and a rule carrying its "because" extends correctly to cases it did not list. When a test shows one instruction being skipped, give it a reason or move the check into a script before raising its volume.
- **Match specificity to fragility.** Numbered steps and exact commands belong where only one sequence is safe: destructive operations, auth flows, strings a script parses. For judgment work, state the outcome, the constraints, and how to check the result, and leave the plan to the model.

### Bundled files

```
skill-name/
+-- SKILL.md          # Required: what to do and when to open the rest
+-- references/       # Loaded on demand
+-- scripts/          # Run as black boxes
+-- *_test.ts         # Tests for scripts
+-- agents/openai.yaml  # Codex only: invocation policy and UI metadata
```

- Link each reference from `SKILL.md` with when to read it, one level deep: a reference that links to another gets read partially. Give a reference over 100 lines a table of contents.
- Use a script for a deterministic operation, and say whether to run it or read it.

## Interaction flow

- **Present information before asking for decisions.** Show concrete data (command examples, impact scope, rationale) before asking the user to choose add/skip/approve.
- **Scope side effects to user actions.** Irreversible operations (log deletion, data changes) apply only to items the user explicitly acted on. Do not touch skipped items.

## Delegate to other skills and tools

Do not document another skill's or tool's detailed usage (command flags, arguments, internal workflow) inside a skill. Name it and let its own documentation carry the details:

```markdown
Use the **repo-dive** skill to clone and explore a GitHub repository.
```

## After writing

Run the skill once where it runs: a headless `claude -p` (or `codex exec` for a Codex skill) with a request it should handle, then read which skills loaded and what it produced. Use `/skill-improver <name>` only when that run or real use shows the skill misfiring or not firing, or when the user asks for it: it dispatches many subagents, and a skill that already works gains nothing from it. Its Step 2.5 measures the description; of two candidates that measure the same, keep the shorter.

## Anti-patterns

- **A reminder to invoke the skill, inside the skill.** A rule such as "always run gate after implementation" belongs in `CLAUDE.md`: inside the skill it is only seen once the skill is already loaded.
- **Body situations the description cannot reach.** The body loads only after the description matched, so every kind of situation the body handles has to fall inside the description's intent. Plan-mode guidance in the body, for example, needs plan mode named in the description. Name the situation once, not a phrase per case.
- **Name, directory, and references that disagree.** `name` is lowercase letters, digits, and hyphens, up to 64 characters, and matches the directory; every `/name` in `CLAUDE.md` or another skill uses the same spelling, or the reference does not invoke anything.
- **Guardrails moved out of `CLAUDE.md`.** When moving content from `CLAUDE.md` into a skill, keep one-line rules ("use X for Y") in `CLAUDE.md`, and move only reference detail (multi-line patterns, examples, decision trees).
