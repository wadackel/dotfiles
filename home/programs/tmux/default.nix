{
  lib,
  pkgs,
  dotfiles,
  ...
}:

let
  # Computing the hash at Nix eval time instead of in the activation shell:
  # a shell `find`-based enumeration can silently match zero files (path or
  # expression bug) and hash an empty stream, pinning the stamp so recompiles
  # are skipped forever — eval-time filtering with the assert below turns that
  # failure class into a loud evaluation error.
  # `./shared` is included wholesale even though only pane-shared.ts is a
  # runtime dependency today; a spurious recompile costs seconds while a
  # missed dependency ships a stale binary to `prefix+w`.
  pickerSrcHash =
    let
      isSrc =
        file:
        (file.hasExt "ts" || file.hasExt "tsx")
        && !(lib.hasSuffix "_test.ts" file.name)
        && file.name != "picker_e2e_harness.ts";
      files =
        lib.fileset.toList (lib.fileset.fileFilter isSrc ./picker)
        ++ lib.fileset.toList (lib.fileset.fileFilter isSrc ./shared);
    in
    assert lib.assertMsg (builtins.length files >= 8) "picker source fileset unexpectedly small";
    builtins.hashString "sha256" (lib.concatMapStrings builtins.readFile files);
in
{
  home.packages = [ pkgs.tmux ];

  # Tmux configuration
  xdg.configFile."tmux/tmux.conf".source = dotfiles.linkHere ./. "config/tmux.conf";

  # Tmux popup configuration (symlink to ~/.tmux.popup.conf)
  home.file.".tmux.popup.conf".source = dotfiles.linkHere ./. "config/tmux.popup.conf";

  # Tmux popup session script
  home.file.".local/bin/tmux-popup-session.sh".source =
    dotfiles.linkHere ./. "scripts/popup-session.sh";

  # Tmux window picker (prefix+w: ink + React on Deno)
  home.file.".local/bin/picker.tsx".source = dotfiles.linkHere ./. "picker/picker.tsx";

  # Picker source siblings for direct/manual Deno runs.
  home.file.".local/bin/pane_row.ts".source = dotfiles.linkHere ./. "picker/pane_row.ts";
  home.file.".local/bin/ansi.ts".source = dotfiles.linkHere ./. "picker/ansi.ts";
  home.file.".local/bin/cell_width.ts".source = dotfiles.linkHere ./. "picker/cell_width.ts";
  home.file.".local/bin/format_helpers.ts".source = dotfiles.linkHere ./. "picker/format_helpers.ts";
  home.file.".local/bin/components.tsx".source = dotfiles.linkHere ./. "picker/components.tsx";

  # Picker diagnostic CLI (manual: when a Claude Code pane fails to appear)
  home.file.".local/bin/picker-doctor.ts".source = dotfiles.linkHere ./. "picker/picker-doctor.ts";

  # Dev layout script
  home.file.".local/bin/dev-layout.sh".source = dotfiles.linkHere ./. "scripts/dev-layout.sh";

  # AOT-compile picker.tsx into ~/.local/share/picker-tmux/picker.
  # The picker is launched by `prefix+w` via display-popup and the React+Ink
  # module graph evaluation dominates cold startup (~236ms out of ~370ms
  # measured). Deno's npm cache does not amortize this (cold == warm in
  # measurement), so only AOT via `deno compile` eliminates the cost.
  # Hash-skip avoids recompiling when picker source modules are unchanged.
  home.activation.compilePickerBin = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    SRC="${./.}"
    OUT="$HOME/.local/share/picker-tmux"
    BIN="$OUT/picker"
    STAMP="$OUT/.src-hash"
    HASH="${pickerSrcHash}"
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
      #
      # `--no-prompt` 必須: 何らかの未許可 op が runtime に呼ばれた瞬間、
      # Deno の `TtyPrompter::prompt` 内 `clear_stdin` (runtime/permissions/
      # prompter.rs) が `loop { tcflush; select(timeout=100ms); ... }` で
      # 永久ループに突入する (tmux popup 上では stdin に常時データが流れる
      # ため select が 0 を返さない)。main thread が完全に詰まり JS が動か
      # ず、ESC/q の byte は届くが useInput が発火しない (Ctrl+C は SIGINT
      # interrupt → signal-exit → 抜けられる)。`--no-prompt` を付けると
      # prompt 経路自体が抑止され「未許可なら即 throw」になるので picker
      # 側の tick try/catch (picker.tsx:781-783) で吸収され継続稼働する。
      run ${pkgs.deno}/bin/deno compile \
        --allow-env --allow-read --allow-run \
        --no-prompt \
        --output "$TMP" \
        "$SRC/picker/picker.tsx"
      run /bin/mv -f "$TMP" "$BIN"
      run /bin/sh -c "printf '%s\n' \"$HASH\" > \"$STAMP\""
    fi
  '';
}
