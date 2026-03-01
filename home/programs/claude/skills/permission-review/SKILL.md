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

The `--format json` mode automatically provides:
- Full command examples (up to 50 per pattern, no truncation)
- `subPatterns` array for each candidate (ordered specific to general)
- `reason` field for Bash entries explaining why the permission confirmation occurred

### Step 2: Detail Presentation (Phase 1)

Present **all** candidate patterns with full details. For each pattern in
`allowCandidates` and `reviewItems`, use this format:

```markdown
### `Bash(git *)` -- N件 (project1, project2)

確認が発生した理由: [reason-based explanation]

実行されたコマンド:
- `git add CLAUDE.md config/dax3.keymap && git commit -m "refactor(keymap): ..."`
- `git status --short && echo "---" && git log --oneline -3`

追加可能なパターン:
- `Bash(git commit *)` -- commit のみ許可
- `Bash(git status *)` -- status のみ許可
- `Bash(git *)` -- git 全般を許可
```

Display the `reason` field as a human-readable explanation:
- `compound_command`: "パイプ/複合コマンドのため `permissions.allow` にマッチしない（既知制限）。ALLOWED_COMMANDS で対応可能"
- `pattern_gap`: "既存パターン `Bash(X *)` は登録済みだが、このサブコマンドはカバーされていない"
- `no_pattern` (or absent): "対応するパターンが未登録"

Every candidate **must** be presented in this format. This is a required format, not illustrative.

### Step 3: Individual Review (Phase 2)

For each candidate in `allowCandidates` / `reviewItems`, use `AskUserQuestion` with up to 3 options + Other:

1. **パターンを選んで追加** -- proceed to sub-flow for pattern selection
2. **bash-policy に追加** -- use the **bash-policy-add skill**
3. **スキップ (ログ保持)** -- take no action; log entries are preserved for next review

#### Pattern Selection Sub-flow

When "パターンを選んで追加" is chosen:

- If `subPatterns` has **1 entry** (typical for non-Bash tools): skip sub-flow, add directly
- If `subPatterns` has **2 entries**: present 2 options + Other (3 options total)
- If `subPatterns` has **3+ entries**: sort by pattern string length descending (specific to general), present top 3 + Other (4 options total)

Each option should include a brief explanation:
```
AskUserQuestion:
  - "Bash(git commit *)" -- commit のみ許可
  - "Bash(git status *)" -- status のみ許可
  - "Bash(git *)" -- git 全般を許可
  - Other (自由入力)
```

**Critical**: Always generate options from the JSON output's `subPatterns` field. Do not invent patterns.

#### Other Input Validation

When the user enters a custom pattern via Other:
- Must be `Tool(pattern)` format (Tool: Bash, Read, Edit, Write, Glob, Grep, Task, WebFetch, WebSearch, or `mcp__` prefix)
- Parentheses must be balanced
- Invalid examples: `Bash(git commit` (no closing paren), `git *` (no Tool name)
- If invalid, explain why and prompt re-entry

Record all added patterns for Step 4.

#### ALLOWED_COMMANDS Candidates

If the JSON output contains `allowedCommandsCandidates`, process them as a separate step after the main review. For each, offer:

1. **ALLOWED_COMMANDS に追加** -- Edit `~/dotfiles/home/programs/claude/scripts/approve-piped-commands.ts`
2. **スキップ**

### Step 4: Apply Changes and Selective Purge

1. Edit the relevant files (`settings.json`, `bash-policy.yaml`, `approve-piped-commands.ts`)
2. **Selectively purge only patterns that were added** (quote patterns containing `*`, `(`, `)` with single quotes):
   ```bash
   permission-review.ts --purge-pattern 'Bash(git commit *)' --purge-pattern 'AskUserQuestion'
   ```
3. **If all candidates were skipped, do NOT run purge** -- entries remain for next review
4. Show a change summary:
   - Added patterns
   - Purged entry count
   - Remaining log entry count
5. Note that no `darwin-rebuild` is needed (all files are symlinked)

#### Interrupted Session Recovery

If a previous session added patterns but didn't purge (interrupted before Step 4),
the next `/permission-review` run may show already-added patterns. In that case,
use `--purge` for bulk cleanup, or `--purge-pattern` to selectively clean specific patterns.

## Important Notes

- Log file location: `~/.claude/logs/permission-requests.jsonl`
- Settings file (source of truth): `~/dotfiles/home/programs/claude/settings.json`
- The logger hook only records requests -- it does not track whether the user approved or denied them
- Patterns appearing frequently are likely being routinely approved by the user
