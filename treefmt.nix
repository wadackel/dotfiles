{ pkgs, ... }:
{
  # プロジェクトのルートファイルを指定
  projectRootFile = "flake.nix";

  # nixfmt を有効化
  programs.nixfmt.enable = true;
}
