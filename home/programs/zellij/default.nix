{
  config,
  pkgs,
  lib,
  ...
}:

{
  # zellij 本体のインストールと zsh 統合
  programs.zellij = {
    enable = true;
    enableZshIntegration = true;
    package = pkgs.zellij;
  };

  # 既存の設定ファイルを配置
  xdg.configFile = {
    # メイン設定
    "zellij/config.kdl".source = ./config.kdl;

    # レイアウト
    "zellij/layouts/default.kdl".source = ./layouts/default.kdl;

    # テーマ
    "zellij/themes/dogrun.kdl".source = ./themes/dogrun.kdl;

    # zjstatus プラグイン
    "zellij/plugins/zjstatus.wasm".source = "${pkgs.zjstatus}/bin/zjstatus.wasm";
  };
}
