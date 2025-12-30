{
  config,
  lib,
  pkgs,
  dotfiles,
  ...
}:

{
  # Tmux configuration
  xdg.configFile."tmux/tmux.conf".source = dotfiles.linkHere ./. "tmux.conf";
}
