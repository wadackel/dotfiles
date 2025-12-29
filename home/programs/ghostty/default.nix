{
  config,
  lib,
  pkgs,
  ...
}:

{
  # Ghostty terminal configuration
  xdg.configFile."ghostty/config".source = ./config;
}
