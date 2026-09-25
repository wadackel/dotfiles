# Authentication Patterns

How this environment authenticates headless agent-browser runs: auth state imported from the user's running Chrome.

**Related**: [SKILL.md](../SKILL.md) for quick start.

## Contents

- [Import Auth from Your Browser](#import-auth-from-your-browser)

Generic login, OAuth, 2FA, profile, and saved-state patterns ship with the CLI: `agent-browser skills get core --full`. Add this environment's `--session` / `--state` flags to every command taken from there.

## Import Auth from Your Browser

This is the **default authentication strategy** in this environment. Cookies + localStorage are exported once from the user's running Chrome into a plaintext JSON file with mode 600, and subsequent agent-browser calls launch independent headless Chrome instances that load this state transparently. The user's live Chrome window is never touched at runtime, eliminating browser-window collisions between human activity and automation.

### Architecture

```
User's Chrome (headed)
   ↑ direct CDP: Storage.getCookies (browser session) + a throwaway background tab
abr               →  ~/.agent-browser-state/main.json (plaintext JSON, mode 600)
                                                  ↓ (--state "$HOME/.agent-browser-state/main.json" passed explicitly)
                          agent-browser open <url>  →  independent headless Chrome
                                                  + --session "claude-$PPID" isolates the daemon to this Claude session
```

`abr` speaks CDP directly (`home/programs/agents/scripts/abr.ts`, published at `~/.agents/scripts/`) and **never attaches to a target it did not create**. Do not "simplify" it back to `agent-browser connect`: that command attaches to every page target and calls `Page.enable` on one of them, and Chrome freezes background-tab renderers, so a frozen tab never answers and the daemon blocks forever (`Failed to read: Resource temporarily unavailable (os error 35)`). On a working day with 40+ tabs open, a third of them are typically frozen.

### Required environment

**No env var is required.** The state file lives at the fixed path `$HOME/.agent-browser-state/main.json`, and skill commands reference it as a literal. An `AGENT_BROWSER_STATE_PATH` env var is not used because it does not propagate reliably from the user's zsh through Claude's shell-snapshot mechanism into Bash subshells.

`AGENT_BROWSER_STATE` (the CLI's hardcoded auto-load env) **must not** be exported in this environment — exporting it makes the daemon navigate to `origins[0]` on the first command and reject any subsequent `--state` flag with `⚠ --state ignored: daemon already running`. Pass `--state "$HOME/.agent-browser-state/main.json"` explicitly on the call that may start the daemon (typically the first call of the session).

No encryption key is involved. The state file matches the de facto convention for developer secrets on macOS (SSH keys, AWS credentials, npm tokens, GitHub tokens) — plaintext, mode 600, in a mode-700 directory. FileVault provides at-rest disk encryption.

### Step 1: Refresh the state file

Make sure the user's Chrome is running with `--remote-debugging-port=9222` (or the `chrome://inspect/#remote-debugging` toggle is on) **and is logged into the SaaS sites you want to automate**. Then:

```bash
abr                                    # captures the origin of Chrome's active tab
abr https://app.example.com/dashboard  # captures a specific origin
abr https://app1.example.com/ \
                 https://app2.example.com/          # captures multiple origins and merges them
abr -i                                 # pick origins from the open tabs with fzf
abr --all-cookies https://app.example.com/  # skip the cookie narrowing
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
- If any requested origin ends up absent from the saved state — a failed navigation, a page whose storage could not be read, or an SSO redirect that landed on a different origin — `abr` prints a single `selected origins not saved: …` line to stderr. Whatever did load is recorded under the origin that **actually** loaded, never relabelled as the requested one. The other origins are saved normally; re-run after fixing the affected site.

### Step 2: Use agent-browser normally

Pass the state file explicitly via `--state "$HOME/.agent-browser-state/main.json"` on the first call of each Claude session, plus `--session "claude-$PPID"` to use a daemon isolated to this Claude session:

```bash
# First call: include both flags (the daemon starts here)
agent-browser --session "claude-$PPID" --state "$HOME/.agent-browser-state/main.json" open https://github.com

# Subsequent calls within the same Claude session: --state can be omitted
agent-browser --session "claude-$PPID" snapshot -i
agent-browser --session "claude-$PPID" tab new https://app.linear.app
```

The browser is independent and headless; the user's Chrome window is unaffected. See [SKILL.md](../SKILL.md) Default Flags for the rationale behind the two flags.

### State expiry and recovery

State files don't have a fixed lifetime — they fail when the SaaS rotates the session token (typically days to weeks). Symptoms:

- `agent-browser snapshot` returns the login page instead of the dashboard.
- `agent-browser get url` shows `/login` or `/signin` after `open <protected-url>`.
- `No such file or directory: .../main.json` — the state file was never created or was deleted; run `abr` first.

Recovery is always the same: re-run `abr` against a freshly-logged-in Chrome.

### Sites this approach does not cover

Cookie + localStorage capture is not enough for sites that bind session state to:

- **IndexedDB** (e.g., some chat clients, web SQL apps)
- **Service Workers** holding auth tokens in memory
- **Per-device device-trust signals** that re-prompt for 2FA on a "new" headless instance

For those, fall back to a **persistent profile** (`--profile <dir>`; see `agent-browser skills get core --full`) — the user-data-dir captures everything and survives across runs.

### Security notes

- The state file is plaintext JSON with mode 600. Same-UID processes can read it; this matches the threat model of every other dev secret on the machine (SSH keys, AWS credentials, npm/GitHub tokens). At-rest protection comes from FileVault.
- The state directory is mode 700 (`drwx------`), so other local users cannot read the file.
- Nothing is written outside `~/.agent-browser-state/`. The only intermediate file is a mode-600 temp file in that same directory, replaced by `rename` in the same run.
- Cookie narrowing keeps unrelated sites' cookies (banking, personal accounts) out of `main.json` entirely. `--all-cookies` disables that; use it only when a specific SSO flow needs it, and re-run without the flag afterwards to prune again.
- `--remote-debugging-port=9222` exposes full browser control on localhost while it is enabled. Only run `abr` on trusted machines.
- Application-layer encryption was deliberately removed: env-var-derived keys provide no protection against same-UID readers, who can read the env directly. The added complexity (secret-manager lookups, encrypted-file suffix juggling, biometric prompts on shell startup) was not justified by the residual threat surface FileVault already covers.
