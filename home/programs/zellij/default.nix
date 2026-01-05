{
  config,
  pkgs,
  lib,
  ...
}:

let
  # ホームディレクトリを取得
  homeDir = config.home.homeDirectory;

  # file:~/.config/zellij/plugins/ を絶対パスに置換する共通関数
  replacePluginPath =
    content:
    builtins.replaceStrings
      [ "file:~/.config/zellij/plugins/" ]
      [ "file:${homeDir}/.config/zellij/plugins/" ]
      content;

  # config.kdl の内容を読み込んでパス置換
  configKdlWithAbsolutePath = replacePluginPath (builtins.readFile ./config.kdl);

  # layouts/default.kdl の内容を読み込んでパス置換
  layoutsDefaultKdlWithAbsolutePath = replacePluginPath (builtins.readFile ./layouts/default.kdl);
in
{
  # zellij 本体のインストールと zsh 統合
  programs.zellij = {
    enable = true;
    enableZshIntegration = true;
    package = pkgs.zellij;
  };

  # 既存の設定ファイルを配置
  xdg.configFile = {
    # メイン設定（動的生成）
    "zellij/config.kdl".text = configKdlWithAbsolutePath;

    # レイアウト（動的パス置換適用）
    "zellij/layouts/default.kdl".text = layoutsDefaultKdlWithAbsolutePath;

    # テーマ
    "zellij/themes/dogrun.kdl".source = ./themes/dogrun.kdl;

    # zjstatus プラグイン
    "zellij/plugins/zjstatus.wasm".source = "${pkgs.zjstatus}/bin/zjstatus.wasm";

    # zellij-tab-name プラグイン
    "zellij/plugins/zellij-tab-name.wasm".source = pkgs.zellij-tab-name;
  };
}
