---
name: merge-settings
description: Merge project-local .claude/settings.local.json permissions into global ~/.claude/settings.json with user approval
---

# Settings Merger

Merges project-specific permission rules from `.claude/settings.local.json` into global `~/.claude/settings.json`.

## Quick start

/merge-settings

After approval, apply with the approved rules JSON:

```
~/.claude/skills/merge-settings/merge.sh --apply '<rules_json>' --hash '<rules_hash>'
```

## How it works

1. Reads `.claude/settings.local.json` in current project
2. Extracts `permissions.allow` rules
3. Compares with existing `~/.claude/settings.json`
4. Proposes new rules for user approval
5. Merges approved rules with automatic deduplication

## Use cases

### Adding project-specific permissions

When a project requires specific permissions not in your global settings:

/merge-settings

# Claude will propose new rules for approval
# After approval, rules are added to ~/.claude/settings.json

You can also pass the approved JSON array directly:

```
~/.claude/skills/merge-settings/merge.sh --apply '<rules_json>' --hash '<rules_hash>'
```

## Safety features

- **Automatic backup**: Creates timestamped backup before any changes
- **Deduplication**: Skips rules already in global settings
- **User approval**: Always asks before applying changes
- **Error handling**: Validates JSON format and file existence

## Requirements

- `jq` command (for JSON processing)
- `.claude/settings.local.json` in project root
- `~/.claude/settings.json` exists

## Limitations

- Only merges `permissions.allow` (not `deny` or other fields)
- No automatic conflict resolution for complex rules
- Requires manual execution (not automatic)
