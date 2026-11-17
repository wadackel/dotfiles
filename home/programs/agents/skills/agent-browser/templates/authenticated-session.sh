#!/bin/bash

set -euo pipefail

LOGIN_URL="${1:?Usage: $0 <login-url> [state-file]}"
STATE_FILE="${2:-$HOME/.agent-browser-state/main.json}"
# An empty name would fall into agent-browser's `default` session, shared by every
# process and closed by no session's end.
SESSION="${AGENT_BROWSER_SESSION:-${CODEX_THREAD_ID:+codex-$CODEX_THREAD_ID}}"
SESSION="${SESSION:-${CLAUDE_PID:+claude-$CLAUDE_PID}}"
: "${SESSION:?None of AGENT_BROWSER_SESSION, CODEX_THREAD_ID, CLAUDE_PID is set}"

if [[ ! -f "$STATE_FILE" ]]; then
    echo "State file not found: $STATE_FILE" >&2
    echo "Run 'abr' to import auth state from your Chrome." >&2
    exit 1
fi

# --state on a running browser relaunches it and discards its pages, and `open` would
# replace its active tab, so a browser that is already up (the lead's, when a subagent
# runs this) only gets a new tab.
STARTED=0
if agent-browser --json session list | jq -e --arg s "$SESSION" '.data.sessions | index($s)' >/dev/null; then
    echo "Using the running browser of session $SESSION..."
    agent-browser --session "$SESSION" tab new "$LOGIN_URL"
else
    echo "Loading saved state from $STATE_FILE (session: $SESSION)..."
    agent-browser --session "$SESSION" --state "$STATE_FILE" open "$LOGIN_URL"
    STARTED=1
fi
agent-browser --session "$SESSION" wait 2000

CURRENT_URL=$(agent-browser --session "$SESSION" get url)
if [[ "$CURRENT_URL" == *"login"* ]] || [[ "$CURRENT_URL" == *"signin"* ]]; then
    echo "Session expired (landed on $CURRENT_URL)." >&2
    echo "Re-run 'abr $LOGIN_URL' against a logged-in Chrome." >&2
    echo "If it still lands here, the SSO flow needs a third-party domain: retry with --all-cookies." >&2
    if [[ "$STARTED" == 1 ]]; then
        agent-browser --session "$SESSION" close >/dev/null 2>&1 || true
    else
        echo "The browser was already running; if it started without the state, reload it: agent-browser --session $SESSION --state $STATE_FILE open $LOGIN_URL" >&2
    fi
    exit 1
fi

echo "Session restored successfully"
agent-browser --session "$SESSION" snapshot -i
