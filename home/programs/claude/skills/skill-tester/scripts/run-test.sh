#!/usr/bin/env bash
set -euo pipefail

# Usage: run-test.sh <output-dir> <test-id> <prompt> [max-turns]
# Output: <output-dir>/<test-id>.jsonl (stream-json), <output-dir>/<test-id>.exit (exit code)

output_dir="$1"
test_id="$2"
prompt="$3"
max_turns="${4:-10}"

output_file="${output_dir}/${test_id}.jsonl"

mkdir -p "$output_dir"

# CLAUDECODE を除去して別セッションとして起動
env -u CLAUDECODE claude -p "$prompt" \
  --output-format stream-json \
  --verbose \
  --max-turns "$max_turns" \
  --no-session-persistence \
  --dangerously-skip-permissions \
  > "$output_file" 2>/dev/null

echo "$?" > "${output_dir}/${test_id}.exit"
