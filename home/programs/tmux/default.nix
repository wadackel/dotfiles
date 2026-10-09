{
  lib,
  pkgs,
  dotfiles,
  ...
}:

let
  # The files that decide the Agentower binary, relative to the repository
  # root. The list is built at eval time rather than with a shell `find`: an
  # enumeration that silently matches nothing would hash an empty stream and
  # pin the stamp, and the assert below turns that into an evaluation error.
  # The contents are hashed by the activation, from the worktree it builds.
  # `./shared` is included wholesale even though only pane-shared.ts is a
  # runtime dependency today; a spurious recompile costs seconds while a
  # missed dependency ships a stale binary to `prefix+w`.
  agentowerInputs =
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
      # from outside this directory, the dependency versions, and the
      # type-check settings.
      inputs = [
        ../agents/lib/proc.ts
        ../../../bun.lock
        ../../../tsconfig.json
        ./agentower/tsconfig.json
      ];
      root = toString ../../..;
      relative = map (file: lib.removePrefix "${root}/" (toString file)) (files ++ inputs);
    in
    assert lib.assertMsg (builtins.length files >= 8) "Agentower source fileset unexpectedly small";
    assert lib.assertMsg (lib.all (
      path: !lib.hasPrefix "/" path
    ) relative) "Agentower input outside the repository root";
    relative;

  # The build flags come from this file as evaluated, not from the worktree's
  # copy of it, so they enter the stamp from here. They include the two that
  # keep the binary from loading a bunfig.toml or .env out of the pane's cwd.
  agentowerRecipeHash = builtins.hashString "sha256" (builtins.readFile ./default.nix);

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
  # it needs the node_modules that installDotfilesDeps puts there. The stamp is
  # therefore a hash of the worktree's files too: taken from the flake source,
  # it would mark a binary built from a different checkout as current.
  home.activation.compileAgentowerBin = lib.hm.dag.entryAfter [ "installDotfilesDeps" ] ''
    ROOT="${dotfiles.root}"
    SRC="$ROOT/home/programs/tmux/agentower"
    OUT="$HOME/.local/share/agentower"
    BIN="$OUT/agentower"
    STAMP="$OUT/.src-hash"
    # The Bun store path is part of the key: the binary embeds the runtime.
    HASH="$(cd "$ROOT" && /bin/cat ${lib.escapeShellArgs agentowerInputs} | /usr/bin/shasum -a 256 | /usr/bin/cut -d' ' -f1) ${pkgs.bun} ${agentowerRecipeHash}"
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
      # --bytecode parses the module graph at build time (first paint 55ms →
      # 39ms); it defaults to CommonJS and the entry uses top-level await, hence
      # --format=esm. NODE_ENV picks React's production build (--compile alone
      # ships the development one; --minify is size only). --no-compile-autoload-*:
      # the binary would otherwise run a bunfig.toml preload and load the .env of
      # the pane's repository. DEV: ink loads react-devtools when it is "true".
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
