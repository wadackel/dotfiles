#!/usr/bin/env bash
#
# Claude Code Settings Smart Checker
# プロジェクトごとの .claude/settings.local.json の許可設定を
# ~/.claude/settings.json へマージするオールインワンスクリプト
#
# Usage:
#   settings-smart-checker.sh --check              # 新規設定を検出してClaudeに通知
#   settings-smart-checker.sh --apply <rules_json> # ユーザー承認後にマージ実行
#   settings-smart-checker.sh --skip <rules_json>  # ルールをスキップリストに追加
#

set -euo pipefail

# ================================
# 設定
# ================================

CLAUDE_HOME="${HOME}/.claude"
STATE_DIR="${CLAUDE_HOME}/state"
BACKUP_DIR="${CLAUDE_HOME}/backups"
CONFIG_DIR="${CLAUDE_HOME}/config"
USER_SETTINGS="${CLAUDE_HOME}/settings.json"
SECURITY_RULES="${CONFIG_DIR}/settings-security-rules.json"

# ================================
# ヘルパー関数
# ================================

log_info() {
  echo "[INFO] $*" >&2
}

log_error() {
  echo "[ERROR] $*" >&2
}

# プロジェクトハッシュの計算（パスベース）
get_project_hash() {
  local project_path="$1"
  echo -n "${project_path}" | shasum -a 256 | cut -d' ' -f1
}

# Local設定ファイルのハッシュを計算
get_settings_hash() {
  local settings_file="$1"
  if [[ -f "${settings_file}" ]]; then
    shasum -a 256 "${settings_file}" | cut -d' ' -f1
  else
    echo "none"
  fi
}

# 状態ファイルのパスを取得
get_state_file() {
  local project_hash="$1"
  echo "${STATE_DIR}/settings-${project_hash}.state"
}

# スキップリストファイルのパスを取得
get_skip_file() {
  local project_hash="$1"
  echo "${STATE_DIR}/settings-${project_hash}.skip"
}

# ================================
# セキュリティ分類
# ================================

classify_rule() {
  local rule="$1"

  # セキュリティルールが存在しない場合はReviewとして扱う
  if [[ ! -f "${SECURITY_RULES}" ]]; then
    echo "review"
    return
  fi

  # Dangerous パターンチェック
  local dangerous_patterns
  dangerous_patterns=$(jq -r '.dangerous_patterns[]' "${SECURITY_RULES}" 2>/dev/null || echo "")

  while IFS= read -r pattern; do
    [[ -z "${pattern}" ]] && continue
    # シェルのパターンマッチングではなく、grepで正規表現マッチング
    if echo "${rule}" | grep -qE "${pattern}"; then
      echo "dangerous"
      return
    fi
  done <<< "${dangerous_patterns}"

  # Safe パターンチェック
  local safe_patterns
  safe_patterns=$(jq -r '.safe_patterns[]' "${SECURITY_RULES}" 2>/dev/null || echo "")

  while IFS= read -r pattern; do
    [[ -z "${pattern}" ]] && continue
    if echo "${rule}" | grep -qE "${pattern}"; then
      echo "safe"
      return
    fi
  done <<< "${safe_patterns}"

  # どちらにも該当しない場合はReview
  echo "review"
}

# ================================
# --check モード
# ================================

check_mode() {
  # 現在のディレクトリをプロジェクトパスとして使用
  local project_path
  project_path="$(pwd)"
  local local_settings="${project_path}/.claude/settings.local.json"

  # Local設定が存在しない場合は何もしない
  if [[ ! -f "${local_settings}" ]]; then
    exit 0
  fi

  # 必要なディレクトリを作成
  mkdir -p "${STATE_DIR}" "${BACKUP_DIR}"

  # プロジェクトハッシュを計算
  local project_hash
  project_hash=$(get_project_hash "${project_path}")

  local state_file
  state_file=$(get_state_file "${project_hash}")

  local skip_file
  skip_file=$(get_skip_file "${project_hash}")

  # 現在の設定ハッシュ
  local current_hash
  current_hash=$(get_settings_hash "${local_settings}")

  # 前回のハッシュを読み込み
  local previous_hash="none"
  if [[ -f "${state_file}" ]]; then
    previous_hash=$(cat "${state_file}")
  fi

  # ハッシュが同じなら何もしない（高速終了）
  if [[ "${current_hash}" == "${previous_hash}" ]]; then
    exit 0
  fi

  # Local設定からpermissions.allowを抽出
  if ! jq -e '.permissions.allow' "${local_settings}" >/dev/null 2>&1; then
    exit 0
  fi

  local local_rules
  local_rules=$(jq -r '.permissions.allow[]' "${local_settings}" 2>/dev/null || echo "")

  # User設定から既存のルールを取得
  local existing_rules=""
  if [[ -f "${USER_SETTINGS}" ]] && jq -e '.permissions.allow' "${USER_SETTINGS}" >/dev/null 2>&1; then
    existing_rules=$(jq -r '.permissions.allow[]' "${USER_SETTINGS}" 2>/dev/null || echo "")
  fi

  # スキップリストを読み込み
  local skip_list=""
  if [[ -f "${skip_file}" ]]; then
    skip_list=$(cat "${skip_file}")
  fi

  # 新規ルールを抽出（既存とスキップリストを除外）
  local new_rules=()
  while IFS= read -r rule; do
    [[ -z "${rule}" ]] && continue

    # 既存のルールに含まれている場合はスキップ
    if echo "${existing_rules}" | grep -qFx "${rule}"; then
      continue
    fi

    # スキップリストに含まれている場合はスキップ
    if echo "${skip_list}" | grep -qFx "${rule}"; then
      continue
    fi

    new_rules+=("${rule}")
  done <<< "${local_rules}"

  # 新規ルールがない場合は状態を更新して終了
  if [[ ${#new_rules[@]} -eq 0 ]]; then
    echo "${current_hash}" > "${state_file}"
    exit 0
  fi

  # セキュリティ分類
  local safe_rules=()
  local review_rules=()
  local dangerous_rules=()

  for rule in "${new_rules[@]}"; do
    local category
    category=$(classify_rule "${rule}")

    case "${category}" in
      safe)
      safe_rules+=("${rule}")
      ;;
      review)
      review_rules+=("${rule}")
      ;;
      dangerous)
      dangerous_rules+=("${rule}")
      ;;
    esac
  done

  # JSON形式で環境変数にセット（Claudeが読み取る）
  local proposal
  proposal=$(jq -n \
    --argjson safe "$(printf '%s\n' "${safe_rules[@]}" | jq -R . | jq -s .)" \
    --argjson review "$(printf '%s\n' "${review_rules[@]}" | jq -R . | jq -s .)" \
    --argjson dangerous "$(printf '%s\n' "${dangerous_rules[@]}" | jq -R . | jq -s .)" \
    --arg project_path "${project_path}" \
    '{safe: $safe, review: $review, dangerous: $dangerous, project_path: $project_path}')

  # 環境変数にセット
  export CLAUDE_SETTINGS_PROPOSAL="${proposal}"

  # 提案内容を標準出力に出力（Claudeが読み取る）
  echo "${proposal}"
}

# ================================
# --apply モード
# ================================

apply_mode() {
  local rules_json="$1"

  # ルールをパース
  local rules
  rules=$(echo "${rules_json}" | jq -r '.[]' 2>/dev/null || echo "")

  if [[ -z "${rules}" ]]; then
    log_error "No rules to apply"
    exit 1
  fi

  # User設定が存在しない場合はエラー
  if [[ ! -f "${USER_SETTINGS}" ]]; then
    log_error "User settings not found: ${USER_SETTINGS}"
    exit 1
  fi

  # バックアップを作成
  local timestamp
  timestamp=$(date +%Y%m%d_%H%M%S)
  local backup_file="${BACKUP_DIR}/settings_${timestamp}.json"

  cp "${USER_SETTINGS}" "${backup_file}"
  log_info "Backup created: ${backup_file}"

  # 既存のルールを取得
  local existing_allow
  existing_allow=$(jq -r '.permissions.allow' "${USER_SETTINGS}" 2>/dev/null || echo "[]")

  # 新しいルールを追加
  local new_allow
  new_allow=$(echo "${existing_allow}" | jq -r '.[]' 2>/dev/null || echo "")

  while IFS= read -r rule; do
    [[ -z "${rule}" ]] && continue
    new_allow="${new_allow}"$'\n'"${rule}"
  done <<< "${rules}"

  # 重複を除去してソート
  local merged_allow
  merged_allow=$(echo "${new_allow}" | grep -v '^$' | sort -u | jq -R . | jq -s .)

  # User設定を更新
  local updated_settings
  updated_settings=$(jq --argjson allow "${merged_allow}" '.permissions.allow = $allow' "${USER_SETTINGS}")

  echo "${updated_settings}" > "${USER_SETTINGS}"

  local rules_count
  rules_count=$(echo "${rules}" | grep -v '^$' | wc -l | tr -d ' ')

  log_info "Applied ${rules_count} rules to ${USER_SETTINGS}"

  # 状態ファイルを更新（無限ループ防止）
  local project_path
  project_path="$(pwd)"
  local project_hash
  project_hash=$(get_project_hash "${project_path}")
  local state_file
  state_file=$(get_state_file "${project_hash}")

  local local_settings="${project_path}/.claude/settings.local.json"
  local current_hash
  current_hash=$(get_settings_hash "${local_settings}")

  echo "${current_hash}" > "${state_file}"

  echo "Success"
}

# ================================
# --skip モード
# ================================

skip_mode() {
  local rules_json="$1"

  # ルールをパース
  local rules
  rules=$(echo "${rules_json}" | jq -r '.[]' 2>/dev/null || echo "")

  if [[ -z "${rules}" ]]; then
    log_error "No rules to skip"
    exit 1
  fi

  # プロジェクトハッシュを計算
  local project_path
  project_path="$(pwd)"
  local project_hash
  project_hash=$(get_project_hash "${project_path}")

  local skip_file
  skip_file=$(get_skip_file "${project_hash}")

  # 既存のスキップリストを読み込み
  local existing_skip=""
  if [[ -f "${skip_file}" ]]; then
    existing_skip=$(cat "${skip_file}")
  fi

  # 新しいルールを追加
  local new_skip="${existing_skip}"
  while IFS= read -r rule; do
    [[ -z "${rule}" ]] && continue
    new_skip="${new_skip}"$'\n'"${rule}"
  done <<< "${rules}"

  # 重複を除去
  echo "${new_skip}" | grep -v '^$' | sort -u > "${skip_file}"

  local rules_count
  rules_count=$(echo "${rules}" | grep -v '^$' | wc -l | tr -d ' ')

  log_info "Added ${rules_count} rules to skip list"

  # 状態ファイルを更新
  local state_file
  state_file=$(get_state_file "${project_hash}")

  local local_settings="${project_path}/.claude/settings.local.json"
  local current_hash
  current_hash=$(get_settings_hash "${local_settings}")

  echo "${current_hash}" > "${state_file}"

  echo "Success"
}

# ================================
# メイン処理
# ================================

main() {
  case "${1:-}" in
    --check)
      check_mode
      ;;
    --apply)
      if [[ -z "${2:-}" ]]; then
        log_error "Usage: $0 --apply <rules_json>"
        exit 1
      fi
      apply_mode "$2"
      ;;
    --skip)
      if [[ -z "${2:-}" ]]; then
        log_error "Usage: $0 --skip <rules_json>"
        exit 1
      fi
      skip_mode "$2"
      ;;
    *)
      log_error "Usage: $0 {--check|--apply <rules_json>|--skip <rules_json>}"
      exit 1
      ;;
  esac
}

main "$@"
