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
        rust = {
          version = "nightly";
          components = [
            "rust-analyzer"
            "rust-src"
          ];
        };
        usage = "latest";
        uv = "latest";
        yamllint = "latest";
        "npm:agent-browser" = "latest";
        "npm:modern-web-guidance" = "0.0.169";
        "npm:@playwright/cli" = "latest";
        "npm:@googleworkspace/cli" = "latest";
      };
      settings = {
        idiomatic_version_file_enable_tools = [ "node" ];
        # gh は keyring にトークンを置くため mise 既定の gh_cli_tokens
        # (~/.config/gh/hosts.yml を読む) が空振りする。
        github.credential_command = "gh auth token";
      };
    };
  };
}
