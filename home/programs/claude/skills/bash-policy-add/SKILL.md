---
name: bash-policy-add
description: Adds a rule to bash-policy.yaml to block specific shell command patterns and redirect Claude to preferred alternatives. Use when asked to "block command X", "enforce pnpm over npx", "prevent git -C usage", "add a bash-policy rule", or "コマンドXをブロックして", "bash-policyに追加して". Conducts a structured interview to gather all required information before making any changes.
argument-hint: "[command pattern to block]"
---

# bash-policy-add

Adds a rule to `.claude/bash-policy.yaml` (or the global config) after fully gathering
all required information through a structured interview.

## Quick start

/bash-policy-add [command pattern to block]

## How it works

1. Reads existing context to pre-fill known answers
2. Asks only about the items that could not be determined from context
3. Builds a YAML rule draft and shows it to the user for approval
4. Applies the rule after explicit approval

## Skill Execution Workflow

### Step 1: Extract Known Information from Context

Before asking any questions, inspect the current conversation context to determine
which of the four required items are already clear:

| # | Item | Example |
|---|------|---------|
| 1 | **Pattern** — glob that matches the command to block | `npx *`, `git -C *` |
| 2 | **Exclude** — globs to exempt (may be empty) | `npx scaffdog *` |
| 3 | **Alternative** — preferred command shown in the block message | `pnpm exec <cmd>` |
| 4 | **Scope** — project-level (`.claude/bash-policy.yaml`) or global (`~/.claude/scripts/bash-policy.yaml`) |

If an item is clearly derivable from what the user said, treat it as known and
**do not ask about it again**.

### Step 2: Read Existing Config

Read the target `bash-policy.yaml` to:
- Check for duplicate or conflicting patterns
- Understand the style of existing messages

Use the findings to inform the suggestions offered in the next step.

### Step 3: Ask About Missing Items

For each item that is still unknown, ask the user using `AskUserQuestion`.
Batch unrelated questions into a single call (up to 4 questions per call).

Key guidance per item:

**Pattern**
- Offer concrete glob candidates inferred from the user's intent (e.g. `npx *` vs `npx tsc *`)
- Clarify whether the block should cover the full command family or just specific subcommands

**Exclude**
- Suggest candidates from context (e.g. tools already allowed in `settings.json`)
- Default: no exclusions

**Alternative**
- Propose the most likely replacement command
- For pnpm migrations, offer both `pnpm exec <cmd>` and `pnpm -F <pkg> <script>`

**Scope**
- Default: project-level
- Choose global only when the rule should apply across all projects

### Step 4: Build YAML Draft and Get Approval

Compose the full rule entry and present it to the user **before making any changes**:

```yaml
# Proposed addition to <target file>:
rules:
  # ... existing rules ...
  - pattern: "<pattern>"
    message: |
      <message text>
    exclude:          # omit if empty
      - "<exclude-1>"
```

Ask: "Apply this rule?" and wait for explicit approval.

### Step 5: Apply

Edit the target file to append the approved rule under `rules:`.

## Rule Design Reference

### Pattern tips

- `*` matches any characters including spaces
- Patterns match individual command segments (split by `&&`, `||`, `|`, `;`)
- Prefer broad patterns (`npx *`) over narrow ones (`npx tsc *`) unless there are
  many legitimate uses of the base command

### Message tips

- State why the command is blocked
- Show the exact preferred alternative with a concrete example
- Multiline messages (YAML `|` block) are supported

### Exclude tips

- List only patterns that have a known legitimate use
- Globs follow the same rules as `pattern`

### Common examples

```yaml
# Block npm in favor of pnpm
- pattern: "npm install *"
  message: "Use pnpm install instead of npm install."

# Block git -C
- pattern: "git -C *"
  message: "Use 'cd <path> && git <subcmd>' instead of 'git -C <path>'."

# Block npx with scaffdog exception
- pattern: "npx *"
  message: |
    Do not use npx directly. Use pnpm alternatives instead:
      pnpm exec <command>
      pnpm -F <package> <script>
  exclude:
    - "npx scaffdog *"
```

---

## Safety features

- **No changes before approval**: Rule draft is always shown for user confirmation
- **Duplicate check**: Existing config is read before any edits
- **Minimal questions**: Only asks about truly unknown items — skips what context already tells
