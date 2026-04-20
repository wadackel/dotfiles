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

  # Shared SSOT module imported by both picker.tsx and picker-doctor.ts
  home.file.".local/bin/pane_row.ts".source = dotfiles.linkHere ./. "pane_row.ts";

  # Picker diagnostic CLI (manual: when a Claude Code pane fails to appear)
  home.file.".local/bin/picker-doctor.ts".source = dotfiles.linkHere ./. "picker-doctor.ts";

  # Dev layout script
  home.file.".local/bin/dev-layout.sh".source = dotfiles.linkHere ./. "dev-layout.sh";
}
