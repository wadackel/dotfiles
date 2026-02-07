{
  config,
  lib,
  pkgs,
  dotfiles,
  ...
}:

{
  # Claude Code configuration
  home.file.".claude/agents" = {
    source = dotfiles.linkHere ./. "agents";
    recursive = true;
  };

  home.file.".claude/skills".source = dotfiles.linkHere ./. "skills";

  # scripts ディレクトリのシンボリックリンク (ディレクトリ全体をリンク)
  home.file.".claude/scripts".source = dotfiles.linkHere ./. "scripts";

  # settings.json をシンボリックリンク形式で配置
  home.file.".claude/settings.json".source = dotfiles.linkHere ./. "settings.json";

  # ~/.claude/scripts をPATHに追加
  home.sessionPath = [ "$HOME/.claude/scripts" ];
}
