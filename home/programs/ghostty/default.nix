{
  config,
  lib,
  pkgs,
  dotfiles,
  ...
}:

{
  # Ghostty terminal configuration
  xdg.configFile."ghostty/config".source = dotfiles.linkHere ./. "config";
}
