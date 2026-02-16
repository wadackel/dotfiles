{
  config,
  pkgs,
  lib,
  ...
}:

{
  home.packages = with pkgs; [
    nerd-fonts.caskaydia-cove
    nerd-fonts.hack
    nerd-fonts.jetbrains-mono
    nerd-fonts.monoid
    nerd-fonts.roboto-mono
    nerd-fonts.sauce-code-pro
    nerd-fonts.ubuntu-mono
    noto-fonts-cjk-sans
  ];
}
