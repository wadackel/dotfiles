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

### Code Formatting

```bash
# Format all Nix files using treefmt (nixfmt)
nix fmt

# Check formatting (CI)
nix flake check
```

### Testing Configuration Changes

```bash
# Verify syntax before applying
nix flake check

# Apply and test changes
sudo darwin-rebuild switch --flake .#private
```

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

`lib/dotfiles-path.nix` の `linkHere` は out-of-store symlink を作成する。`home.file` の `recursive = true` と組み合わせると Nix store 経由の個別ファイルリンクとなり、新ファイル追加時に `darwin-rebuild` が必要。ディレクトリ全体をリンク (`recursive` なし) にすれば新ファイルが自動反映される。

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
- **Program configs**: git, neovim, tmux, zellij, fzf, and 20+ other tools

### What's Still Using Homebrew

Despite Nix, Homebrew is used for:

- **Applications/Casks**: Arc, Chrome Canary, Claude Code, Raycast, WezTerm, 1Password CLI, etc.
- **Python versions**: 3.8, 3.9, 3.10, 3.11, 3.13, 3.14 (not yet stable in nixpkgs)
- **Specialized tools**: z3, cask, numpy, pillow
- **Custom taps**: wadackel/tap (ofsht, pinact)

Homebrew configuration is in `darwin/configuration.nix` under the `homebrew` section.

## Making Changes

### Adding a New Program

1. Create directory: `mkdir -p home/programs/<program-name>`
2. Create module: `home/programs/<program-name>/default.nix`
3. Add configuration files in the same directory
4. Track new files in Git: `git add home/programs/<program-name>/` (Nix flake only recognizes tracked files)
   - **シェルスクリプトの場合**: `chmod +x <file>` でファイルシステムの execute bit を付与してから `darwin-rebuild`
   - `git update-index --chmod=+x` は git INDEX のみ変更しファイルシステムは変更しない点に注意
   - nix store はソースの execute bit を引き継ぐため、ソースへの `chmod +x` → `darwin-rebuild` が必要
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

## Development Environment

### Supported Languages and Tools

This configuration includes comprehensive support for:

- **Node.js**: pnpm, npm, yarn (via mise/asdf)
- **Rust**: cargo, rustc, rustfmt
- **Python**: Multiple versions via Homebrew, poetry
- **Ruby**: rbenv
- **Go**: go toolchain
- **Dart/Flutter**: Flutter SDK
- **Java/Android**: JDK, Android SDK tools
- **WebAssembly**: wabt, wasmtime

### Editor Configuration

- **Neovim**: Lua config at `home/programs/neovim/init.lua`
- **Vim**: Traditional vimrc configuration
- **Git**: git config with 40+ aliases

### Terminal Stack

Multiple terminal options configured:

- **Shells**: zsh, bash, fish
- **Prompt**: starship with custom configuration
- **Multiplexers**: tmux, zellij (with layouts and themes)
- **Emulators**: WezTerm, ghostty

## Troubleshooting

### launchd / macOS 通知からのコマンド実行

`terminal-notifier -execute` など macOS 通知クリック時に実行されるスクリプトは launchd 環境で動作し、PATH が `/usr/bin:/bin:/usr/sbin:/sbin` に限定される。Nix 管理のコマンド (tmux, jq など) を使う場合はフルパスを渡す必要がある。

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
- **Agents**: 20 specialized agents in `home/programs/claude/agents/` (accessibility, architecture, backend, cloud, code-review, debugging, DevOps, documentation, error-detective, frontend, JavaScript/TypeScript, performance, QA, React, refactoring, security-audit, security-engineering, SRE, technical writing)
- **Scripts**: `home/programs/claude/scripts/` (symlinked to `~/.claude/scripts/`, PATH に追加済み)
  - `claude-notify.ts`: terminal-notifier + tmux 連携通知。デバッグ: `claude-notify.ts debug`
  - `extract-session-history.ts`: セッションの transcript JSONL を読み取り、構造化された markdown に変換して出力
  - `claude-memo.ts`: セッション要約を Obsidian デイリーノートに書き込む Stop hook。デバッグ: `$TMPDIR/claude-memo.log`
  - `bash-policy.ts`: 禁止コマンドパターンをブロックする `PreToolUse` hook（常時稼働）。ルール定義: `bash-policy.yaml`（同ディレクトリ）
  - 新スクリプト追加時は `settings.json` の `permissions.allow` に `"Bash(*<script-name>*)"` を追記すること（ワイルドカード接頭辞で、Claude がフルパスで呼び出す場合にも対応。`Bash(<script-name>*)` ではパス付き呼び出しにマッチしない）
  - リダイレクト付き呼び出し（`2>/dev/null` 等）は `Bash()` パターンにマッチしない既知制限があるため、`approve-piped-commands.ts` の `ALLOWED_COMMANDS` にもスクリプト名を追加すること
  - 例外: `hooks` から呼び出されるスクリプトは Bash tool call ではないため `permissions.allow` への追加不要
  - 新スクリプト追加時は `chmod +x` で実行権限を付与すること（hooks からの実行に execute bit が必要。git が 100644/100755 でモードを管理するので commit も必要）
- **Module**: `home/programs/claude/default.nix` manages symlinking to `~/.claude/`
- **グローバル CLAUDE.md**: `home/programs/claude/CLAUDE.md` が `~/.claude/CLAUDE.md` のシンボリックリンク元。グローバル設定を編集する際はこのファイルを直接編集する
- **`permissions.allow`**: `Edit(~/.claude/**)` と `Write(~/.claude/**)` を追加することで、skill が `~/.claude/` 配下のファイルを確認ダイアログなしに編集できる

Editing existing Claude Code config files (settings.json, skills, etc.) is immediately reflected — no `darwin-rebuild` needed (they are symlinked). Only run `darwin-rebuild` when adding *new* files that need new symlinks created.

### プロジェクトディレクトリのエンコード規則

`~/.claude/projects/` のディレクトリ名はプロジェクトパスのエンコード: 先頭 `/` 除去後に `-` を prefix、`/` と `.` をどちらも `-` に置換。
例: `/Users/foo/github.com/bar` → `-Users-foo-github-com-bar`

### bash-policy

`bash-policy.ts` はグローバル `PreToolUse` hook として全 Bash コマンドを評価する。
- **ブロック動作**: exit 2 → コマンド不実行 → stderr がエラーフィードバックとして Claude へ返却 → 自己修正
- **グローバルルール**: `~/.claude/scripts/bash-policy.yaml`（現在: `git -C *`）
- **プロジェクトルール**: `.claude/bash-policy.yaml` を作成すると `cwd` から上方探索して自動ロード（グローバル gitignore 済み）
- **ルール形式**: `pattern: "npx *"` + `message: "..."` の YAML（glob マッチ）

### Hook Data

Claude Code hooks receive JSON via stdin with common fields (`session_id`, `transcript_path`, `hook_event_name`, `cwd`) plus event-specific fields. `cwd` はセッション開始時のプロジェクトルート（bash コマンド内の `cd` に関わらず一定）。 Stop hook: `stop_hook_active`. Notification hook: `message`, `title`, `notification_type`.

### `permissions.allow` の制限

パイプ `|`、`&&`、`||`、`;`、リダイレクト `2>&1` などを含むコマンドは `Bash(cmd *)` パターンにマッチしない既知の制限がある（[Issue #13137](https://github.com/anthropics/claude-code/issues/13137)）。対処法:
- `PermissionRequest` hook でパイプ・リダイレクト等のシェル構文を含むコマンドをセグメント分割してホワイトリスト照合し自動承認する（`home/programs/claude/scripts/approve-piped-commands.ts` 参照）
- `PermissionRequest` は権限ダイアログが発生する直前のみ発火するため、`PreToolUse` より低オーバーヘッド
