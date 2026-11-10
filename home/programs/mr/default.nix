{
  config,
  lib,
  pkgs,
  ...
}:

let
  clone = name: { checkout = "git clone ssh://git@github.com/wadackel/${name} ${name}"; };
in
{
  programs.mr = {
    enable = true;
    settings = {
      # 未 commit の変更がある clone と、既定ブランチ以外で作業中の clone は触らない。
      DEFAULT = {
        skip = ''[ "$1" = update ] && [ -d "$MR_REPO" ] && { [ -n "$(git -C "$MR_REPO" status --porcelain)" ] || ! { b=$(git -C "$MR_REPO" symbolic-ref -q --short refs/remotes/origin/HEAD) && [ "$(git -C "$MR_REPO" branch --show-current)" = "''${b#origin/}" ]; }; }'';
        update = "git pull --ff-only";
      };
      "develop/github.com/wadackel/vim-dogrun" = clone "vim-dogrun";
      "develop/github.com/wadackel/eda.nvim" = clone "eda.nvim";
      "develop/github.com/wadackel/diffreel.nvim" = clone "diffreel.nvim" // {
        fixups = "nix build .#default";
      };
      # mise を通さないと RUSTUP_TOOLCHAIN が付かず、rustup が rust-toolchain.toml の
      # stable を取りに行く。手元の shell と同じ nightly でビルドするため mise exec で包む。
      "develop/github.com/wadackel/ofsht" = clone "ofsht" // {
        fixups = "mise exec -- just install";
      };
    };
  };

  # installDotfilesDeps と違って失敗で switch を止めない。オフラインや SSH 鍵の状態で
  # switch 全体が通らなくなる方が困るため。ssh の確認（未知のホスト鍵、パスフレーズ）は
  # || true では拾えず入力待ちで止まるので、BatchMode で失敗に変える。
  home.activation.syncOwnRepos = lib.hm.dag.entryAfter [ "linkGeneration" "miseInstall" ] ''
    run env GIT_SSH_COMMAND="ssh -o BatchMode=yes" PATH="${
      lib.makeBinPath [
        pkgs.git
        pkgs.just
        config.programs.mise.package
      ]
    }:$PATH:/run/current-system/sw/bin:/usr/bin:/bin" \
      ${config.programs.mr.package}/bin/mr -d "$HOME" -j 2 update || true
  '';
}
