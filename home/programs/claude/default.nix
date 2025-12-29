{
  config,
  lib,
  pkgs,
  ...
}:

{
  # Claude Code configuration
  home.file.".claude/agents" = {
    source = ./agents;
    recursive = true;
  };

  home.file.".claude/settings.json".source = ./settings.json;
}
