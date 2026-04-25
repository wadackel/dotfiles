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
   ↑ CDP WebSocket attach (state save only — one-shot, brief)
ab-state-refresh  →  ~/.agent-browser-state/main.json (plaintext JSON, mode 600)
                                                  ↓ (--state "$HOME/.agent-browser-state/main.json" passed explicitly)
                          agent-browser open <url>  →  independent headless Chrome
                                                  + --session "claude-$PPID" isolates the daemon to this Claude session
```

### Required environment

**No env var is required.** The state file lives at the fixed path `$HOME/.agent-browser-state/main.json`, and skill commands reference it as a literal. Earlier iterations used an `AGENT_BROWSER_STATE_PATH` env var, but it did not propagate reliably from the user's zsh through Claude's shell-snapshot mechanism into Bash subshells, so the indirection was removed.

`AGENT_BROWSER_STATE` (the CLI's hardcoded auto-load env) **must not** be exported in this environment — exporting it makes the daemon navigate to `origins[0]` on the first command and reject any subsequent `--state` flag with `⚠ --state ignored: daemon already running`. Pass `--state "$HOME/.agent-browser-state/main.json"` explicitly on the call that may start the daemon (typically the first call of the session).

No encryption key is involved. The state file matches the de facto convention for developer secrets on macOS (SSH keys, AWS credentials, npm tokens, GitHub tokens) — plaintext, mode 600, in a mode-700 directory. FileVault provides at-rest disk encryption.

### Step 1: Refresh the state file

Make sure the user's Chrome is running with `--remote-debugging-port=9222` (or the `chrome://inspect/#remote-debugging` toggle is on) **and is logged into the SaaS sites you want to automate**. Then:

```bash
ab-state-refresh
```

This:

1. Creates `~/.agent-browser-state/` with mode 700.
2. Reads the CDP WebSocket URL from `~/Library/Application Support/Google/Chrome/DevToolsActivePort` and attaches via `agent-browser connect <ws-url>`. Chrome 127+ returns 404 on `/json/version` unless Origin is whitelisted, so HTTP-based discovery (used by plain `--auto-connect`) is unreliable on current Chrome — file-based discovery is the robust path.
3. Calls `agent-browser state save $HOME/.agent-browser-state/main.json`, which writes plaintext JSON.
4. Sets the file to mode 600.
5. Prints the resulting file path, size, and timestamp.

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
- `--remote-debugging-port=9222` exposes full browser control on localhost during the brief `state save` window. Only run `ab-state-refresh` on trusted machines.
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
