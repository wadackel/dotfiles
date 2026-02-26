#!/bin/bash
# tmux-window-picker.sh
# fzf + display-popup ベースのペイン選択 UI
# prefix+w で起動。全セッション横断でペインを一覧し、プレビューで中身を確認しながら移動できる。

set -euo pipefail

SELF="$HOME/.local/bin/tmux-window-picker.sh"

# --preview サブコマンド（fzf の --preview= から呼ばれる）
if [[ "${1:-}" == "--preview" ]]; then
  target="$2"
  # ANSI 色付きでペイン全体を表示（ペインが消えていても || true でエラーを吸収）
  tmux capture-pane -p -e -t "$target" 2>/dev/null || true
  exit 0
fi

# --filter <pattern>: 一覧をパターンで事前フィルタ（case-insensitive, 固定文字列マッチ）
FILTER_PATTERN=""
if [[ "${1:-}" == "--filter" && $# -ge 2 ]]; then
  FILTER_PATTERN="$2"
  shift 2
fi

# このペイン自身（popup pane）を除外するため pane_id を取得
# display-popup 内で失敗する場合に備えてフォールバック
SELF_PANE_ID=$(tmux display-message -p '#{pane_id}' 2>/dev/null || echo '')

# pane 一覧生成（TAB 区切り: pane_id TAB target TAB 表示テキスト）
# pane_id を先頭に付けて自ペインを grep -v で除外する
list_panes() {
  local panes
  panes=$(tmux list-panes -a \
    -F $'#{pane_id}\t#{session_name}:#{window_index}.#{pane_index}\t#{session_name}:#{window_index}.#{pane_index}  #{window_name}  #{pane_title}  (#{pane_current_command})')
  if [[ -n "$SELF_PANE_ID" ]]; then
    echo "$panes" | grep -v "^${SELF_PANE_ID}"$'\t' || true
  else
    echo "$panes"
  fi
}

pane_list=$(list_panes)

# --filter 指定時はパターンでフィルタ（全行に対して case-insensitive 固定文字列 grep）
# session名/window名/pane_title/command いずれかに含まれていればマッチ
if [[ -n "$FILTER_PATTERN" ]]; then
  pane_list=$(echo "$pane_list" | grep -iF "$FILTER_PATTERN" || true)
fi

if [[ -z "$pane_list" ]]; then
  exit 0
fi

HEADER='Select pane  [Enter: jump / Esc: cancel]'
PROMPT='pane ❯ '
if [[ -n "$FILTER_PATTERN" ]]; then
  HEADER="Select pane (filter: ${FILTER_PATTERN})  [Enter: jump / Esc: cancel]"
  PROMPT="${FILTER_PATTERN} ❯ "
fi

selected=$(echo "$pane_list" \
  | FZF_DEFAULT_OPTS="" fzf \
      --ansi \
      --no-sort \
      --reverse \
      --delimiter=$'\t' \
      --with-nth=3 \
      --no-select-1 \
      --no-exit-0 \
      --cycle \
      --header="$HEADER" \
      --preview="$SELF --preview {2}" \
      --preview-window='right:60%:wrap:follow' \
      --prompt="$PROMPT" \
      --pointer='»' \
      --marker='∙' \
      --color='fg:#8085a6,bg:#222433,hl:#bdc3e6' \
      --color='fg+:#8085a6,bg+:#363e7f,hl+:#bdc3e6' \
      --color='info:#929be5,prompt:#929be5,pointer:#b871b8' \
      --color='marker:#b871b8,spinner:#73c1a9,header:#545c8c' \
      --color='border:#32364c,gutter:-1' \
  2>/dev/null) || exit 0

[[ -z "$selected" ]] && exit 0

# 第 2 フィールド（target = session:win.pane）を取得
target=$(printf '%s' "$selected" | cut -f2)
[[ -z "$target" ]] && exit 0

session="${target%%:*}"
win_pane="${target#*:}"
window="${win_pane%%.*}"
pane="${win_pane#*.}"

tmux switch-client -t "$session"                       2>/dev/null || true
tmux select-window -t "${session}:${window}"           2>/dev/null || true
tmux select-pane   -t "${session}:${window}.${pane}"   2>/dev/null || true
