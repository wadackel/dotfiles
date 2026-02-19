#!/usr/bin/env bash
set -euo pipefail

# Usage: run-story-test.sh <output-dir> <test-id> <setup-prompts-file> <test-prompt> [max-turns]
# setup-prompts-file: 1行1プロンプトのテキストファイル
# Output: <output-dir>/<test-id>.jsonl (test prompt stream-json)
#         <output-dir>/<test-id>.setup-*.json (setup prompts)
#         <output-dir>/<test-id>.session (session ID)
#         <output-dir>/<test-id>.exit (exit code)

output_dir="$1"
test_id="$2"
setup_file="$3"
test_prompt="$4"
max_turns="${5:-10}"

mkdir -p "$output_dir"

session_id=""
setup_index=0

# Setup prompts を順次実行（json 出力で session_id を取得）
while IFS= read -r setup_prompt; do
  [ -z "$setup_prompt" ] && continue

  if [ -z "$session_id" ]; then
    # 最初のプロンプト: 新規セッション開始
    result=$(env -u CLAUDECODE claude -p "$setup_prompt" \
      --output-format json \
      --max-turns "$max_turns" \
      --dangerously-skip-permissions \
      2>/dev/null)
    session_id=$(echo "$result" | jq -r '.session_id')
    echo "$result" > "${output_dir}/${test_id}.setup-${setup_index}.json"
  else
    # 継続プロンプト: 既存セッションを resume
    env -u CLAUDECODE claude -p "$setup_prompt" \
      --resume "$session_id" \
      --output-format json \
      --max-turns "$max_turns" \
      --dangerously-skip-permissions \
      > "${output_dir}/${test_id}.setup-${setup_index}.json" 2>/dev/null
  fi

  setup_index=$((setup_index + 1))
done < "$setup_file"

# テストプロンプト: stream-json で全ツールコールをキャプチャ
env -u CLAUDECODE claude -p "$test_prompt" \
  --resume "$session_id" \
  --output-format stream-json \
  --verbose \
  --max-turns "$max_turns" \
  --dangerously-skip-permissions \
  > "${output_dir}/${test_id}.jsonl" 2>/dev/null

echo "$?" > "${output_dir}/${test_id}.exit"
echo "$session_id" > "${output_dir}/${test_id}.session"
