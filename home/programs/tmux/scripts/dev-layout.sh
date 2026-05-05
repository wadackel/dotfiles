#!/bin/sh
set -eu

dir="${1:-$(tmux display-message -p '#{pane_current_path}')}"

# 現在のペインを左右50%に分割 → 右ペインが生成される
tmux split-window -h -c "$dir" -l 50%

# 左ペイン（元のペイン）に戻り、下20%分割
tmux select-pane -L
tmux split-window -v -c "$dir" -l 20%

# 左上ペインにフォーカス
tmux select-pane -U
