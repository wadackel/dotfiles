#!/bin/bash
# Template: State-replay Workflow
# Purpose: Load a saved auth state file and verify the session is still valid.
# Usage: ./authenticated-session.sh <login-url> [state-file]
#
# Default state file is $HOME/.agent-browser-state/main.json (the path
# `ab-state-refresh` writes to). Override by passing arg 2.
# To refresh expired state, run `ab-state-refresh` (host zsh function) against a
# fresh, logged-in Chrome — see references/authentication.md.

set -euo pipefail

LOGIN_URL="${1:?Usage: $0 <login-url> [state-file]}"
STATE_FILE="${2:-$HOME/.agent-browser-state/main.json}"
SESSION="claude-$PPID"

if [[ ! -f "$STATE_FILE" ]]; then
    echo "State file not found: $STATE_FILE" >&2
    echo "Run 'ab-state-refresh' to import auth state from your Chrome." >&2
    exit 1
fi

echo "Loading saved state from $STATE_FILE (session: $SESSION)..."
agent-browser --session "$SESSION" --state "$STATE_FILE" open "$LOGIN_URL"
agent-browser --session "$SESSION" wait 2000

CURRENT_URL=$(agent-browser --session "$SESSION" get url)
if [[ "$CURRENT_URL" == *"login"* ]] || [[ "$CURRENT_URL" == *"signin"* ]]; then
    echo "Session expired (landed on $CURRENT_URL)." >&2
    echo "Re-run 'ab-state-refresh' to refresh state from a logged-in Chrome." >&2
    agent-browser --session "$SESSION" close 2>/dev/null || true
    exit 1
fi

echo "Session restored successfully"
agent-browser --session "$SESSION" snapshot -i
