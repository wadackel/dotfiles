---
name: merge-settings
description: Merges project-local .claude/settings.local.json permission rules into global ~/.claude/settings.json. Use when adding project permissions to global settings, syncing local permissions, or when asked to "merge settings", "add permissions", or "promote local rules".
allowed-tools: Bash(~/.claude/skills/merge-settings/merge.ts *)
---

# Settings Merger

Merges project-specific permission rules from `.claude/settings.local.json` into global `~/.claude/settings.json`.

## Quick start

/merge-settings

After approval, apply with the approved rules JSON:

```
~/.claude/skills/merge-settings/merge.ts --apply '<rules_json>'
```

## How it works

1. Reads `.claude/settings.local.json` in current project
2. Extracts `permissions.allow` rules
3. Compares with existing `~/.claude/settings.json`
4. **Claude evaluates each new rule** using criteria in [references/rule-criteria.md](references/rule-criteria.md)
5. Classifies rules as RECOMMEND (safe to globalize) or EXCLUDE (project-specific)
6. Proposes only RECOMMEND rules for user approval with justifications
7. Also displays EXCLUDE rules with reasons (for transparency)
8. Merges approved rules with automatic deduplication

## Skill Execution Workflow

When `/merge-settings` is invoked, Claude should follow this workflow:

### Step 1: Extract New Rules

Run the merge script in proposal mode:
```bash
~/.claude/skills/merge-settings/merge.ts
```

This outputs JSON with:
- `status`: "proposal", "noop", or "error"
- `new_rules`: Array of rules not in global settings
- `new_rules_count`: Number of new rules
- `project_path`: Current working directory

### Step 2: Evaluate Each Rule

For each rule in `new_rules`, apply the criteria in [references/rule-criteria.md](references/rule-criteria.md):

1. Check if the rule matches any RECOMMEND pattern
2. Check if the rule matches any EXCLUDE pattern
3. Assign the rule to the appropriate category
4. Record the reason for classification

**Important**: If a rule could match both categories, EXCLUDE takes precedence (fail-safe).

### Step 3: Present Evaluation to User

Display results in this format:

```
Found <N> new rules in .claude/settings.local.json

RECOMMENDED (<count> rules) - Safe to add to global settings:
  ✓ <rule> - <reason>
  ✓ <rule> - <reason>
  ...

EXCLUDED (<count> rules) - Project-specific, keeping local:
  ✗ <rule> - <reason>
  ✗ <rule> - <reason>
  ...

How would you like to review the <count> recommended rules?
```

Then ask the user to choose a review mode:
1. **全て適用** — Apply all recommended rules at once
2. **1つずつ確認** — Review and approve each rule individually
3. **適用しない** — Skip all

If the user chooses **individual review**, iterate through each RECOMMEND rule
with a separate AskUserQuestion (追加する / スキップ), applying approved
rules immediately after each approval via `merge.ts --apply`.

### Step 4: Apply Approved Rules

If user approves (batch mode), construct the approved rules JSON array (only RECOMMEND rules) and apply:

```bash
~/.claude/skills/merge-settings/merge.ts --apply '<rules_json>'
```

Notes:
- Only include RECOMMEND rules in `<rules_json>`

### Step 5: Report Results

After successful application:
- Confirm number of rules added
- List the applied rules for user reference

## Safety features

- **Deduplication**: Skips rules already in global settings
- **User approval**: Always asks before applying changes
- **Error handling**: Validates JSON format and file existence

## Limitations

- Only merges `permissions.allow` (not `deny` or other fields)
- No automatic conflict resolution for complex rules
- Requires manual execution (not automatic)
