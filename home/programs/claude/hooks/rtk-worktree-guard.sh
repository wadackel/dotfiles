#!/usr/bin/env bash
# Runs rtk-rewrite.sh except for git commands in a linked worktree. Claude Code
# refuses `rtk git ...` in a worktree-isolated session, because its guard cannot
# see which repository a git behind an unknown launcher targets. The check is
# not in rtk-rewrite.sh itself: rtk refuses to run once that file stops matching
# .rtk-hook.sha256, and `rtk init` would overwrite it.

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [[ "$CMD" =~ (^|[^[:alnum:]_.-])git($|[^[:alnum:]_.-]) ]]; then
  CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
  DIRS=$(git -C "${CWD:-.}" rev-parse --path-format=absolute --git-dir --git-common-dir 2>/dev/null)
  [ -n "$DIRS" ] && [ "$(echo "$DIRS" | sed -n 1p)" != "$(echo "$DIRS" | sed -n 2p)" ] && exit 0
fi

echo "$INPUT" | exec "$(dirname "$0")/rtk-rewrite.sh"
