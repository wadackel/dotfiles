#!/usr/bin/env bash
set -euo pipefail

# Usage: analyze-test.sh <jsonl-file> [target-skill]
# Output: JSON summary to stdout

jsonl_file="$1"
target_skill="${2:-}"

# stream-json イベントから Skill tool invocation を抽出
# フォーマット: {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"xxx"}}]}}
# または stream_event ラッパー経由
skills_invoked=$(jq -r '
  # assistant message 形式
  (select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and .name == "Skill") | .input.skill),
  # stream_event 形式（content_block_start）
  (select(.type == "stream_event") | .event? // . | select(.type? == "content_block_start") | .content_block? | select(.type == "tool_use" and .name == "Skill") | .input.skill)
' "$jsonl_file" 2>/dev/null | sort -u | grep -v '^$' || true)

# 全ツールコール集計
all_tools=$(jq -r '
  (select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | .name),
  (select(.type == "stream_event") | .event? // . | select(.type? == "content_block_start") | .content_block? | select(.type == "tool_use") | .name)
' "$jsonl_file" 2>/dev/null | sort | uniq -c | sort -rn || true)

# result イベントからメタデータ取得
num_turns=$(jq -r 'select(.type == "result") | .num_turns // 0' "$jsonl_file" 2>/dev/null | tail -1)
cost=$(jq -r 'select(.type == "result") | .total_cost_usd // 0' "$jsonl_file" 2>/dev/null | tail -1)
result_text=$(jq -r 'select(.type == "result") | .result // ""' "$jsonl_file" 2>/dev/null | tail -1 | head -c 500)

# ターゲットスキル発火判定
triggered="false"
if [ -n "$target_skill" ] && echo "$skills_invoked" | grep -qF "$target_skill"; then
  triggered="true"
fi

# JSON 出力
jq -n \
  --argjson triggered "$triggered" \
  --arg skills "$skills_invoked" \
  --arg tools "$all_tools" \
  --arg turns "${num_turns:-0}" \
  --arg cost "${cost:-0}" \
  --arg result "$result_text" \
  '{
    triggered: $triggered,
    skills_invoked: ($skills | split("\n") | map(select(. != ""))),
    tool_usage: $tools,
    num_turns: (if $turns == "" then 0 else ($turns | tonumber) end),
    cost_usd: (if $cost == "" then 0 else ($cost | tonumber) end),
    result_preview: $result
  }'
