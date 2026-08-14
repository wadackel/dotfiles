# Authentication Patterns

Login flows, session persistence, OAuth, 2FA, and authenticated browsing.

**Related**: [session-management.md](session-management.md) for state persistence details, [SKILL.md](../SKILL.md) for quick start.

## Contents

- [Import Auth from Your Browser](#import-auth-from-your-browser)
- [Persistent Profiles](#persistent-profiles)
- [Session Persistence](#session-persistence)
- [Basic Login Flow](#basic-login-flow)
- [Saving Authentication State](#saving-authentication-state)
- [Restoring Authentication](#restoring-authentication)
- [OAuth / SSO Flows](#oauth--sso-flows)
- [Two-Factor Authentication](#two-factor-authentication)
- [HTTP Basic Auth](#http-basic-auth)
- [Cookie-Based Auth](#cookie-based-auth)
- [Token Refresh Handling](#token-refresh-handling)
- [Security Best Practices](#security-best-practices)

## Import Auth from Your Browser

This is the **default authentication strategy** in this environment. Cookies + localStorage are exported once from the user's running Chrome into a plaintext JSON file with mode 600, and subsequent agent-browser calls launch independent headless Chrome instances that load this state transparently. The user's live Chrome window is never touched at runtime, eliminating browser-window collisions between human activity and automation.

### Architecture

```
User's Chrome (headed)
   ↑ direct CDP: Storage.getCookies (browser session) + a throwaway background tab
ab-state-refresh  →  ~/.agent-browser-state/main.json (plaintext JSON, mode 600)
                                                  ↓ (--state "$HOME/.agent-browser-state/main.json" passed explicitly)
                          agent-browser open <url>  →  independent headless Chrome
                                                  + --session "claude-$PPID" isolates the daemon to this Claude session
```

`ab-state-refresh` speaks CDP directly (`home/programs/agents/scripts/ab-state-refresh.ts`, published at `~/.agents/scripts/`) and **never attaches to a target it did not create**. Do not "simplify" it back to `agent-browser connect`: that command attaches to every page target and calls `Page.enable` on one of them, and Chrome freezes background-tab renderers, so a frozen tab never answers and the daemon blocks forever (`Failed to read: Resource temporarily unavailable (os error 35)`). On a working day with 40+ tabs open, a third of them are typically frozen.

### Required environment

**No env var is required.** The state file lives at the fixed path `$HOME/.agent-browser-state/main.json`, and skill commands reference it as a literal. Earlier iterations used an `AGENT_BROWSER_STATE_PATH` env var, but it did not propagate reliably from the user's zsh through Claude's shell-snapshot mechanism into Bash subshells, so the indirection was removed.

`AGENT_BROWSER_STATE` (the CLI's hardcoded auto-load env) **must not** be exported in this environment — exporting it makes the daemon navigate to `origins[0]` on the first command and reject any subsequent `--state` flag with `⚠ --state ignored: daemon already running`. Pass `--state "$HOME/.agent-browser-state/main.json"` explicitly on the call that may start the daemon (typically the first call of the session).

No encryption key is involved. The state file matches the de facto convention for developer secrets on macOS (SSH keys, AWS credentials, npm tokens, GitHub tokens) — plaintext, mode 600, in a mode-700 directory. FileVault provides at-rest disk encryption.

### Step 1: Refresh the state file

Make sure the user's Chrome is running with `--remote-debugging-port=9222` (or the `chrome://inspect/#remote-debugging` toggle is on) **and is logged into the SaaS sites you want to automate**. Then:

```bash
ab-state-refresh                                    # captures the origin of Chrome's active tab
ab-state-refresh https://app.example.com/dashboard  # captures a specific origin
ab-state-refresh https://app1.example.com/ \
                 https://app2.example.com/          # captures multiple origins and merges them
ab-state-refresh -i                                 # pick origins from the open tabs with fzf
ab-state-refresh --all-cookies https://app.example.com/  # skip the cookie narrowing
```

This:

1. Creates `~/.agent-browser-state/` with mode 700.
2. Reads the CDP WebSocket URL from `~/Library/Application Support/Google/Chrome/DevToolsActivePort` (line 1 is the port, line 2 the browser path). Chrome 127+ returns 404 on `/json/version` unless Origin is whitelisted, so HTTP-based discovery is unreliable on current Chrome — file-based discovery is the robust path.
3. For each requested URL, opens a **throwaway background tab** (`Target.createTarget` with `background: true`, then `Page.navigate`), waits for the load event, settles 2000 ms so async XHR-driven auth state lands in localStorage, reads `localStorage` / `sessionStorage` via `Runtime.evaluate`, and closes the tab. Every CDP request is time-boxed, so a slow or wedged page can never hang the run.
4. Reads every cookie in one `Storage.getCookies` call on the browser session — no page is attached for this.
5. Merges with the existing `main.json` (last-wins on `[name, domain, path]` for cookies and on `origin` for origins), then writes the result through a mode-600 temp file and `rename`, so no partially-written or world-readable state ever exists.
6. Prints the resulting file path, size, and timestamp.

An empty incoming `localStorage` / `sessionStorage` never replaces a stored non-empty value. A freshly opened tab has an empty `sessionStorage` by definition, so plain last-wins would erase a previously captured one on every run.

#### Cookie narrowing

By default only cookies that would be sent to a **tracked origin** are saved. Tracked origins are every origin in the merged `origins[]` — the ones captured this run plus the ones already in `main.json`. Matching is RFC 6265 domain-match, so for `https://lightdash.example.com` a `.example.com` cookie is kept but an `api.example.com` cookie is not (pass that URL too if you need it). The number of dropped cookies is printed to stderr.

Use `--all-cookies` when a site's SSO bounces through a domain you have not tracked (`accounts.google.com`, an Okta tenant, …) and the headless replay lands on a login page. That is the recovery path for "narrowing was too aggressive".

#### What is and is not captured

`localStorage` / `sessionStorage` come from the **main frame only**. A cross-origin auth iframe's origin is not picked up automatically — pass its URL explicitly if an app keeps tokens there. `cookies[]` is collected from the full browser context, so cookie coverage is never frame-limited.

Note that port is part of the origin per [RFC 6454](https://datatracker.ietf.org/doc/html/rfc6454), so `https://host:3000` and `https://host:3001` are distinct origins and must be passed separately.

`-i` lists the currently-open Chrome tabs (internal pages like `chrome://`, `about:`, `chrome-extension://`, `devtools://`, `file://` are excluded, and tabs sharing an origin collapse to one row). TAB to multi-select, Enter to confirm, ESC to cancel. Picked origins are harvested in a fresh background tab, not by switching to the existing one — an existing tab may be frozen, and switching would disturb the user's navigation. Rows are sorted by origin; there is no active-tab-first ordering, because the browser-level CDP session cannot tell which tab is focused. Mixing `-i` with positional URL arguments exits with a usage error.

The no-argument path resolves the active tab through `osascript`, so the first run raises a macOS Automation permission prompt for the terminal. If it is denied or fails, the run warns and refreshes cookies only.

Side effects:
- Tabs opened for capture are created in the background and closed automatically, including on Ctrl-C (the run exits 130 after closing them). The user's tabs are never navigated or switched.
- If any requested origin ends up absent from the saved state — a failed navigation, a page whose storage could not be read, or an SSO redirect that landed on a different origin — `ab-state-refresh` prints a single `selected origins not saved: …` line to stderr. Whatever did load is recorded under the origin that **actually** loaded, never relabelled as the requested one. The other origins are saved normally; re-run after fixing the affected site.

### Step 2: Use agent-browser normally

Pass the state file explicitly via `--state "$HOME/.agent-browser-state/main.json"` on the first call of each Claude session, plus `--session "claude-$PPID"` to use a daemon isolated to this Claude session:

```bash
# First call: include both flags (the daemon starts here)
agent-browser --session "claude-$PPID" --state "$HOME/.agent-browser-state/main.json" open https://github.com

# Subsequent calls within the same Claude session: --state can be omitted
agent-browser --session "claude-$PPID" snapshot -i
agent-browser --session "claude-$PPID" tab new https://app.linear.app
```

The browser is independent and headless; the user's Chrome window is unaffected. See [session-management.md](session-management.md) for parallel session patterns and [SKILL.md](../SKILL.md) Default Flags for the rationale behind the two flags.

### State expiry and recovery

State files don't have a fixed lifetime — they fail when the SaaS rotates the session token (typically days to weeks). Symptoms:

- `agent-browser snapshot` returns the login page instead of the dashboard.
- `agent-browser get url` shows `/login` or `/signin` after `open <protected-url>`.
- `No such file or directory: .../main.json` — the state file was never created or was deleted; run `ab-state-refresh` first.

Recovery is always the same: re-run `ab-state-refresh` against a freshly-logged-in Chrome.

### Sites this approach does not cover

Cookie + localStorage capture is not enough for sites that bind session state to:

- **IndexedDB** (e.g., some chat clients, web SQL apps)
- **Service Workers** holding auth tokens in memory
- **Per-device device-trust signals** that re-prompt for 2FA on a "new" headless instance

For those, fall back to a **persistent profile** (next section) — the user-data-dir captures everything and survives across runs.

### Security notes

- The state file is plaintext JSON with mode 600. Same-UID processes can read it; this matches the threat model of every other dev secret on the machine (SSH keys, AWS credentials, npm/GitHub tokens). At-rest protection comes from FileVault.
- The state directory is mode 700 (`drwx------`), so other local users cannot read the file.
- Nothing is written outside `~/.agent-browser-state/`. The only intermediate file is a mode-600 temp file in that same directory, replaced by `rename` in the same run.
- Cookie narrowing keeps unrelated sites' cookies (banking, personal accounts) out of `main.json` entirely. `--all-cookies` disables that; use it only when a specific SSO flow needs it, and re-run without the flag afterwards to prune again.
- `--remote-debugging-port=9222` exposes full browser control on localhost while it is enabled. Only run `ab-state-refresh` on trusted machines.
- Application-layer encryption was deliberately removed: env-var-derived keys provide no protection against same-UID readers, who can read the env directly. The added complexity (secret-manager lookups, encrypted-file suffix juggling, biometric prompts on shell startup) was not justified by the residual threat surface FileVault already covers.

## Persistent Profiles

Use `--profile` to point agent-browser at a Chrome user data directory. This persists everything (cookies, IndexedDB, service workers, cache) across browser restarts without explicit save/load:

```bash
# First run: login once
agent-browser --profile ~/.myapp-profile open https://app.example.com/login
# ... complete login flow ...

# All subsequent runs: already authenticated
agent-browser --profile ~/.myapp-profile open https://app.example.com/dashboard
```

Use different paths for different projects or test users:

```bash
agent-browser --profile ~/.profiles/admin open https://app.example.com
agent-browser --profile ~/.profiles/viewer open https://app.example.com
```

Or set via environment variable:

```bash
export AGENT_BROWSER_PROFILE=~/.myapp-profile
agent-browser open https://app.example.com/dashboard
```

## Session Persistence

Use `--session-name` to auto-save and restore cookies + localStorage by name, without managing files:

```bash
# Auto-saves state on close, auto-restores on next launch
agent-browser --session-name twitter open https://twitter.com
# ... login flow ...
agent-browser close  # state saved to ~/.agent-browser/sessions/

# Next time: state is automatically restored
agent-browser --session-name twitter open https://twitter.com
```

## Basic Login Flow

```bash
# Navigate to login page
agent-browser open https://app.example.com/login
agent-browser wait --load networkidle

# Get form elements
agent-browser snapshot -i
# Output: @e1 [input type="email"], @e2 [input type="password"], @e3 [button] "Sign In"

# Fill credentials
agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"

# Submit
agent-browser click @e3
agent-browser wait --load networkidle

# Verify login succeeded
agent-browser get url  # Should be dashboard, not login
```

## Saving Authentication State

After logging in, save state for reuse:

```bash
# Login first (see above)
agent-browser open https://app.example.com/login
agent-browser snapshot -i
agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --url "**/dashboard"

# Save authenticated state
agent-browser state save ./auth-state.json
```

## Restoring Authentication

Skip login by loading saved state:

```bash
# Load saved auth state
agent-browser state load ./auth-state.json

# Navigate directly to protected page
agent-browser open https://app.example.com/dashboard

# Verify authenticated
agent-browser snapshot -i
```

## OAuth / SSO Flows

For OAuth redirects:

```bash
# Start OAuth flow
agent-browser open https://app.example.com/auth/google

# Handle redirects automatically
agent-browser wait --url "**/accounts.google.com**"
agent-browser snapshot -i

# Fill Google credentials
agent-browser fill @e1 "user@gmail.com"
agent-browser click @e2  # Next button
agent-browser wait 2000
agent-browser snapshot -i
agent-browser fill @e3 "password"
agent-browser click @e4  # Sign in

# Wait for redirect back
agent-browser wait --url "**/app.example.com**"
agent-browser state save ./oauth-state.json
```

## Two-Factor Authentication

Handle 2FA with manual intervention:

```bash
# Login with credentials
agent-browser open https://app.example.com/login --headed  # Show browser
agent-browser snapshot -i
agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3

# Wait for user to complete 2FA manually
echo "Complete 2FA in the browser window..."
agent-browser wait --url "**/dashboard" --timeout 120000

# Save state after 2FA
agent-browser state save ./2fa-state.json
```

## HTTP Basic Auth

For sites using HTTP Basic Authentication:

```bash
# Set credentials before navigation
agent-browser set credentials username password

# Navigate to protected resource
agent-browser open https://protected.example.com/api
```

## Cookie-Based Auth

Manually set authentication cookies:

```bash
# Set auth cookie
agent-browser cookies set session_token "abc123xyz"

# Navigate to protected page
agent-browser open https://app.example.com/dashboard
```

## Token Refresh Handling

For sessions with expiring tokens:

```bash
#!/bin/bash
# Wrapper that handles token refresh

STATE_FILE="./auth-state.json"

# Try loading existing state
if [[ -f "$STATE_FILE" ]]; then
    agent-browser state load "$STATE_FILE"
    agent-browser open https://app.example.com/dashboard

    # Check if session is still valid
    URL=$(agent-browser get url)
    if [[ "$URL" == *"/login"* ]]; then
        echo "Session expired, re-authenticating..."
        # Perform fresh login
        agent-browser snapshot -i
        agent-browser fill @e1 "$USERNAME"
        agent-browser fill @e2 "$PASSWORD"
        agent-browser click @e3
        agent-browser wait --url "**/dashboard"
        agent-browser state save "$STATE_FILE"
    fi
else
    # First-time login
    agent-browser open https://app.example.com/login
    # ... login flow ...
fi
```

## Security Best Practices

1. **Never commit state files** - They contain session tokens
   ```bash
   echo "*.auth-state.json" >> .gitignore
   ```

2. **Use environment variables for credentials**
   ```bash
   agent-browser fill @e1 "$APP_USERNAME"
   agent-browser fill @e2 "$APP_PASSWORD"
   ```

3. **Clean up after automation**
   ```bash
   agent-browser cookies clear
   rm -f ./auth-state.json
   ```

4. **Use short-lived sessions for CI/CD**
   ```bash
   # Don't persist state in CI
   agent-browser open https://app.example.com/login
   # ... login and perform actions ...
   agent-browser close  # Session ends, nothing persisted
   ```
