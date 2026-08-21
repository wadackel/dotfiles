{
  pkgs,
  ...
}:

{
  programs.gh = {
    enable = true;

    extensions = [
      pkgs.gh-poi
      pkgs.gh-stack
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
