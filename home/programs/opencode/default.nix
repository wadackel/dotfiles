{ dotfiles, ... }:
{
  programs.opencode = {
    enable = true;
  };

  home.file.".config/opencode/opencode.json".source = dotfiles.linkHere ./. "opencode.json";
  # plugin.ts (Bun) imports plugin_logic.ts via `./plugin_logic.ts` — both must
  # land in the same ~/.config/opencode/ directory so the relative resolution
  # works after symlink redirection.
  home.file.".config/opencode/plugin.ts".source = dotfiles.linkHere ./. "plugin.ts";
  home.file.".config/opencode/plugin_logic.ts".source = dotfiles.linkHere ./. "plugin_logic.ts";
}
