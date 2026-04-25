# Video Recording

Capture browser automation as video for debugging, documentation, or verification.

**Related**: [commands.md](commands.md) for full command reference, [SKILL.md](../SKILL.md) for quick start.

## Contents

- [Basic Recording](#basic-recording)
- [Recording Commands](#recording-commands)
- [Use Cases](#use-cases)
- [Best Practices](#best-practices)
- [Output Format](#output-format)
- [Limitations](#limitations)

## Basic Recording

```bash
# Start recording
agent-browser record start ./demo.webm

# Perform actions
agent-browser open https://example.com
agent-browser snapshot -i
agent-browser click @e1
agent-browser fill @e2 "test input"

# Stop and save
agent-browser record stop
```

## Recording Commands

```bash
# Start recording to file
agent-browser record start ./output.webm

# Stop current recording
agent-browser record stop

# Restart with new file (stops current + starts new)
agent-browser record restart ./take2.webm
```

## Use Cases

### Debugging Failed Automation

```bash
#!/bin/bash
# Record automation for debugging

agent-browser record start ./debug-$(date +%Y%m%d-%H%M%S).webm

# Run your automation
agent-browser open https://app.example.com
agent-browser snapshot -i
agent-browser click @e1 || {
    echo "Click failed - check recording"
    agent-browser record stop
    exit 1
}

agent-browser record stop
```

### Documentation Generation

```bash
#!/bin/bash
# Record workflow for documentation

agent-browser record start ./docs/how-to-login.webm

agent-browser open https://app.example.com/login
agent-browser wait 1000  # Pause for visibility

agent-browser snapshot -i
agent-browser fill @e1 "demo@example.com"
agent-browser wait 500

agent-browser fill @e2 "password"
agent-browser wait 500

agent-browser click @e3
agent-browser wait --load networkidle
agent-browser wait 1000  # Show result

agent-browser record stop
```

### CI/CD Test Evidence

```bash
#!/bin/bash
# Record E2E test runs for CI artifacts

TEST_NAME="${1:-e2e-test}"
RECORDING_DIR="./test-recordings"
mkdir -p "$RECORDING_DIR"

agent-browser record start "$RECORDING_DIR/$TEST_NAME-$(date +%s).webm"

# Run test
if run_e2e_test; then
    echo "Test passed"
else
    echo "Test failed - recording saved"
fi

agent-browser record stop
```

## Best Practices

### 1. Add Pauses for Clarity

```bash
# Slow down for human viewing
agent-browser click @e1
agent-browser wait 500  # Let viewer see result
```

### 2. Use Descriptive Filenames

```bash
# Include context in filename
agent-browser record start ./recordings/login-flow-2024-01-15.webm
agent-browser record start ./recordings/checkout-test-run-42.webm
```

### 3. Handle Recording in Error Cases

```bash
#!/bin/bash
set -e

cleanup() {
    agent-browser record stop 2>/dev/null || true
    agent-browser close 2>/dev/null || true
}
trap cleanup EXIT

agent-browser record start ./automation.webm
# ... automation steps ...
```

### 4. Combine with Screenshots

```bash
# Record video AND capture key frames
agent-browser record start ./flow.webm

agent-browser open https://example.com
agent-browser screenshot ./screenshots/step1-homepage.png

agent-browser click @e1
agent-browser screenshot ./screenshots/step2-after-click.png

agent-browser record stop
```

### 5. Verify URL and Tab State Before and After Recording

The recording itself succeeds even when the page silently navigates mid-flow. Sandwich every action between `get url` and `tab list` probes inside the same `batch` so silent navigation surfaces in the batch output instead of being discovered after reviewing a multi-minute video.

`agent-browser batch` is sequential-only — it cannot branch on intermediate output. The probes inside the batch are **recordings**; you read the batch's combined stdout afterward and decide whether to issue the next batch. If the post-action `get url` does not match the expected URL, stop recording and investigate the cause (keybind collision, expired auth, redirect) before resuming.

Use both probes — `get url` reports the active tab's URL, while `tab list` reveals every tab's URL with stable ids and catches the case where focus has shifted to a different tab.

```bash
SESSION="claude-$PPID"
EXPECTED_URL="https://github.com/owner/repo"

agent-browser --session "$SESSION" record start /tmp/qa-test.webm

# Open + verify URL/tab state in one batch
agent-browser --session "$SESSION" batch \
  "tab new $EXPECTED_URL" \
  "wait 3000" \
  "get url" \
  "tab list"

# Read the batch output above. Confirm 'get url' == "$EXPECTED_URL"
# and 'tab list' shows the expected tab as active. If not, stop and investigate.

# Wrap each subsequent action between fresh URL/tab probes
agent-browser --session "$SESSION" batch \
  "scrollintoview @e1" \
  "wait 500" \
  "get url" \
  "tab list"

# Read again. URL drift here usually means a site keybind collided
# with the action — see "Site Keybind Conflicts During Recording" below.

agent-browser --session "$SESSION" record stop
```

## Output Format

- Default format: WebM (VP8/VP9 codec)
- Compatible with all modern browsers and video players
- Compressed but high quality

## Limitations

- Recording adds slight overhead to automation
- Large recordings can consume significant disk space
- Some headless environments may have codec limitations

### Site Keybind Conflicts During Recording

`agent-browser scroll` sends OS keyboard events that some sites interpret as their own shortcuts — GitHub `gd` jumps to the Dashboard, Gmail `j` / `k` move between messages — and the page navigates mid-recording. The webm file still saves, but the captured content is not what the automation intended.

See SKILL.md "### Site keybind conflicts (mitigation, not guarantee)" for the full mitigation matrix and recommended alternatives (`pdf`, `scrollintoview @ref`, `eval window.scrollTo()` with URL verification).
