#!/bin/sh
set -eu

wid=${1-}
dir=${2-}

# 引数チェック
if [ -z "$wid" ] || [ -z "$dir" ]; then
  exit 1
fi

# セッションが存在するかチェック
if TMUX= tmux -L popup has-session -t "popup-$wid" 2>/dev/null; then
  # 既存セッションに接続
  TMUX= tmux -L popup -f ~/.tmux.popup.conf attach-session -t "popup-$wid"
else
  # 新規セッション作成
  TMUX= tmux -L popup -f ~/.tmux.popup.conf new-session -s "popup-$wid" -c "$dir"
fi
