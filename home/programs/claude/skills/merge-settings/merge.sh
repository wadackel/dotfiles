#!/usr/bin/env bash
set -euo pipefail

# ================================================================
# Settings Merger - Merge .claude/settings.local.json to global settings
# ================================================================

# 定数
readonly CLAUDE_HOME="${HOME}/.claude"
readonly USER_SETTINGS="${CLAUDE_HOME}/settings.json"
readonly BACKUP_DIR="${CLAUDE_HOME}/backups"
readonly PROJECT_LOCAL_SETTINGS="./.claude/settings.local.json"

# ================================================================
# ヘルパー関数
# ================================================================

# エラーJSON出力
error_json() {
  local error_type="$1"
  local message="$2"
  jq -n \
    --arg status "error" \
    --arg error_type "${error_type}" \
    --arg message "${message}" \
    '{status: $status, error_type: $error_type, message: $message}'
}

# 成功JSON出力
success_json() {
  local applied_count="$1"
  local backup_path="$2"
  jq -n \
    --arg status "success" \
    --argjson applied_count "${applied_count}" \
    --arg backup_path "${backup_path}" \
    --arg message "${applied_count}件のルールを追加しました" \
    '{status: $status, applied_count: $applied_count, backup_path: $backup_path, message: $message}'
}

# noop JSON出力
noop_json() {
  jq -n \
    --arg status "noop" \
    --arg message "新規ルールはありません（すべて既存）" \
    '{status: $status, message: $message}'
}

# 提案JSON出力
proposal_json() {
  local new_rules_json="$1"
  local new_rules_count="$2"
  local project_path="$3"
  local rules_hash="$4"
  jq -n \
    --arg status "proposal" \
    --argjson new_rules "${new_rules_json}" \
    --argjson new_rules_count "${new_rules_count}" \
    --arg project_path "${project_path}" \
    --arg user_settings_path "${USER_SETTINGS}" \
    --arg rules_hash "${rules_hash}" \
    '{status: $status, new_rules: $new_rules, new_rules_count: $new_rules_count, project_path: $project_path, user_settings_path: $user_settings_path, rules_hash: $rules_hash}'
}

# ================================================================
# コア機能
# ================================================================

# ファイル存在確認
check_local_settings() {
  if [[ ! -f "${PROJECT_LOCAL_SETTINGS}" ]]; then
    error_json "no_local_settings" ".claude/settings.local.json が見つかりません"
    exit 1
  fi
}

check_user_settings() {
  if [[ ! -f "${USER_SETTINGS}" ]]; then
    error_json "no_user_settings" "~/.claude/settings.json が見つかりません"
    exit 1
  fi
}

# ローカル設定からルール抽出
extract_local_rules() {
  local rules
  rules=$(jq -r '.permissions.allow[]? // empty' "${PROJECT_LOCAL_SETTINGS}" 2>/dev/null) || {
    error_json "invalid_local_json" ".claude/settings.local.json のJSON形式が不正です"
    exit 1
  }

  if [[ -z "${rules}" ]]; then
    error_json "no_local_rules" ".claude/settings.local.json に permissions.allow が見つかりません"
    exit 1
  fi

  echo "${rules}"
}

# グローバル設定からルール抽出
extract_existing_rules() {
  local rules
  rules=$(jq -r '.permissions.allow[]? // empty' "${USER_SETTINGS}" 2>/dev/null) || {
    error_json "invalid_user_json" "~/.claude/settings.json のJSON形式が不正です"
    exit 1
  }

  echo "${rules}"
}

# 差分計算（新規ルールのみ）
calculate_diff() {
  local local_rules="$1"
  local existing_rules="$2"

  # grep -Fxvで完全一致しないものを抽出（新規ルールのみ）
  local new_rules
  if [[ -n "${existing_rules}" ]]; then
    new_rules=$(echo "${local_rules}" | grep -Fxv "${existing_rules}" || true)
  else
    new_rules="${local_rules}"
  fi

  echo "${new_rules}"
}

# バックアップ作成
create_backup() {
  local timestamp
  timestamp=$(date +"%Y%m%d_%H%M%S")
  local backup_path="${BACKUP_DIR}/settings_${timestamp}.json"

  mkdir -p "${BACKUP_DIR}"

  if ! cp "${USER_SETTINGS}" "${backup_path}"; then
    error_json "backup_failed" "バックアップの作成に失敗しました"
    exit 1
  fi

  echo "${backup_path}"
}

# ルールをJSON配列に変換
json_array_from_lines() {
  local lines="$1"
  printf '%s\n' "${lines}" | jq -R 'select(length > 0)' | jq -s .
}

# ルールJSONの正規化
canonicalize_rules_json() {
  local rules_json="$1"
  printf '%s' "${rules_json}" | jq -c 'sort | unique'
}

# ルールJSONのハッシュ計算
calculate_rules_hash() {
  local rules_json="$1"
  printf '%s' "${rules_json}" | shasum -a 256 | awk '{print $1}'
}

# ルールマージ実行
merge_rules() {
  local new_rules_json="$1"
  local backup_path="$2"

  # 一時ファイル作成
  local temp_file
  temp_file=$(mktemp)
  trap 'rm -f "${temp_file}"' EXIT

  # 既存のルールと新規ルールをマージ（unique + sort）
  if ! jq --argjson new_rules "${new_rules_json}" \
    '.permissions.allow = ((.permissions.allow // []) + $new_rules | unique | sort)' \
    "${USER_SETTINGS}" > "${temp_file}"; then
    error_json "merge_failed" "ルールのマージに失敗しました"
    exit 1
  fi

  # 上書き（symlinkを保持）
  if ! cat "${temp_file}" > "${USER_SETTINGS}"; then
    # 失敗時はバックアップから復元
    cp "${backup_path}" "${USER_SETTINGS}"
    error_json "write_failed" "設定ファイルの更新に失敗しました（バックアップから復元済み）"
    exit 1
  fi
}

# ================================================================
# モード実装
# ================================================================

# 提案モード
proposal_mode() {
  check_local_settings
  check_user_settings

  local local_rules
  local_rules=$(extract_local_rules)

  local existing_rules
  existing_rules=$(extract_existing_rules)

  local new_rules
  new_rules=$(calculate_diff "${local_rules}" "${existing_rules}")

  # 新規ルールがない場合
  if [[ -z "${new_rules}" ]]; then
    noop_json
    exit 0
  fi

  # 提案JSON出力
  local new_rules_json
  new_rules_json=$(json_array_from_lines "${new_rules}") || {
    error_json "invalid_rules" "Failed to build rules JSON"
    exit 1
  }

  local canonical_rules_json
  canonical_rules_json=$(canonicalize_rules_json "${new_rules_json}") || {
    error_json "invalid_rules" "Failed to canonicalize rules JSON"
    exit 1
  }

  local new_rules_count
  new_rules_count=$(printf '%s' "${canonical_rules_json}" | jq 'length') || {
    error_json "invalid_rules" "Failed to count rules"
    exit 1
  }

  local rules_hash
  rules_hash=$(calculate_rules_hash "${canonical_rules_json}")

  local project_path
  project_path=$(pwd)

  proposal_json "${canonical_rules_json}" "${new_rules_count}" "${project_path}" "${rules_hash}"
}

# 適用モード
apply_mode() {
  local rules_json="$1"
  local expected_hash="${2:-}"

  check_user_settings

  local canonical_rules_json
  canonical_rules_json=$(canonicalize_rules_json "${rules_json}") || {
    error_json "invalid_rules" "Invalid rules JSON"
    exit 1
  }

  local rules_count
  rules_count=$(printf '%s' "${canonical_rules_json}" | jq 'length') || {
    error_json "invalid_rules" "Failed to count rules"
    exit 1
  }

  if [[ "${rules_count}" -eq 0 ]]; then
    error_json "no_rules" "No rules to apply"
    exit 1
  fi

  if [[ -n "${expected_hash}" ]]; then
    local actual_hash
    actual_hash=$(calculate_rules_hash "${canonical_rules_json}")
    if [[ "${actual_hash}" != "${expected_hash}" ]]; then
      error_json "rules_hash_mismatch" "Approved rules do not match"
      exit 1
    fi
  fi

  # バックアップ作成
  local backup_path
  backup_path=$(create_backup)

  # マージ実行
  merge_rules "${canonical_rules_json}" "${backup_path}"

  # 成功JSON出力
  success_json "${rules_count}" "${backup_path}"
}

# ================================================================
# メイン処理
# ================================================================

main() {
  local mode="${1:-}"

  case "${mode}" in
    --apply)
      local rules_json="${2:-}"
      local expected_hash=""

      if [[ -z "${rules_json}" ]]; then
        error_json "missing_rules" "Usage: $0 --apply '<rules_json>' --hash <hash>"
        exit 1
      fi

      if [[ "${3:-}" != "--hash" ]]; then
        error_json "missing_hash" "Usage: $0 --apply '<rules_json>' --hash <hash>"
        exit 1
      fi

      if [[ -z "${4:-}" ]]; then
        error_json "missing_hash" "Usage: $0 --apply '<rules_json>' --hash <hash>"
        exit 1
      fi

      expected_hash="${4}"

      apply_mode "${rules_json}" "${expected_hash}"
      ;;
    *)
      proposal_mode
      ;;
  esac
}

main "$@"
