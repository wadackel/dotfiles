#!/usr/bin/env bash
set -euo pipefail

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
    title="$2"
    message="$3"
    sound="$4"

    rotate_log
    log "--- send start ---"
    log "ARGS: title=$title message=$message sound=$sound"
    log_env

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

      subtitle="tmux: ${session} > ${window}"
      group="claude-${session}-${window}-${pane}"

      script_path="${HOME}/.claude/scripts/claude-notify.sh"
      execute_cmd="${script_path} activate '${session}' '${window}' '${pane}'"
      log "EXECUTE_CMD: $execute_cmd"

      if output=$(terminal-notifier \
        -title "$title" \
        -message "$message" \
        -subtitle "$subtitle" \
        -sound "$sound" \
        -group "$group" \
        -execute "$execute_cmd" 2>&1); then
        log "NOTIFY: success"
      else
        log "NOTIFY_ERROR: exit=$? output=$output"
      fi
    else
      log "NO_TMUX: sending without execute"
      terminal-notifier \
        -title "$title" \
        -message "$message" \
        -sound "$sound" 2>&1 || log "NOTIFY_ERROR: exit=$?"
    fi

    log "--- send end ---"
    ;;

  activate)
    session="$2"
    window="$3"
    pane="$4"

    log "--- activate start ---"
    log "ARGS: session=$session window=$window pane=$pane"

    if output=$(osascript -e 'tell application "WezTerm" to activate' 2>&1); then
      log "WEZTERM_ACTIVATE: success"
    else
      log "WEZTERM_ACTIVATE_ERROR: exit=$? output=$output"
    fi

    client=$(tmux list-clients -F "#{client_name}" 2>&1 | head -1)
    log "TMUX_CLIENT: $client"

    if [ -n "$client" ]; then
      tmux switch-client -c "$client" -t "$session" 2>&1 && \
        log "SWITCH_CLIENT: success" || \
        log "SWITCH_CLIENT_ERROR: exit=$?"
    fi

    tmux select-window -t "${session}:${window}" 2>&1 && \
      log "SELECT_WINDOW: success" || \
      log "SELECT_WINDOW_ERROR: exit=$?"
    tmux select-pane -t "${session}:${window}.${pane}" 2>&1 && \
      log "SELECT_PANE: success" || \
      log "SELECT_PANE_ERROR: exit=$?"

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
