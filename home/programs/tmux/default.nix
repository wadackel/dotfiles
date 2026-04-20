{
  config,
  lib,
  pkgs,
  dotfiles,
  ...
}:

{
  home.packages = [ pkgs.tmux ];

  # Tmux configuration
  xdg.configFile."tmux/tmux.conf".source = dotfiles.linkHere ./. "tmux.conf";

  # Tmux popup configuration (symlink to ~/.tmux.popup.conf)
  home.file.".tmux.popup.conf".source = dotfiles.linkHere ./. "tmux.popup.conf";

  # Tmux popup session script
  home.file.".local/bin/tmux-popup-session.sh".source = dotfiles.linkHere ./. "popup-session.sh";

  # Tmux window picker (prefix+w: ink + React on Deno)
  home.file.".local/bin/picker.tsx".source = dotfiles.linkHere ./. "picker.tsx";

  # Dev layout script
  home.file.".local/bin/dev-layout.sh".source = dotfiles.linkHere ./. "dev-layout.sh";
}
