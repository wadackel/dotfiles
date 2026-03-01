---
name: pkg-install
description: Adds tools and packages to the dotfiles repository, preferring home-manager (Nix) and falling back to Homebrew. Use when asked to install, add, or set up a tool with "install xxx", "set up xxx", "xxxをインストールして", "xxxを追加して", "xxxを入れて", "xxxを導入して".
argument-hint: [package-name]
---

# Package Install

Adds `$ARGUMENTS` to this dotfiles repository.

## Quick Start

```
/pkg-install <package-name>
```

## Decision Flow

```
GUI app?
  YES -> homebrew.casks (darwin/configuration.nix)
  NO  -> Found via `nix search nixpkgs#<name>`?
           NO  -> homebrew.brews (darwin/configuration.nix)
           YES -> home-manager has programs.<name>?
                    YES -> home/programs/<name>/default.nix (new module)
                    NO  -> home/programs/packages/default.nix (home.packages)
```

## Workflow

### 1. Classify and search

- **GUI app** → Skip to Step 3 (Homebrew)
- **CLI tool** → Check nixpkgs: `nix search nixpkgs#<name>`

If not found, try common aliases (e.g., `rg` → `ripgrep`). If still not found, go to Step 3.

### 2. Choose Nix installation method

Determine if home-manager has a `programs.<name>` module. If unsure, search the web.

**If dedicated module exists** → Create `home/programs/<name>/default.nix`:

```nix
{ config, lib, ... }:
{
  programs.<name> = {
    enable = true;
    # Shell integrations if available:
    # enableZshIntegration = lib.mkIf (config.programs.zsh.enable or false) true;
    # enableFishIntegration = lib.mkIf (config.programs.fish.enable or false) true;
    # enableBashIntegration = lib.mkIf (config.programs.bash.enable or false) true;
  };
}
```

Auto-discovery handles imports automatically. Place config files in the same directory.

**If no dedicated module** → Add to the appropriate category in `home/programs/packages/default.nix`:

```nix
<package-name> # short description
```

### 3. Install via Homebrew

Add to the relevant section in `darwin/configuration.nix`:

- **CLI formula** → `homebrew.brews`
- **GUI app** → `homebrew.casks`

### 4. Verify and apply

1. Stage new files if any: `git add home/programs/<name>/`
2. `nix fmt` && `nix flake check`
3. Determine profile via `whoami` (`wadackel` → `.#private`, `tsuyoshi.wada` → `.#work`)
4. `sudo darwin-rebuild switch --flake .#<profile>`
5. Verify with `which <name>` or `<name> --version`

## Notes

- If the user explicitly requests Homebrew, follow that preference
- Check `home/programs/mise/default.nix` first for mise-managed tools (Node.js, Go, Rust, etc.) to avoid duplication
- If `darwin-rebuild` fails, fall back to the next option in priority order
- For custom tap formulas, check `brew search <name>` first to see if it's in homebrew-core (tap may not be needed)
