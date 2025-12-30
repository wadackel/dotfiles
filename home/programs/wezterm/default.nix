{
  config,
  lib,
  pkgs,
  dotfiles,
  ...
}:

{
  # Wezterm terminal configuration
  xdg.configFile."wezterm/wezterm.lua".source = dotfiles.linkHere ./. "wezterm.lua";
}
