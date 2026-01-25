{
  config,
  pkgs,
  lib,
  dotfiles,
  ...
}:

{
  programs.zsh = {
    enable = true;

    enableCompletion = true;

    # Auto-suggestion
    autosuggestion = {
      enable = true;
      highlight = "fg=60";
    };

    # History configuration
    history = {
      size = 1000000;
      save = 1000000;
      path = "${config.home.homeDirectory}/.zsh_history";
      ignoreAllDups = true;
      ignoreDups = true;
      expireDuplicatesFirst = true;
      extended = true;
      share = true;
      ignoreSpace = false;
    };

    # Session variables
    sessionVariables = {
      # Tool-specific settings (kept in zsh.nix for development convenience)
      ESLINT_D_LOCAL_ESLINT_ONLY = "1";
      ESLINT_USE_FLAT_CONFIG = "true";
      PRETTIERD_LOCAL_PRETTIER_ONLY = "1";

      # pnpm
      PNPM_HOME = "${config.home.homeDirectory}/Library/pnpm";

      # wasmtime
      WASMTIME_HOME = "${config.home.homeDirectory}/.wasmtime";
    };

    # Shell aliases
    shellAliases = {
      # Basic file operations
      ls = "ls -G";
      ll = "ls -lF";
      la = "ls -laF";
      md = "mkdir -pv";
      cp = "cp -p";
      df = "df -h";
      rmrf = "rm -rf";

      # zellij
      zj = "zellij";

      # tmux - basic aliases
      tm = "tmux";
      tmls = "tmux ls";
      tmr = "tmux kill-session -t";
      # Note: tma, tmd are functions defined in init.zsh

      # Git log helpers
      glNoGraph = "git log --color=always --format=\"%C(auto)%h%d %s %C(black)%C(bold)%cr% C(auto)%an\" \"$@\"";

      # Android emulator
      emulator = "~/Library/Android/sdk/emulator/emulator";

      # zmv
      zmv = "noglob zmv -W";

      # Google Cloud SDK
      appserver = "${pkgs.google-cloud-sdk}/google-cloud-sdk/bin/dev_appserver.py";
    };

    # Plugins
    plugins = [
      {
        name = "zsh-defer";
        src = pkgs.zsh-defer;
        file = "share/zsh-defer/zsh-defer.plugin.zsh";
      }
    ];

    initContent = lib.mkMerge [
      # zprof profiling (set ZPROF=1 to enable)
      (lib.mkBefore ''
        if [[ -n "$ZPROF" ]]; then
          zmodload zsh/zprof
        fi
      '')

      # Homebrew PATH must be set early (mkBefore)
      (lib.mkBefore ''
        # Homebrew PATH (M1 Mac)
        if [[ -d "/opt/homebrew" ]]; then
          export PATH="/opt/homebrew/bin:''${PATH}"
          export PATH="/opt/homebrew/sbin:''${PATH}"
        fi
      '')

      # Load init.zsh from working tree (via out-of-store symlink)
      ''
        source "$HOME/.config/zsh/init.zsh"
      ''

      # zprof output (if enabled)
      ''
        if [[ -n "$ZPROF" ]]; then
          zprof 2>/dev/null | head -20 2>/dev/null || true
        fi
      ''
    ];

    # Disable other plugin managers
    antidote.enable = false;
    oh-my-zsh.enable = false;
    prezto.enable = false;
    zplug.enable = false;
  };

  # Create out-of-store symlink to init.zsh in working tree
  xdg.configFile."zsh/init.zsh".source = dotfiles.linkHere ./. "init.zsh";
}
