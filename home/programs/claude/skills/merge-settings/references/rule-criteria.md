# Rule Evaluation Criteria

When evaluating new rules from `settings.local.json`, Claude applies the following classification.

**If a rule matches any EXCLUDE pattern, it is EXCLUDED regardless of other considerations.**

**Default is EXCLUDE.** When uncertain whether a rule is safe to globalize, keep it project-local.
However, well-known CLI tools that do not match any EXCLUDE pattern should lean toward RECOMMEND.

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

**Shell fragments and builtins**
- Pattern: Shell keywords or builtins that appear as standalone rules (artifacts of permission dialog expansion)
- Rationale: These are fragments of shell constructs, not standalone commands
- Examples:
  - `Bash(do)`, `Bash(done)`, `Bash(fi)`, `Bash(then)` - Shell loop/conditional keywords
  - `Bash(while read f)`, `Bash(do basename "$f" .md)` - Shell loop fragments

**Build/automation tools that execute arbitrary code**
- Pattern: Tools whose primary function includes executing arbitrary Makefiles, scripts, or build configurations
- Rationale: Execution model is too broad for safe global permission
- Examples:
  - `Bash(make *)` - Executes arbitrary Makefiles
  - `Bash(cmake *)` - Configures and builds arbitrary projects
  - Safe subcommands only: `Bash(make --dry-run *)`, `Bash(go version *)`, `Bash(go list *)`

**Network tools with upload/modification capability**
- Pattern: Tools that can send data or modify remote state
- Rationale: Data exfiltration or remote modification risk
- Examples:
  - `Bash(curl *)` - Can POST data, upload files (only safe forms like `curl --head *`)
  - `Bash(wget *)` - Can download and execute scripts

## RECOMMEND - Safe to add to global settings

Rules that do NOT match any EXCLUDE pattern above are candidates for RECOMMEND.
The following categories are confirmed safe:

**WebFetch with domain restrictions**
- Pattern: `WebFetch(domain:<domain>)`
- Rationale: Domain-based restrictions are portable and safe
- Examples:
  - `WebFetch(domain:github.com)` - Documentation site
  - `WebFetch(domain:npmjs.com)` - Package registry
  - `WebFetch(domain:docs.python.org)` - Language docs

**Read-only inspection commands**
- Pattern: Commands that only query system state
- Rationale: No side effects, safe for global use
- Examples:
  - `Bash(defaults read *)` - macOS preferences reader
  - `Bash(plutil *)` - Property list utility
  - `Bash(ioreg *)` - I/O registry explorer
  - `Bash(defaults -currentHost read -g *)` - Generic current-host read (without device IDs)

**Development runtimes and build tools (read/build only)**
- Pattern: Runtime tools with well-defined, non-arbitrary execution
- Examples:
  - `Bash(deno *)` - Deno runtime (requires explicit permissions)
  - `Bash(bun *)` - Bun runtime
  - `Bash(cargo *)` - Rust package manager and build tool
  - `Bash(tsc *)` - TypeScript compiler
  - `Bash(tsx *)` - TypeScript executor

**Package managers (query operations)**
- Pattern: Commands that query package information
- Examples:
  - `Bash(brew search *)`, `Bash(brew info *)`, `Bash(brew list *)` - Homebrew queries
  - `Bash(npm list *)`, `Bash(npm info *)` - Node packages
  - `Bash(pip list *)`, `Bash(pip show *)` - Python packages
  - `Bash(nix search *)`, `Bash(nix eval *)` - Nix package queries

**Nix toolchain**
- Rationale: Nix commands have well-scoped side effects and are portable
- Examples:
  - `Bash(nix fmt *)`, `Bash(nix flake check *)`, `Bash(nix flake update *)`
  - `Bash(nix flake show *)`, `Bash(nix flake metadata *)`, `Bash(nix flake lock *)`
  - `Bash(nix-build *)`, `Bash(nix-store *)`, `Bash(nix-env -q *)`

**Test runners**
- Rationale: Test execution is portable and has well-defined scope
- Examples:
  - `Bash(jest *)`, `Bash(vitest *)`, `Bash(pytest *)`, `Bash(deno test *)`
  - `Bash(mocha *)`, `Bash(ava *)`

**System utilities (read-only)**
- Pattern: Commands that read system information without side effects
- Examples:
  - `Bash(xxd *)` - Hex dump
  - `Bash(col *)` - Column formatter
  - `Bash(pgrep *)` - Process grep (read-only)
  - `Bash(pkgutil *)` - Package utility (macOS)
  - `Bash(fc-list *)` - Font list
  - `Bash(printenv *)` - Print environment variables
  - `Bash(lsof *)` - List open files
  - `Bash(ps *)` - Process status
  - `Bash(netstat *)` - Network statistics
  - `Bash(du *)` - Disk usage

**Safe CLI tools**
- Pattern: Tools with specific, safe purposes (NOT universal shells/scripting tools)
- Examples:
  - `Bash(rg *)` - ripgrep search
  - `Bash(tmux *)` - Terminal multiplexer
  - `Bash(nvim *)` - Neovim editor
  - `Bash(zellij *)` - Terminal workspace
  - `Bash(claude *)` - Claude CLI
  - `Bash(gemini *)` - Gemini CLI
  - `Bash(gh *)` - GitHub CLI
  - `Bash(git *)` or specific git subcommands
  - `Bash(starship config *)`, `Bash(starship explain *)`
  - `Bash(terminal-notifier *)` - macOS notifications

**Version check commands**
- Pattern: Commands that display version information
- Rationale: Harmless diagnostics, universally useful
- Examples:
  - `Bash(gcloud version *)` - Cloud SDK version
  - `Bash(tailscale version *)` - Tailscale version
  - `Bash(gogcli version *)` - gogcli version

**Network read-only tools**
- Pattern: Commands that only read network information
- Examples:
  - `Bash(dig *)` - DNS lookup
  - `Bash(nslookup *)` - DNS query
  - `Bash(ping *)` - Network connectivity test

**Basic file operations**
- Pattern: Standard POSIX utilities for reading and basic file management
- Examples:
  - `Bash(cat *)`, `Bash(ls *)`, `Bash(wc *)`, `Bash(sort *)`, `Bash(head *)`, `Bash(tail *)`
  - `Bash(cp *)`, `Bash(mv *)`, `Bash(mkdir *)`, `Bash(rm *)`, `Bash(touch *)`
  - `Bash(grep *)`, `Bash(awk *)`, `Bash(sed *)`, `Bash(jq *)`, `Bash(yq *)`

## Pattern Recognition Guidelines

**For Bash rules**:
1. Extract the command name (before first space or end of pattern)
2. Check against EXCLUDE patterns in order:
   - Universal shell/scripting tool? → EXCLUDE
   - Contains filesystem paths (`/`, `~`, `./`)? → EXCLUDE
   - Contains environment variable assignments (`VAR=value`)? → EXCLUDE
   - Shell execution/sourcing pattern (`source`, `exec`, `-c 'cmd'`)? → EXCLUDE
   - Hardware-specific identifiers (device IDs, serial numbers)? → EXCLUDE
   - Complex quoted shell commands? → EXCLUDE
   - Project-specific tool name (not a standard CLI tool)? → EXCLUDE
   - Shell fragment or builtin keyword? → EXCLUDE
3. If no EXCLUDE pattern matches, lean toward RECOMMEND for well-known CLI tools

**For WebFetch rules**:
- Domain-based (`domain:X`): RECOMMEND (portable, safe)
- URL with path: EXCLUDE (may contain project-specific endpoints)

**Note on deprecated `:*` syntax**:
- Claude Code previously used `Bash(cmd:*)` syntax, which is now deprecated
- The merge script automatically normalizes `:*)` → ` *)` before comparison and application
- When evaluating rules, treat `Bash(cmd:*)` the same as `Bash(cmd *)` — they are equivalent
- Always propose rules in the new ` *` format (e.g., `Bash(tmux *)` not `Bash(tmux:*)`)

**When uncertain**:
- Default to EXCLUDE (safer)
- Provide clear reasoning in the explanation
- User can still manually add to global settings if needed
- Exception: well-known, widely-used CLI tools that clearly don't match EXCLUDE patterns can be RECOMMEND
