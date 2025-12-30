{
  config,
  lib,
  pkgs,
  ...
}:

{
  # Vim configuration (legacy, non-XDG)
  home.file.".vimrc".source = ./vimrc;
}
