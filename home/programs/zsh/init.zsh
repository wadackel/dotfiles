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
# Zellij Tab Auto-naming
# ====================================================

# ディレクトリ名を表示用に変換する関数
_calculate_display_dir() {
  local dir="$1"
  local display_dir

  # ホームディレクトリの場合
  if [[ "$dir" == "$HOME" ]]; then
    display_dir="~"
  # ホームディレクトリ配下の場合
  elif [[ "$dir" == "$HOME"/* ]]; then
    local rel_dir="${dir#$HOME/}"
    # スラッシュの数で階層を判定
    local slash_count="${rel_dir//[^\/]}"
    if [[ ${#slash_count} -ge 2 ]]; then
      # 後半2階層を取得
      local last="${rel_dir##*/}"
      local parent="${rel_dir%/*}"
      parent="${parent##*/}"
      display_dir="~/$parent/$last"
    else
      display_dir="~/$rel_dir"
    fi
  # ルート直下の場合
  else
    local abs_path="${dir#/}"
    local slash_count="${abs_path//[^\/]}"
    if [[ ${#slash_count} -ge 2 ]]; then
      local last="${abs_path##*/}"
      local parent="${abs_path%/*}"
      parent="${parent##*/}"
      display_dir="$parent/$last"
    else
      display_dir="$dir"
    fi
  fi

  echo "$display_dir"
}

_update_zellij_tab_on_chpwd() {
  # Zellij 環境でない場合は何もしない
  [[ -z $ZELLIJ ]] && return

  # pane_id が取得できない場合は何もしない
  local pane_id="$ZELLIJ_PANE_ID"
  [[ -z $pane_id ]] && return

  # 現在のタブ名を取得
  local current_name
  current_name=$(zellij action dump-layout 2>/dev/null | awk '
    /tab name=/ && /focus=true/ {
      if (match($0, /name="([^"]*)"/, m)) {
        print m[1]
        exit
      }
    }
  ')

  # 新しいディレクトリの表示名を算出
  local new_expected
  new_expected=$(_calculate_display_dir "$PWD")

  # ユーザーリネームの判定
  local should_update=false

  # ケース1: デフォルトタブ名（Tab #1, Tab #2, など）→ 常に更新
  if [[ "$current_name" =~ ^Tab\ \#[0-9]+$ ]]; then
    should_update=true
  # ケース2: OLDPWDが空（初回起動、セッション再起動）→ 更新
  elif [[ -z "$OLDPWD" ]]; then
    should_update=true
  else
    # ケース3: OLDPWDベースの判定
    local old_expected
    old_expected=$(_calculate_display_dir "$OLDPWD")

    # 現在のタブ名が前回の期待値と一致 → 自動更新されていた → 更新
    if [[ "$current_name" == "$old_expected" ]]; then
      should_update=true
    else
      # 現在のタブ名が前回の期待値と不一致 → ユーザーリネーム → 保護
      should_update=false
    fi
  fi

  # 更新しない場合は終了
  if [[ "$should_update" != "true" ]]; then
    return
  fi

  # タブ名の構築
  local tab_name="$new_expected"

  # 特殊文字のエスケープ処理
  local escaped_name="$tab_name"
  escaped_name="${escaped_name//\\/\\\\}"    # バックスラッシュをエスケープ
  escaped_name="${escaped_name//\"/\\\"}"    # ダブルクォートをエスケープ
  escaped_name="${escaped_name//\{/\{\{}"    # { を {{ にエスケープ
  escaped_name="${escaped_name//\}/\}\}}"    # } を }} にエスケープ

  zellij pipe --name change-tab-name -- "{\"pane_id\": \"$pane_id\", \"name\": \"$escaped_name\", \"use_stable_ids\": true}" 2>/dev/null
}

# chpwd_functions 配列に追加（ディレクトリ変更時のみ実行）
chpwd_functions+=(_update_zellij_tab_on_chpwd)

# セッション開始時に一度だけ実行（初期化）
_update_zellij_tab_on_chpwd

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

# Google Cloud SDK paths and completion (遅延ロード)
if [[ -f "${HOME}/google-cloud-sdk/path.zsh.inc" ]]; then
  zsh-defer source "${HOME}/google-cloud-sdk/path.zsh.inc"
  zsh-defer source "${HOME}/google-cloud-sdk/completion.zsh.inc"

  # appserver alias (conditional on gcloud SDK)
  alias appserver="${HOME}/google-cloud-sdk/bin/dev_appserver.py"
fi

# goapp PATH addition (Google App Engine for Go)
if [[ -x $(command -v goapp) ]]; then
  export PATH=${PATH}:${HOME}/go_appengine/
fi

# pnpm tabtab completion (遅延ロード)
if [ -f ~/.config/tabtab/zsh/__tabtab.zsh ]; then
  zsh-defer source ~/.config/tabtab/zsh/__tabtab.zsh
fi
