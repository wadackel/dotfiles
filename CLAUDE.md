# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a **declarative macOS development environment** managed with Nix, nix-darwin, and home-manager. The repository uses a flake-based configuration supporting multiple machine profiles (private and work).

**For setup instructions, basic commands, and directory structure, see [README.md](README.md).**

## Working with this Repository

### Claude's Responsibilities

When working on tasks in this repository, Claude Code should:

1. **Take ownership of the entire workflow**
   - Plan and execute changes end-to-end
   - Minimize the need for user verification and manual steps
   - Design workflows that can be validated programmatically when possible

2. **Apply configuration changes**
   - After making changes to Nix files, Claude should apply the configuration using `darwin-rebuild`
   - **CRITICAL**: Always verify the correct profile before applying:
     - Use `.#private` for personal machine (wadackel)
     - Use `.#work` for work machine (tsuyoshi.wada)
   - Check the current user/hostname with `whoami` and `hostname` if uncertain
   - Example: `sudo darwin-rebuild switch --flake .#private`
   - **Important**: When editing symlinked config files (tmux.conf, zshrc, etc.) managed by home-manager, darwin-rebuild is NOT needed. Changes are immediately reflected since the file is symlinked, not copied. Only run darwin-rebuild when modifying Nix files themselves (*.nix).

3. **Verify changes programmatically**
   - Use `nix flake check` before applying
   - After applying, verify the configuration took effect when possible
   - Report any errors or warnings encountered during application

### Workflow Example

When asked to add a new program or modify configuration:

1. Make the necessary changes to Nix files
2. Run `nix flake check` to verify syntax
3. Determine the correct profile (check hostname/username if needed)
4. Apply with `sudo darwin-rebuild switch --flake .#<profile>`
5. Report the results to the user

## Common Development Commands

| Command | Description |
|---------|-------------|
| `nix fmt` | Format all Nix files (treefmt/nixfmt) |
| `nix flake check` | Verify syntax and formatting |
| `sudo darwin-rebuild switch --flake .#private` | Apply configuration changes |

## Architecture

### Profile System

The repository supports two machine profiles defined in `flake.nix`:

- **`private`**: Personal machine (wadackel/wadackels-MacBook-Air)
- **`work`**: Work machine (tsuyoshi.wada/tsuyoshiwadas-MacBook-Pro)

Profiles are the single source of truth for username, hostname, and can enable profile-specific behavior via the `profile` parameter.

### Key Files

- **`flake.nix`**: Main orchestration - defines profiles, creates both `homeConfigurations` (standalone) and `darwinConfigurations` (system+home)
- **`darwin/configuration.nix`**: System-level settings (Nix config, Homebrew, macOS defaults, keyboard/trackpad/Dock settings)
- **`home/home.nix`**: home-manager entry point, auto-imports all program modules
- **`home/programs/default.nix`**: Auto-discovery pattern - dynamically imports all `programs/*/default.nix`

### Program Module Pattern

All program configurations follow a consistent structure:

```
home/programs/<program-name>/
  ├── default.nix       # Nix module (enables program, sources configs)
  └── <config-files>    # Co-located configuration files
```

The `programs/default.nix` auto-imports all subdirectories, enabling modular configuration. To add a new program:

1. Create `home/programs/<name>/default.nix`
2. Place config files alongside the module
3. No manual imports needed - auto-discovery handles it

### `dotfiles.linkHere` and `recursive`

`lib/dotfiles-path.nix`'s `linkHere` creates out-of-store symlinks. When combined with `home.file`'s `recursive = true`, it creates individual file links via the Nix store, requiring `darwin-rebuild` when adding new files. Linking the entire directory (without `recursive`) allows new files to be reflected automatically.

### Helper Functions in flake.nix

- **`mkHome`**: Creates standalone home-manager configuration
- **`mkDarwin`**: Creates nix-darwin configuration with embedded home-manager
- **`mkHomeDir`**: Derives home directory from username (`/Users/${username}`)

Both configurations use the same overlays and extraSpecialArgs to ensure consistency.

## Configuration Scope

### What's Managed by Nix

- **System settings**: All macOS defaults (keyboard, trackpad, Finder, Dock, etc.) in `darwin/configuration.nix`
- **CLI tools**: Most development tools are in `home/programs/packages/default.nix` as Nix packages
- **Fonts**: Nerd Fonts managed via home-manager (auto-synced to `~/Library/Fonts/HomeManager/`)
- **Shell configuration**: zsh, bash, fish with starship prompt
- **Program configs**: git, neovim, tmux, fzf, and 20+ other tools

### What's Still Using Homebrew

Despite Nix, Homebrew is used for:

- **Applications/Casks**: Arc, Chrome Canary, Claude Code, Raycast, WezTerm, 1Password CLI, etc.
- **Python versions**: 3.8, 3.9, 3.10, 3.11, 3.13, 3.14 (not yet stable in nixpkgs)
- **Specialized tools**: z3, cask, numpy, pillow
- **Custom taps**: wadackel/tap (pinact)

Homebrew configuration is in `darwin/configuration.nix` under the `homebrew` section.

## Making Changes

### Adding a New Program

1. Create directory: `mkdir -p home/programs/<program-name>`
2. Create module: `home/programs/<program-name>/default.nix`
3. Add configuration files in the same directory
4. Track new files in Git: `git add home/programs/<program-name>/` (Nix flake only recognizes tracked files)
   - **For shell scripts**: Run `chmod +x <file>` to set the filesystem execute bit before `darwin-rebuild`
   - Note: `git update-index --chmod=+x` only changes the git INDEX, not the actual filesystem
   - The Nix store inherits the execute bit from the source, so `chmod +x` on the source → `darwin-rebuild` is required
5. Apply: `sudo darwin-rebuild switch --flake .#private`

Example module structure:

```nix
{ config, pkgs, ... }:
{
  programs.<program-name> = {
    enable = true;
    # ... program-specific options
  };
}
```

### Modifying macOS System Settings

Edit `darwin/configuration.nix` under the `system.defaults.*` sections. Settings are organized by category:

- `system.defaults.NSGlobalDomain.*`: Global macOS settings
- `system.defaults.dock.*`: Dock behavior
- `system.defaults.finder.*`: Finder settings
- `system.defaults.trackpad.*`: Trackpad configuration
- `system.defaults.screencapture.*`: Screenshot settings

### Profile-Specific Configuration

Use the `profile` parameter (available in darwin modules) for conditional configuration:

```nix
system.defaults.NSGlobalDomain.AppleShowScrollBars =
  if profile == "work" then "Always" else "Automatic";
```

### Updating Dependencies

```bash
# Update all flake inputs (nixpkgs, home-manager, nix-darwin, etc.)
nix flake update

# Update specific input
nix flake lock --update-input nixpkgs

# Apply updated configuration
sudo darwin-rebuild switch --flake .#private
```

For rollback commands and generation management, see [README.md](README.md#rollback).

## Troubleshooting

### Hot-reloading tmux Configuration

The tmux config file is located at the XDG path `~/.config/tmux/tmux.conf` (`~/.tmux.conf` does not exist).
Command to hot-reload after editing: `TMUX="" tmux source-file ~/.config/tmux/tmux.conf`

`\;` inside `bind-key`'s `if-shell` arguments does not function as a command separator (`tmux list-keys` shows `\\;`, meaning it is retained as a literal character). To execute multiple commands sequentially, separate with `\;` at the top level of `bind-key`:
- ✗ `bind-key h if-shell -F cond 'cmd1 \; cmd2'` — `cmd1 \; cmd2` treated as a single command
- ✓ `bind-key h if-shell -F cond 'cmd1' \; if-shell -F cond2 'cmd2'` — separated at top level

### Command Execution from launchd / macOS Notifications

Scripts executed on macOS notification click (e.g., `terminal-notifier -execute`) run in the launchd environment where PATH is limited to `/usr/bin:/bin:/usr/sbin:/sbin`. When using Nix-managed commands (tmux, jq, etc.), full paths must be provided.

### Configuration Not Applied

If system settings don't update after `darwin-rebuild`:

1. Check if the setting requires logout/reboot
2. Some Dock/Finder settings use post-activation scripts for immediate effect (see `system.activationScripts`)
3. Try: `killall Dock && killall Finder`

### Homebrew Formula Not Found

The `homebrew.global.brewfile` is disabled due to formula lookup issues during migration. Formulas are explicitly listed in `homebrew.brews`.

### Rollback After Bad Change

Nix keeps all previous generations - you can always rollback safely. See [README.md](README.md#rollback) for rollback commands.

## Claude Code Integration

This repository includes comprehensive Claude Code configuration:

- **Settings**: `home/programs/claude/settings.json` (symlinked to `~/.claude/settings.json`)
- **Agents**: 10 specialized agents in `home/programs/claude/agents/` (code-review, security-audit, architecture-review, debugging, frontend, refactoring, build-error-resolution, task-planning, TDD, skill-review)
- **Scripts**: `home/programs/claude/scripts/` (symlinked to `~/.claude/scripts/`)
  - `claude-notify.ts`: terminal-notifier + tmux integration notifications. Debug: `~/.claude/scripts/claude-notify.ts debug`
  - `claude-memo.ts`: Stop hook that writes session summaries to Obsidian daily notes. Debug: `$TMPDIR/claude-memo.log`
  - `bash-policy.ts`: `PreToolUse` hook (always active) that blocks prohibited command patterns. Rules defined in: `bash-policy.yaml` (same directory)
  - `claude-pane-status.ts`: Hook that writes session state to tmux pane options for the popup picker. Invoked per event by argv[0] (SessionStart/End/UserPromptSubmit/Stop/StopFailure/Notification/PermissionDenied/CwdChanged/Subagent*/Worktree*). Unknown events are a no-op. Debug: pipe JSON to stdin with `TMUX_PANE` set
  - Running Claude script tests: `deno test --allow-env=HOME --allow-read --allow-write home/programs/claude/scripts/<name>_test.ts`
  - When adding new scripts, add `"Bash(*<script-name>*)"` to `permissions.allow` in `settings.json` (wildcard prefix handles full-path invocations by Claude. `Bash(<script-name>*)` does not match path-prefixed invocations)
  - Invocations with redirects (`2>/dev/null`, etc.) do not match `Bash()` patterns (known limitation), but `approve-piped-commands.ts` reads patterns from `settings.json` and auto-approves, so no additional work is needed
  - Exception: Scripts called from `hooks` are not Bash tool calls, so adding to `permissions.allow` is not required
  - When adding new scripts, grant execute permission with `chmod +x` (execute bit is required for hook execution. Git manages mode as 100644/100755, so a commit is also needed)
- **Module**: `home/programs/claude/default.nix` manages symlinking to `~/.claude/`
- **Global CLAUDE.md**: `home/programs/claude/CLAUDE.md` is the symlink source for `~/.claude/CLAUDE.md`. Edit this file directly when modifying global settings
- **`permissions.allow`**: Adding `Edit(~/.claude/**)` and `Write(~/.claude/**)` allows skills to edit files under `~/.claude/` without confirmation dialogs

Editing existing Claude Code config files (settings.json, skills, etc.) is immediately reflected — no `darwin-rebuild` needed (they are symlinked). Only run `darwin-rebuild` when adding *new* files that need new symlinks created.

### picker-verify (tmux picker e2e)

After changing `home/programs/tmux/picker.tsx`, `home/programs/tmux/picker_e2e_harness.ts`, or `home/programs/tmux/picker_e2e_test.ts`, run `.claude/skills/picker-verify/picker-verify.ts` (or invoke the `/picker-verify` skill). It spins up an isolated `tmux -L picker-e2e-$PID` server, runs the 6 e2e scenarios (warm path ~3 s, 30 s budget), and emits a JSON verdict. Escape-driven exit is exercised in every scenario, so a broken quit path fails CI-style rather than leaking a stuck picker into the sandbox. Do not claim picker changes are complete while `ok: false`.

### Picker binary (prefix+w)

`tmux.conf`'s `bind-key w` invokes the AOT-compiled binary at `~/.local/share/picker-tmux/picker`, not `deno run picker.tsx`. The binary is produced by `home.activation.compilePickerBin` in `home/programs/tmux/default.nix` via `deno compile` (React+Ink cold-start is ~236ms; AOT is the only way to amortize it for a popup). Hash-skip keys on `shasum -a 256` of `picker.tsx` + `pane_row.ts`.

Implications when editing picker source:

- Running `deno run picker.tsx` or `/picker-verify` exercises the source path only. Neither tells you whether the deployed binary reflects your edits.
- To make changes visible to `prefix+w`, run `sudo darwin-rebuild switch --flake .#private` — the activation detects the source hash change and recompiles.
- To iterate without a full rebuild, re-run the compile directly: `mise exec -- deno compile --allow-env --allow-read --allow-run=tmux,git --output ~/.local/share/picker-tmux/picker home/programs/tmux/picker.tsx` (arg set must match the activation).
- Do not claim picker work is complete based solely on `deno run` or `picker-verify` output — the binary is the thing users invoke.

### Project Directory Encoding Rules

Directory names under `~/.claude/projects/` are encoded from the project path: strip the leading `/`, add `-` as a prefix, and replace both `/` and `.` with `-`.
Example: `/Users/foo/github.com/bar` → `-Users-foo-github-com-bar`

### bash-policy

`bash-policy.ts` evaluates all Bash commands as a global `PreToolUse` hook.
- **Blocking behavior**: exit 2 → command not executed → stderr returned to Claude as error feedback → self-correction
- **Global rules**: `~/.claude/scripts/bash-policy.yaml` (currently: `git -C *`)
- **Project rules**: Create `.claude/bash-policy.yaml` and it will be auto-loaded by searching upward from `cwd` (already in global gitignore)
- **Rule format**: YAML with `pattern: "npx *"` + `message: "..."` (glob matching)

### Hook Data

Claude Code hooks receive JSON via stdin with common fields (`session_id`, `transcript_path`, `hook_event_name`, `cwd`) plus event-specific fields. `cwd` is the project root at session start (constant regardless of `cd` within bash commands). Stop hook: `stop_hook_active`. Notification hook: `message`, `title`, `notification_type`.

### `permissions.allow` Limitations

Commands containing pipes `|`, `&&`, `||`, `;`, or redirects `2>&1` do not match `Bash(cmd *)` patterns — this is a known limitation ([Issue #13137](https://github.com/anthropics/claude-code/issues/13137)). Workaround:
- Use a `PermissionRequest` hook to segment commands containing shell syntax (pipes, redirects, etc.), match against a whitelist, and auto-approve (see `home/programs/claude/scripts/approve-piped-commands.ts`)
- `PermissionRequest` fires only just before a permission dialog appears, making it lower overhead than `PreToolUse`

`Tool(**)` patterns (e.g., `Read(**)`) only cover paths within the project directory and `additionalDirectories`. For paths outside the project like `~/.claude/`, add `Tool(~/.claude/**)` separately. All three of `Read`, `Edit`, and `Write` need the `~/.claude/**` pattern.
