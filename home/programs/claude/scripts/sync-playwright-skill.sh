#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/microsoft/playwright-cli.git"
REMOTE_DIR="skills/playwright-cli"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../skills/playwright-cli" && pwd)"

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

echo "Syncing playwright-cli skill from microsoft/playwright-cli..."

git clone --depth 1 --filter=blob:none --sparse "$REPO_URL" "$tmpdir/repo" 2>/dev/null
git -C "$tmpdir/repo" sparse-checkout set "$REMOTE_DIR" 2>/dev/null

src="$tmpdir/repo/$REMOTE_DIR"

if [[ ! -f "$src/SKILL.md" ]]; then
  echo "Error: SKILL.md not found in upstream" >&2
  exit 1
fi

rsync -rc --delete --exclude='.playwright-cli' "$src/" "$SKILL_DIR/" \
  --out-format="✓ %n updated"

echo ""
echo "Done."
