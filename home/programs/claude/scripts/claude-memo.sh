#!/usr/bin/env bash
set -uo pipefail

LOG_FILE="${TMPDIR:-/tmp}/claude-memo.log"

rotate_log() {
  if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 1000 ]; then
    tail -n 500 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
  fi
}
rotate_log

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

jq_path=$(which jq 2>/dev/null || echo "/usr/bin/jq")
if [ ! -x "$jq_path" ]; then
  log "ERROR: jq not found"
  exit 0
fi

stdin_data=$(cat)
log "START: claude-memo.sh"

session_id=$("$jq_path" -r '.session_id // ""' <<< "$stdin_data")
transcript=$("$jq_path" -r '.transcript_path // ""' <<< "$stdin_data")
cwd=$("$jq_path" -r '.cwd // ""' <<< "$stdin_data")

if [ -z "$transcript" ] || [ ! -f "$transcript" ]; then
  log "SKIP: transcript not found ($transcript)"
  exit 0
fi

summary=$("$jq_path" -r 'select(.type == "summary") | .summary' "$transcript" 2>/dev/null | tail -1)
if [ -z "$summary" ]; then
  summary=$("$jq_path" -r 'select(.type == "user") | select(.message.content | type == "string") | .message.content' "$transcript" 2>/dev/null \
    | head -1 \
    | head -c 100)
  log "FALLBACK: using first user prompt"
fi
if [ -z "$summary" ]; then
  log "SKIP: no summary or user prompt found"
  exit 0
fi

summary=$(printf '%s' "$summary" | tr '\n' ' ' | head -c 200)

project_dir="${cwd:-$PWD}"
repo_name=$(basename "$(git -C "$project_dir" rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null)
repo_name="${repo_name:-$(basename "$project_dir")}"

daily_note="${HOME}/Documents/Main/99_Tracking/Daily/$(date +%Y-%m-%d).md"
if [ ! -f "$daily_note" ]; then
  log "SKIP: daily note not found ($daily_note)"
  exit 0
fi

session_short="${session_id:0:8}"
timestamp=$(date +%H:%M)
entry="- ${timestamp} - \`(${repo_name}/${session_short})\` ${summary}"

tmpfile="${daily_note}.tmp.$$"

existing_line=$(grep -n "/${session_short}" "$daily_note" 2>/dev/null | head -1 | cut -d: -f1)

if [ -n "$existing_line" ]; then
  awk -v line="$existing_line" -v entry="$entry" 'NR==line{print entry; next}1' "$daily_note" > "$tmpfile"
  mv "$tmpfile" "$daily_note"
  log "UPDATE: replaced entry at line $existing_line"
else
  reading_line=$(grep -n '^## 📕 Reading' "$daily_note" | head -1 | cut -d: -f1)
  if [ -z "$reading_line" ]; then
    log "SKIP: ## 📕 Reading section not found"
    exit 0
  fi

  prev_line=$((reading_line - 1))
  prev_content=$(sed -n "${prev_line}p" "$daily_note")

  if [ -z "$prev_content" ]; then
    {
      head -n $((prev_line - 1)) "$daily_note"
      echo "$entry"
      echo ""
      tail -n +"$reading_line" "$daily_note"
    } > "$tmpfile"
  else
    {
      head -n "$prev_line" "$daily_note"
      echo "$entry"
      echo ""
      tail -n +"$reading_line" "$daily_note"
    } > "$tmpfile"
  fi

  mv "$tmpfile" "$daily_note"
  log "INSERT: added new entry"
fi
