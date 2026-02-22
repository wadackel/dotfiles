# Rule Evaluation Criteria

When evaluating new rules from `settings.local.json`, Claude applies the following classification.

**If a rule could match both categories, EXCLUDE takes precedence (fail-safe).**

## RECOMMEND - Safe to add to global settings

**WebFetch with domain restrictions**
- Pattern: `WebFetch(domain:<domain>)`
- Rationale: Domain-based restrictions are portable and safe
- Examples:
  - `WebFetch(domain:github.com)` - Documentation site
  - `WebFetch(domain:npmjs.com)` - Package registry
  - `WebFetch(domain:docs.python.org)` - Language docs

**Specific-purpose safe CLI tools**
- Pattern: `Bash(<tool> *)`
- Rationale: Tools limited to specific safe purposes (NOT universal shells/scripting tools)
- Examples:
  - `Bash(claude *)` - Claude CLI operations
  - `Bash(gemini *)` - Gemini CLI operations
  - `Bash(starship config *)` - starship configuration
  - `Bash(rg *)` - ripgrep search
  - `Bash(tmux *)` - Terminal multiplexer
  - `Bash(git status *)` - Git read operations
  - `Bash(nvim *)` - Neovim editor
  - `Bash(zellij *)` - Terminal workspace

**IMPORTANT**: Do NOT include universal shells/scripting tools like:
- `Bash(bash *)`, `Bash(sh *)`, `Bash(zsh *)` - Universal shells allowing arbitrary code execution
- `Bash(expect *)` - Universal scripting tool
- `Bash(python *)`, `Bash(perl *)`, `Bash(ruby *)` - Languages allowing arbitrary code via `-c` flag

**Read-only inspection commands**
- Pattern: Commands that only query system state
- Rationale: No side effects, safe for global use
- Examples:
  - `Bash(defaults read *)` - macOS preferences reader
  - `Bash(plutil *)` - Property list utility
  - `Bash(ioreg *)` - I/O registry explorer

**Note**: Commands like `Bash(cat *)` and `Bash(ls *)` can read arbitrary files, so consider project-specific sensitivity before adding globally. For most users, these are safe, but in sensitive environments, keep them project-local.

**Package/dependency managers (read-only)**
- Pattern: Query operations for package managers
- Rationale: Portable across projects using the same tools
- Examples:
  - `Bash(nix search *)` - Nix package search
  - `Bash(npm list *)` - Node packages
  - `Bash(pip list *)` - Python packages
  - `Bash(cargo search *)` - Rust packages

**Version check commands**
- Pattern: Commands that display version information
- Rationale: Harmless diagnostics, universally useful
- Examples:
  - `Bash(node --version)` - Node.js version
  - `Bash(python --version)` - Python version
  - `Bash(gcloud version *)` - Cloud SDK version

## EXCLUDE - Keep in project-local settings

**Universal scripting/shell tools (DANGEROUS)**
- Pattern: Tools allowing arbitrary code execution
- Rationale: Universal shells and scripting languages can execute any code, making global permission extremely dangerous
- Examples:
  - `Bash(bash *)` - Universal shell
  - `Bash(sh *)` - Universal shell
  - `Bash(zsh *)` - Universal shell
  - `Bash(expect *)` - Universal scripting tool
  - `Bash(python *)` - Can execute arbitrary code via `python -c`
  - `Bash(perl *)` - Can execute arbitrary code via `perl -e`
  - `Bash(ruby *)` - Can execute arbitrary code via `ruby -e`
  - `Bash(node *)` - Can execute arbitrary code via `node -e`

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
  - `Bash(appserver *)` - Custom application server
  - `Bash(myapp *)` - Project-specific binary
  - `Bash(deploy-to-staging *)` - Custom deployment script

## Pattern Recognition Guidelines

**For WebFetch rules**:
- Domain-based: RECOMMEND (portable, safe)
- URL with path: EXCLUDE (may contain project-specific endpoints)
- Example: `WebFetch(domain:api.github.com)` → RECOMMEND
- Example: `WebFetch(https://internal.company.com/api)` → EXCLUDE

**Note on deprecated `:*` syntax**:
- Claude Code previously used `Bash(cmd:*)` syntax, which is now deprecated
- The merge script automatically normalizes `:*)` → ` *)` before comparison and application
- When evaluating rules, treat `Bash(cmd:*)` the same as `Bash(cmd *)` — they are equivalent
- Always propose rules in the new ` *` format (e.g., `Bash(tmux *)` not `Bash(tmux:*)`)

**For Bash rules**:
- Extract the command name (before first space)
- **CRITICAL**: Immediately EXCLUDE if it's a universal shell/scripting tool (bash, sh, zsh, expect, python, perl, ruby, node)
- Check if it's a specific-purpose safe tool (claude, gemini, starship, rg, git, tmux, etc.)
- Look for path indicators (`/`, `~`, `./`) → EXCLUDE
- Look for environment variable assignments (`VAR=value`) → EXCLUDE
- Check for shell execution patterns (`source`, `exec`, `-c`) → EXCLUDE

**Edge cases**:
- `Bash(git update-index *)` - Standard tool, specific subcommand → RECOMMEND
- `Bash(nix-store --query --references *)` - Nix tool, read-only → RECOMMEND
- `Bash(defaults -currentHost read -g *)` - Read-only BUT currentHost implies machine-specific → check content
  - If it includes device IDs: EXCLUDE
  - If it's generic: RECOMMEND

**Wildcards and specificity**:
- `Bash(tool *)` generally indicates a pattern, lean toward RECOMMEND if tool is standard
- Specific arguments without wildcards may indicate project-specific usage → scrutinize carefully

**When uncertain**:
- Default to EXCLUDE (safer)
- Provide clear reasoning in the explanation
- User can still manually add to global settings if needed
