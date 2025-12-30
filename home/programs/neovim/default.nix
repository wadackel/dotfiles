{
  config,
  lib,
  pkgs,
  dotfiles,
  ...
}:

{
  # Neovim configuration
  xdg.configFile = {
    "nvim/init.lua".source = dotfiles.linkHere ./. "init.lua";
  };
}
