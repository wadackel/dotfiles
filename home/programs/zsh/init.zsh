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


# ====================================================
# agent-browser state import (state-import + headless default)
# ====================================================

ab-state-refresh() {
  local state_path="$HOME/.agent-browser-state/main.json"
  local state_dir="${state_path:h}"
  # Create the dir under a tight umask so first-run TOCTOU between mkdir and
  # the post-hoc chmod is closed. The chmod stays as defense-in-depth for the
  # already-existing-dir case.
  (umask 077 && mkdir -p "$state_dir")
  chmod 700 "$state_dir"

  # Discover the running Chrome's CDP WebSocket via DevToolsActivePort.
  # Chrome 127+ returns 404 on /json/version unless Origin is whitelisted,
  # so HTTP discovery is unreliable; the file-based discovery always works.
  local active_port_file="$HOME/Library/Application Support/Google/Chrome/DevToolsActivePort"
  if [[ ! -r "$active_port_file" ]]; then
    print -u2 "ab-state-refresh: DevToolsActivePort not found at $active_port_file."
    print -u2 "  Start Chrome with --remote-debugging-port=9222 (or enable it via chrome://inspect/#remote-debugging),"
    print -u2 "  log in to your target sites, then re-run ab-state-refresh."
    return 1
  fi
  local cdp_port cdp_ws_path
  cdp_port=$(head -1 "$active_port_file")
  cdp_ws_path=$(tail -1 "$active_port_file")
  local ws_url="ws://127.0.0.1:${cdp_port}${cdp_ws_path}"

  agent-browser close >/dev/null 2>&1

  case "${1:-}" in
  -i)
    # Interactive: pick from currently-open Chrome tabs via fzf, then save
    # each picked tab's origin (switch → wait → state save) and merge with jq.
    # Active tab on exit is the last switched-to tab; user can Cmd+` to restore.
    if (( $# > 1 )); then
      print -u2 "ab-state-refresh: cannot combine -i with positional URL arguments"
      print -u2 "  usage: ab-state-refresh [-i | URL [URL ...]]"
      return 1
    fi
    if ! command -v fzf >/dev/null 2>&1; then
      print -u2 "ab-state-refresh -i: fzf not found in PATH"
      return 1
    fi
    if ! [[ -t 0 ]]; then
      print -u2 "ab-state-refresh -i: requires TTY (fzf cannot run on piped stdin)"
      return 1
    fi

    # Connect once in the parent shell so `tab list` sees the user's Chrome.
    # The agent-browser daemon caches the CDP attach across CLI invocations,
    # so the per-tab subshell below does not need to re-connect.
    if ! agent-browser connect "$ws_url" >/dev/null 2>&1; then
      print -u2 "ab-state-refresh: failed to connect to $ws_url."
      return 1
    fi

    # TSV: tabId, origin, display. Padding is computed in jq (not via tabs)
    # so alignment survives fzf's --with-nth rendering, which strips
    # delimiter context. Filter out internal pages and URLs without an origin.
    local fzf_input
    fzf_input=$(agent-browser tab list --json 2>/dev/null | jq -r '
      .data.tabs
      | map(select(.url | test("^(chrome|about|chrome-extension|devtools):") | not))
      | map(select(.url | test("^[a-z][a-z0-9+\\-.]*://[^/]+")))
      | map(. + {origin: (.url | capture("^(?<o>[^/]+://[^/]+)").o)})
      | sort_by([(.active | not), .tabId])
      | (map(.origin | length) | max // 0) as $w
      | .[]
      | (.origin | length) as $ow
      | [.tabId, .origin,
         (.origin + (if $w > $ow then " " * ($w - $ow) else "" end) + "  " +
          (.title // "" | .[0:80]))]
      | @tsv
    ') || {
      print -u2 "ab-state-refresh: failed to list tabs."
      return 1
    }
    if [[ -z "$fzf_input" ]]; then
      print -u2 "ab-state-refresh: no eligible tabs to pick (all internal pages?)."
      return 1
    fi

    local selected
    selected=$(print -r -- "$fzf_input" | \
      fzf --height 40% --reverse --border --multi \
          --delimiter $'\t' \
          --with-nth=3 \
          --header 'Select tabs to refresh (TAB to mark, ESC to cancel)')

    # Cancel (ESC or no selection): silent return, main.json untouched.
    if [[ -z "$selected" ]]; then
      return 0
    fi

    local -a sel_tab_ids sel_origins
    local _t_id _t_origin _t_display
    while IFS=$'\t' read -r _t_id _t_origin _t_display; do
      sel_tab_ids+=("$_t_id")
      sel_origins+=("$_t_origin")
    done <<< "$selected"

    local merge_dir total=${#sel_tab_ids[@]}
    merge_dir=$(umask 077 && mktemp -d "${TMPDIR:-/tmp}/ab-state-refresh.XXXXXX") || {
      print -u2 "ab-state-refresh: mktemp failed."
      return 1
    }
    # Pre-create main.json with mode 600 before the jq redirect (same TOCTOU
    # rationale as the URL-arg path above).
    (umask 077 && : > "$state_path") || {
      rm -rf "$merge_dir"
      print -u2 "ab-state-refresh: failed to prepare $state_path."
      return 1
    }
    (
      umask 077
      local idx=0 tab_id
      for tab_id in "${sel_tab_ids[@]}"; do
        idx=$((idx + 1))
        print -u2 "ab-state-refresh: switching to tab $idx/$total: $tab_id"
        # `tab tN` switches synchronously (verified empirically). If the user
        # closed the tab between fzf confirm and now, the switch fails — warn
        # and skip that tab so the remaining picks still get saved. wait/save
        # failures further down are treated as fatal (the daemon is broken at
        # that point) and abort the run via `exit 1`. `wait 2000` mirrors the
        # URL-arg path: load + async XHR settle.
        if ! agent-browser tab "$tab_id" >/dev/null 2>&1; then
          print -u2 "ab-state-refresh: tab $tab_id no longer exists, skipping"
          continue
        fi
        agent-browser wait 2000 || exit 1
        agent-browser state save "$merge_dir/state.${idx}.json" || exit 1
      done
      # If every tab switch failed, the glob below has no matches and jq -s
      # exits non-zero, which the outer wrapper catches.
      jq -s '{cookies: .[-1].cookies, origins: (map(.origins) | add | unique_by(.origin))}' \
        "$merge_dir"/state.*.json > "$state_path" || exit 1
    ) || {
      rm -rf "$merge_dir"
      print -u2 "ab-state-refresh: failed to refresh state via $ws_url."
      return 1
    }
    rm -rf "$merge_dir"

    # Diagnostic: warn if any picked origin is absent from the saved state
    # (typical cause: tab was on chrome-error://, e.g. local dev server down).
    local saved_origins missing_list
    saved_origins=$(jq -r '.origins[].origin' "$state_path" 2>/dev/null)
    local -a missing
    local _o
    for _o in "${sel_origins[@]}"; do
      if ! print -r -- "$saved_origins" | grep -Fxq -- "$_o"; then
        missing+=("$_o")
      fi
    done
    if (( ${#missing[@]} > 0 )); then
      missing_list="${(j:, :)missing}"
      print -u2 "ab-state-refresh: selected origins not saved: $missing_list"
    fi
    ;;
  *)
    if (( $# == 0 )); then
      # No URLs: agent-browser state save captures whatever Page Target is
      # currently focused in the user's Chrome plus its iframes. To capture
      # additional origins, pass them as arguments.
      (
        umask 077
        agent-browser connect "$ws_url" || exit 1
        agent-browser state save "$state_path" || exit 1
      ) || {
        print -u2 "ab-state-refresh: failed to refresh state via $ws_url."
        return 1
      }
    else
      # Multi-URL: state save only captures the focused tab + iframes, so open
      # a new tab per URL, save each to a temp file, then merge origins via jq.
      # cookies are browser-context-wide so any single save's cookies suffice
      # (we keep the last). Each `tab new` opens a visible foreground tab — the
      # user must close them manually after the run.
      local merge_dir total=$#
      merge_dir=$(umask 077 && mktemp -d "${TMPDIR:-/tmp}/ab-state-refresh.XXXXXX") || {
        print -u2 "ab-state-refresh: mktemp failed."
        return 1
      }
      # Pre-create the state file under tight perms BEFORE the jq redirect below.
      # `> "$state_path"` is parsed by the parent shell, so the file would
      # otherwise be created with the parent's umask (typically 022 → mode 644)
      # and exposed for the duration of jq's write. On first-ever runs the
      # subsequent chmod 600 closes the window only after secrets are written.
      (umask 077 && : > "$state_path") || {
        rm -rf "$merge_dir"
        print -u2 "ab-state-refresh: failed to prepare $state_path."
        return 1
      }
      (
        umask 077
        agent-browser connect "$ws_url" || exit 1
        local idx=0 url
        for url in "$@"; do
          idx=$((idx + 1))
          print -u2 "ab-state-refresh: opening tab $idx/$total: $url"
          # `tab new` already waits for the load event; the extra 2 s gives async
          # XHR-driven auth state a chance to land in localStorage before save.
          # `wait --load networkidle` is avoided per agent-browser/SKILL.md (it
          # hangs on ad-heavy or analytics-heavy sites).
          agent-browser tab new "$url" || exit 1
          agent-browser wait 2000 || exit 1
          agent-browser state save "$merge_dir/state.${idx}.json" || exit 1
        done
        jq -s '{cookies: .[-1].cookies, origins: (map(.origins) | add | unique_by(.origin))}' \
          "$merge_dir"/state.*.json > "$state_path" || exit 1
      ) || {
        rm -rf "$merge_dir"
        print -u2 "ab-state-refresh: failed to refresh state via $ws_url."
        return 1
      }
      rm -rf "$merge_dir"
    fi
    ;;
  esac

  chmod 600 "$state_path"

  printf 'state saved: %s (%s bytes, %s)\n' \
    "$state_path" \
    "$(stat -f '%z' "$state_path")" \
    "$(date)"
}
