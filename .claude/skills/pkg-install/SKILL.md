---
name: pkg-install
description: Adds tools and packages to the dotfiles repository, preferring home-manager (Nix) and falling back to Homebrew. Use when asked to install, add, or set up a tool with "install xxx", "set up xxx", "xxxをインストールして", "xxxを追加して", "xxxを入れて", "xxxを導入して".
argument-hint: "[package-name]"
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
           YES -> home-manager has programs.<name>?
                    YES -> home/programs/<name>/default.nix (new module)
                    NO  -> home/programs/packages/default.nix (home.packages)
           NO  -> Tool provides official flake? (check GitHub repo for flake.nix)
                    YES -> Add as flake input in flake.nix + overlay (Step 2a)
                    NO  -> Go/Rust source available on GitHub?
                             YES -> Custom overlay with buildGoModule/buildRustPackage (Step 2b)
                             NO  -> GitHub Releases has pre-built binary for darwin-arm64?
                                      YES -> Custom overlay with fetchurl + mkDerivation (Step 2c)
                                      NO  -> homebrew.brews (darwin/configuration.nix)
```

## Workflow

### 1. Classify and search

- **GUI app** → Skip to Step 3 (Homebrew)
- **CLI tool** → Check nixpkgs: `nix search nixpkgs#<name>`

If not found, try common aliases (e.g., `rg` → `ripgrep`). If still not found, go to Step 2a.

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

### 2a. Add as flake input (tool provides official flake)

If the tool's GitHub repo has a `flake.nix`, add it as a flake input:

```nix
# flake.nix の inputs に追加
inputs.<tool-name> = {
  url = "github:<owner>/<repo>";
  inputs.nixpkgs.follows = "nixpkgs";
};

# overlays に追加
overlays = [
  (final: prev: {
    <tool-name> = inputs.<tool-name>.packages.${system}.default;
  })
];
```

Then add `<tool-name>` to `home/programs/packages/default.nix`.

### 2b. Custom overlay (Go/Rust source build)

For Go/Rust tools not in nixpkgs and without a flake:

```nix
# flake.nix の overlays に追加
overlays = [
  (final: prev: {
    <tool-name> = final.buildGoModule {
      pname = "<tool-name>";
      version = "<version>";
      src = final.fetchFromGitHub {
        owner = "<owner>";
        repo = "<repo>";
        rev = "v<version>";
        hash = "sha256-...";  # nix-prefetch-url --unpack で取得
      };
      vendorHash = "sha256-...";
    };
  })
];
```

For Rust, use `final.rustPlatform.buildRustPackage` with `cargoHash` instead of `vendorHash`.

Then add `<tool-name>` to `home/programs/packages/default.nix`.

### 2c. Custom overlay (pre-built binary)

For tools with GitHub Releases binaries but no source build support:

```nix
# flake.nix の overlays に追加
overlays = [
  (final: prev: {
    <tool-name> = final.stdenv.mkDerivation {
      pname = "<tool-name>";
      version = "<version>";
      src = final.fetchurl {
        url = "https://github.com/<owner>/<repo>/releases/download/v<version>/<tool-name>-darwin-arm64.tar.gz";
        hash = "sha256-...";
      };
      dontConfigure = true;
      dontBuild = true;
      installPhase = ''
        mkdir -p $out/bin
        install -m755 <tool-name> $out/bin/
      '';
    };
  })
];
```

Then add `<tool-name>` to `home/programs/packages/default.nix`.

### 3. Install via Homebrew

Last resort when Nix options are not viable.

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
- If `darwin-rebuild` fails, fall back to the next option in priority order (nixpkgs → flake input → custom overlay → Homebrew)
- For custom tap formulas, check `brew search <name>` first to see if it's in homebrew-core (tap may not be needed)
- Flake inputs and custom overlays are best for tools you want under long-term Nix management. For temporary or infrequently updated tools, Homebrew is acceptable
