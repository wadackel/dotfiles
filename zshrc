fpath=(/usr/local/share/zsh/functions/ ${fpath})


# ====================================================
# Basic
# ====================================================

export LANG=en_US.UTF-8
export EDITOR=nvim

# キー操作
bindkey -e

# 自動補完
autoload -U compinit
compinit -C

# nobeep
setopt no_beep
setopt nolistbeep

# ディレクトリの移動
setopt auto_cd


# ====================================================
# Path
# ====================================================

export GOENV_ROOT="${HOME}/.goenv"

# for M1 device
if [ -d "/opt/homebrew" ]; then
  export PATH="/opt/homebrew/bin:${PATH}"
  export PATH="/opt/homebrew/sbin:${PATH}"
fi

# LLVM9 (M1 device)
if [ -d "/opt/llvm9" ]; then
  export PATH="/opt/llvm9/bin:${PATH}"
fi

export PATH="/usr/local/bin:${PATH}"
export PATH="/usr/local/sbin:${PATH}"
export PATH="${PATH}:${HOME}/.poetry/bin"
export PATH="${HOME}/.yarn/bin:${PATH}"
export PATH="${HOME}/.cargo/bin:${PATH}"
export PATH="${HOME}/flutter/bin:${PATH}"
export PATH="${HOME}/fvm/default/bin:${PATH}"
export PATH="${PATH}:${HOME}/.pub-cache/bin"
export PATH="${GOENV_ROOT}/bin:${PATH}"

# QEMU (M1 device)
if [ -d "/opt/QEMU" ]; then
  export PATH="/opt/QEMU/bin:${PATH}"
fi

# depot_tools
if [[ -e "${HOME}/chromium/tools/depot_tools" ]]; then
  export PATH="${PATH}:/${HOME}/chromium/tools/depot_tools"
fi

# nodenev
if [[ -x `which nodenv` ]]; then
  eval "$(nodenv init - --no-rehash)"
fi

# goenv
if [[ -x `which goenv` ]]; then
  eval "$(goenv init - --no-rehash)"
  export PATH="${GOROOT}/bin:${PATH}"
  export PATH="${PATH}:${GOPATH}/bin"
fi

# pyenv
if [[ -x `which pyenv` ]]; then
  eval "$(pyenv init - --no-rehash)"
fi

# poetry
if [[ -x `which poetry` ]]; then
  poetry completions zsh > $(brew --prefix)/share/zsh/site-functions/_poetry
fi

# Rust
if [[ -x `which rustc` ]]; then
  export RUST_SRC_PATH="$(rustc --print sysroot)/lib/rustlib/src/rust/src"
fi


# ====================================================
# Google Cloud SDK
# ====================================================

# gcloud
# install: https://cloud.google.com/sdk/downloads?hl=ja#interactive
if [[ -f "${HOME}/google-cloud-sdk/path.zsh.inc" ]]; then
  source "${HOME}/google-cloud-sdk/path.zsh.inc"
  source "${HOME}/google-cloud-sdk/completion.zsh.inc"

  alias appserver="${HOME}/google-cloud-sdk/bin/dev_appserver.py"
fi

# goapp
# install: https://cloud.google.com/appengine/docs/standard/go/download?hl=ja
if [[ -x `which goapp` ]]; then
  export PATH=${PATH}:${HOME}/go_appengine/
fi


# ====================================================
# History
# ====================================================

# 履歴ファイルの保存先
export HISTFILE=${HOME}/.zsh_history

# メモリに保存される履歴の件数
export HISTSIZE=1000000

# 履歴ファイルに保存される履歴の件数
export SAVEHIST=1000000

# ヒストリに追加されるコマンド行が古いものと同じなら古いものを削除
setopt hist_ignore_all_dups

# 重複を記録しない
setopt hist_ignore_dups

# ヒストリを呼び出してから実行する間に一旦編集可能
setopt hist_verify

# 開始と終了を記録
setopt EXTENDED_HISTORY

# historyコマンドは履歴に登録しない
setopt hist_no_store

# 他のターミナルとヒストリーを共有
setopt share_history

# 余分な空白は詰めて記録
setopt hist_reduce_blanks

# 補完時にヒストリを自動的に展開
setopt hist_expand

# 履歴をインクリメンタルに追加
setopt inc_append_history

# カーソル位置で補完
setopt complete_in_word

# `=` 以降のパスも補完
setopt magic_equal_subst


# history bind
autoload -U history-search-end
zle -N history-beginning-search-backward-end history-search-end
zle -N history-beginning-search-forward-end history-search-end

bindkey '^p' history-beginning-search-backward-end
bindkey '^n' history-beginning-search-forward-end
bindkey '^r' history-incremental-search-backward

zstyle ':completion:*' keep-prefix
zstyle ':completion:*' recent-dirs-insert both

# 補完候補に色を付ける
zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"

# 曖昧検索
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Z}'


# ====================================================
# Extensition
# ====================================================
autoload -Uz zmv
alias zmv='noglob zmv -W'


# ====================================================
# Aliases & Custom functions
# ====================================================

# basic
alias ls='ls -G'
alias ll='ls -lF'
alias la='ls -laF'
alias md='mkdir -pv'
alias cp='cp -p'
alias df='df -h'
alias rmrf='rm -rf'

# global
alias -g G="| grep"
alias -g X="| xargs"

# tmux
alias tm="tmux"
alias tmls="tmux ls"
alias tma="tmux a -t"
alias tmd="tmux d -t"
alias tmr="tmux kill-session -t"

# <Tab> で候補選択
zstyle ':completion:*:default' menu select=1

# <Shift-Tab>で補完候補の逆順
bindkey "^[[Z" reverse-menu-complete

# 単語の一部として扱われる文字のセット
WORDCHARS='*?_-.[]~=&;!#$%^(){}<>'


# Utility
# mkdir hoge && cd $_
function mkcd() {
  if [[ -d $1 ]]; then
    echo "It already exsits! Cd to the directory."
    cd $1
  else
    mkdir -p $1 && cd $1
  fi
}

# gitignore.io
function gitignore() { curl -L -s https://www.gitignore.io/api/$@ ;}


# fzf
export FZF_DEFAULT_OPTS='--reverse --exit-0 --select-1 --ansi --prompt "❯ " --pointer "»" --marker "∙"'


# git 操作

# <CR> で `git status` 呼び出し (git repository 内だけ)
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

# ブランチの切り替え
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

# リポジトリの移動
function dev() {
  local to
  to=$(ghq list -p | fzf)
  if [[ -n $to ]]; then
    cd $to
  fi
}

# emulator (Android) の選択起動
alias emulator='~/Library/Android/sdk/emulator/emulator'

function avdr() {
  local selected
  selected=$(emulator -list-avds | fzf)
  if [[ -n $selected ]]; then
    emulator @"$selected" > /dev/null &
  fi
}

# commit のブラウズ
alias glNoGraph='git log --color=always --format="%C(auto)%h%d %s %C(black)%C(bold)%cr% C(auto)%an" "$@"'
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


# tmux
## http://qiita.com/b4b4r07/items/01359e8a3066d1c37edc
function is_exists() { type "$1" >/dev/null 2>&1; return $?; }
function is_osx() { [[ $OSTYPE == darwin* ]]; }
function is_tmux_running() { [ ! -z "$TMUX" ]; }
function is_ssh_running() { [ ! -z "$SSH_CONECTION" ]; }
function shell_has_started_interactively() { [ ! -z "$PS1" ]; }

function tmux_automatically_attach_session()
{
  if is_tmux_running; then
    ! is_exists 'tmux' && return 1
  else
    if shell_has_started_interactively && ! is_ssh_running; then
      if ! is_exists 'tmux'; then
        echo 'Error: tmux command not found' 2>&1
        return 1
      fi

      if tmux has-session >/dev/null 2>&1; then
        tmux list-sessions
        echo -n "tmux: attach? (y/N/num) "
        read
        if [[ "$REPLY" =~ ^[Nn]$ ]]; then
          return 0
        elif [[ "$REPLY" =~ ^[Yy]$ ]] || [[ "$REPLY" == '' ]]; then
          tmux attach-session
          if [ $? -eq 0 ]; then
            return 0
          fi
        elif [[ "$REPLY" =~ ^[0-9]+$ ]]; then
          tmux attach -t "$REPLY"
          if [ $? -eq 0 ]; then
            return 0
          fi
        fi
      fi

      if is_osx && is_exists 'reattach-to-user-namespace'; then
        # on OS X force tmux's default command
        # to spawn a shell in the user's namespace
        tmux_config=$(cat $HOME/.tmux.conf <(echo 'set-option -g default-command "reattach-to-user-namespace -l $SHELL"'))
        tmux -f <(echo "$tmux_config") new-session && echo "$(tmux -V) created new session supported OS X"
      else
        tmux new-session && echo "tmux created new session"
      fi
    fi
  fi
}
tmux_automatically_attach_session


# ====================================================
# Plugins
# ====================================================

# zplug
if [[ -f "${HOME}/.zplug/init.zsh" ]]; then
  source ~/.zplug/init.zsh

  # others
  zplug "zsh-users/zsh-completions"
  zplug "b4b4r07/enhancd", use:init.sh

  zplug "zsh-users/zsh-autosuggestions", \
    hook-load:"ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=60'"

  zplug load

  # enhancd
  ENHANCD_HOOK_AFTER_CD=ls
  ENHANCD_DISABLE_DOT=1
  ENHANCD_DISABLE_HYPHEN=1
  ENHANCD_FILTER="fzf:non-existing-filter"
fi

# starship (theme)
eval "$(starship init zsh)"

# profile
if (which zprof > /dev/null 2>&1) ;then
  zprof
fi

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh
