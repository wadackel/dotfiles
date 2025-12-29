{
  config,
  lib,
  pkgs,
  ...
}:

{
  # Neovim configuration
  xdg.configFile = {
    "nvim/init.lua".source = ./init.lua;
  };
}
