{
  config,
  lib,
  pkgs,
  ...
}:

{
  # Typos spell checker configuration
  xdg.configFile."typos.toml".source = ./typos.toml;
}
