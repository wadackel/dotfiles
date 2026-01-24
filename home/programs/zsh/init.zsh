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

# Zellij tab name shortening threshold
ZELLIJ_TAB_NAME_MAX_LENGTH="${ZELLIJ_TAB_NAME_MAX_LENGTH:-20}"

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

# ディレクトリ名を表示用に変換する関数（lualine風の短縮表示）
# - 20文字以下: そのまま表示
# - 20文字超過: 中間ディレクトリを省略形に変換
#   - ドット始まりは2文字（例: .config → ..）
#   - それ以外は1文字（例: apple → a）
#   - 最終ディレクトリ名は常にフル表示
_calculate_display_dir() {
  local dir="$1"
  local max_length="${ZELLIJ_TAB_NAME_MAX_LENGTH:-20}"

  # ホームディレクトリの場合
  [[ "$dir" == "$HOME" ]] && echo "~" && return

  # プレフィックスと相対パスを決定
  local prefix=""
  local rel_dir=""

  if [[ "$dir" == "$HOME"/* ]]; then
    prefix="~"
    rel_dir="${dir#$HOME/}"
  else
    # 絶対パス
    prefix=""
    rel_dir="${dir#/}"
  fi

  # フルパスを構築
  local full_path="${prefix:+$prefix/}$rel_dir"

  # 閾値以下ならそのまま返す
  [[ ${#full_path} -le $max_length ]] && echo "$full_path" && return

  # パスを"/"で分割
  local -a segments
  segments=("${(@s:/:)rel_dir}")

  # セグメントが1つだけなら短縮できない
  [[ ${#segments[@]} -eq 1 ]] && echo "$full_path" && return

  # 中間セグメントを短縮
  local -a result=()
  local segment
  local i

  for i in {1..${#segments[@]}}; do
    segment="${segments[$i]}"

    # 空セグメントをスキップ（防御的処理）
    [[ -z "$segment" ]] && continue

    # 最後のセグメントはフル表示
    if [[ $i -eq ${#segments[@]} ]]; then
      result+=("$segment")
    # 中間セグメントは短縮
    else
      if [[ "$segment" == .* ]]; then
        # ドット始まりは2文字
        result+=("${segment:0:2}")
      else
        # 通常は1文字
        result+=("${segment:0:1}")
      fi
    fi
  done

  # スラッシュで再結合
  local IFS="/"
  local shortened="${result[*]}"

  # プレフィックスを付けて返す
  if [[ -n "$prefix" ]]; then
    echo "${prefix}/${shortened}"
  else
    echo "/${shortened}"
  fi
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
# Zellij Session Management
# ====================================================

# fzf-based session selector to attach to a zellij session
zja() {
  # Check if already inside a zellij session
  if [[ -n $ZELLIJ ]]; then
    echo "Already inside a zellij session. Use 'Ctrl-s e' for session-manager plugin."
    return 1
  fi

  # Get list of active sessions
  local sessions
  sessions=$(zellij list-sessions 2>/dev/null)

  # Check if any sessions exist
  if [[ -z $sessions ]]; then
    echo "No zellij sessions found"
    return 1
  fi

  # Strip ANSI codes and present in fzf
  local selected
  selected=$(echo "$sessions" | sed -E 's/\x1b\[[0-9;]*m//g' | \
    fzf --height 40% --reverse --border \
        --header 'Select session to attach (ESC to cancel)' | \
    awk '{print $1}')

  # User cancelled selection
  if [[ -z $selected ]]; then
    return 0
  fi

  # Attach to selected session
  zellij attach "$selected"
}

# fzf-based session selector to delete a zellij session
zjd() {
  # Get list of active sessions
  local sessions
  sessions=$(zellij list-sessions 2>/dev/null)

  # Check if any sessions exist
  if [[ -z $sessions ]]; then
    echo "No zellij sessions found"
    return 1
  fi

  # Store current session name for force-delete detection
  local current_session=""
  if [[ -n $ZELLIJ ]]; then
    current_session=$(echo "$sessions" | sed -E 's/\x1b\[[0-9;]*m//g' | \
      grep "(current)" | awk '{print $1}')
  fi

  # Strip ANSI codes and present in fzf (multi-select enabled)
  local selected
  selected=$(echo "$sessions" | sed -E 's/\x1b\[[0-9;]*m//g' | \
    fzf --height 40% --reverse --border --multi \
        --header 'Select session(s) to delete (TAB to select multiple, ESC to cancel)' | \
    awk '{print $1}')

  # User cancelled selection
  if [[ -z $selected ]]; then
    return 0
  fi

  # Delete each selected session
  echo "$selected" | while IFS= read -r session; do
    if [[ "$session" == "$current_session" ]]; then
      echo "Deleting current session: $session"
    else
      echo "Deleting session: $session"
    fi
    zellij delete-session --force "$session"
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
