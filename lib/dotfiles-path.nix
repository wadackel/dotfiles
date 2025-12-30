{
  lib,
  config,
  storeRoot,
  ...
}:
let
  # Worktree root is assumed to be at ~/dotfiles
  worktreeRoot = "${config.home.homeDirectory}/dotfiles";

  # モジュールの store パスからリポジトリルートからの相対パスを計算
  relFromSelf =
    here:
    let
      rel = lib.removePrefix "${storeRoot}/" (toString here);
    in
    if lib.hasPrefix "/" rel then lib.removePrefix "/" rel else rel;

  # モジュールと co-located なファイルへの out-of-store シンボリックリンクを作成
  linkHere =
    here: file: config.lib.file.mkOutOfStoreSymlink "${worktreeRoot}/${relFromSelf here}/${file}";
in
{
  _module.args.dotfiles = {
    inherit linkHere;
  };
}
