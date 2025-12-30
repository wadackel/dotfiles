{ config, lib, ... }:

{
  programs.ripgrep = {
    enable = true;
    arguments = [
      "--smart-case"
      "--hidden"
      "--glob"
      "!.git"
    ];
  };
}
