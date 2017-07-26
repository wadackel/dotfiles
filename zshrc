# ====================================================
# Basic
# ====================================================

# キー操作
bindkey -e

# 自動補完
autoload -U compinit
compinit -C

# ディレクトリの移動
setopt auto_cd




# ====================================================
# Library
# ====================================================
export GOPATH=${HOME}/go
export PATH=${PATH}:${GOPATH}/bin




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

# history bind
autoload -U history-search-end
zle -N history-beginning-search-backward-end history-search-end
zle -N history-beginning-search-forward-end history-search-end

bindkey '^P' history-beginning-search-backward-end
bindkey '^N' history-beginning-search-forward-end
bindkey "^R" history-incremental-search-backward



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


# other
alias v=vim
alias vi=vim
alias g=git

# tree
if type tree > /dev/null 2>&1; then
  local TREE="tree -a -f"
else
  local TREE="ls -R | grep ":$" | sed -e 's/:$//' -e 's/[^-][^\/]*\//--/g' -e 's/^/   /' -e 's/-/|/'"
fi

alias tree=TREE

# global
alias -g G="| grep"
alias -g X="| xargs"

# tmux
alias tmux="TERM=xterm-256color tmux"
alias tmls="tmux ls"
alias tma="tmux a -t"
alias tmd="tmux d -t"

# golang
alias gp="cd $GOPATH/src/github.com/tsuyoshiwada/"

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


# ====================================================
# Styles
# ====================================================

# VCSの情報を取得するzsh関数
autoload -Uz vcs_info

# 色の設定
autoload -U colors ; colors


# PROMPT変数内で変数参照
setopt prompt_subst

zstyle ':vcs_info:git:*' check-for-changes true
zstyle ':vcs_info:git:*' stagedstr "%F{163} !" #commit されていないファイルがある
zstyle ':vcs_info:git:*' unstagedstr "%F{14} *" #add されていないファイルがある
zstyle ':vcs_info:*' formats '%F{244} %b%c%u%f' #通常
zstyle ':vcs_info:*' actionformats ' %F{244}%b %F{163}!%a' #rebase 途中,merge コンフリクト等 formats 外の表示

# Pre
precmd () {
  print
  vcs_info
}

PROMPT='%{%F{14}%}%~%{${DEFAULT}%}${vcs_info_msg_0_}
%F{169}❯%{$reset_color%} %{${DEFAULT}%}'

# 右プロンプト (memo)
function memo(){
  memotxt=''
  for str in $@
  do
  memotxt="${memotxt} ${str}"
  done
}

RPROMPT='${memotxt}'



# tmux
## http://qiita.com/b4b4r07/items/01359e8a3066d1c37edc
function is_exists() { type "$1" >/dev/null 2>&1; return $?; }
function is_osx() { [[ $OSTYPE == darwin* ]]; }
function is_screen_running() { [ ! -z "$STY" ]; }
function is_tmux_runnning() { [ ! -z "$TMUX" ]; }
function is_screen_or_tmux_running() { is_screen_running || is_tmux_runnning; }
function shell_has_started_interactively() { [ ! -z "$PS1" ]; }
function is_ssh_running() { [ ! -z "$SSH_CONECTION" ]; }

function tmux_automatically_attach_session()
{
    if is_screen_or_tmux_running; then
        ! is_exists 'tmux' && return 1

        if is_tmux_runnning; then
        elif is_screen_running; then
            echo "This is on screen."
        fi
    else
        if shell_has_started_interactively && ! is_ssh_running; then
            if ! is_exists 'tmux'; then
                echo 'Error: tmux command not found' 2>&1
                return 1
            fi

            if tmux has-session >/dev/null 2>&1 && tmux list-sessions | grep -qE '.*]$'; then
                # detached session exists
                tmux list-sessions
                echo -n "Tmux: attach? (y/N/num) "
                read
                if [[ "$REPLY" =~ ^[Yy]$ ]] || [[ "$REPLY" == '' ]]; then
                    tmux attach-session
                    if [ $? -eq 0 ]; then
                        echo "$(tmux -V) attached session"
                        return 0
                    fi
                elif [[ "$REPLY" =~ ^[0-9]+$ ]]; then
                    tmux attach -t "$REPLY"
                    if [ $? -eq 0 ]; then
                        echo "$(tmux -V) attached session"
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



# gitignore.io
function gitignore() { curl -L -s https://www.gitignore.io/api/$@ ;}


# ====================================================
# Plugins
# ====================================================

# zplug
source ~/.zplug/init.zsh

# fzf
zplug "junegunn/fzf-bin", as:command, from:gh-r, rename-to:fzf
zplug "junegunn/fzf", as:command, use:bin/fzf-tmux

# others
zplug "zsh-users/zsh-autosuggestions"
zplug "b4b4r07/enhancd", use:init.sh
zplug "zsh-users/zsh-completions"
zplug "mollifier/cd-gitroot"

# Install
if ! zplug check --verbose; then
  printf 'Install? [y/N]: '
  if read -q; then
    echo; zplug install
  fi
fi

zplug load

# cd-gitroot
alias cdu='cd-gitroot'

# enhancd
ENHANCD_HOOK_AFTER_CD=ls
ENHANCD_DISABLE_DOT=1
ENHANCD_DISABLE_HYPHEN=1

# fzf
export FZF_DEFAULT_OPTS='--reverse --exit-0 --select-1 --ansi'

# fzf x history select
function select-history() {
  BUFFER=$(history -n -r 1 | fzf --no-sort +m --query "$LBUFFER" --prompt="History ❯ ")
  CURSOR=$#BUFFER
}
zle -N select-history
bindkey '^T' select-history
