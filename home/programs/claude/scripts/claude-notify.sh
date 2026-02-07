#!/usr/bin/env bash
set -uo pipefail

LOG_FILE="${TMPDIR:-/tmp}/claude-notify.log"
MAX_LOG_LINES=1000

log() {
  local timestamp
  timestamp=$(date "+%Y-%m-%d %H:%M:%S")
  echo "[$timestamp] $*" >> "$LOG_FILE"
}

log_env() {
  log "ENV: TMUX_PANE=${TMUX_PANE:-<unset>} TMUX=${TMUX:-<unset>}"
}

# ログローテーション
rotate_log() {
  if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt "$MAX_LOG_LINES" ]; then
    tail -n "$MAX_LOG_LINES" "$LOG_FILE" > "${LOG_FILE}.tmp"
    mv "${LOG_FILE}.tmp" "$LOG_FILE"
  fi
}

case "${1:-}" in
  send)
    sound="$2"

    rotate_log
    log "--- send start ---"
    log "ARGS: sound=$sound"
    log_env

    # stdin から Claude Code のフック JSON を読み取る
    stdin_data=$(cat)
    log "STDIN: $stdin_data"

    # jq のフルパスを解決
    jq_path=$(which jq 2>/dev/null || echo "/usr/bin/jq")
    log "JQ_PATH: $jq_path"

    # フック種別を判定
    hook_event_name=$("$jq_path" -r '.hook_event_name // "unknown"' <<< "$stdin_data")
    log "HOOK_EVENT: $hook_event_name"

    # tmux コンテキスト情報を取得
    if [ -n "${TMUX_PANE:-}" ]; then
      session=$(tmux display-message -t "$TMUX_PANE" -p "#{session_name}" 2>&1) && \
        log "TMUX_CONTEXT: session=$session" || \
        log "ERROR: failed to get session: $session"
      window=$(tmux display-message -t "$TMUX_PANE" -p "#{window_index}" 2>&1) && \
        log "TMUX_CONTEXT: window=$window" || \
        log "ERROR: failed to get window: $window"
      pane=$(tmux display-message -t "$TMUX_PANE" -p "#{pane_index}" 2>&1) && \
        log "TMUX_CONTEXT: pane=$pane" || \
        log "ERROR: failed to get pane: $pane"
      pane_title=$(tmux display-message -t "$TMUX_PANE" -p "#{pane_title}" 2>&1) && \
        log "TMUX_CONTEXT: pane_title=$pane_title" || \
        log "ERROR: failed to get pane_title: $pane_title"

      # タイトル: Claude Code · <pane_title>
      title="Claude Code · ${pane_title}"

      # フック種別に応じてサブタイトルとメッセージを決定
      if [ "$hook_event_name" = "Stop" ]; then
        subtitle="作業が完了しました"

        # トランスクリプトから最終アシスタントメッセージを取得
        transcript_path=$("$jq_path" -r '.transcript_path // ""' <<< "$stdin_data")
        log "TRANSCRIPT_PATH: $transcript_path"

        if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
          message=$(tail -n 50 "$transcript_path" 2>/dev/null \
            | "$jq_path" -r 'select(.type == "assistant") | .message.content[]? | select(.type == "text") | .text' 2>/dev/null \
            | tail -1 \
            | cut -c 1-200)
          log "LAST_MESSAGE: ${message:0:100}..."
        else
          message="(メッセージを取得できませんでした)"
          log "TRANSCRIPT_NOT_FOUND or EMPTY"
        fi
      elif [ "$hook_event_name" = "Notification" ]; then
        # Notification の場合は stdin の message フィールドをサブタイトルに
        subtitle=$("$jq_path" -r '.message // "通知"' <<< "$stdin_data")
        message=""  # Notification にはメッセージ不要
        log "NOTIFICATION_MESSAGE: $subtitle"
      else
        subtitle="Claude Code"
        message=""
        log "UNKNOWN_HOOK_TYPE"
      fi

      group="claude-${session}-${window}-${pane}"

      # tmux のフルパスを解決して activate に渡す
      tmux_path=$(which tmux)
      log "TMUX_PATH: $tmux_path"

      script_path="${HOME}/.claude/scripts/claude-notify.sh"
      execute_cmd="${script_path} activate '${session}' '${window}' '${pane}' '${tmux_path}'"
      log "EXECUTE_CMD: $execute_cmd"

      # terminal-notifier で通知送信
      notify_args=(
        -title "$title"
        -subtitle "$subtitle"
        -sound "$sound"
        -group "$group"
        -execute "$execute_cmd"
      )

      # メッセージが空でない場合のみ追加
      if [ -n "$message" ]; then
        notify_args+=(-message "$message")
      fi

      if output=$(terminal-notifier "${notify_args[@]}" 2>&1); then
        log "NOTIFY: success"
      else
        log "NOTIFY_ERROR: exit=$? output=$output"
      fi
    else
      log "NO_TMUX: sending without execute"
      title="Claude Code"
      subtitle="通知"
      terminal-notifier \
        -title "$title" \
        -subtitle "$subtitle" \
        -sound "$sound" 2>&1 || log "NOTIFY_ERROR: exit=$?"
    fi

    log "--- send end ---"
    ;;

  activate)
    session="$2"
    window="$3"
    pane="$4"
    tmux_cmd="${5:-tmux}"  # フルパスまたはデフォルト 'tmux'

    log "--- activate start ---"
    log "ARGS: session=$session window=$window pane=$pane tmux_cmd=$tmux_cmd"

    if output=$(osascript -e 'tell application "WezTerm" to activate' 2>&1); then
      log "WEZTERM_ACTIVATE: success"
    else
      log "WEZTERM_ACTIVATE_ERROR: exit=$? output=$output"
    fi

    # 短い待機で WezTerm のアクティブ化を確実にする
    sleep 0.1

    # すべてのクライアントに対して、セッション:ウィンドウ.ペインに直接切り替え
    target="${session}:${window}.${pane}"
    log "TARGET: $target"

    # クライアントリストを取得（パイプを避けるため変数に格納）
    clients=$("$tmux_cmd" list-clients -F "#{client_name}" 2>&1)
    log "CLIENTS: $clients"

    for client in $clients; do
      if [ -n "$client" ]; then
        log "PROCESSING_CLIENT: $client"
        if output=$("$tmux_cmd" switch-client -c "$client" -t "$target" 2>&1); then
          log "SWITCH_TO_TARGET: success for $client"
        else
          log "SWITCH_TO_TARGET_ERROR: client=$client output=$output"
        fi
      fi
    done

    log "--- activate end ---"
    ;;

  debug)
    if [ -f "$LOG_FILE" ]; then
      echo "=== claude-notify.sh debug log ==="
      echo "Log file: $LOG_FILE"
      echo ""
      tail -n 50 "$LOG_FILE"
    else
      echo "No log file found at $LOG_FILE"
    fi
    ;;

  *)
    echo "Usage: $0 {send|activate|debug}" >&2
    exit 1
    ;;
esac
