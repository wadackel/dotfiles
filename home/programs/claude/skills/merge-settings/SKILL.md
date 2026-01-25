---
name: merge-settings
description: Merge project-local .claude/settings.local.json permissions into global ~/.claude/settings.json with user approval
permissions:
  - Bash(~/.claude/skills/merge-settings/merge.sh*)
---

# Settings Merger

Merges project-specific permission rules from `.claude/settings.local.json` into global `~/.claude/settings.json`.

## Quick start

/merge-settings

After approval, apply with the approved rules JSON:

```
~/.claude/skills/merge-settings/merge.sh --apply '<rules_json>'
```

## How it works

1. Reads `.claude/settings.local.json` in current project
2. Extracts `permissions.allow` rules
3. Compares with existing `~/.claude/settings.json`
4. **Claude evaluates each new rule** using evaluation criteria (see below)
5. Classifies rules as RECOMMEND (safe to globalize) or EXCLUDE (project-specific)
6. Proposes only RECOMMEND rules for user approval with justifications
7. Also displays EXCLUDE rules with reasons (for transparency)
8. Merges approved rules with automatic deduplication

## Rule Evaluation Criteria

When evaluating new rules from `settings.local.json`, Claude applies the following classification:

### RECOMMEND - Safe to add to global settings

**WebFetch with domain restrictions**
- Pattern: `WebFetch(domain:<domain>)`
- Rationale: Domain-based restrictions are portable and safe
- Examples:
  - `WebFetch(domain:github.com)` - Documentation site
  - `WebFetch(domain:npmjs.com)` - Package registry
  - `WebFetch(domain:docs.python.org)` - Language docs

**Standard tool wildcards**
- Pattern: `Bash(<tool>:*)`
- Rationale: Common CLI tools used across projects
- Examples:
  - `Bash(rg:*)` - ripgrep search
  - `Bash(tmux:*)` - Terminal multiplexer
  - `Bash(git status:*)` - Git read operations
  - `Bash(nvim:*)` - Neovim editor
  - `Bash(zellij:*)` - Terminal workspace

**Read-only inspection commands**
- Pattern: Commands that only query system state
- Rationale: No side effects, safe for global use
- Examples:
  - `Bash(defaults read:*)` - macOS preferences reader
  - `Bash(plutil:*)` - Property list utility
  - `Bash(ioreg:*)` - I/O registry explorer
  - `Bash(cat:*)` - File content display
  - `Bash(ls:*)` - Directory listing

**Package/dependency managers (read-only)**
- Pattern: Query operations for package managers
- Rationale: Portable across projects using the same tools
- Examples:
  - `Bash(nix search:*)` - Nix package search
  - `Bash(npm list:*)` - Node packages
  - `Bash(pip list:*)` - Python packages
  - `Bash(cargo search:*)` - Rust packages

**Version check commands**
- Pattern: Commands that display version information
- Rationale: Harmless diagnostics, universally useful
- Examples:
  - `Bash(node --version)` - Node.js version
  - `Bash(python --version)` - Python version
  - `Bash(gcloud version:*)` - Cloud SDK version

### EXCLUDE - Keep in project-local settings

**Absolute or relative paths**
- Pattern: Any command with explicit filesystem paths
- Rationale: Paths are machine/project-specific
- Examples:
  - `Bash(~/.local/bin/script.sh ...)` - Home directory path
  - `Bash(./scripts/deploy.sh)` - Relative path
  - `Bash(/usr/local/bin/custom-tool)` - System path

**Environment variable presets**
- Pattern: Commands with hardcoded environment variables
- Rationale: Environment configs are context-specific
- Examples:
  - `TMUX= tmux:*` - Clearing TMUX variable
  - `NODE_ENV=production node:*` - Fixed environment
  - `DEBUG=* npm start` - Debug flag preset

**Shell sourcing/execution**
- Pattern: Commands that source rc files or execute shells
- Rationale: Profile/rc files are machine-specific
- Examples:
  - `source ~/.zshrc` - Loading shell config
  - `exec zsh -l` - Shell execution
  - `. ~/.bashrc` - Dotfile sourcing

**Hardware-specific identifiers**
- Pattern: Device IDs, serial numbers, host-specific keys
- Rationale: Only valid on specific hardware
- Examples:
  - `defaults -currentHost read -g com.apple.keyboard.modifiermapping.1452-641-0` - Keyboard device ID
  - `adb -s AB1234567890 shell` - Android device serial

**Complex quoted shell commands**
- Pattern: Shell commands with embedded subshells or complex quoting
- Rationale: Often project-specific workarounds or setups
- Examples:
  - `zsh -l -c 'which gcloud'` - Login shell wrapper
  - `bash -c 'source env.sh && run-app'` - Multi-step command

**Project-specific tool names**
- Pattern: Non-standard command names unique to the project
- Rationale: Tools don't exist in other environments
- Examples:
  - `appserver:*` - Custom application server
  - `myapp:*` - Project-specific binary
  - `deploy-to-staging:*` - Custom deployment script

## Skill Execution Workflow

When `/merge-settings` is invoked, Claude should follow this workflow:

### Step 1: Extract New Rules

Run the merge script in proposal mode:
```bash
~/.claude/skills/merge-settings/merge.sh
```

This outputs JSON with:
- `status`: "proposal", "noop", or "error"
- `new_rules`: Array of rules not in global settings
- `new_rules_count`: Number of new rules
- `project_path`: Current working directory

### Step 2: Evaluate Each Rule

For each rule in `new_rules`, apply the evaluation criteria above:

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

Apply <count> recommended rules to ~/.claude/settings.json?
```

### Step 4: Apply Approved Rules

If user approves, construct the approved rules JSON array (only RECOMMEND rules) and apply:

```bash
~/.claude/skills/merge-settings/merge.sh --apply '<rules_json>'
```

Notes:
- Only include RECOMMEND rules in `<rules_json>`
- The script will create a backup before applying
- Report the backup path to the user

### Step 5: Report Results

After successful application:
- Confirm number of rules added
- Show backup file path
- List the applied rules for user reference

## Implementation Notes

### Pattern Recognition Guidelines

**For WebFetch rules**:
- Domain-based: RECOMMEND (portable, safe)
- URL with path: EXCLUDE (may contain project-specific endpoints)
- Example: `WebFetch(domain:api.github.com)` → RECOMMEND
- Example: `WebFetch(https://internal.company.com/api)` → EXCLUDE

**For Bash rules**:
- Extract the command name (before first `:` or space)
- Check if it's a standard tool (rg, git, tmux, etc.)
- Look for path indicators (`/`, `~`, `./`)
- Look for environment variable assignments (`VAR=value`)
- Check for shell execution patterns (`source`, `exec`, `-c`)

**Edge cases**:
- `Bash(git update-index:*)` - Standard tool, specific subcommand → RECOMMEND
- `Bash(nix-store --query --references:*)` - Nix tool, read-only → RECOMMEND
- `Bash(defaults -currentHost read -g:*)` - Read-only BUT currentHost implies machine-specific → check content
  - If it includes device IDs: EXCLUDE
  - If it's generic: RECOMMEND

**Wildcards and specificity**:
- `tool:*` generally indicates a pattern, lean toward RECOMMEND if tool is standard
- Specific arguments without wildcards may indicate project-specific usage → scrutinize carefully

**When uncertain**:
- Default to EXCLUDE (safer)
- Provide clear reasoning in the explanation
- User can still manually add to global settings if needed

## Use cases

### Adding project-specific permissions

When a project requires specific permissions not in your global settings:

/merge-settings

# Claude will propose new rules for approval
# After approval, rules are added to ~/.claude/settings.json

You can also pass the approved JSON array directly:

```
~/.claude/skills/merge-settings/merge.sh --apply '<rules_json>'
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
