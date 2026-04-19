#!/bin/bash
# tmux-window-picker.sh
# fzf + display-popup ベースのペイン選択 UI
# prefix+w で起動。全セッション横断でペインを一覧し、プレビューで中身を確認しながら移動できる。
# Claude Code pane は claude-pane-status.ts が書く @pane_* オプションを SSOT として状態列を表示する。

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
# --command <agent>: @pane_agent の完全一致でフィルタ（claude など）
FILTER_PATTERN=""
COMMAND_FILTER=""
if [[ "${1:-}" == "--filter" && $# -ge 2 ]]; then
  FILTER_PATTERN="$2"
  shift 2
elif [[ "${1:-}" == "--command" && $# -ge 2 ]]; then
  COMMAND_FILTER="$2"
  shift 2
fi

# このペイン自身（popup pane）を除外するため pane_id を取得
# display-popup 内で失敗する場合に備えてフォールバック
SELF_PANE_ID=$(tmux display-message -p '#{pane_id}' 2>/dev/null || echo '')

NOW_EPOCH=$(date +%s)

# 空値プレースホルダには `·` (middle dot / U+00B7) を使う — `-` より視覚的に軽く、値とハイフンを混同しない

# 経過秒を Ns / Nm / Nh に整形
format_elapsed() {
  local s="$1"
  if [[ -z "$s" ]] || ! [[ "$s" =~ ^[0-9]+$ ]]; then
    printf '%s' '·'
    return
  fi
  local d=$((NOW_EPOCH - s))
  if (( d < 0 )); then
    printf '%s' '·'
  elif (( d < 60 )); then
    printf '%ds' "$d"
  elif (( d < 3600 )); then
    printf '%dm' $((d / 60))
  else
    printf '%dh' $((d / 3600))
  fi
}

# ステータス → アイコン
status_icon() {
  case "$1" in
    running) printf '%s' '●' ;;
    waiting) printf '%s' '◐' ;;
    idle)    printf '%s' '○' ;;
    error)   printf '%s' '✖' ;;
    *)       printf '%s' ' ' ;;
  esac
}

# ステータス → 短縮テキスト (%-4s padding 用)。unknown は空文字で padding に任せる。
status_short() {
  case "$1" in
    running) printf '%s' 'run' ;;
    waiting) printf '%s' 'wait' ;;
    idle)    printf '%s' 'idle' ;;
    error)   printf '%s' 'err' ;;
    *)       printf '%s' '' ;;
  esac
}

# pane 一覧生成
# 内部パース区切りは US (\x1f) — bash の read は IFS=TAB だと連続 TAB を 1 区切りに潰して空フィールドを食うため、
# 非空白の制御文字で分ける必要がある。fzf に渡す最終出力は TAB 区切りに戻す。
# F1=pane_id / F2=target / F3=pane_current_command / F4=display_text（ここで再構成）
# F5=agent / F6=status / F7=started_at / F8=cwd / F9=worktree_branch
# F10=subagents_count / F11=prompt / F12=wait_reason / F13=attention
list_panes() {
  local US=$'\x1f'
  local fmt="#{pane_id}${US}#{session_name}:#{window_index}.#{pane_index}${US}#{pane_current_command}${US}__RAW__${US}#{@pane_agent}${US}#{@pane_status}${US}#{@pane_started_at}${US}#{@pane_cwd}${US}#{@pane_worktree_branch}${US}#{@pane_subagents_count}${US}#{@pane_prompt}${US}#{@pane_wait_reason}${US}#{@pane_attention}"
  local raw
  raw=$(tmux list-panes -a -F "$fmt")
  local pane_id target cmd _placeholder agent status started_at cwd branch subs_count prompt wait_reason attention
  local icon attention_mark subs status_col elapsed cwd_base branch_disp summary_src summary40 target_dim display
  while IFS="$US" read -r pane_id target cmd _placeholder agent status started_at cwd branch subs_count prompt wait_reason attention; do
    [[ -z "$pane_id" ]] && continue
    [[ -n "$SELF_PANE_ID" && "$pane_id" == "$SELF_PANE_ID" ]] && continue
    icon=$(status_icon "$status")
    # attention は常に 1 文字列で予約 (! or 空白) — icon の列幅を可変にしない
    if [[ "$attention" == "notification" ]]; then
      attention_mark='!'
    else
      attention_mark=' '
    fi
    # 並列作業中の subagent 数を icon 直後に併記 (`●3` 形式)。0 / 空は非表示。
    if [[ -n "$subs_count" && "$subs_count" != "0" ]]; then
      subs="$subs_count"
    else
      subs=""
    fi
    # status 短縮テキスト (4 char 左詰め padding)
    status_col=$(printf '%-4s' "$(status_short "$status")")
    elapsed=$(format_elapsed "$started_at")
    if [[ -n "$cwd" ]]; then
      cwd_base=$(basename -- "$cwd")
    else
      cwd_base='·'
    fi
    branch_disp="${branch:-·}"
    # summary: status=waiting/error の時は wait_reason を優先 (権限プロンプト等のユーザアクション要否を前面に)。
    # それ以外は prompt。どちらも空なら '·'。
    summary_src="$prompt"
    if [[ "$status" == "waiting" || "$status" == "error" ]]; then
      [[ -n "$wait_reason" ]] && summary_src="$wait_reason"
    fi
    summary40="${summary_src:0:40}"
    summary40="${summary40:-·}"
    # target は末尾に ANSI dim (gray) で弱化表示。fzf --ansi が有効
    target_dim=$'\e[2;90m'"$target"$'\e[0m'
    # 新表示順: <attention><icon><subs> <status> <cwd> <branch> <elapsed> <summary> <target-dim>
    display="${attention_mark}${icon}${subs} ${status_col} ${cwd_base}  ${branch_disp}  ${elapsed}  ${summary40}  ${target_dim}"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$pane_id" "$target" "$cmd" "$display" "$agent" "$status" "$started_at" "$cwd" "$branch" "$subs_count" "$prompt" "$wait_reason" "$attention"
  done <<< "$raw"
}

pane_list=$(list_panes)

# --filter 指定時はパターンでフィルタ（全行に対して case-insensitive 固定文字列 grep）
if [[ -n "$FILTER_PATTERN" ]]; then
  pane_list=$(echo "$pane_list" | grep -iF "$FILTER_PATTERN" || true)
fi

# --command 指定時は @pane_agent（F5）でフィルタ（SSOT: pane_current_command ベースの旧ロジックは廃止）
if [[ -n "$COMMAND_FILTER" ]]; then
  pane_list=$(echo "$pane_list" | awk -F'\t' -v agent="$COMMAND_FILTER" '$5 == agent' || true)
fi

if [[ -z "$pane_list" ]]; then
  exit 0
fi

HEADER='Select pane  [Enter: jump / Esc: cancel]'
PROMPT='pane ❯ '
if [[ -n "$FILTER_PATTERN" ]]; then
  HEADER="Select pane (filter: ${FILTER_PATTERN})  [Enter: jump / Esc: cancel]"
  PROMPT="${FILTER_PATTERN} ❯ "
elif [[ -n "$COMMAND_FILTER" ]]; then
  HEADER="Select pane (agent: ${COMMAND_FILTER})  [Enter: jump / Esc: cancel]"
  PROMPT="${COMMAND_FILTER} ❯ "
fi

selected=$(echo "$pane_list" \
  | FZF_DEFAULT_OPTS="" fzf \
      --ansi \
      --no-sort \
      --reverse \
      --delimiter=$'\t' \
      --with-nth=4 \
      --no-select-1 \
      --no-exit-0 \
      --cycle \
      --header="$HEADER" \
      --preview="$SELF --preview {2}" \
      --preview-window='right:40%:wrap:follow' \
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

# F1=pane_id（attention クリア用）、F2=target（遷移先）
selected_pane_id=$(printf '%s' "$selected" | cut -f1)
target=$(printf '%s' "$selected" | cut -f2)
[[ -z "$target" ]] && exit 0

session="${target%%:*}"
win_pane="${target#*:}"
window="${win_pane%%.*}"
pane="${win_pane#*.}"

# 選択された pane の notification マークをクリア（他 pane の attention には触らない）
if [[ -n "$selected_pane_id" ]]; then
  tmux set -t "$selected_pane_id" -p -u @pane_attention 2>/dev/null || true
fi

tmux switch-client -t "$session"                       2>/dev/null || true
tmux select-window -t "${session}:${window}"           2>/dev/null || true
tmux select-pane   -t "${session}:${window}.${pane}"   2>/dev/null || true
