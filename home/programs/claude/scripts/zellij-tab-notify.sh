#!/bin/bash
# zellij-tab-notify.sh - Claude Code 確認待ち状態のタブ名強調

set -euo pipefail

ACTION="${1:-}"
ZELLIJ_SESSION_NAME="${ZELLIJ_SESSION_NAME:-}"
ZELLIJ_PANE_ID="${ZELLIJ_PANE_ID:-}"

# Zellij 環境でない場合は何もしない
[[ -z "$ZELLIJ" ]] && exit 0
[[ -z "$ZELLIJ_SESSION_NAME" ]] && exit 0
[[ -z "$ZELLIJ_PANE_ID" ]] && exit 0

# タブ名に付与するプレフィックス
PREFIX="◉ "

# 現在フォーカスしているタブ名を取得する
get_current_tab_name() {
  zellij action dump-layout 2>/dev/null \
    | awk '
        /tab name=/ && /focus=true/ {
          if (match($0, /name="([^"]*)"/, m)) {
            print m[1]
            exit
          }
        }
      '
}

# プレフィックスを除去
strip_prefix() {
  local name="$1"
  if [[ "$name" == "$PREFIX"* ]]; then
    echo "${name#$PREFIX}"
  else
    echo "$name"
  fi
}

# タブ名を更新する関数
set_tab_name() {
  local tab_name="$1"

  # 特殊文字のエスケープ処理
  local escaped_name="$tab_name"
  escaped_name="${escaped_name//\\/\\\\}"    # バックスラッシュをエスケープ
  escaped_name="${escaped_name//\"/\\\"}"    # ダブルクォートをエスケープ
  escaped_name="${escaped_name//\{/\{\{}"    # { を {{ にエスケープ
  escaped_name="${escaped_name//\}/\}\}}"    # } を }} にエスケープ

  # zellij pipe でタブ名を更新
  local pipe_cmd="{\"pane_id\": \"$ZELLIJ_PANE_ID\", \"name\": \"$escaped_name\", \"use_stable_ids\": true}"
  zellij pipe --name change-tab-name -- "$pipe_cmd" 2>/dev/null
}

case "$ACTION" in
  start)
    # 現在のタブ名を取得
    current_name="$(get_current_tab_name)"

    # プレフィックスを除去してから追加（冪等性を確保）
    base_name="$(strip_prefix "$current_name")"

    set_tab_name "${PREFIX}${base_name}"
    ;;

  stop)
    # 現在のタブ名を取得
    current_name="$(get_current_tab_name)"

    # プレフィックスを除去（冪等性を確保）
    base_name="$(strip_prefix "$current_name")"

    set_tab_name "$base_name"
    ;;

  *)
    echo "Usage: $0 {start|stop}" >&2
    exit 1
    ;;
esac

exit 0
