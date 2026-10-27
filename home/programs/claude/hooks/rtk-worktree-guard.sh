#!/usr/bin/env bash
# Runs `rtk hook claude` except for git commands in a linked worktree. Claude
# Code refuses `rtk git ...` in a worktree-isolated session, because its guard
# cannot see which repository a git behind an unknown launcher targets; rtk
# 1.0.1 rewrites git even under `.claude/worktrees/`.

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [[ "$CMD" =~ (^|[^[:alnum:]_.-])git($|[^[:alnum:]_.-]) ]]; then
  CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
  DIRS=$(git -C "${CWD:-.}" rev-parse --path-format=absolute --git-dir --git-common-dir 2>/dev/null)
  [ -n "$DIRS" ] && [ "$(echo "$DIRS" | sed -n 1p)" != "$(echo "$DIRS" | sed -n 2p)" ] && exit 0
fi

OUTPUT=$(echo "$INPUT" | rtk hook claude) || exit 0
[ -z "$OUTPUT" ] && exit 0

# rtk allows a rewrite whenever settings.json has a matching allow rule, but
# auto mode drops the broad interpreter and package-manager rules, so for those
# the decision is removed and the classifier still sees the rewrite. A runner
# anywhere as a word counts, so an assignment, a wrapper, a newline or a path
# before it does not hide it; a false match only costs one classifier call.
RUNNERS='npm|pnpm|yarn|bun|bunx|npx|uv|uvx|pip|pip3|python|python3|node|deno|ruby|perl|cargo|go|make|just'
if [[ "$CMD" =~ (^|[^[:alnum:]_.-])($RUNNERS)($|[^[:alnum:]_.-]) ]]; then
  echo "$OUTPUT" | jq -c 'del(.hookSpecificOutput.permissionDecision, .hookSpecificOutput.permissionDecisionReason)'
else
  echo "$OUTPUT"
fi
