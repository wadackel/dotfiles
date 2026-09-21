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
  agentowerSrcHash =
    let
      isSrc =
        file:
        (file.hasExt "ts" || file.hasExt "tsx")
        && !(lib.hasSuffix "_test.ts" file.name)
        && file.name != "agentower_e2e_harness.ts"
        # Measurement only: editing it must not cost a 68MB recompile plus the
        # warm-up run on the next activation.
        && file.name != "agentower-bench.ts";
      files =
        lib.fileset.toList (lib.fileset.fileFilter isSrc ./agentower)
        ++ lib.fileset.toList (lib.fileset.fileFilter isSrc ./shared);
    in
    assert lib.assertMsg (builtins.length files >= 8) "Agentower source fileset unexpectedly small";
    builtins.hashString "sha256" (lib.concatMapStrings builtins.readFile files);

  # Released tmux (3.7b) lets a repainting background pane draw over an open
  # popup's top border row, so the border blinks out and back while an agent
  # renders behind `prefix+w`. That is tmux issue 4920; 3.7 fixed most of it and
  # 3.8 finishes the job ("Fix redraw issues around ... popups ..."). Verified
  # against this exact repro: broken on 3.7b, clean on master.
  # Drop this override and go back to pkgs.tmux once nixpkgs ships 3.8.
  tmuxNext = pkgs.tmux.overrideAttrs (old: {
    version = "next-3.8";
    src = pkgs.fetchFromGitHub {
      owner = "tmux";
      repo = "tmux";
      rev = "c9ae3f6a0207444292076c9ab74054115504858f";
      hash = "sha256-KCFedowiNBICzBKBLSs5UhWvuPDl8rOfjkdLqai5mmA=";
    };
    # master's configure refuses to pick a malloc on darwin by itself.
    buildInputs = (old.buildInputs or [ ]) ++ [ pkgs.jemalloc ];
    configureFlags = (old.configureFlags or [ ]) ++ [ "--enable-jemalloc" ];
  });
in
{
  home.packages = [ tmuxNext ];

  # Tmux configuration
  xdg.configFile."tmux/tmux.conf".source = dotfiles.linkHere ./. "config/tmux.conf";

  # Tmux popup configuration (symlink to ~/.tmux.popup.conf)
  home.file.".tmux.popup.conf".source = dotfiles.linkHere ./. "config/tmux.popup.conf";

  # Tmux popup session script
  home.file.".local/bin/tmux-popup-session.sh".source =
    dotfiles.linkHere ./. "scripts/popup-session.sh";

  # Agentower (prefix+w: ink + React on Deno)
  home.file.".local/bin/agentower-main.ts".source =
    dotfiles.linkHere ./. "agentower/agentower-main.ts";

  # Agentower source siblings for direct/manual Deno runs.
  home.file.".local/bin/agentower.tsx".source = dotfiles.linkHere ./. "agentower/agentower.tsx";
  home.file.".local/bin/trace.ts".source = dotfiles.linkHere ./. "agentower/trace.ts";
  home.file.".local/bin/pane_row.ts".source = dotfiles.linkHere ./. "agentower/pane_row.ts";
  home.file.".local/bin/ansi.ts".source = dotfiles.linkHere ./. "agentower/ansi.ts";
  home.file.".local/bin/cell_width.ts".source = dotfiles.linkHere ./. "agentower/cell_width.ts";
  home.file.".local/bin/format_helpers.ts".source =
    dotfiles.linkHere ./. "agentower/format_helpers.ts";
  home.file.".local/bin/components.tsx".source = dotfiles.linkHere ./. "agentower/components.tsx";

  # Agentower diagnostic CLI (manual: when a Claude Code pane fails to appear)
  home.file.".local/bin/agentower-doctor.ts".source =
    dotfiles.linkHere ./. "agentower/agentower-doctor.ts";

  # Dev layout script
  home.file.".local/bin/dev-layout.sh".source = dotfiles.linkHere ./. "scripts/dev-layout.sh";

  # Evaluating the React+Ink module graph dominates Agentower's startup, and
  # Deno's npm cache does not amortize it (cold == warm), so AOT is the only
  # way to pay it once. Bundling first collapses the graph further, but breaks
  # `deno compile` — hence the post-process stage (agentower/bundle-postprocess.ts).
  # `deno compile` type-checks its input, and a `.js` bundle under --no-check
  # does not, so the check is run explicitly.
  home.activation.compileAgentowerBin = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    SRC="${./.}"
    OUT="$HOME/.local/share/agentower"
    BIN="$OUT/agentower"
    STAMP="$OUT/.src-hash"
    HASH="${agentowerSrcHash}"
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
      # prompt 経路自体が抑止され「未許可なら即 throw」になるので Agentower
      # 側の fetchPanes tick の try/catch (agentower.tsx) で吸収され継続稼働する。
      # Kept after the build rather than cleaned up: when a rebuild ships a
      # binary that misbehaves, this is the input that produced it.
      BUNDLE="$OUT/agentower.bundle.js"
      # Neither `deno bundle` nor `deno compile --no-check` looks at types, so
      # without this the activation would happily ship a binary built from
      # source that does not type-check.
      run ${pkgs.deno}/bin/deno check "$SRC/agentower/agentower-main.ts"
      # --minify is for React, not size: it is the only switch that makes
      # esbuild fold NODE_ENV to production (--conditions, DENO_CONDITIONS and
      # NODE_ENV at bundle time all keep development, and drop the production
      # body so it cannot be patched in later). The source hash does not cover
      # this file, so a flag change alone is never rebuilt.
      run ${pkgs.deno}/bin/deno bundle \
        --minify \
        --external ws --external react-devtools-core \
        -o "$BUNDLE" \
        "$SRC/agentower/agentower-main.ts"
      # `exit` would abort the activation fragments that follow, so a failed
      # post-process branches instead and leaves the previous binary and stamp
      # untouched for the next activation to retry. `run` on the condition so
      # that --dry-run echoes the whole branch instead of running this one step.
      if run ${pkgs.deno}/bin/deno run \
        --allow-read="$SRC/agentower","$OUT" --allow-write="$BUNDLE" \
        "$SRC/agentower/bundle-postprocess.ts" "$BUNDLE"; then
        run ${pkgs.deno}/bin/deno compile \
          --no-check \
          --allow-env --allow-read --allow-run \
          --no-prompt \
          --output "$TMP" \
          "$BUNDLE"
        run /bin/mv -f "$TMP" "$BIN"
        # macOS charges ~1.4s to the first exec of a freshly written Mach-O of
        # this size, so without this the next `prefix+w` after every rebuild
        # waits for it. The exit code doubles as the only check that the binary
        # starts at all: 2 is main()'s own guard on the missing TMUX, so
        # anything else means the graph did not evaluate and the stamp must not
        # claim this build is current.
        WARM=0
        run --silence /usr/bin/env -u TMUX "$BIN" </dev/null 2>"$OUT/.warm.log" || WARM=$?
        if [ "$WARM" = 2 ]; then
          run /bin/sh -c "printf '%s\n' \"$HASH\" > \"$STAMP\""
        else
          echo "agentower: fresh binary exited $WARM, expected 2 — keeping the previous stamp so the next activation rebuilds" >&2
          /bin/cat "$OUT/.warm.log" >&2 || true
        fi
        /bin/rm -f "$OUT/.warm.log"
      else
        echo "agentower: bundle post-process failed, keeping the previous binary" >&2
      fi
    fi
  '';
}
