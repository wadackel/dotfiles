{ dotfiles, ... }:
{
  programs.opencode = {
    enable = true;
  };

  home.file.".config/opencode/opencode.json".source = dotfiles.linkHere ./. "opencode.json";
}
