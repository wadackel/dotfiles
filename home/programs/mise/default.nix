{ config, lib, ... }:

{
  programs.mise = {
    enable = true;
    enableZshIntegration = lib.mkIf (config.programs.zsh.enable or false) true;
    enableFishIntegration = lib.mkIf (config.programs.fish.enable or false) true;
    enableBashIntegration = lib.mkIf (config.programs.bash.enable or false) true;

    globalConfig = {
      tools = {
        actionlint = "latest";
        deno = "latest";
        go = "latest";
        node = "lts";
        rust = "nightly";
        usage = "latest";
        uv = "latest";
        yamllint = "latest";
        "npm:@playwright/cli" = "latest";
      };
      settings = {
        idiomatic_version_file_enable_tools = [ "node" ];
      };
    };
  };
}
