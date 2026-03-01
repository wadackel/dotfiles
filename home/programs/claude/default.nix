{
  config,
  lib,
  pkgs,
  dotfiles,
  ...
}:

{
  # Claude Code configuration
  home.file.".claude/agents".source = dotfiles.linkHere ./. "agents";

  home.file.".claude/skills".source = dotfiles.linkHere ./. "skills";

  # scripts ディレクトリのシンボリックリンク (ディレクトリ全体をリンク)
  home.file.".claude/scripts".source = dotfiles.linkHere ./. "scripts";

  # ファイルのシンボリックリンク
  home.file.".claude/CLAUDE.md".source = dotfiles.linkHere ./. "CLAUDE.md";
  home.file.".claude/settings.json".source = dotfiles.linkHere ./. "settings.json";

  # ~/.claude/scripts をPATHに追加
  home.sessionPath = [ "$HOME/.claude/scripts" ];
}
