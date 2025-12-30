{ config, lib, ... }:

{
  programs.zoxide = {
    enable = true;
    enableZshIntegration = lib.mkIf (config.programs.zsh.enable or false) true;
    enableFishIntegration = lib.mkIf (config.programs.fish.enable or false) true;
    enableBashIntegration = lib.mkIf (config.programs.bash.enable or false) true;
  };
}
