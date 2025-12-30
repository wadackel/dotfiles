{
  config,
  pkgs,
  lib,
  ...
}:

let
  # ホームディレクトリを取得
  homeDir = config.home.homeDirectory;

  # config.kdl の内容を読み込んで、file:~ を絶対パスに置換
  configKdlContent = builtins.readFile ./config.kdl;
  # file:~/.config を絶対パスに置換
  configKdlWithAbsolutePath =
    builtins.replaceStrings
      [ "file:~/.config/zellij/plugins/zellij-tab-name.wasm" ]
      [ "file:${homeDir}/.config/zellij/plugins/zellij-tab-name.wasm" ]
      configKdlContent;
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

    # レイアウト
    "zellij/layouts/default.kdl".source = ./layouts/default.kdl;

    # テーマ
    "zellij/themes/dogrun.kdl".source = ./themes/dogrun.kdl;

    # zjstatus プラグイン
    "zellij/plugins/zjstatus.wasm".source = "${pkgs.zjstatus}/bin/zjstatus.wasm";

    # zellij-tab-name プラグイン
    "zellij/plugins/zellij-tab-name.wasm".source = pkgs.zellij-tab-name;
  };
}
