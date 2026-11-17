---
name: agent-browser
description: Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include requests to "open a website", "fill out a form", "click a button", "take a screenshot", "scrape data from a page", "test this web app", "login to a site", "automate browser actions", "ブラウザで確認", "Chromeで開いて", "スクリーンショット", verifying UI, or any task requiring programmatic web interaction. Also use in plan mode when planning browser-based verification to apply correct data extraction strategies and avoid common anti-patterns.
allowed-tools: Bash(npx agent-browser:*), Bash(agent-browser:*)
---

# Browser Automation with agent-browser

Fast native Rust CLI for browser automation. Managed by `mise` (`npm:agent-browser = "latest"`). This SKILL keeps only what is specific to this dotfiles environment; all workflow / command / troubleshooting content is served by the CLI itself.

## Load first before any command

The upstream skill content ships with the CLI and always matches the installed version. **Before running any `agent-browser` command in a fresh task, load the core skill:**

```bash
agent-browser skills get core             # overview, common patterns, troubleshooting
agent-browser skills get core --full      # include full command reference and templates
agent-browser skills list                 # discover other skills (electron, slack, dogfood, ...)
```

The rest of this file describes only the environment-specific defaults you must apply on top of the core skill.

## Session and sign-in state

This environment runs agent-browser headless and loads the sign-ins the user imported with `abr`.

- **The session name comes from the environment.** In Claude Code a SessionStart hook sets `AGENT_BROWSER_SESSION=claude-<pid of this Claude process>` for every Bash call, script, and subagent, so commands carry no `--session`. When it is empty there (a session started without that hook, such as `vclaude`), pass `--session "claude-$CLAUDE_PID"` on every command instead of falling into the shared `default` session. In Codex, pass `--session "${AGENT_BROWSER_SESSION:-codex-$CODEX_THREAD_ID}"` on every command: a Codex started from Claude Code inherits the variable and shares that browser. Do not build a name from `$PPID`: inside a script it is the script's shell, so each script would start a browser of its own.
- **A separate browser** (its own cookies, a parallel charter) takes that name plus `-<label>`: `--session "${AGENT_BROWSER_SESSION:-claude-$CLAUDE_PID}-<label>"` in Claude Code, `--session "${AGENT_BROWSER_SESSION:-codex-$CODEX_THREAD_ID}-<label>"` in Codex. Claude Code closes a derived name together with the session; any other name lingers until the idle timeout.
- **Pass `--state "$HOME/.agent-browser-state/main.json"` only on the command that starts the browser**, when `agent-browser session list` does not show the session yet. On a running browser `--state` relaunches it and discards every open page, so a subagent that shares the lead's browser never passes it. Do not export `AGENT_BROWSER_STATE` either: it is read on every command and relaunches the browser each time.
- **A sign-in page after a pause** means the browser shut down while idle and the next command started a fresh one without the state: pass `--state` once more.

```bash
agent-browser --state "$HOME/.agent-browser-state/main.json" tab new <url>   # starts the browser
agent-browser snapshot -i
agent-browser click @e1
agent-browser screenshot <path>
```

The browser is independent and headless; the user's live Chrome window is never touched. `--auto-connect` is **not** used in normal commands.

## Initial setup (one-time per Claude session)

Before the first agent-browser call, the state file must exist. The user populates it by running the host's `abr` command (`home/programs/agents/scripts/abr.ts`, published at `~/.agents/scripts/` and wrapped by a zsh function in `home/programs/zsh/init.zsh`), which talks CDP to their running Chrome and saves cookies + localStorage + sessionStorage to `~/.agent-browser-state/main.json` (mode 600).

If `agent-browser --state "$HOME/.agent-browser-state/main.json" <cmd>` fails with `No such file or directory: .../main.json`, the state file has not been created yet. **Stop and tell the user**: `Run \`abr\` to import auth state from your Chrome.`

Each run captures storage only for the origins it is asked about: `abr URL1 URL2 ...` for specific origins, `abr -i` to pick from the open tabs, or no arguments for Chrome's active tab. Cookies are narrowed to those origins by default; `--all-cookies` is the escape hatch when an SSO flow needs a third-party domain. See [references/authentication.md](references/authentication.md) for the full architecture, edge cases, and troubleshooting.

## Sharing one browser across main + subagents

The main agent and its subagents see the same `AGENT_BROWSER_SESSION`, so they drive the same authenticated browser. Close a browser only if you started it: a `close` from a subagent tears it down for the lead too. Parallel subagents in one browser also take the active tab from each other; give each its own derived session instead.

## Tab-Safe Navigation

`agent-browser open <url>` navigates the daemon's active tab. To keep multiple URLs in the same session without overwriting, always open a new tab:

```bash
agent-browser tab new <url>
agent-browser tab new <url> --label work   # name the tab for stable later reference
```

Tabs use stable string ids (`t1`, `t2`, ...). Pass `--label <name>` at creation time to reference the tab by a memorable name.

## Cleanup

Close a browser you started when the work is done, since each one holds about 300 MB:

```bash
agent-browser close                            # the session's browser
agent-browser --session "<derived name>" close   # a derived one, spelled as above
agent-browser doctor --fix                     # stale sockets / pid files after a crash
```

What is left is closed without you: when a Claude Code session ends (`/clear` included), its SessionEnd hook closes `$AGENT_BROWSER_SESSION` and the sessions derived from it, and any daemon idle for 20 minutes shuts down, a `--headed` one included (`~/.agent-browser/config.json`, from `home/programs/agent-browser`).

## Escape hatch: `--auto-connect`

`--auto-connect` (CDP attach to the user's live Chrome) is retained for cases where state-import + headless cannot reproduce the target behavior:

- Real-time interaction with the user's logged-in browser (e.g. observing in-flight OAuth popups they trigger manually).
- Sites whose state lives in IndexedDB / Service Worker / Web SQL that the cookie+localStorage state file does not capture.

When using `--auto-connect`, expect to share the user's window — coordinate with them to avoid collisions. Prefer state-import for everything else.

## State-replay template

For state-replay bootstrap in the environment's session, use the local template. It passes `$HOME/.agent-browser-state/main.json` only when that session has no browser yet:

```bash
./templates/authenticated-session.sh <login-url>
```

It loads the saved state, verifies the session by checking the current URL for `login`/`signin` markers, and prompts the user to re-run `abr` when the state is expired. See [templates/authenticated-session.sh](templates/authenticated-session.sh) for the full script.

## Specialized skills

Load a specialized skill when the task falls outside plain browser web pages:

```bash
agent-browser skills get electron          # Electron desktop apps (VS Code, Slack, Discord, Figma, ...)
agent-browser skills get slack             # Slack workspace automation
agent-browser skills get dogfood           # Exploratory testing / QA / bug hunts
agent-browser skills get vercel-sandbox    # agent-browser inside Vercel Sandbox microVMs
agent-browser skills get agentcore         # AWS Bedrock AgentCore cloud browsers
```

Specialized skills do not know this environment: the session still comes from `AGENT_BROWSER_SESSION`, and their commands follow the `--state` rule above.
