{
  config,
  pkgs,
  lib,
  ...
}:

{
  programs.gh = {
    enable = true;

    extensions = [
      pkgs.gh-poi
    ];

    settings = {
      git_protocol = "ssh";
      prompt = "enabled";

      aliases = {
        co = "pr checkout";
      };
    };
  };
}
