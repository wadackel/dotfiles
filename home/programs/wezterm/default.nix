{
  config,
  lib,
  pkgs,
  ...
}:

{
  # Wezterm terminal configuration
  xdg.configFile."wezterm/wezterm.lua".source = ./wezterm.lua;
}
