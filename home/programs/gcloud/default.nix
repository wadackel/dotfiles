{
  config,
  pkgs,
  lib,
  ...
}:

{
  # Google Cloud SDK
  home.packages = with pkgs; [
    google-cloud-sdk
    google-cloud-sql-proxy
  ];

  # 注: appserver エイリアスは zsh/default.nix で定義
}
