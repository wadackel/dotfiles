{ config, lib, ... }:

{
  programs.fzf = {
    enable = true;

    # Shell-independent configuration
    defaultOptions = [
      "--reverse"
      "--exit-0"
      "--select-1"
      "--ansi"
      "--prompt '❯ '"
      "--pointer '»'"
      "--marker '∙'"
      "--color=fg:#8085a6,bg:#222433,hl:#bdc3e6"
      "--color=fg+:#8085a6,bg+:#363e7f,hl+:#bdc3e6"
      "--color=info:#929be5,prompt:#32364c,pointer:#b871b8"
      "--color=marker:#b871b8,spinner:#73c1a9,header:#32364c"
      "--color=border:#32364c,gutter:-1"
    ];

    # Conditional shell integrations
    enableZshIntegration = lib.mkIf (config.programs.zsh.enable or false) true;
    enableFishIntegration = lib.mkIf (config.programs.fish.enable or false) true;
    enableBashIntegration = lib.mkIf (config.programs.bash.enable or false) true;
  };
}
