{ config, lib, ... }:

{
  home.activation.miseInstall = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    run ${config.programs.mise.package}/bin/mise install --yes 2>&1 || true
  '';

  programs.mise = {
    enable = true;
    enableZshIntegration = lib.mkIf (config.programs.zsh.enable or false) true;
    enableFishIntegration = lib.mkIf (config.programs.fish.enable or false) true;
    enableBashIntegration = lib.mkIf (config.programs.bash.enable or false) true;

    globalConfig = {
      tools = {
        actionlint = "latest";
        go = "latest";
        node = "lts";
        rust = "nightly";
        usage = "latest";
        uv = "latest";
        yamllint = "latest";
        "npm:agent-browser" = "latest";
        "npm:@playwright/cli" = "latest";
        "npm:@googleworkspace/cli" = "latest";
      };
      settings = {
        idiomatic_version_file_enable_tools = [ "node" ];
      };
    };
  };
}
