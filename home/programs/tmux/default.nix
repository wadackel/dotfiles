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

  # Tmux popup configuration (symlink to ~/.tmux.popup.conf)
  home.file.".tmux.popup.conf".source = dotfiles.linkHere ./. "tmux.popup.conf";

  # Tmux popup session script
  home.file.".local/bin/tmux-popup-session.sh".source = dotfiles.linkHere ./. "popup-session.sh";

  # Tmux window picker script
  home.file.".local/bin/tmux-window-picker.sh".source = dotfiles.linkHere ./. "tmux-window-picker.sh";
}
