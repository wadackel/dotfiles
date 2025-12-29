{
  config,
  pkgs,
  lib,
  ...
}:

{
  programs.bash = {
    enable = true;

    # Shell aliases - bashrc から移行
    shellAliases = {
      ll = "ls -lG";
      la = "ls -laG";
    };

    # FZF 統合は programs/fzf.nix が自動で有効化
    # zoxide, mise も同様に自動統合される
  };
}
