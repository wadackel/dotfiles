#!/usr/bin/env bash
set -euo pipefail

input=$(cat)

# --- Model ---
model=$(echo "$input" | jq -r '.model.display_name // empty')

# --- Context ---
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // empty')

# --- Workspace ---
cwd=$(echo "$input" | jq -r '.workspace.current_dir // empty')

# --- Helper: format token count (e.g. 45200 -> "45k", 1500 -> "1.5k") ---
fmt_tokens() {
  local n=$1
  if [ "$n" -ge 1000 ]; then
    local k=$((n / 1000))
    local r=$(( (n % 1000) / 100 ))
    if [ "$r" -gt 0 ]; then
      printf '%d.%dk' "$k" "$r"
    else
      printf '%dk' "$k"
    fi
  else
    printf '%d' "$n"
  fi
}

# --- Colors (256-color) ---
BLUE='\033[38;5;68m'
GREEN='\033[38;5;107m'
YELLOW='\033[38;5;179m'
RED='\033[38;5;167m'
MAGENTA='\033[38;5;140m'
CYAN='\033[38;5;73m'
DIM='\033[38;5;243m'
RST='\033[0m'

# --- Nerd Font icons (via Unicode escape to avoid encoding loss) ---
ICON_MODEL=$(printf '\U000F06A9') # nf-md-robot
ICON_REPO=$(printf '\uEA62')      # nf-cod-repo
ICON_BRANCH=$(printf '\uE725')    # nf-dev-git_branch
ICON_DB=$(printf '\uF1C0')        # nf-fa-database

parts=()

# --- Model ---
if [ -n "$model" ]; then
  parts+=("$(printf "${MAGENTA}${ICON_MODEL}${RST} ${DIM}${model}${RST}")")
fi

# --- Repo + Branch (git only) ---
if [ -n "$cwd" ]; then
  cd "$cwd" 2>/dev/null || true
  if git rev-parse --git-dir >/dev/null 2>&1; then
    repo=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || basename "$cwd")
    branch=$(git branch --show-current 2>/dev/null || echo "")
    dirty=""
    [ -n "$(git status --porcelain 2>/dev/null | head -1)" ] && dirty="*"

    parts+=("$(printf "${BLUE}${ICON_REPO}${RST} ${DIM}${repo}${RST}")")
    if [ -n "$branch" ]; then
      parts+=("$(printf "${GREEN}${ICON_BRANCH}${RST} ${DIM}${branch}${dirty}${RST}")")
    fi
  fi
fi

# --- Context usage ---
if [ -n "$used_pct" ] && [ -n "$ctx_size" ]; then
  used_int=${used_pct%.*}
  : "${used_int:=0}"
  used_tokens=$(( ctx_size * used_int / 100 ))

  used_fmt=$(fmt_tokens "$used_tokens")
  total_fmt=$(fmt_tokens "$ctx_size")

  # Dynamic color for percentage
  if [ "$used_int" -lt 50 ]; then
    pct_color="$GREEN"
  elif [ "$used_int" -lt 75 ]; then
    pct_color="$YELLOW"
  else
    pct_color="$RED"
  fi

  parts+=("$(printf "${CYAN}${ICON_DB}${RST} ${DIM}${used_fmt}/${total_fmt} (${RST}${pct_color}${used_int}%%${RST}${DIM})${RST}")")
fi

# --- Join with dim separator ---
result=""
for i in "${!parts[@]}"; do
  if [ "$i" -gt 0 ]; then
    result="${result}  "
  fi
  result="${result}${parts[$i]}"
done

printf '%b' "$result"
