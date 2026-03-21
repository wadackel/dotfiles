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
zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"
zstyle ':completion:*' rehash true
zstyle ':completion:*' menu select

# Shift-Tab for reverse completion
bindkey "^[[Z" reverse-menu-complete

# Word characters
WORDCHARS='*?_-.[]~=&;!#$%^(){}<>'

# fpath extension
fpath=(/usr/local/share/zsh/functions/ ${fpath})

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

# fzf-based branch switcher
fbr() {
  local branch
  branch=$(git branch -a --color | grep -v HEAD | grep -v '*' | sed -E 's/^ +//' | fzf --height 40% | perl -pe 's/\e\[?.*?[\@-~]//g')

  if [[ -z $branch ]]; then
    zle reset-prompt
    return
  fi

  local already_exists
  already_exists=$(git branch | grep -q "${branch##*/}" &>/dev/null)

  if [[ $branch =~ ^remotes ]]; then
    if [[ !$already_exists ]]; then
      git checkout "${branch##*/}"
    else
      git checkout -b "${branch##*/}" "${branch#*/}"
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

# ====================================================
# tmux Session Management (fzf-based)
# ====================================================

# fzf-based session attach/switch
tma() {
  # セッション一覧取得
  local sessions
  sessions=$(tmux list-sessions -F "#{session_name}:#{session_windows}:#{?session_attached,attached,detached}:#{session_created}" 2>/dev/null)

  # セッションが存在しない場合
  if [[ -z $sessions ]]; then
    echo "No tmux sessions found. Create one with 'tmux new -s <name>'"
    return 1
  fi

  # tmux内かどうかを判定
  local inside_tmux=false
  local current_session=""
  if [[ -n $TMUX ]]; then
    inside_tmux=true
    current_session=$(tmux display-message -p '#S')
  fi

  # fzf用にフォーマット
  local formatted
  formatted=$(echo "$sessions" | awk -F: '{
    name = $1
    windows = $2
    status = $3
    icon = (status == "attached") ? "󰆍" : "○"
    printf "%s %-20s %s windows  %s\n", icon, name, windows, status
  }')

  # プレビューコマンド（ウィンドウとペイン一覧）
  local preview_cmd='tmux list-windows -t {2} 2>/dev/null | cat; echo "---"; tmux list-panes -t {2} -a -F "Pane #{pane_index}: #{pane_current_command}" 2>/dev/null'

  # fzfでセッション選択
  local selected
  selected=$(echo "$formatted" | \
    fzf --height 40% --reverse --border \
        --header "Select session to $([ "$inside_tmux" = true ] && echo "switch" || echo "attach") (ESC to cancel)" \
        --preview "$preview_cmd" \
        --preview-window=right:50% | \
    awk '{print $2}')

  # キャンセルされた場合
  if [[ -z $selected ]]; then
    return 0
  fi

  # 現在のセッションと同じ場合
  if [[ "$inside_tmux" = true && "$selected" == "$current_session" ]]; then
    echo "Already in session: $selected"
    return 0
  fi

  # アタッチまたはスイッチ
  if [[ $inside_tmux = true ]]; then
    tmux switch-client -t "$selected"
  else
    tmux attach-session -t "$selected"
  fi
}

# fzf-based session delete (multi-select)
tmd() {
  # セッション一覧取得
  local sessions
  sessions=$(tmux list-sessions -F "#{session_name}:#{session_windows}:#{?session_attached,attached,detached}" 2>/dev/null)

  # セッションが存在しない場合
  if [[ -z $sessions ]]; then
    echo "No tmux sessions found"
    return 1
  fi

  # 現在のセッションを判定（tmux内の場合）
  local current_session=""
  if [[ -n $TMUX ]]; then
    current_session=$(tmux display-message -p '#S')
  fi

  # fzf用にフォーマット
  local formatted
  formatted=$(echo "$sessions" | awk -F: '{
    name = $1
    windows = $2
    status = $3
    icon = (status == "attached") ? "󰆍" : "○"
    printf "%s %-20s %s windows  %s\n", icon, name, windows, status
  }')

  # fzfでセッション選択（マルチ選択対応）
  local selected
  selected=$(echo "$formatted" | \
    fzf --height 40% --reverse --border --multi \
        --header 'Select session(s) to delete (TAB for multiple, ESC to cancel)' | \
    awk '{print $2}')

  # キャンセルされた場合
  if [[ -z $selected ]]; then
    return 0
  fi

  # 選択されたセッションを削除
  echo "$selected" | while IFS= read -r session; do
    if [[ "$session" == "$current_session" ]]; then
      echo "⚠ Skipping current session: $session (detach first or use 'tmux kill-session')"
    else
      echo "Deleting session: $session"
      tmux kill-session -t "$session"
    fi
  done
}

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
if [[ -e "${HOME}/chromium/tools/depot_tools" ]]; then
  export PATH="${PATH}:${HOME}/chromium/tools/depot_tools"
fi

# ====================================================
# Completion Cache Setup
# ====================================================

ZSH_COMPLETION_CACHE_DIR="${HOME}/.cache/zsh/completions"
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


# goapp PATH addition (Google App Engine for Go)
if [[ -x $(command -v goapp) ]]; then
  export PATH=${PATH}:${HOME}/go_appengine/
fi

# pnpm tabtab completion (遅延ロード)
if [ -f ~/.config/tabtab/zsh/__tabtab.zsh ]; then
  zsh-defer source ~/.config/tabtab/zsh/__tabtab.zsh
fi
