{
  config,
  pkgs,
  lib,
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

      # tmux
      tm = "tmux";
      tmls = "tmux ls";
      tma = "tmux a -t";
      tmd = "tmux d -t";
      tmr = "tmux kill-session -t";

      # Git log helpers
      glNoGraph = "git log --color=always --format=\"%C(auto)%h%d %s %C(black)%C(bold)%cr% C(auto)%an\" \"$@\"";

      # Android emulator
      emulator = "~/Library/Android/sdk/emulator/emulator";

      # zmv
      zmv = "noglob zmv -W";
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

      # Main initialization content
      ''
        # Additional history options not available in home-manager
        setopt hist_ignore_dups
        setopt hist_verify
        setopt hist_no_store
        setopt hist_reduce_blanks
        setopt hist_expand
        setopt inc_append_history
        setopt complete_in_word
        setopt magic_equal_subst

        # Additional basic options
        setopt no_beep
        setopt nolistbeep
        setopt auto_cd

        # History keybindings
        autoload -U history-search-end
        zle -N history-beginning-search-backward-end history-search-end
        zle -N history-beginning-search-forward-end history-search-end

        # Completion styling (from main branch)
        zstyle ':completion:*' keep-prefix
        zstyle ':completion:*' recent-dirs-insert both
        zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'
        zstyle ':completion:*' list-colors "''${(s.:.)LS_COLORS}"
        zstyle ':completion:*' rehash true
        zstyle ':completion:*' menu select

        # Shift-Tab for reverse completion
        bindkey "^[[Z" reverse-menu-complete

        # Word characters
        WORDCHARS='*?_-.[]~=&;!#$%^(){}<>'

        # fpath extension
        fpath=(/usr/local/share/zsh/functions/ ''${fpath})

        # Conditional Rust source path
        if [[ -x $(command -v rustc) ]]; then
          export RUST_SRC_PATH="$(rustc --print sysroot)/lib/rustlib/src/rust/src"
        fi

        # Note: Plugin loading is handled by programs.zsh.plugins
        # zsh-defer is skipped in Phase 1 due to download issues
        # Can be added in Phase 2 if needed

        # ====================================================
        # Git Workflow Functions
        # ====================================================

        # Enhanced Enter key - shows git status when in git repo
        do_enter() {
          if [[ -n $BUFFER ]]; then
            zle accept-line
            return $status
          fi

          if [[ -d .git ]]; then
            if [[ -n "$(git status)" ]]; then
              git status
            fi
          else
            zle accept-line
          fi

          zle reset-prompt
        }

        zle -N do_enter
        bindkey '^m' do_enter

        # fzf-based branch switcher
        fbr() {
          local branch
          branch=$(git branch -a --color | grep -v HEAD | grep -v '*' | sed -E 's/^ +//' | fzf --height 40% | perl -pe 's/\e\[?.*?[\@-~]//g')

          if [[ -z $branch ]]; then
            zle reset-prompt
            return
          fi

          local already_exists
          already_exists=$(git branch | grep -q "''${branch##*/}" &>/dev/null)

          if [[ $branch =~ ^remotes ]]; then
            if [[ !$already_exists ]]; then
              git checkout "''${branch##*/}"
            else
              git checkout -b "''${branch##*/}" "''${branch#*/}"
            fi
          else
            if [[ !$already_exists ]]; then
              git checkout "$branch"
            fi
          fi

          echo "\n"
          zle reset-prompt
        }

        zle -N fbr
        bindkey '^gb' fbr

        # Git commit browser with preview
        _gitLogLineToHash="echo {} | grep -o '[a-f0-9]\{7\}' | head -1"
        _viewGitLogLine="$_gitLogLineToHash | xargs -I % sh -c 'git show --color=always %'"

        fshow_preview() {
          glNoGraph |
            fzf --no-sort --reverse --tiebreak=index --no-multi \
              --ansi --preview="$_viewGitLogLine" \
              --header "enter to view, ctrl-y to copy hash" \
              --bind "enter:execute:$_viewGitLogLine | bat --paging always" \
              --bind "ctrl-y:execute:$_gitLogLineToHash | xargs echo -n | pbcopy"

          zle reset-prompt
        }

        zle -N fshow_preview
        bindkey "^gp" fshow_preview

        # ====================================================
        # Zellij Tab Auto-naming
        # ====================================================

        _update_zellij_tab() {
          [[ -z $ZELLIJ ]] && return

          local dir="$PWD"
          local display_dir

          # ホームディレクトリの場合
          if [[ "$dir" == "$HOME" ]]; then
            display_dir="~"
          # ホームディレクトリ配下の場合
          elif [[ "$dir" == "$HOME"/* ]]; then
            local rel_dir="''${dir#$HOME/}"
            # スラッシュの数で階層を判定
            local slash_count="''${rel_dir//[^\/]}"
            if [[ ''${#slash_count} -ge 2 ]]; then
              # 後半2階層を取得
              local last="''${rel_dir##*/}"
              local parent="''${rel_dir%/*}"
              parent="''${parent##*/}"
              display_dir="~/$parent/$last"
            else
              display_dir="~/$rel_dir"
            fi
          # ルート直下の場合
          else
            local abs_path="''${dir#/}"
            local slash_count="''${abs_path//[^\/]}"
            if [[ ''${#slash_count} -ge 2 ]]; then
              local last="''${abs_path##*/}"
              local parent="''${abs_path%/*}"
              parent="''${parent##*/}"
              display_dir="$parent/$last"
            else
              display_dir="$dir"
            fi
          fi

          zellij action rename-tab "$display_dir" 2>/dev/null
        }

        # precmd_functions 配列に追加（既存の precmd を上書きしない）
        precmd_functions+=(_update_zellij_tab)

        # ====================================================
        # Development Utilities
        # ====================================================

        # mkdir + cd combined
        mkcd() {
          if [[ -d $1 ]]; then
            echo "It already exists! Cd to the directory."
            cd $1
          else
            mkdir -p $1 && cd $1
          fi
        }

        # ghq + fzf repository navigation
        dev() {
          local to
          to=$(ghq list -p | fzf)
          if [[ -n $to ]]; then
            cd $to
          fi
        }

        # Android AVD selection with fzf
        avdr() {
          local selected
          selected=$(emulator -list-avds | fzf)
          if [[ -n $selected ]]; then
            emulator @"$selected" > /dev/null &
          fi
        }

        # gitignore.io helper
        gitignore() {
          curl -L -s https://www.gitignore.io/api/$@ ;
        }

        # Ring the bell (macOS notification sound)
        bell() {
          afplay -v 4 /System/Library/Sounds/Hero.aiff
        }

        # ====================================================
        # Conditional PATH Additions
        # ====================================================

        # depot_tools (conditional on directory existence)
        if [[ -e "''${HOME}/chromium/tools/depot_tools" ]]; then
          export PATH="''${PATH}:''${HOME}/chromium/tools/depot_tools"
        fi

        # ====================================================
        # Completion Cache Setup
        # ====================================================

        ZSH_COMPLETION_CACHE_DIR="''${HOME}/.cache/zsh/completions"
        mkdir -p "$ZSH_COMPLETION_CACHE_DIR"
        fpath=("$ZSH_COMPLETION_CACHE_DIR" $fpath)

        # ====================================================
        # External Service Completions (Optimized)
        # ====================================================

        # 1Password CLI completion (遅延ロード)
        if [[ -x $(command -v op) ]]; then
          _init_op_completion() {
            eval "$(op completion zsh)"
          }
          zsh-defer _init_op_completion
        fi

        # ofsht shell initialization and completion (遅延ロード)
        if [[ -x $(command -v ofsht) ]]; then
          _init_ofsht_completion() {
            eval "$(ofsht shell-init zsh)"
            source <(COMPLETE=zsh ofsht)
          }
          zsh-defer _init_ofsht_completion
        fi

        # Terraform completion (遅延ロード)
        if [[ -x $(command -v terraform) ]]; then
          _init_terraform_completion() {
            autoload -U +X bashcompinit && bashcompinit

            if [[ -e "/usr/local/bin/terraform" ]]; then
              complete -o nospace -C /usr/local/bin/terraform terraform
            elif [[ -e "/opt/homebrew/bin/terraform" ]]; then
              complete -o nospace -C /opt/homebrew/bin/terraform terraform
            fi
          }

          zsh-defer _init_terraform_completion
        fi

        # Google Cloud SDK paths and completion (遅延ロード)
        if [[ -f "''${HOME}/google-cloud-sdk/path.zsh.inc" ]]; then
          zsh-defer source "''${HOME}/google-cloud-sdk/path.zsh.inc"
          zsh-defer source "''${HOME}/google-cloud-sdk/completion.zsh.inc"

          # appserver alias (conditional on gcloud SDK)
          alias appserver="''${HOME}/google-cloud-sdk/bin/dev_appserver.py"
        fi

        # goapp PATH addition (Google App Engine for Go)
        if [[ -x $(command -v goapp) ]]; then
          export PATH=''${PATH}:''${HOME}/go_appengine/
        fi

        # pnpm tabtab completion (遅延ロード)
        if [ -f ~/.config/tabtab/zsh/__tabtab.zsh ]; then
          zsh-defer source ~/.config/tabtab/zsh/__tabtab.zsh
        fi
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
}
