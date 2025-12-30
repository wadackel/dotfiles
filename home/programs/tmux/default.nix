{
  config,
  lib,
  pkgs,
  ...
}:

{
  # Tmux configuration
  xdg.configFile."tmux/tmux.conf".source = ./tmux.conf;
}
