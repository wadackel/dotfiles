{ ... }:
let
  # programs/ 配下のすべてのディレクトリ名を取得
  dirs = builtins.attrNames (builtins.readDir ./.);

  # default.nix 自身を除外し、ディレクトリのみをインポート
  isValidDir = name: (builtins.readDir ./.)."${name}" == "directory";

  validDirs = builtins.filter isValidDir dirs;
in
{
  imports = map (d: ./. + "/${d}") validDirs;
}
