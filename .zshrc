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
# History
# ====================================================

# 他のターミナルとヒストリーを共有
setopt share_history

# ヒストリーに重複を表示しない
setopt histignorealldups




# ====================================================
# Aliases & Custom functions
# ====================================================

# ls
alias ls="ls -G"
alias ll="ls -l"
alias la="ls -la"

# tree
alias tree="ls -R | grep ":$" | sed -e 's/:$//' -e 's/[^-][^\/]*\//--/g' -e 's/^/   /' -e 's/-/|/'"


# <Tab> でパス名の補完候補を表示したあと、
# 続けて <Tab> を押すと候補からパス名を選択できるようになる
# 候補を選ぶには <Tab> か Ctrl-N,B,F,P
zstyle ':completion:*:default' menu select=1

# 単語の一部として扱われる文字のセットを指定する
# ここではデフォルトのセットから / を抜いたものとする
# こうすると、 Ctrl-W でカーソル前の1単語を削除したとき、 / までで削除が止まる
WORDCHARS='*?_-.[]~=&;!#$%^(){}<>'




# ====================================================
# Styles
# ====================================================

# VCSの情報を取得するzsh関数
autoload -Uz vcs_info

# 色の設定
autoload -U colors ; colors
local DEFAULT=%{$reset_color%}
local RED=%{$fg[red]%}
local MAGENTA=%{$fg[magenta]%}
local GREEN=%{$fg[green]%}
local YELLOW=%{$fg[yellow]%}
local BLUE=%{$fg[blue]%}
local PURPLE=%{$fg[purple]%}
local CYAN=%{$fg[cyan]%}
local WHITE=%{$fg[white]%}

# PROMPT変数内で変数参照
setopt prompt_subst

zstyle ':vcs_info:git:*' check-for-changes true
zstyle ':vcs_info:git:*' stagedstr "%F{green}!" #commit されていないファイルがある
zstyle ':vcs_info:git:*' unstagedstr "%F{magenta}+" #add されていないファイルがある
zstyle ':vcs_info:*' formats "%F{green}%c%u(%b)%f" #通常
zstyle ':vcs_info:*' actionformats '[%b|%a]' #rebase 途中,merge コンフリクト等 formats 外の表示

# `vcs_info` 呼び出し
precmd () { vcs_info }

# 左プロンプト
PROMPT='%{${CYAN}%}[%n@%m]%{${DEFAULT}%}'
PROMPT=$PROMPT'${vcs_info_msg_0_} %{${YELLOW}%}%}$%{${DEFAULT}%} '

# 右プロンプト
RPROMPT='%{${GREEN}%}[%~]%{${DEFAULT}%}'

