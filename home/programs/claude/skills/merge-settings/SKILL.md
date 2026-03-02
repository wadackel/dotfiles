---
name: merge-settings
description: Merges project-local .claude/settings.local.json permission rules into global ~/.claude/settings.json. Use when adding project permissions to global settings, syncing local permissions, or when asked to "merge settings", "add permissions", or "promote local rules".
allowed-tools: Bash(~/.claude/skills/merge-settings/merge.ts *)
---

# Settings Merger

Merges project-specific permission rules from `.claude/settings.local.json` into global `~/.claude/settings.json`.

## Quick start

/merge-settings

## How it works

1. Reads `.claude/settings.local.json` in current project
2. Extracts `permissions.allow` rules
3. Compares with existing `~/.claude/settings.json`
4. **Separates rules into three groups**:
   - **New**: Rules not in global and not subsumed
   - **Already Covered**: Rules subsumed by a broader global rule (e.g., local `Bash(deno test *)` covered by global `Bash(deno *)`)
   - **Skipped** (exact duplicates): Already handled automatically
5. **Claude evaluates each new rule** using criteria in [references/rule-criteria.md](references/rule-criteria.md)
6. Classifies new rules as RECOMMEND (safe to globalize) or EXCLUDE (project-specific)
7. Proposes only RECOMMEND rules for user approval with justifications
8. Merges approved rules with automatic deduplication
9. Cleans up local settings by removing applied and already-covered rules

## Skill Execution Workflow

When `/merge-settings` is invoked, Claude should follow this workflow:

### Step 1: Extract New Rules

Run the merge script in proposal mode:
```bash
~/.claude/skills/merge-settings/merge.ts
```

This outputs JSON with:
- `status`: "proposal", "noop", or "error"
- `new_rules`: Array of rules not in global settings (and not subsumed)
- `new_rules_count`: Number of new rules
- `subsumed_rules`: Array of `{ rule, subsumed_by }` objects — local rules already covered by a broader global rule
- `subsumed_count`: Number of subsumed rules
- `project_path`: Current working directory

### Step 2: Evaluate Each Rule

For each rule in `new_rules`, apply the criteria in [references/rule-criteria.md](references/rule-criteria.md):

1. Check if the rule matches any EXCLUDE pattern
2. If no EXCLUDE matches, classify as RECOMMEND (lean toward RECOMMEND for well-known CLI tools)
3. Record the reason for classification

**Important**: If a rule matches an EXCLUDE pattern, it is EXCLUDED regardless of other considerations.

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

ALREADY COVERED (<count> rules) - Subsumed by existing global rules:
  - <rule> (covered by <existing_rule>)
  - <rule> (covered by <existing_rule>)
  ...

How would you like to review the <count> recommended rules?
```

Then ask the user to choose a review mode:
1. **全て適用** — Apply all recommended rules at once
2. **1つずつ確認** — Review and approve each rule individually
3. **適用しない** — Skip all

If the user chooses **individual review**, iterate through each RECOMMEND rule
with a separate AskUserQuestion (追加する / スキップ), collecting approved rules.

### Step 4: Apply Approved Rules

If user approves (batch mode), construct the approved rules JSON array (only RECOMMEND rules) and apply:

```bash
~/.claude/skills/merge-settings/merge.ts --apply '<rules_json>'
```

Notes:
- Only include RECOMMEND rules in `<rules_json>`
- Output `status` will be `"applied"` on success

### Step 5: Clean Up Local Settings

After all rules have been reviewed (batch or individual), clean up local settings.

Construct a combined removal list:
- All rules that were successfully applied to global
- All rules from `subsumed_rules` (already covered by global — no action needed)

Then run cleanup:

```bash
~/.claude/skills/merge-settings/merge.ts --cleanup '<combined_rules_json>'
```

Notes:
- EXCLUDED rules are intentionally preserved in local settings
- Output `status` will be `"cleaned"` on success with `cleaned_count`
- If no rules to remove, status will be `"noop"`

### Step 6: Report Results

After successful application and cleanup:
- Confirm number of rules added to global
- Confirm number of rules removed from local
- Remind user that EXCLUDED rules remain in local settings

## Safety features

- **Deduplication**: Skips rules already in global settings
- **Subsumption detection**: Identifies local rules already covered by broader global patterns
- **User approval**: Always asks before applying changes
- **Targeted cleanup**: Only removes applied and already-covered rules; EXCLUDED rules stay local
- **Error handling**: Validates JSON format and file existence

## Limitations

- Only merges `permissions.allow` (not `deny` or other fields)
- No automatic conflict resolution for complex rules
- Requires manual execution (not automatic)
