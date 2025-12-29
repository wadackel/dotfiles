# dotfiles

macOS development environment configuration managed with Nix, nix-darwin, and home-manager.

## Prerequisites

- macOS (tested on macOS Sonoma 14.x)
- [Nix package manager](https://nixos.org/download.html) installed with flakes enabled
  - Follow the [official installation guide](https://nixos.org/download.html)
  - Enable flakes: `mkdir -p ~/.config/nix && echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf`

## Directory Structure

- `flake.nix` - Nix flake configuration
- `flake.lock` - Locked dependency versions
- `treefmt.nix` - Code formatting configuration
- `darwin/` - nix-darwin system configuration
- `home/` - home-manager user configuration
  - `home.nix` - Main home-manager configuration
  - `programs/` - Program-specific modules (21 programs, auto-imported)
    - `programs/default.nix` - Auto-import helper
    - `programs/<name>/default.nix` - Each program's Nix module
    - `programs/<name>/<config>` - Co-located configuration files

## Setup

### Initial Setup

1. Clone this repository:
   ```bash
   git clone https://github.com/wadackel/dotfiles.git ~/dotfiles
   cd ~/dotfiles
   ```

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

### Configuration Profiles

- **private**: Personal MacBook Air configuration
- **work**: Work MacBook Pro configuration

Profile-specific settings (e.g., scrollbar visibility) are managed in `darwin/configuration.nix`.

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
