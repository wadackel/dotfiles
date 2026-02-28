---
name: permission-review
description: Reviews logged permission requests and interactively applies permissions.allow patterns, bash-policy rules, or ALLOWED_COMMANDS entries. Use when asked to "review permissions", "check permission logs", "permission review", "権限ログを確認", "許可パターンを見直し", "権限の最適化", or when optimizing permission dialog frequency.
argument-hint: "[--days N] [--project NAME] [--tool NAME]"
---

# permission-review

Analyzes accumulated permission request logs and guides the user through
adding patterns to `permissions.allow`, `bash-policy.yaml`, or
`approve-piped-commands.ts` ALLOWED_COMMANDS.

## Quick start

```
/permission-review
```

## Skill Execution Workflow

### Step 1: Run Analysis

Execute the CLI tool and capture the JSON output:

```bash
permission-review.ts --format json
```

If the user specifies filters, pass them as flags (e.g. `--days 7`, `--project dotfiles`, `--tool Bash`).

### Step 2: Present Summary

Show the user a concise summary:
- Total requests in the period
- Top `permissions.allow` candidates (pattern, count, projects, examples)
- ALLOWED_COMMANDS candidates (if any)
- Items needing review
- Tool/project breakdown stats

### Step 3: Interactive Review

Walk through each candidate pattern with the user using `AskUserQuestion`. For each pattern (or group of similar patterns), offer actions:

- **Add to permissions.allow** - Edit `~/dotfiles/home/programs/claude/settings.json` to add the pattern to `permissions.allow`
- **Add to bash-policy** - Use the **bash-policy-add skill** with the generalized pattern as argument
- **Add to ALLOWED_COMMANDS** - Edit `~/dotfiles/home/programs/claude/scripts/approve-piped-commands.ts` to add the command to `ALLOWED_COMMANDS`
- **Skip** - Take no action on this pattern

Group similar patterns when possible to reduce the number of questions.

### Step 4: Apply Changes

After the user confirms actions:
1. Edit the relevant files
2. Purge resolved entries from the log: `permission-review.ts --purge`
3. Show a summary of all changes made (including purged entry count)
4. Note that no `darwin-rebuild` is needed (all files are symlinked)

## Important Notes

- Log file location: `~/.claude/logs/permission-requests.jsonl`
- Settings file (source of truth): `~/dotfiles/home/programs/claude/settings.json`
- The logger hook only records requests — it does not track whether the user approved or denied them
- Patterns appearing frequently are likely being routinely approved by the user
