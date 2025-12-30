{
  config,
  lib,
  pkgs,
  dotfiles,
  ...
}:

let
  # 外部スクリプトの内容を読み込み
  scriptContent = builtins.readFile ./scripts/zellij-tab-notify.sh;

  # Nixパッケージとしてzellij-tab-notifyを定義
  zellij-tab-notify = pkgs.writeShellScriptBin "zellij-tab-notify" scriptContent;
in
{
  # zellij-tab-notifyをPATHに追加
  home.packages = [ zellij-tab-notify ];

  # Claude Code configuration
  home.file.".claude/agents" = {
    source = dotfiles.linkHere ./. "agents";
    recursive = true;
  };

  # settings.json をシンボリックリンク形式で配置
  home.file.".claude/settings.json".source = dotfiles.linkHere ./. "settings.json";
}
