{
  config,
  lib,
  pkgs,
  dotfiles,
  ...
}:

{
  # Vim configuration (legacy, non-XDG)
  home.file.".vimrc".source = dotfiles.linkHere ./. "vimrc";
}
