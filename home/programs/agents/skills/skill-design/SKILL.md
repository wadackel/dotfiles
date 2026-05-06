---
name: skill-design
description: Design principles and conventions for creating Claude Code skills. Covers SKILL.md authoring rules (English content, argument-hint for $ARGUMENTS skills), interaction flow principles (present info before asking decisions), tool/skill delegation patterns (delegate details, don't duplicate), and mandatory skill-improver execution after creation. Auto-loads when creating, editing, or reviewing skill definitions.
user-invocable: false
---

# Skill Design Principles

Conventions for authoring Claude Code skills in this repository.

## When This Applies

- Creating a new skill (SKILL.md)
- Editing or restructuring an existing skill
- Reviewing skill quality or design decisions

## Three-Level Loading Model

Skills use progressive disclosure for context efficiency:

| Level | Size | Loaded when |
|---|---|---|
| **Metadata** (name + description) | ~100 tokens | Always in context |
| **SKILL.md body** | <5k words | Skill is invoked or auto-loaded |
| **Bundled resources** (references/, scripts/) | Unlimited | Explicitly referenced during execution |

Keep SKILL.md under 500 lines. Move detailed reference material to `references/` files.

## Language

Write all SKILL.md content in English (section headings, descriptions, comments, instructions).

Two narrow exceptions are permitted, both treated as Intentional Conventions:

1. **Bilingual trigger phrases in `description`**: Japanese trigger phrases (e.g., `'コードレビューして'`, `'実装して'`) may sit alongside English action verbs in the frontmatter `description` field for bilingual dispatch. They are intentional, not violations.
2. **User-facing print strings inside fenced code blocks or quoted message templates**: Strings that Claude prints verbatim to the user (confirmation prompts, AskUserQuestion option labels, sample template headers) may stay in the user's language, typically Japanese for jp users. Keep them inside fenced code blocks or backticks so they are visually distinguishable from instruction prose.

Anything outside these two exceptions — narrative prose, rule statements, `-- Why:` rationale comments, workflow steps, examples that are NOT user-facing print samples — must be English.

## Frontmatter Rules

### `argument-hint`

Add `argument-hint: "[hint]"` to any skill that uses `$ARGUMENTS`. This appears in autocomplete to guide the user.

```yaml
---
name: my-skill
argument-hint: "[target-name]"
---
```

### `description` Quality

- Write in third person ("Covers...", "Handles...", "Auto-loads when...")
- Include trigger phrases matching how users naturally describe the task
- Include both English and Japanese trigger phrases where applicable
- Keep concise -- this is loaded into every session for routing decisions

## Writing Style

- Use imperative/infinitive form (verb-first): "Run the test suite", "Read the config file"
- Avoid second-person ("You should...") -- use objective instructional language
- Provide concrete examples, not abstract guidelines

## Interaction Flow Principles

- **Present information before asking for decisions.** Show concrete data (command examples, impact scope, rationale) before asking the user to choose add/skip/approve.
- **Scope side effects to user actions.** Irreversible operations (log deletion, data changes) apply only to items the user explicitly acted on. Do not touch skipped items.

## Tool and Skill Delegation

Do not document another skill's or tool's detailed usage (command flags, arguments, internal workflow) inside a skill. Instead, delegate:

```markdown
Use the **gemini-research** skill for codebase analysis.
```

Let the target skill's own documentation handle the details.

## Resource Organization

```
skill-name/
+-- SKILL.md              # Required: overview and navigation
+-- references/            # Detailed docs, loaded on demand
|   +-- patterns.md
|   +-- examples.md
+-- scripts/               # Executable code, called as black boxes
|   +-- helper.ts
+-- *_test.ts              # Tests for scripts
```

- **references/**: Documentation too large for SKILL.md. Reference from SKILL.md so Claude knows when to load them.
- **scripts/**: Deterministic operations. Call via command line, run `--help` first to discover usage.
- **assets/**: Output templates, fonts, etc. Not loaded into context.

## Post-Creation Checklist

After creating a new skill, execute `/skill-improver <name>` for quality evaluation and optimization before considering the work complete.

## Anti-patterns

### Chicken-and-egg rule placement

Rules that remind Claude to **invoke** a skill (e.g., "always run codex-review after implementation") must stay in CLAUDE.md, not inside the skill itself. If the rule lives inside the skill, Claude never sees it until the skill is already loaded — defeating its purpose as a reminder.

### Plan-mode body/description mismatch

If a skill body contains plan-mode guidance (e.g., `## Plan Mode Verification`, `## Mode A (Plan Review)`), the description **must** explicitly include a plan-mode trigger phrase. Body content is loaded only after triggering — if the description omits plan-mode scenarios, the skill silently fails to trigger during the planning phase.

```yaml
# Good: description covers plan-mode use case
description: "... Also use in plan mode when designing verification plans ..."

# Bad: plan-mode guidance exists only in body — never seen during planning
description: "Use for 'test this', 'QA check', or after feature implementation."
```

### Name/directory/trigger mismatch

The skill's frontmatter `name`, directory name, and any manual trigger references (in CLAUDE.md or description) must all match. A mismatch means `/skill-name` won't invoke the skill.

```yaml
# Good: all three match
# Directory: skills/systematic-debugging/
name: systematic-debugging
# CLAUDE.md: "load the /systematic-debugging skill"
# Description: "Manual trigger: /systematic-debugging."

# Bad: name doesn't match trigger
# Directory: skills/systematic-debugging/
name: systematic-debugging
# CLAUDE.md: "load the /debug skill"  ← won't work
```

### Extracting guardrails vs reference content

When moving content from CLAUDE.md to a skill, distinguish between:
- **Guardrails** (1-line rules: "use X for Y") — keep in CLAUDE.md
- **Reference details** (multi-line patterns, examples, decision trees) — move to skill
