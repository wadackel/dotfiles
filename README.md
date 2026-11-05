# dotfiles

macOS development environment configuration managed with Nix, nix-darwin, and home-manager.

## Prerequisites

- macOS
- [Nix package manager](https://nixos.org/download.html) installed with flakes enabled
  - Follow the [official installation guide](https://nixos.org/download.html)
  - Enable flakes: `mkdir -p ~/.config/nix && echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf`

## Directory Structure

- `flake.nix` - Nix flake configuration
- `flake.lock` - Locked dependency versions
- `treefmt.nix` - Code formatting configuration
- `darwin/` - nix-darwin system configuration
- `lib/dotfiles-path.nix` - `linkHere` / `pathHere`, which link or point at files in the `~/dotfiles` worktree
- `home/` - home-manager user configuration
  - `home.nix` - Main home-manager configuration
  - `programs/` - Program-specific modules (one directory per program, auto-imported)
    - `programs/default.nix` - Auto-import helper
    - `programs/<name>/default.nix` - Each program's Nix module
    - `programs/<name>/<config>` - Co-located configuration files
- `package.json`, `bun.lock`, `.npmrc`, `tsconfig.json` - Dependencies and type check for the TypeScript scripts, which run on Bun
- `AGENTS.md` (root and next to some subsystems) - Notes for coding agents

## Setup

### Initial Setup

1. Clone this repository:
   ```bash
   git clone https://github.com/wadackel/dotfiles.git ~/dotfiles
   cd ~/dotfiles
   ```
   The repository must live at `~/dotfiles`: many config files are symlinked from there rather than copied. Every switch runs `bun install --frozen-lockfile` in it (the network is needed only after `bun.lock` changed); if that step fails, the switch stops, so run `bun install --frozen-lockfile --ignore-scripts` in `~/dotfiles` by hand and switch again.

2. Apply darwin configuration (first time - bootstrap):
   ```bash
   # First time setup requires using nix run (darwin-rebuild is not yet in PATH)
   sudo nix run nix-darwin/master#darwin-rebuild -- switch --flake .#private
   # or for work profile:
   sudo nix run nix-darwin/master#darwin-rebuild -- switch --flake .#work
   ```

3. After the first setup, use the standard command:
   ```bash
   sudo darwin-rebuild switch --flake .#private
   ```

## Program Modules

All program configurations are located in `home/programs/` with a consistent structure:
- Each program has its own directory: `home/programs/<name>/`
- Module file: `home/programs/<name>/default.nix`
- Co-located config files: `home/programs/<name>/<config-files>`

## Updating Configuration

After making changes to any configuration file:

```bash
cd ~/dotfiles

# Verify syntax (optional)
nix flake check

# Apply configuration
sudo darwin-rebuild switch --flake .#private
# or for work profile:
sudo darwin-rebuild switch --flake .#work
```

On the private profile, `sudo darwin-rebuild` needs no password (a sudoers entry in `darwin/configuration.nix` covers that command only), so a coding agent without a terminal can apply changes with `sudo -n darwin-rebuild switch --flake .#private`. Every other `sudo` command still asks for the password.

## Updating Dependencies

To update all packages to their latest versions:

```bash
cd ~/dotfiles

# Update all flake inputs (nixpkgs, home-manager, nix-darwin, etc.)
nix flake update

# Verify syntax (optional but recommended)
nix flake check

# Apply updated configuration
sudo darwin-rebuild switch --flake .#private
```

To update specific inputs only:

```bash
# Update only nixpkgs
nix flake update nixpkgs

# Update only home-manager
nix flake update home-manager

# Update only nix-darwin
nix flake update nix-darwin
```

## Rollback

If something goes wrong, rollback to the previous generation:

```bash
cd ~/dotfiles

# Rollback to previous generation
sudo darwin-rebuild --rollback

# List all generations
darwin-rebuild --list-generations

# Switch to specific generation
sudo darwin-rebuild --switch-generation <number>
```

Automatic garbage collection periodically deletes generations older than 14 days, so a generation older than that may no longer be there to switch back to.
