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
        # Measurement only: editing it must not cost a 60MB recompile plus the
        # warm-up run on the next activation.
        && file.name != "agentower-bench.ts";
      files =
        lib.fileset.toList (lib.fileset.fileFilter isSrc ./agentower)
        ++ lib.fileset.toList (lib.fileset.fileFilter isSrc ./shared);
      # What decides the binary besides its sources: the one module imported
      # from outside this directory, the dependency versions, the type-check
      # settings, and this file, whose build flags include the two that keep
      # the binary from loading a bunfig.toml or .env out of the pane's cwd.
      inputs = [
        ../agents/lib/proc.ts
        ../../../bun.lock
        ../../../tsconfig.json
        ./agentower/tsconfig.json
        ./default.nix
      ];
    in
    assert lib.assertMsg (builtins.length files >= 8) "Agentower source fileset unexpectedly small";
    builtins.hashString "sha256" (lib.concatMapStrings builtins.readFile (files ++ inputs));

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

  # Agentower (prefix+w: ink + React on Bun). The source entry, for a manual
  # run without the compiled binary.
  home.file.".local/bin/agentower-main.ts".source =
    dotfiles.linkHere ./. "agentower/agentower-main.ts";

  # Agentower diagnostic CLI (manual: when a Claude Code pane fails to appear)
  home.file.".local/bin/agentower-doctor.ts".source =
    dotfiles.linkHere ./. "agentower/agentower-doctor.ts";

  # Dev layout script
  home.file.".local/bin/dev-layout.sh".source = dotfiles.linkHere ./. "scripts/dev-layout.sh";

  # Evaluating the React+Ink module graph dominates Agentower's startup, so it
  # is compiled ahead of time. The build reads the worktree, not a store copy:
  # it needs the node_modules that installDotfilesDeps puts there. The hash
  # above is still taken from the flake source, so the two agree only when the
  # flake being switched is ~/dotfiles itself.
  home.activation.compileAgentowerBin = lib.hm.dag.entryAfter [ "installDotfilesDeps" ] ''
    ROOT="${dotfiles.root}"
    SRC="$ROOT/home/programs/tmux/agentower"
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
      # Neither Bun nor its bundler looks at types, so without this the
      # activation would happily ship a binary built from source that does not
      # type-check. tsc is called by path: `bun x tsc` outside the project
      # resolves an unrelated npm package of that name.
      run ${pkgs.bun}/bin/bun --no-env-file --no-install --config=/dev/null \
        "$ROOT/node_modules/typescript/bin/tsc" --noEmit -p "$SRC/tsconfig.json"
      # --bytecode: the module graph is parsed at build time instead of on every
      # start, which took first paint from 55ms to 39ms (agentower-bench-baseline.md).
      # It defaults to CommonJS output, and the entry uses top-level await.
      # --bytecode: the module graph is parsed at build time instead of on
      # every start, which took first paint from 55ms to 39ms
      # (agentower-bench-baseline.md). It defaults to CommonJS output, and the
      # entry uses top-level await, hence --format=esm.
      # --no-compile-autoload-*: a compiled binary otherwise runs the preload
      # of a bunfig.toml and loads the .env found in its working directory, and
      # the popup's working directory is whatever repository the pane is in.
      # DEV: ink connects to react-devtools when DEV is "true" in the
      # environment, which a tmux session can carry.
      run ${pkgs.bun}/bin/bun --no-env-file --no-install --config=/dev/null \
        build --compile --minify --bytecode --format=esm \
        --define 'process.env.NODE_ENV="production"' \
        --define 'process.env.DEV="false"' \
        --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
        --outfile "$TMP" \
        "$SRC/agentower-main.ts"
      run /bin/mv -f "$TMP" "$BIN"
      # macOS charges ~0.5s to the first exec of a freshly written Mach-O of
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
    fi
  '';
}
