{
  config,
  lib,
  pkgs,
  dotfiles,
  ...
}:

{
  home.packages = [ pkgs.tmux ];

  # Tmux configuration
  xdg.configFile."tmux/tmux.conf".source = dotfiles.linkHere ./. "tmux.conf";

  # Tmux popup configuration (symlink to ~/.tmux.popup.conf)
  home.file.".tmux.popup.conf".source = dotfiles.linkHere ./. "tmux.popup.conf";

  # Tmux popup session script
  home.file.".local/bin/tmux-popup-session.sh".source = dotfiles.linkHere ./. "popup-session.sh";

  # Tmux window picker (prefix+w: ink + React on Deno)
  home.file.".local/bin/picker.tsx".source = dotfiles.linkHere ./. "picker.tsx";

  # Shared SSOT module imported by both picker.tsx and picker-doctor.ts
  home.file.".local/bin/pane_row.ts".source = dotfiles.linkHere ./. "pane_row.ts";

  # Picker diagnostic CLI (manual: when a Claude Code pane fails to appear)
  home.file.".local/bin/picker-doctor.ts".source = dotfiles.linkHere ./. "picker-doctor.ts";

  # Dev layout script
  home.file.".local/bin/dev-layout.sh".source = dotfiles.linkHere ./. "dev-layout.sh";

  # AOT-compile picker.tsx into ~/.local/share/picker-tmux/picker.
  # The picker is launched by `prefix+w` via display-popup and the React+Ink
  # module graph evaluation dominates cold startup (~236ms out of ~370ms
  # measured). Deno's npm cache does not amortize this (cold == warm in
  # measurement), so only AOT via `deno compile` eliminates the cost.
  # Hash-skip avoids recompiling when picker.tsx/pane_row.ts are unchanged.
  home.activation.compilePickerBin = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    SRC="${./.}"
    OUT="$HOME/.local/share/picker-tmux"
    BIN="$OUT/picker"
    STAMP="$OUT/.src-hash"
    # Hash file contents only (not paths) so the Nix store path of `${./.}`
    # does not dirty the hash whenever any sibling file in this dir changes.
    HASH=$(/bin/cat "$SRC/picker.tsx" "$SRC/pane_row.ts" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')
    # home-manager concatenates activation fragments into one shell script,
    # so `exit` here would abort later fragments. Gate the cold path with an
    # inverted if/else instead.
    if [ -x "$BIN" ] && [ -f "$STAMP" ] && [ "$(/bin/cat "$STAMP")" = "$HASH" ]; then
      :
    else
      run /bin/mkdir -p "$OUT"
      # Compile to a temp path and rename atomically so a mid-compile failure
      # cannot leave a corrupt binary in place (the stamp would then disagree
      # with the truncated file, and next activation retries the compile).
      TMP="$BIN.tmp.$$"
      # `--allow-run` を裸 (scope 無し) で渡す: Ink が依存する signal-exit は
      # popup 閉鎖時の SIGHUP ハンドラで `process.kill(process.pid, sig)` を
      # 呼ぶ。Deno はこれを `--allow-run` 権限で gate するが、partial scope
      # (`tmux,git` 等) では拒否され runtime prompt が popup に表示される
      # (denoland/deno#15217)。
      run ${pkgs.deno}/bin/deno compile \
        --allow-env --allow-read --allow-run \
        --output "$TMP" \
        "$SRC/picker.tsx"
      run /bin/mv -f "$TMP" "$BIN"
      run /bin/sh -c "printf '%s\n' \"$HASH\" > \"$STAMP\""
    fi
  '';
}
