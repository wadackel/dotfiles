{
  config,
  lib,
  pkgs,
  dotfiles,
  inputs,
  ...
}:

{
  # Claude Code
  home.packages = [ inputs.nix-claude-code.packages.${pkgs.stdenv.hostPlatform.system}.default ];

  # Claude Code configuration
  home.file.".claude/agents".source = dotfiles.linkHere ./. "agents";

  home.file.".claude/skills".source = dotfiles.linkHere ./. "skills";

  # Codex CLI からも参照できるようにする
  home.file.".agents/skills".source = dotfiles.linkHere ./. "skills";

  # scripts ディレクトリのシンボリックリンク (ディレクトリ全体をリンク)
  home.file.".claude/scripts".source = dotfiles.linkHere ./. "scripts";

  # hooks ディレクトリのシンボリックリンク (ディレクトリ全体をリンク)
  home.file.".claude/hooks".source = dotfiles.linkHere ./. "hooks";

  # ファイルのシンボリックリンク
  home.file.".claude/CLAUDE.md".source = dotfiles.linkHere ./. "CLAUDE.md";
  home.file.".claude/RTK.md".source = dotfiles.linkHere ./. "RTK.md";
  home.file.".claude/settings.json".source = dotfiles.linkHere ./. "settings.json";
}
