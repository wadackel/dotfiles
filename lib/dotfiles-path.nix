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

  worktreePath = here: file: "${worktreeRoot}/${relFromSelf here}/${file}";

  # モジュールと co-located なファイルへの out-of-store シンボリックリンクを作成
  linkHere = here: file: config.lib.file.mkOutOfStoreSymlink (worktreePath here file);

  # モジュールと co-located なファイルの worktree 上の絶対パス。toString は存在を
  # 確かめないため、store 参照なら評価時に出ていた「ファイルが無い」を assert で残す
  pathHere =
    here: file:
    assert lib.assertMsg (builtins.pathExists (
      here + "/${file}"
    )) "dotfiles.pathHere: ${toString here}/${file} does not exist";
    worktreePath here file;
in
{
  _module.args.dotfiles = {
    inherit linkHere pathHere;
  };
}
