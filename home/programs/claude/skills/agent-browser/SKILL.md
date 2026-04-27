---
name: agent-browser
description: Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include requests to "open a website", "fill out a form", "click a button", "take a screenshot", "scrape data from a page", "test this web app", "login to a site", "automate browser actions", "ブラウザで確認", "Chromeで開いて", "スクリーンショット", verifying UI, or any task requiring programmatic web interaction. Also use in plan mode when planning browser-based verification to apply correct data extraction strategies and avoid common anti-patterns.
allowed-tools: Bash(npx agent-browser:*), Bash(agent-browser:*)
---

# Browser Automation with agent-browser

The CLI uses Chrome/Chromium via CDP directly. Install via `npm i -g agent-browser`, `brew install agent-browser`, or `cargo install agent-browser`. Run `agent-browser install` to download Chrome. Existing Chrome, Brave, Playwright, and Puppeteer installations are detected automatically. Run `agent-browser upgrade` to update to the latest version.

## Default Flags

This environment runs agent-browser in **state-import + headless** mode by default. Pass two flags on every invocation:

- `--session "claude-$PPID"` — use a daemon isolated to this Claude session. `$PPID` in a Bash subshell points at the Claude main process, so all calls within one Claude session (main + any subagents) share the same daemon. Different Claude sessions (separate terminals) get different `$PPID` values and therefore separate daemons, so they cannot interfere with each other.
- `--state "$HOME/.agent-browser-state/main.json"` — load the plaintext state file produced by `ab-state-refresh`. Required on the **first** call of the session (whichever subcommand starts the daemon). Subsequent calls within the same session can omit it because the daemon already has the state loaded.

```bash
# First call: include both flags
agent-browser --session "claude-$PPID" --state "$HOME/.agent-browser-state/main.json" tab new <url>

# Subsequent calls within the same Claude session: --state can be omitted
agent-browser --session "claude-$PPID" snapshot -i
agent-browser --session "claude-$PPID" click @e1
agent-browser --session "claude-$PPID" record start <path>
agent-browser --session "claude-$PPID" screenshot <path>
```

The browser is independent and headless; the user's live Chrome window is never touched. **No `--auto-connect` flag** is needed in normal commands.

### Why these flags

agent-browser CLI 0.26 hardcodes an env var name for state auto-load that, if exported, makes the daemon navigate to `origins[0]` on the first command and reject any subsequent `--state` flag with `⚠ --state ignored: daemon already running`. To stay clear of that behavior, **never** export `AGENT_BROWSER_STATE` in this environment, and pass `--state` explicitly on the call that may start the daemon.

The host's `AGENT_BROWSER_STATE_PATH` env var is intentionally **not** referenced from these flags. Past iterations relied on it, but it does not propagate reliably from the user's zsh through Claude's shell-snapshot mechanism into Bash subshells. Using a literal path eliminates that uncertainty.

### Cleanup

Daemon idle timeout is disabled by default (`AGENT_BROWSER_IDLE_TIMEOUT_MS`), so each Claude session's daemon stays up until you `close` it. Close at the end of the workflow:

```bash
# Normal cleanup at end of workflow
agent-browser --session "claude-$PPID" close

# Stale socket / pid sidecars from a previous crash
agent-browser doctor --fix
```

For richer session management options (named sessions for parallel scraping, state persistence patterns) see [references/session-management.md](references/session-management.md).

### Initial setup (one-time)

Before the first agent-browser call, the user must populate the state file by running the host's `ab-state-refresh` zsh function. This:
1. Creates `~/.agent-browser-state/` with mode 700.
2. Connects to the user's running Chrome via the CDP WebSocket discovered from `DevToolsActivePort` (one-shot) and saves cookies + localStorage to the state file with mode 600.

**Important**: `agent-browser state save` only captures localStorage for the focused tab plus its iframes (single Page Target constraint of CDP attach). Cookies are browser-context-wide, but localStorage is origin-scoped. Focus the target app's tab before running `ab-state-refresh`, pass URLs as arguments — `ab-state-refresh URL1 URL2 ...` — or pick interactively from open tabs with `ab-state-refresh -i` when multiple origins are needed (see [Step 1 of authentication.md](references/authentication.md#step-1-refresh-the-state-file)).

If `agent-browser --session "claude-$PPID" --state "$HOME/.agent-browser-state/main.json" <cmd>` fails with `No such file or directory: .../main.json`, the state file has not been created yet. **Stop and tell the user**: `Run \`ab-state-refresh\` to import auth state from your Chrome.`

### Sharing one daemon across main + subagents

Within a single Claude session, the main agent and any subagents (Agent tool / Task tool) all see the same `$PPID` (the Claude main process), so they share one `claude-$PPID` daemon. This is intended for `qa-planner` Mode C: Lead and QA Tester both interact with the same authenticated browser. The implication is that **neither side should `close` until the workflow is complete** — `close` tears down the daemon for everyone.

### Tab-Safe Navigation

`agent-browser open <url>` navigates the **active tab** of the headless instance — but since the headless instance is not the user's live Chrome, "active tab" simply means the daemon's current tab. To keep multiple URLs in the same daemon session without overwriting:

```bash
agent-browser tab new <url>
agent-browser tab new <url> --label work   # name the tab for stable later reference
```

Tabs use stable string ids (`t1`, `t2`, ...). Pass `--label <name>` at creation time to reference the tab by a memorable name.

### Escape hatch: `--auto-connect`

`--auto-connect` (CDP attach to the user's live Chrome) is retained for the rare cases where state-import + headless cannot reproduce the target behavior:

- Real-time interaction with the user's logged-in browser (e.g., observing in-flight OAuth popups they trigger manually).
- Sites whose state lives in IndexedDB / Service Worker / Web SQL that the cookie+localStorage state file does not capture.
- The `state save` operation itself (used internally by `ab-state-refresh`).

When using `--auto-connect`, expect to share the user's window — coordinate with them to avoid collisions. Prefer state-import for everything else.

## Core Workflow

Every browser automation follows this pattern:

1. **Navigate**: `agent-browser tab new <url>` (always opens in a new tab to avoid overwriting existing tabs)
2. **Wait** (if needed): `agent-browser wait 2000` or `agent-browser wait <selector>` for SPAs. Note: `open` already waits for the `load` event; additional waiting is only needed for async content
3. **Snapshot**: `agent-browser snapshot -i` (get element refs like `@e1`, `@e2`)
4. **Interact**: Use refs to click, fill, select
5. **Re-snapshot**: After navigation or DOM changes, get fresh refs

```bash
agent-browser tab new https://example.com/form
agent-browser wait 2000
agent-browser snapshot -i
# Output: @e1 [input type="email"], @e2 [input type="password"], @e3 [button] "Submit"

agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait 2000
agent-browser snapshot -i  # Check result
```

## Command Chaining

**Prefer `batch` over `&&` chaining** for 2+ sequential commands. See Batch Execution section below. `&&` chaining still works but `batch` is more efficient.

Commands can be chained with `&&` in a single shell invocation. The browser persists between commands via a background daemon, so chaining is safe and more efficient than separate calls.

```bash
# Chain open + snapshot in one call
agent-browser open https://example.com && agent-browser snapshot -i

# Chain multiple interactions
agent-browser fill @e1 "user@example.com" && agent-browser fill @e2 "password123" && agent-browser click @e3

# Navigate and capture
agent-browser open https://example.com && agent-browser screenshot
```

**When to chain:** Use `&&` when you don't need to read the output of an intermediate command before proceeding (e.g., open + screenshot). Run commands separately when you need to parse the output first (e.g., snapshot to discover refs, then interact using those refs).

## Batch Execution

ALWAYS use `batch` when running 2+ commands in sequence. Batch executes commands in order, so dependent commands (like navigate then screenshot) work correctly. Each quoted argument is a separate command.

```bash
# Navigate and take a snapshot
agent-browser batch "open https://example.com" "snapshot -i"

# Navigate, snapshot, and screenshot in one call
agent-browser batch "open https://example.com" "snapshot -i" "screenshot"

# Click, wait, then screenshot
agent-browser batch "click @e1" "wait 1000" "screenshot"

# With --bail to stop on first error
agent-browser batch --bail "open https://example.com" "click @e1" "screenshot"
```

Only use a single command (not batch) when you need to read the output before deciding the next command. For example, you must run `snapshot -i` as a single command when you need to read the refs to decide what to click. After reading the snapshot, batch the remaining steps.

Stdin mode is also supported for programmatic use:

```bash
echo '[["open","https://example.com"],["screenshot"]]' | agent-browser batch --json
agent-browser batch --bail < commands.json
```

## Efficiency Strategies

These patterns minimize tool calls and token usage.

**Use `--urls` to avoid re-navigation.** When you need to visit links from a page, use `snapshot -i --urls` to get all href URLs upfront. Then `open` each URL directly instead of clicking refs and navigating back.

**Snapshot once, act many times.** Never re-snapshot the same page. Extract all needed info (refs, URLs, text) from a single snapshot, then batch the remaining actions.

**Multi-page workflow (e.g. "visit N sites and screenshot each"):**

```bash
# 1. Get all URLs in one call
agent-browser batch "open https://news.ycombinator.com" "snapshot -i --urls"
# Read output to extract URLs, then visit each directly:
# 2. One batch per target site
agent-browser batch "open https://github.com/example/repo" "screenshot"
agent-browser batch "open https://example.com/article" "screenshot"
agent-browser batch "open https://other.com/page" "screenshot"
```

This approach uses 4 tool calls instead of 14+. Never go back to the listing page between visits.

## Handling Authentication

This environment uses **state-import as the default authentication strategy** (see Default Flags). The host's `ab-state-refresh` function captures the user's Chrome auth state once into a plaintext JSON file at `~/.agent-browser-state/main.json` (mode 600), and each command loads it via `--state "$HOME/.agent-browser-state/main.json"` on the first call of the Claude session.

Other authentication options remain available for special cases:

**Option 1: Persistent Chrome profile (when state file isn't enough)**

If a target site depends on IndexedDB / Service Worker (which the state file does not capture), use a persistent profile:

```bash
# First run: login manually
agent-browser --profile ~/.myapp open https://app.example.com/login
# ... fill credentials, submit ...

# All future runs: already authenticated, full storage preserved
agent-browser --profile ~/.myapp open https://app.example.com/dashboard
```

**Option 2: Chrome profile reuse (zero setup)**

```bash
# List available Chrome profiles
agent-browser profiles

# Reuse the user's existing Chrome login state
agent-browser --profile Default open https://gmail.com
```

**Option 3: Persistent profile (for recurring tasks)**

```bash
# First run: login manually or via automation
agent-browser --profile ~/.myapp open https://app.example.com/login
# ... fill credentials, submit ...

# All future runs: already authenticated
agent-browser --profile ~/.myapp open https://app.example.com/dashboard
```

**Option 4: Session name (auto-save/restore cookies + localStorage)**

```bash
agent-browser --session-name myapp open https://app.example.com/login
# ... login flow ...
agent-browser close  # State auto-saved

# Next time: state auto-restored
agent-browser --session-name myapp open https://app.example.com/dashboard
```

**Option 5: Auth vault (credentials stored encrypted, login by name)**

```bash
echo "$PASSWORD" | agent-browser auth save myapp --url https://app.example.com/login --username user --password-stdin
agent-browser auth login myapp
```

`auth login` navigates with `load` and then waits for login form selectors to appear before filling/clicking, which is more reliable on delayed SPA login screens.

**Option 6: State file (manual save/load)**

```bash
# After logging in:
agent-browser state save ./auth.json
# In a future session:
agent-browser state load ./auth.json
agent-browser open https://app.example.com/dashboard
```

See [references/authentication.md](references/authentication.md) for OAuth, 2FA, cookie-based auth, and token refresh patterns.

## Essential Commands

```bash
# Batch: ALWAYS use batch for 2+ sequential commands. Commands run in order.
agent-browser batch "open https://example.com" "snapshot -i"
agent-browser batch "open https://example.com" "screenshot"
agent-browser batch "click @e1" "wait 1000" "screenshot"

# Navigation
agent-browser open <url>              # Navigate (aliases: goto, navigate)
agent-browser close                   # Close browser
agent-browser close --all             # Close all active sessions

# Snapshot
agent-browser snapshot -i             # Interactive elements with refs (recommended)
agent-browser snapshot -i --urls      # Include href URLs for links
agent-browser snapshot -s "#selector" # Scope to CSS selector

# Interaction (use @refs from snapshot)
agent-browser click @e1               # Click element
agent-browser click @e1 --new-tab     # Click and open in new tab
agent-browser fill @e2 "text"         # Clear and type text
agent-browser type @e2 "text"         # Type without clearing
agent-browser select @e1 "option"     # Select dropdown option
agent-browser check @e1               # Check checkbox
agent-browser press Enter             # Press key
agent-browser keyboard type "text"    # Type at current focus (no selector)
agent-browser keyboard inserttext "text"  # Insert without key events
agent-browser scroll down 500         # Scroll page. Sends keyboard events; on GitHub/Gmail/Linear avoid scroll or use 'pdf' — see "Site keybind conflicts" pattern below.
agent-browser scroll down 500 --selector "div.content"  # Scroll within a specific container

# Get information
agent-browser get text @e1            # Get element text
agent-browser get url                 # Get current URL
agent-browser get title               # Get page title
agent-browser get cdp-url             # Get CDP WebSocket URL

# Wait
agent-browser wait @e1                # Wait for element
agent-browser wait 2000               # Wait milliseconds
agent-browser wait --url "**/page"    # Wait for URL pattern
agent-browser wait --text "Welcome"   # Wait for text to appear (substring match)
agent-browser wait --load networkidle # Wait for network idle (caution: hangs on ad-heavy sites, see Timeouts section)
agent-browser wait --fn "!document.body.innerText.includes('Loading...')"  # Wait for text to disappear
agent-browser wait "#spinner" --state hidden  # Wait for element to disappear

# Downloads
agent-browser download @e1 ./file.pdf          # Click element to trigger download
agent-browser wait --download ./output.zip     # Wait for any download to complete
agent-browser --download-path ./downloads open <url>  # Set default download directory

# Tab management
agent-browser tab list                              # List all open tabs (shows stable tab ids t1, t2, ...)
agent-browser tab new                               # Open a blank new tab
agent-browser tab new https://example.com           # Open URL in a new tab
agent-browser tab new https://example.com --label work  # Open URL and name the tab "work"
agent-browser tab t2                                # Switch by stable tab id (unchanged across opens/closes)
agent-browser tab work                              # Switch by label
agent-browser tab close                             # Close the current tab
agent-browser tab close t2                          # Close by tab id (or by label: `tab close work`)

# Network
agent-browser network requests                 # Inspect tracked requests
agent-browser network requests --type xhr,fetch  # Filter by resource type
agent-browser network requests --method POST   # Filter by HTTP method
agent-browser network requests --status 2xx    # Filter by status (200, 2xx, 400-499)
agent-browser network request <requestId>      # View full request/response detail
agent-browser network route "**/api/*" --abort  # Block matching requests
agent-browser network har start                # Start HAR recording
agent-browser network har stop ./capture.har   # Stop and save HAR file

# Viewport & Device Emulation
agent-browser set viewport 1920 1080          # Set viewport size (default: 1280x720)
agent-browser set viewport 1920 1080 2        # 2x retina (same CSS size, higher res screenshots)
agent-browser set device "iPhone 14"          # Emulate device (viewport + user agent)

# Capture
agent-browser screenshot              # Screenshot to temp dir
agent-browser screenshot --full       # Full page screenshot
agent-browser screenshot --annotate   # Annotated screenshot with numbered element labels
agent-browser screenshot --screenshot-dir ./shots  # Save to custom directory
agent-browser screenshot --screenshot-format jpeg --screenshot-quality 80
agent-browser pdf output.pdf          # Save as PDF

# Live preview / streaming
agent-browser stream enable           # Start runtime WebSocket streaming on an auto-selected port
agent-browser stream enable --port 9223  # Bind a specific localhost port
agent-browser stream status           # Inspect enabled state, port, connection, and screencasting
agent-browser stream disable          # Stop runtime streaming and remove the .stream metadata file

# Clipboard
agent-browser clipboard read                      # Read text from clipboard
agent-browser clipboard write "Hello, World!"     # Write text to clipboard
agent-browser clipboard copy                      # Copy current selection
agent-browser clipboard paste                     # Paste from clipboard

# Dialogs (alert, confirm, prompt, beforeunload)
# By default, alert and beforeunload dialogs are auto-accepted so they never block the agent.
# confirm and prompt dialogs still require explicit handling.
# Use --no-auto-dialog (or AGENT_BROWSER_NO_AUTO_DIALOG=1) to disable automatic handling.
agent-browser dialog accept              # Accept dialog
agent-browser dialog accept "my input"   # Accept prompt dialog with text
agent-browser dialog dismiss             # Dismiss/cancel dialog
agent-browser dialog status              # Check if a dialog is currently open

# Diff (compare page states)
agent-browser diff snapshot                          # Compare current vs last snapshot
agent-browser diff snapshot --baseline before.txt    # Compare current vs saved file
agent-browser diff screenshot --baseline before.png  # Visual pixel diff
agent-browser diff url <url1> <url2>                 # Compare two pages
agent-browser diff url <url1> <url2> --wait-until networkidle  # Custom wait strategy
agent-browser diff url <url1> <url2> --selector "#main"  # Scope to element

# Chat (AI natural language control)
agent-browser chat "open google.com and search for cats"  # Single-shot instruction
agent-browser chat                                        # Interactive REPL mode
agent-browser -q chat "summarize this page"               # Quiet (text only, no tool calls)
agent-browser -v chat "fill in the login form"            # Verbose (show command output)
agent-browser --model openai/gpt-4o chat "take a screenshot"  # Override model
```

## Streaming

Every session automatically starts a WebSocket stream server on an OS-assigned port. Use `agent-browser stream status` to see the bound port and connection state. Use `stream disable` to tear it down, and `stream enable --port <port>` to re-enable on a specific port.

## Common Patterns

### Site keybind conflicts (mitigation, not guarantee)

`agent-browser scroll <direction> <px>` sends OS keyboard events (PageDown / arrow keys). Sites that bind single-letter shortcuts to navigation — GitHub (the `gd` shortcut goes to the Dashboard, `gh` to Home, `gn` to Notifications), Gmail (`j` / `k` → next/prev message), Linear, Discord — interpret those events as their own shortcuts and silently navigate away mid-action. The CLI cannot tell whether the page navigated; only `get url` or `tab list` reveals the drift.

**No alternative is 100% safe** on these sites. Recommendations in priority order:

1. **Avoid scrolling**. For content capture (summarization, README inspection, repository overview), use `pdf` to write the entire scrollable document to a single file. No scroll, no keybind collision, one artifact.
2. **`scrollintoview @ref`** (alias `scrollinto`). Targets a snapshot ref; appears to be pure-JS but the internals are not documented in the CLI reference. Treat URL drift the same as `eval scrollTo` if observed.
3. **`eval window.scrollTo(x, y)`**. Pure JS, no synthetic keyboard events — but the recording session at `~/.claude/projects/-Users-wadackel-dotfiles/70a2d283-...jsonl` (line 296) observed dashboard navigation after `eval scrollTo` followed by a long `wait`. Root cause unknown. **Verify URL with `get url` immediately after.**

#### Sandwich verification with batch

`agent-browser batch` is sequential-only — it cannot branch on intermediate output (see L144 below). Place `get url` and `tab list` inside the batch as **recordings**, then read the batch's combined stdout afterward to decide whether the URL drifted:

```bash
SESSION="claude-$PPID"

# Sandwich the action between URL/tab probes inside one batch
agent-browser --session "$SESSION" batch \
  "tab new https://github.com/owner/repo" \
  "wait 3000" \
  "get url" \
  "tab list" \
  "scrollintoview @e1" \
  "wait 500" \
  "get url" \
  "tab list"

# Read the stdout above. If the post-action 'get url' is not the expected URL,
# the page navigated mid-batch — stop and investigate before issuing the next batch.
```

`get url` reports the active tab's URL; `tab list` reports every tab's URL with stable ids. Use both — `get url` catches navigation in the active tab, `tab list` catches cases where a new tab took focus.

### Content capture: prefer pdf over scroll+screenshot

For "summarize the page" / "what's in this README" / "give me the repo overview" tasks, generate a PDF of the entire scrollable area. PDF capture:

- captures the full document, not just the viewport
- avoids site-keybind collisions (no scroll required)
- produces a single artifact you can re-read or attach

Single-call form: `agent-browser --session "claude-$PPID" pdf /tmp/page.pdf` writes the current tab's full document to a PDF.

Recommended sandwich (open + verify URL + capture in one batch):

```bash
SESSION="claude-$PPID"

agent-browser --session "$SESSION" batch \
  "tab new https://github.com/owner/repo" \
  "wait 3000" \
  "get url" \
  "pdf /tmp/repo-contents.pdf"
```

Use `screenshot` only when you specifically need viewport-fit framing or want to capture a particular visual UI state (modal open, hover effect, error overlay). For content-summarization tasks, `pdf` is strictly more reliable.

### Form Submission

```bash
# Navigate and get the form structure
agent-browser batch "open https://example.com/signup" "snapshot -i"
# Read the snapshot output to identify form refs, then fill and submit
agent-browser batch "fill @e1 \"Jane Doe\"" "fill @e2 \"jane@example.com\"" "select @e3 \"California\"" "check @e4" "click @e5" "wait 2000"
```

### Authentication with Auth Vault (Recommended)

```bash
# Save credentials once (stored under ~/.agent-browser/ with mode 600)
# Recommended: pipe password via stdin to avoid shell history exposure
echo "pass" | agent-browser auth save github --url https://github.com/login --username user --password-stdin

# Login using saved profile (LLM never sees password)
agent-browser auth login github

# List/show/delete profiles
agent-browser auth list
agent-browser auth show github
agent-browser auth delete github
```

`auth login` waits for username/password/submit selectors before interacting, with a timeout tied to the default action timeout.

### Authentication with State Persistence

```bash
# Login once and save state
agent-browser batch "open https://app.example.com/login" "snapshot -i"
# Read snapshot to find form refs, then fill and submit
agent-browser batch "fill @e1 \"$USERNAME\"" "fill @e2 \"$PASSWORD\"" "click @e3" "wait --url **/dashboard" "state save auth.json"

# Reuse in future sessions
agent-browser batch "state load auth.json" "open https://app.example.com/dashboard"
```

### Session Persistence

```bash
# Auto-save/restore cookies and localStorage across browser restarts
agent-browser --session-name myapp open https://app.example.com/login
# ... login flow ...
agent-browser close  # State auto-saved to ~/.agent-browser/sessions/

# Next time, state is auto-loaded
agent-browser --session-name myapp open https://app.example.com/dashboard

# Manage saved states
agent-browser state list
agent-browser state show myapp-default.json
agent-browser state clear myapp
agent-browser state clean --older-than 7
```

### Working with Iframes

Iframe content is automatically inlined in snapshots. Refs inside iframes carry frame context, so you can interact with them directly.

```bash
agent-browser batch "open https://example.com/checkout" "snapshot -i"
# @e1 [heading] "Checkout"
# @e2 [Iframe] "payment-frame"
#   @e3 [input] "Card number"
#   @e4 [input] "Expiry"
#   @e5 [button] "Pay"

# Interact directly — no frame switch needed
agent-browser batch "fill @e3 \"4111111111111111\"" "fill @e4 \"12/28\"" "click @e5"

# To scope a snapshot to one iframe:
agent-browser batch "frame @e2" "snapshot -i"
agent-browser frame main          # Return to main frame
```

### Data Extraction

```bash
agent-browser batch "open https://example.com/products" "snapshot -i"
# Read snapshot to find element refs, then extract
agent-browser get text @e5           # Get specific element text
agent-browser get text body > page.txt  # Get all page text

# JSON output for parsing
agent-browser snapshot -i --json
agent-browser get text @e1 --json
```

### Dynamic Data Derivation

Never hardcode expected values or input data for verification. Derive them from runtime state.

- If identifiable from conversation context, use that
- Otherwise, extract programmatically from DOM elements, API responses, or app state
- As a last resort, ask the user via `AskUserQuestion`

### SPA Runtime Data Extraction

Use this decision tree to choose the most reliable extraction method:

```
Need runtime info from a SPA?
  |
  +-- Can DOM inspection answer it? (img[alt], [aria-label], text content)
  |     YES --> Use agent-browser snapshot -i or get text @ref (fastest, most reliable)
  |
  +-- Is data in globals/storage? (window.__NEXT_DATA__, localStorage, cookies)
  |     YES --> Use agent-browser eval to read it
  |
  +-- Need API response data?
  |     YES --> Use agent-browser network requests (requires page reload, see constraints below)
  |
  +-- None of the above work?
        --> Explore React fiber / state store via eval (fragile, last resort only)
```

### `network requests` Constraints

- Tracking starts on the **first call** -- requests before that are not captured
- To capture page-load requests, follow this sequence:
  1. `agent-browser network requests --clear` -- start tracking
  2. Reload or navigate the page
  3. `agent-browser wait 2000`
  4. `agent-browser network requests` -- read results
- If the page is already loaded, prefer DOM inspection over network capture

### MutationObserver Logging in SPAs

When collecting DOM change logs across SPA navigation:

- Store logs on `window.__` prefixed variables (e.g., `window.__mo`, `window.__labelLog`), not `sessionStorage`
- Next.js and similar SPAs preserve `window` variables across client-side navigation
- Use `__` prefix to avoid variable name collisions

```bash
agent-browser eval --stdin <<'EVALEOF'
window.__mo = [];
new MutationObserver(mutations => {
  mutations.forEach(m => window.__mo.push({type: m.type, target: m.target.tagName}));
}).observe(document.body, {childList: true, subtree: true});
EVALEOF
```

### Parallel Sessions

```bash
agent-browser --session site1 open https://site-a.com
agent-browser --session site2 open https://site-b.com

agent-browser --session site1 snapshot -i
agent-browser --session site2 snapshot -i

agent-browser session list
```

### Connect to Existing Chrome (escape hatch)

`--auto-connect` is reserved for cases where state-import is insufficient (real-time observation of the user's live browser, IndexedDB-bound sites, the `state save` operation itself):

```bash
# Auto-discover running Chrome with remote debugging enabled
agent-browser --auto-connect open https://example.com
agent-browser --auto-connect snapshot

# Or with explicit CDP port
agent-browser --cdp 9222 snapshot
```

Auto-connect discovers Chrome via `DevToolsActivePort`, common debugging ports (9222, 9229), and falls back to a direct WebSocket connection if HTTP-based CDP discovery fails. Using this attaches to the user's window — coordinate to avoid collisions.

### Color Scheme (Dark Mode)

```bash
# Persistent dark mode via flag (applies to all pages and new tabs)
agent-browser --color-scheme dark open https://example.com

# Or via environment variable
AGENT_BROWSER_COLOR_SCHEME=dark agent-browser open https://example.com

# Or set during session (persists for subsequent commands)
agent-browser set media dark
```

### Viewport & Responsive Testing

```bash
# Set a custom viewport size (default is 1280x720)
agent-browser set viewport 1920 1080
agent-browser screenshot desktop.png

# Test mobile-width layout
agent-browser set viewport 375 812
agent-browser screenshot mobile.png

# Retina/HiDPI: same CSS layout at 2x pixel density
# Screenshots stay at logical viewport size, but content renders at higher DPI
agent-browser set viewport 1920 1080 2
agent-browser screenshot retina.png

# Device emulation (sets viewport + user agent in one step)
agent-browser set device "iPhone 14"
agent-browser screenshot device.png
```

The `scale` parameter (3rd argument) sets `window.devicePixelRatio` without changing CSS layout. Use it when testing retina rendering or capturing higher-resolution screenshots.

### Visual Browser (Debugging)

```bash
agent-browser --session "claude-$PPID" --state "$HOME/.agent-browser-state/main.json" open https://example.com
agent-browser --session "claude-$PPID" highlight @e1   # Highlight element (daemon already up — --state not needed once attached)
agent-browser --session "claude-$PPID" inspect          # Open Chrome DevTools for the active page
agent-browser --session "claude-$PPID" --state "$HOME/.agent-browser-state/main.json" record start demo.webm  # If this is the call that starts the daemon, --state is required
agent-browser --session "claude-$PPID" profiler start   # Start Chrome DevTools profiling
agent-browser --session "claude-$PPID" profiler stop trace.json  # Stop and save profile (path optional)
```

Use `AGENT_BROWSER_HEADED=1` to enable headed mode via environment variable. Browser extensions work in both headed and headless mode.

### Local Files (PDFs, HTML)

```bash
# Open local files with file:// URLs
agent-browser --allow-file-access open file:///path/to/document.pdf
agent-browser --allow-file-access open file:///path/to/page.html
agent-browser screenshot output.png
```

### iOS Simulator (Mobile Safari)

```bash
# List available iOS simulators
agent-browser device list

# Launch Safari on a specific device
agent-browser -p ios --device "iPhone 16 Pro" open https://example.com

# Same workflow as desktop - snapshot, interact, re-snapshot
agent-browser -p ios snapshot -i
agent-browser -p ios tap @e1          # Tap (alias for click)
agent-browser -p ios fill @e2 "text"
agent-browser -p ios swipe up         # Mobile-specific gesture

# Take screenshot
agent-browser -p ios screenshot mobile.png

# Close session (shuts down simulator)
agent-browser -p ios close
```

**Requirements:** macOS with Xcode, Appium (`npm install -g appium && appium driver install xcuitest`)

**Real devices:** Works with physical iOS devices if pre-configured. Use `--device "<UDID>"` where UDID is from `xcrun xctrace list devices`.

## Security

All security features are opt-in. By default, agent-browser imposes no restrictions on navigation, actions, or output.

### Content Boundaries (Recommended for AI Agents)

Enable `--content-boundaries` to wrap page-sourced output in markers that help LLMs distinguish tool output from untrusted page content:

```bash
export AGENT_BROWSER_CONTENT_BOUNDARIES=1
agent-browser snapshot
# Output:
# --- AGENT_BROWSER_PAGE_CONTENT nonce=<hex> origin=https://example.com ---
# [accessibility tree]
# --- END_AGENT_BROWSER_PAGE_CONTENT nonce=<hex> ---
```

### Domain Allowlist

Restrict navigation to trusted domains. Wildcards like `*.example.com` also match the bare domain `example.com`. Sub-resource requests, WebSocket, and EventSource connections to non-allowed domains are also blocked. Include CDN domains your target pages depend on:

```bash
export AGENT_BROWSER_ALLOWED_DOMAINS="example.com,*.example.com"
agent-browser open https://example.com        # OK
agent-browser open https://malicious.com       # Blocked
```

### Action Policy

Use a policy file to gate destructive actions:

```bash
export AGENT_BROWSER_ACTION_POLICY=./policy.json
```

Example `policy.json`:

```json
{ "default": "deny", "allow": ["navigate", "snapshot", "click", "scroll", "wait", "get"] }
```

Auth vault operations (`auth login`, etc.) bypass action policy but domain allowlist still applies.

### Output Limits

Prevent context flooding from large pages:

```bash
export AGENT_BROWSER_MAX_OUTPUT=50000
```

## Diffing (Verifying Changes)

Use `diff snapshot` after performing an action to verify it had the intended effect. This compares the current accessibility tree against the last snapshot taken in the session.

```bash
# Typical workflow: snapshot -> action -> diff
agent-browser snapshot -i          # Take baseline snapshot
agent-browser click @e2            # Perform action
agent-browser diff snapshot        # See what changed (auto-compares to last snapshot)
```

For visual regression testing or monitoring:

```bash
# Save a baseline screenshot, then compare later
agent-browser screenshot baseline.png
# ... time passes or changes are made ...
agent-browser diff screenshot --baseline baseline.png

# Compare staging vs production
agent-browser diff url https://staging.example.com https://prod.example.com --screenshot
```

`diff snapshot` output uses `+` for additions and `-` for removals, similar to git diff. `diff screenshot` produces a diff image with changed pixels highlighted in red, plus a mismatch percentage.

## Timeouts and Slow Pages

The default timeout is 25 seconds. This can be overridden with the `AGENT_BROWSER_DEFAULT_TIMEOUT` environment variable (value in milliseconds).

**Important:** `open` already waits for the page `load` event before returning. In most cases, no additional wait is needed before taking a snapshot or screenshot. Only add an explicit wait when content loads asynchronously after the initial page load.

```bash
# Wait for a specific element to appear (preferred for dynamic content)
agent-browser wait "#content"
agent-browser wait @e1

# Wait a fixed duration (good default for slow SPAs)
agent-browser wait 2000

# Wait for a specific URL pattern (useful after redirects)
agent-browser wait --url "**/dashboard"

# Wait for text to appear on the page
agent-browser wait --text "Results loaded"

# Wait for a JavaScript condition
agent-browser wait --fn "document.querySelectorAll('.item').length > 0"
```

**Avoid `wait --load networkidle`** unless you are certain the site has no persistent network activity. Ad-heavy sites, sites with analytics/tracking, and sites with websockets will cause `networkidle` to hang indefinitely. Prefer `wait 2000` or `wait <selector>` instead.

**Exception for controlled SPAs:** For known single-page applications without ads or persistent network activity (e.g., internal corporate apps), `wait --load networkidle` remains the most reliable approach for ensuring async data loads complete fully.

To auto-shutdown the daemon after a period of inactivity (useful for ephemeral/CI environments):

```bash
AGENT_BROWSER_IDLE_TIMEOUT_MS=60000 agent-browser open example.com
```

## Handling Native Dialogs

When a page opens a JavaScript dialog (`alert()`, `confirm()`, or `prompt()`), it blocks all other browser commands (snapshot, screenshot, click, etc.) until the dialog is dismissed. By default, `alert` and `beforeunload` dialogs are auto-dismissed, but `confirm` and `prompt` require explicit handling. Use `--no-auto-dialog` (or `AGENT_BROWSER_NO_AUTO_DIALOG=1`) to disable automatic handling.

When a dialog is pending, all command responses include a `warning` field indicating the dialog type and message. In `--json` mode this appears as a `"warning"` key in the response object.

### Reactive: Dismiss a dialog that already appeared

```bash
agent-browser dialog status              # Check if a dialog is blocking
agent-browser dialog accept              # OK/Accept
agent-browser dialog dismiss             # Cancel/Dismiss
agent-browser dialog accept "input text" # Accept prompt with text
```

If agent-browser hangs after a click (commands time out), a native dialog is likely blocking. Run `dialog accept` or `dialog dismiss` to unblock.

### Proactive: Prevent dialogs from blocking (recommended for QA/testing)

Before interacting with pages that may trigger `alert()` or `confirm()`, override them via eval to capture messages without blocking:

```bash
agent-browser eval --stdin <<'EVALEOF'
window.__dialogMessages = [];
window.alert = function(msg) { window.__dialogMessages.push({type:'alert',msg}); };
window.confirm = function(msg) { window.__dialogMessages.push({type:'confirm',msg}); return true; };
EVALEOF
```

After interactions, read captured messages:

```bash
agent-browser eval 'JSON.stringify(window.__dialogMessages)'
```

**Important**: Do NOT call the original `alert`/`confirm` from interceptors (e.g., `origAlert.call(window, msg)`). This re-triggers the native dialog and blocks again.

### Inspecting API error responses

`agent-browser network requests` captures request info but not response bodies. To diagnose API errors (e.g., 4xx/5xx responses), install a fetch interceptor:

```bash
agent-browser eval --stdin <<'EVALEOF'
window.__fetchLog = [];
const origFetch = window.fetch;
window.fetch = async function(...args) {
  const res = await origFetch.apply(this, args);
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
  if (url.includes('target-api-path')) {
    const clone = res.clone();
    const body = await clone.text();
    window.__fetchLog.push({ url, status: res.status, body: body.substring(0, 500) });
  }
  return res;
};
EVALEOF
```

Then read results with `agent-browser eval 'JSON.stringify(window.__fetchLog)'`.

## Session Management and Cleanup

When running multiple agents or automations concurrently, always use named sessions to avoid conflicts:

```bash
# Each agent gets its own isolated session
agent-browser --session agent1 open site-a.com
agent-browser --session agent2 open site-b.com

# Check active sessions
agent-browser session list
```

Always close your browser session when done to avoid leaked processes:

```bash
agent-browser close                    # Close default session
agent-browser --session agent1 close   # Close specific session
agent-browser close --all              # Close all active sessions
```

If a previous session was not closed properly, the daemon may still be running. Use `agent-browser close` to clean it up, or `agent-browser close --all` to shut down every session at once.

To auto-shutdown the daemon after a period of inactivity (useful for ephemeral/CI environments):

```bash
AGENT_BROWSER_IDLE_TIMEOUT_MS=60000 agent-browser open example.com
```

## Ref Lifecycle (Important)

Refs (`@e1`, `@e2`, etc.) are invalidated when the page changes. Always re-snapshot after:

- Clicking links or buttons that navigate
- Form submissions
- Dynamic content loading (dropdowns, modals)

```bash
agent-browser click @e5              # Navigates to new page
agent-browser snapshot -i            # MUST re-snapshot
agent-browser click @e1              # Use new refs
```

## Reconnaissance-Then-Action

Before performing any interaction (click, input, etc.):
1. Take a snapshot (`agent-browser snapshot -i`) to observe current state
2. Identify target refs from the snapshot output
3. Execute the action with discovered refs

Do not guess selectors from source code alone -- always verify against rendered state.
After `open`, wait for content (`agent-browser wait 2000` or `agent-browser wait <selector>`) before inspecting -- SPA client-side transitions may not be complete immediately.

## Plan Mode Verification

When investigating browser UI or rendering issues in plan mode:

- Perform actual measurement via agent-browser, not theoretical reasoning
- Capture DOM element sizes, CSS applied state, layout calculations before forming a plan
- Compare against Figma designs or reference pages for visual accuracy

## Annotated Screenshots (Vision Mode)

Use `--annotate` to take a screenshot with numbered labels overlaid on interactive elements. Each label `[N]` maps to ref `@eN`. This also caches refs, so you can interact with elements immediately without a separate snapshot.

In native mode, this currently works on the CDP-backed browser path (Chromium/Lightpanda). The Safari/WebDriver backend does not yet support `--annotate`.

```bash
agent-browser screenshot --annotate
# Output includes the image path and a legend:
#   [1] @e1 button "Submit"
#   [2] @e2 link "Home"
#   [3] @e3 textbox "Email"
agent-browser click @e2              # Click using ref from annotated screenshot
```

Use annotated screenshots when:

- The page has unlabeled icon buttons or visual-only elements
- You need to verify visual layout or styling
- Canvas or chart elements are present (invisible to text snapshots)
- You need spatial reasoning about element positions

## Semantic Locators (Alternative to Refs)

When refs are unavailable or unreliable, use semantic locators:

```bash
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find role button click --name "Submit"
agent-browser find placeholder "Search" type "query"
agent-browser find testid "submit-btn" click
```

## JavaScript Evaluation (eval)

Use `eval` to run JavaScript in the browser context. **Shell quoting can corrupt complex expressions** -- use `--stdin` or `-b` to avoid issues.

```bash
# Simple expressions work with regular quoting
agent-browser eval 'document.title'
agent-browser eval 'document.querySelectorAll("img").length'

# Complex JS: use --stdin with heredoc (RECOMMENDED)
agent-browser eval --stdin <<'EVALEOF'
JSON.stringify(
  Array.from(document.querySelectorAll("img"))
    .filter(i => !i.alt)
    .map(i => ({ src: i.src.split("/").pop(), width: i.width }))
)
EVALEOF

# Alternative: base64 encoding (avoids all shell escaping issues)
agent-browser eval -b "$(echo -n 'Array.from(document.querySelectorAll("a")).map(a => a.href)' | base64)"
```

**Why this matters:** When the shell processes your command, inner double quotes, `!` characters (history expansion), backticks, and `$()` can all corrupt the JavaScript before it reaches agent-browser. The `--stdin` and `-b` flags bypass shell interpretation entirely.

**Rules of thumb:**

- Single-line, no nested quotes -> regular `eval 'expression'` with single quotes is fine
- Nested quotes, arrow functions, template literals, or multiline -> use `eval --stdin <<'EVALEOF'`
- Programmatic/generated scripts -> use `eval -b` with base64

## Configuration File

Create `agent-browser.json` in the project root for persistent settings. Set `$schema` so editors like VS Code provide autocomplete and validation against the upstream schema:

```json
{
  "$schema": "https://agent-browser.dev/schema.json",
  "headed": true,
  "proxy": "http://localhost:8080",
  "profile": "./browser-data"
}
```

Priority (lowest to highest): `~/.agent-browser/config.json` < `./agent-browser.json` < env vars < CLI flags. Use `--config <path>` or `AGENT_BROWSER_CONFIG` env var for a custom config file (exits with error if missing/invalid). All CLI options map to camelCase keys (e.g., `--executable-path` -> `"executablePath"`). Boolean flags accept `true`/`false` values (e.g., `--headed false` overrides config). Extensions from user and project configs are merged, not replaced.

## Diagnosing Install Issues

Run `agent-browser doctor` first whenever a command fails unexpectedly (`Unknown command`, `Failed to connect`, version mismatches after `agent-browser upgrade`, missing Chrome, stale daemon sockets, etc.). It runs a one-shot diagnosis across env, Chrome, daemons, config, providers, network, and a headless launch test.

```bash
agent-browser doctor                     # full diagnosis
agent-browser doctor --offline --quick   # local-only fast check
agent-browser doctor --fix               # also run destructive repairs (reinstall Chrome, purge old state, ...)
agent-browser doctor --json              # structured output for programmatic consumption
```

Stale socket / pid / version sidecar files are auto-cleaned on every run. Destructive actions require `--fix`. Exit code is `0` if all checks pass (warnings OK), `1` otherwise.

## Anti-patterns

- Do not hardcode user names, IDs, or expected values -- derive from DOM/API
- Do not assume page-load requests are available without initializing `network requests` first
- Do not use `sessionStorage.setItem` for MutationObserver logs -- use `window.__` variables
- Do not rely solely on "it renders" for visual verification -- compare against reference designs
- Do not guess refs -- always snapshot first and use the returned `@eN` references
- Do not call original `alert`/`confirm` from eval interceptors -- it re-triggers the native dialog and blocks agent-browser
- Do not use `wait --load networkidle` on ad-heavy or analytics-heavy sites -- it will hang indefinitely; use `wait 2000` or `wait <selector>` instead
- Do not use `scroll` on sites with single-key keyboard shortcuts (GitHub, Gmail, Linear, Discord) -- it sends keyboard events that collide with site handlers and silently navigate away; use `pdf` for content capture, or `scrollintoview @ref` / `eval window.scrollTo()` followed by `get url` verification
- Do not skip URL/tab verification between actions during recording -- `get url` or `tab list` inside the same `batch` is the only way to detect silent navigation before the video is reviewed; the recording itself succeeds even when the page drifts
- Do not assume `eval window.scrollTo()` is keybind-safe -- a long `wait` after `eval scrollTo` was observed to land on the dashboard in one session; verify URL with `get url` immediately after every scroll-like action
- Do not retry the same failing strategy more than twice -- when scroll+screenshot misfires, switch strategy (use `pdf` for content capture, `scrollintoview @ref` instead of `scroll`, or capture the initial viewport only) instead of repeating the same approach

## Deep-Dive Documentation

| Reference                                                            | When to Use                                               |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| [references/commands.md](references/commands.md)                     | Full command reference with all options                   |
| [references/snapshot-refs.md](references/snapshot-refs.md)           | Ref lifecycle, invalidation rules, troubleshooting        |
| [references/session-management.md](references/session-management.md) | Parallel sessions, state persistence, concurrent scraping |
| [references/authentication.md](references/authentication.md)         | Login flows, OAuth, 2FA handling, state reuse             |
| [references/video-recording.md](references/video-recording.md)       | Recording workflows for debugging and documentation       |
| [references/profiling.md](references/profiling.md)                   | Chrome DevTools profiling for performance analysis        |
| [references/proxy-support.md](references/proxy-support.md)           | Proxy configuration, geo-testing, rotating proxies        |

## Cloud Providers

Use `-p <provider>` (or `AGENT_BROWSER_PROVIDER`) to run against a cloud browser instead of launching a local Chrome instance. Supported providers: `agentcore`, `browserbase`, `browserless`, `browseruse`, `kernel`.

### AgentCore (AWS Bedrock)

```bash
# Credentials auto-resolved from env vars or AWS CLI (SSO, IAM roles, etc.)
agent-browser -p agentcore open https://example.com

# With persistent browser profile
AGENTCORE_PROFILE_ID=my-profile agent-browser -p agentcore open https://example.com

# With explicit region
AGENTCORE_REGION=eu-west-1 agent-browser -p agentcore open https://example.com
```

Set `AWS_PROFILE` to select a named AWS profile.

## Experimental: Native Mode

agent-browser has an experimental native Rust daemon that communicates with Chrome directly via CDP, bypassing Node.js and Playwright entirely. It is opt-in and not recommended for production use yet.

```bash
# Enable via flag
agent-browser --native open example.com

# Enable via environment variable (avoids passing --native every time)
export AGENT_BROWSER_NATIVE=1
agent-browser open example.com
```

The native daemon supports Chromium and Safari (via WebDriver). Firefox and WebKit are not yet supported. All core commands (navigate, snapshot, click, fill, screenshot, cookies, storage, tabs, eval, etc.) work identically in native mode. Use `agent-browser close` before switching between native and default mode within the same session.

## Browser Engine Selection

Use `--engine` to choose a local browser engine. The default is `chrome`.

```bash
# Use Lightpanda (fast headless browser, requires separate install)
agent-browser --engine lightpanda open example.com

# Via environment variable
export AGENT_BROWSER_ENGINE=lightpanda
agent-browser open example.com

# With custom binary path
agent-browser --engine lightpanda --executable-path /path/to/lightpanda open example.com
```

Supported engines:
- `chrome` (default) -- Chrome/Chromium via CDP
- `lightpanda` -- Lightpanda headless browser via CDP (10x faster, 10x less memory than Chrome)

Lightpanda does not support `--extension`, `--profile`, `--state`, or `--allow-file-access`. Install Lightpanda from https://lightpanda.io/docs/open-source/installation.

## Observability Dashboard

The dashboard is a standalone background server that shows live browser viewports, command activity, and console output for all sessions.

```bash
# Install the dashboard once
agent-browser dashboard install

# Start the dashboard server (background, port 4848)
agent-browser dashboard start

# All sessions are automatically visible in the dashboard
agent-browser open example.com

# Stop the dashboard
agent-browser dashboard stop
```

The dashboard runs independently of browser sessions on port 4848 (configurable with `--port`). All sessions automatically stream to the dashboard. Sessions can also be created from the dashboard UI with local engines or cloud providers.

### Dashboard AI Chat

The dashboard has an optional AI chat tab powered by the Vercel AI Gateway. Enable it by setting:

```bash
export AI_GATEWAY_API_KEY=gw_your_key_here
export AI_GATEWAY_MODEL=anthropic/claude-sonnet-4.6           # optional default
export AI_GATEWAY_URL=https://ai-gateway.vercel.sh           # optional default
```

The Chat tab is always visible in the dashboard. Set `AI_GATEWAY_API_KEY` to enable AI responses.

## Ready-to-Use Templates

| Template                                                                 | Description                         |
| ------------------------------------------------------------------------ | ----------------------------------- |
| [templates/form-automation.sh](templates/form-automation.sh)             | Form filling with validation        |
| [templates/authenticated-session.sh](templates/authenticated-session.sh) | Login once, reuse state             |
| [templates/capture-workflow.sh](templates/capture-workflow.sh)           | Content extraction with screenshots |

```bash
./templates/form-automation.sh https://example.com/form
./templates/authenticated-session.sh https://app.example.com/login
./templates/capture-workflow.sh https://example.com ./output
```
