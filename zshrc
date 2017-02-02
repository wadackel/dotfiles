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
export HISTSIZE=1000

# 履歴ファイルに保存される履歴の件数
export SAVEHIST=100000

# 重複を記録しない
setopt hist_ignore_dups

# 開始と終了を記録
setopt EXTENDED_HISTORY

# 他のターミナルとヒストリーを共有
setopt share_history

# ヒストリーに重複を表示しない
setopt histignorealldups

# 余分な空白は詰めて記録
setopt hist_reduce_blanks

# 履歴をインクリメンタルに追加
setopt inc_append_history



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
alias tma="tmux a"
alias tmd="tmux d"

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
zstyle ':vcs_info:*' actionformats '%b%F{green}|%{$reset_color%}%a' #rebase 途中,merge コンフリクト等 formats 外の表示

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

# ブランチ名だけ色を変えたい (途中)
# zstyle ':vcs_info:git:*' formats '%b' '%c' '%u'
# zstyle ':vcs_info:git:*' actionformats '%b@%r|%a' '%c' '%u'
#
# function vcs_echo {
#   local st branch color
#   st=`git status 2> /dev/null`
#   if [[ -z "$st" ]]; then return; fi
#   branch="$vcs_info_msg_0_"
#   if   [[ -n "$vcs_info_msg_1_" ]]; then color='%F{14}' #staged
#   elif [[ -n "$vcs_info_msg_2_" ]]; then color='%F{169}' #unstaged
#   elif [[ -n `echo "$st" | grep "^Untracked"` ]]; then color=${fg[green]} # untracked
#   else color='%F{242}'
#   fi
#   echo "%{$color%}%{$branch%}%{$reset_color%}" | sed -e s/@/"%F{yellow}@%f%{$color%}"/
# }

# 左プロンプト
# PROMPT='%{%F{14}%}%~%{${DEFAULT}%} `vcs_echo`
# %F{169}❯%{$reset_color%} ${DEFAULT}'



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
