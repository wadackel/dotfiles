# AGENTS.md

This file provides guidance to coding agents (Claude Code, Codex) when working with code in this repository.

## Repository Overview

This is a **declarative macOS development environment** managed with Nix, nix-darwin, and home-manager. The repository uses a flake-based configuration supporting multiple machine profiles (private and work).

**For setup instructions, basic commands, and directory structure, see [README.md](README.md).**

## Working with this Repository

### Claude's Responsibilities

When working on tasks in this repository, Claude Code should:

1. **Apply configuration changes**
   - After making changes to Nix files, Claude should apply the configuration using `darwin-rebuild`
   - Apply the profile that matches this machine; a profile sets the username and hostname, so applying the other one misconfigures the machine:
     - `.#private` for the personal machine (wadackel)
     - `.#work` for the work machine (tsuyoshi.wada)
   - Check the current user/hostname with `whoami` and `hostname` if uncertain
   - Example: `sudo darwin-rebuild switch --flake .#private`
   - When editing symlinked config files (tmux.conf, zshrc, etc.) managed by home-manager, darwin-rebuild is not needed. Changes are immediately reflected since the file is symlinked, not copied. Only run darwin-rebuild when modifying Nix files themselves (*.nix).

2. **Verify changes programmatically**
   - Use `nix flake check` before applying
   - After applying, verify the configuration took effect when possible
   - Report any errors or warnings encountered during application

### Branch Policy

Work and commit directly on `main`. Do not create or switch to another branch unless the user asks for one, even when asked to commit while on `main`; in this repository that overrides both the harness default of branching first on the default branch and the global rule to branch for an unrelated fix. A worktree under `.claude/worktrees/` (for example for longer Hermes work) is the one exception. `.claude/bash-policy.yaml` blocks `git switch -c` / `git checkout -b` here; when the user does want a branch, ask them to run it with `! git switch -c <name>`.

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

- **`private`**: Personal machine (wadackel/wadackels-Mac-mini)
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

`pathHere` returns the same worktree path as a plain string, for a module that must hand a path to a program instead of linking it (the Hermes scripts, and `apply-managed.ts` in the Codex activation). It asserts at evaluation that the file exists in the flake source, so a new file has to be tracked by Git first.

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

- **Applications (casks)**: Arc, Chrome Canary, the Claude desktop app, Tinycast, WezTerm, 1Password CLI, etc.
- **Python**: `python@3.14` with `numpy` / `pillow`
- **Formulas**: `tree-sitter-cli` (nvim-treesitter needs a newer release than nixpkgs ships), `z3`, `cask`

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

### Scripts on Bun

The TypeScript scripts in this repository run on Bun. An executable script has the shebang `#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null`. The code is written against `node:*` APIs and web standards: no `Bun.*` API, and from `bun:test` only the names `node:test` also exports, so the runtime stays replaceable. `home/programs/opencode/plugin.ts` is the exception, because it runs inside opencode's own Bun; it starts `opencode-memo.ts` and `vocab.ts` by path, so their shebangs need `bun` on the PATH opencode was started with, and it warns once at load when there is none. `plugin.ts` and `plugins/rtk.ts` are outside the type check: they import `@opencode-ai/plugin`, which this repository does not install.

- **The three shebang flags are a trust boundary.** A plain `bun script.ts` runs the `preload` of a `bunfig.toml` in the current directory and loads the `.env` there (observed on 1.4.2), and hooks, skills and the Agentower popup all run with whatever repository is being worked on as their cwd. `--config=/dev/null` and `--no-env-file` turn both off; `--no-install` makes a missing `node_modules` an error instead of a fetch at run time. Start another script of this repository by its path so its shebang applies, and pass the same flags wherever `bun` is named explicitly (a Nix module, `bun test` from a script). A compiled binary needs `--no-compile-autoload-bunfig --no-compile-autoload-dotenv` at build time for the same reason. A command that runs where `bun` is not on PATH — a `terminal-notifier -execute` string, anything the Hermes gateway starts under launchd — names the interpreter by absolute path (`process.execPath` or `${pkgs.bun}/bin/bun`) followed by the same three flags; the Hermes scripts have no shebang at all for that reason. Bun has no permission model: what Deno's `--allow-*` flags used to confine (Hermes's hosts and directories, a hook's read-only scope) is now confined only by what the code does.
- **Dependencies** live in one root `package.json` with `bun.lock`; scripts import them by bare name (`import { z } from "zod"`). Bun resolves a script through its real path, so one reached through a published symlink such as `~/.claude/scripts/` still finds the repository's `node_modules`. JSR packages (`@std/assert`, `@std/yaml`, `@std/cli`, `@std/streams`, `@ein/bash-parser`) come through the `@jsr` registry in `.npmrc`, aliased in `package.json` as `npm:@jsr/<scope>__<name>`. Versions are pinned exactly. Add one with `bun add --exact <name>`, or `bunx jsr add <@scope/name>` for JSR (then drop the `^` it writes), and commit `package.json` and `bun.lock` together. Do not rely on Bun's auto-install: with a version already cached it failed on some specifiers with `Unexpected while resolving package`, and `bun build --compile` ignores it.
- **Install**: `home.activation.installDotfilesDeps` (`home/programs/bun/default.nix`) runs `bun install --frozen-lockfile --ignore-scripts --cwd ~/dotfiles` on every switch, before home-manager sets up the launchd agents, so a switch never restarts the Hermes gateway before `node_modules` is there. It needs the network only after `bun.lock` changed. A failure stops the whole `darwin-rebuild switch` there: the activation fragments after it do not run and `/run/current-system` is not updated. Run `bun install --frozen-lockfile --ignore-scripts` in `~/dotfiles`, then switch again. An activation step that runs a Bun script is ordered `entryAfter [ "installDotfilesDeps" ]` and names the script in `~/dotfiles`, not a store copy, because only the worktree has `node_modules`: `compileAgentowerBin`, and `codexConfig` (`home/programs/codex/default.nix`), which merges the managed keys into `~/.codex/config.toml` with `scripts/apply-managed.ts`. A switch therefore runs whatever version of that script is on disk. A worktree under `.claude/worktrees/` has no `node_modules` until `bun install --frozen-lockfile` is run in it.
- **Running commands**: `run()` in `home/programs/agents/lib/proc.ts` returns `{ code, signal, stdout, stderr }` as text with no output limit; `env` is layered over the parent environment unless `clearEnv` is set. Use `spawn` from `node:child_process` directly for a streamed or long-lived child, and never `execFile` / `exec`, whose 1 MiB `maxBuffer` throws.
- **Tests**: `bun test <dir or files>` from the repository root, with `import { test } from "bun:test"` and assertions from `@std/assert`. Every test file runs in one process, so a test that changes the working directory, `process.env`, or a signal handler restores it in `finally`. The report goes to stderr, and with `CLAUDECODE=1` in the environment (any agent session) it is only the ` N pass` / ` N fail` summary; `CLAUDECODE= bun test …` brings back the `(pass)` / `(fail)` line per test. The default limit is 5 seconds per test (`--timeout <ms>`). The time zone inside `bun test` is UTC, not the machine's. A directory that starts with a dot needs a `./` prefix (`bun test ./.claude/skills/nvim-verify`).
- **stdin**: read it with `text(process.stdin)` from `node:stream/consumers`, and only on a path that needs it. With stdin a pipe that stays open, as for a hook, anything that starts the stream keeps the process from exiting.
- **Types**: `bunx tsc --noEmit` (TypeScript 7, `tsconfig.json` at the root). `erasableSyntaxOnly` is on: no `enum`, `namespace`, or constructor parameter properties, and relative imports keep their `.ts` extension. `include` lists the script directories; `home/programs/opencode/plugin.ts` and `plugins/rtk.ts` are left out.

## Troubleshooting

### Hot-reloading tmux Configuration

The tmux config file is located at the XDG path `~/.config/tmux/tmux.conf` (`~/.tmux.conf` does not exist).
Command to hot-reload after editing: `TMUX="" tmux source-file ~/.config/tmux/tmux.conf`

`\;` inside `bind-key`'s `if-shell` arguments does not function as a command separator (`tmux list-keys` shows `\\;`, meaning it is retained as a literal character). To execute multiple commands sequentially, separate with `\;` at the top level of `bind-key`:
- ✗ `bind-key h if-shell -F cond 'cmd1 \; cmd2'` — `cmd1 \; cmd2` treated as a single command
- ✓ `bind-key h if-shell -F cond 'cmd1' \; if-shell -F cond2 'cmd2'` — separated at top level

### Session Variables and tmux

A change to `home.sessionVariables` (for example `LLM_WIKI_VAULT_ROOT` in `home/programs/agents/default.nix`) does not reach a tmux server that was already running: new panes inherit the server's environment from when it started, so an agent launched inside tmux still sees the old value or none. Either push the variable into the server with `tmux set-environment -g VAR value` or restart the server. `/llm-wiki` asks before doing anything when the variable is empty rather than searching an empty path.

### Command Execution from launchd / macOS Notifications

Scripts executed on macOS notification click (e.g., `terminal-notifier -execute`) run in the launchd environment where PATH is limited to `/usr/bin:/bin:/usr/sbin:/sbin`. When using Nix-managed commands (tmux, jq, etc.), full paths must be provided.

### Configuration Not Applied

If system settings don't update after `darwin-rebuild`:

1. Check if the setting requires logout/reboot
2. Some Dock/Finder settings use post-activation scripts for immediate effect (see `system.activationScripts`)
3. Try: `killall Dock && killall Finder`

### Rollback After Bad Change

Nix keeps all previous generations - you can always rollback safely. See [README.md](README.md#rollback) for rollback commands.

## Subsystem notes

Each subsystem keeps its notes in an `AGENTS.md` next to its code. Claude Code loads one when it reads a file in that directory; Codex, and anyone reading files through a shell, has to open it. Before changing files in one of these directories, read its notes:

- `home/programs/claude/AGENTS.md`: Claude Code settings, hooks (bash-policy, rtk, pane status), scripts, agents, gate, the global instructions, permission rules
- `home/programs/agents/scripts/AGENTS.md`: plan-state / plan-evidence, check-plan, config-lint, vocab, abr, rebase-guard, vendored skills sync
- `home/programs/hermes/AGENTS.md`: applying Hermes changes, the gateway, `!claude` tasks
- `home/programs/tmux/agentower/AGENTS.md`: the Agentower binary, its e2e and bench

## Skills layout

- `home/programs/claude/skills/`: public Claude Code skills exposed as `~/.claude/skills`
- `home/programs/codex/skills/`: public Codex skills exposed as `~/.agents/skills`
- `home/programs/agents/skills/`: common skill implementations shared by multiple agents
- `home/programs/agents/memo/`: shared memo libraries used by Claude / Codex / opencode
  - The summary `claude -p` that all three memo scripts spawn runs with `~/.cache/claude-memo` as its cwd, so its transcripts collect under `~/.claude/projects/-Users-<name>--cache-claude-memo/` instead of the session's working directory, and are removed by the default 30-day cleanup
- `home/programs/agents/shared/`: shared non-public skill assets such as plan reference prompts
- Agent-specific skills with the same public name (for example `plan` and `impl`) live directly under each agent's public skill root
- Generic skills used by multiple agents keep their implementation under `home/programs/agents/skills/`; each agent public root exposes them with symlinks
- Both public skill roots are linked as whole directories without `recursive = true`; adding a new common skill under `home/programs/agents/skills/` plus per-agent symlinks under the public roots is reflected without adding new Nix `home.file` entries
