{
  config,
  lib,
  pkgs,
  dotfiles,
  ...
}:

{
  home.packages = [ pkgs.vim ];

  # Vim configuration (legacy, non-XDG)
  home.file.".vimrc".source = dotfiles.linkHere ./. "vimrc";
}
