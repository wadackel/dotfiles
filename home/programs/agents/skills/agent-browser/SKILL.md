---
name: agent-browser
description: Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include requests to "open a website", "fill out a form", "click a button", "take a screenshot", "scrape data from a page", "test this web app", "login to a site", "automate browser actions", "ブラウザで確認", "Chromeで開いて", "スクリーンショット", verifying UI, or any task requiring programmatic web interaction. Also use in plan mode when planning browser-based verification to apply correct data extraction strategies and avoid common anti-patterns.
allowed-tools: Bash(npx agent-browser:*), Bash(agent-browser:*)
---

# Browser Automation with agent-browser

Fast native Rust CLI for browser automation. Managed by `mise` (`npm:agent-browser = "latest"`), currently 0.31.x. This SKILL keeps only what is specific to this dotfiles environment; all workflow / command / troubleshooting content is served by the CLI itself.

## Load first before any command

The upstream skill content ships with the CLI and always matches the installed version. **Before running any `agent-browser` command in a fresh task, load the core skill:**

```bash
agent-browser skills get core             # overview, common patterns, troubleshooting
agent-browser skills get core --full      # include full command reference and templates
agent-browser skills list                 # discover other skills (electron, slack, dogfood, ...)
```

The rest of this file describes only the environment-specific defaults you must apply on top of the core skill.

## Default Flags

This environment runs agent-browser in **state-import + headless** mode by default. Pass two flags on every invocation:

- `--session "claude-$PPID"` — a daemon isolated to this Claude session. `$PPID` in a Bash subshell points at the Claude main process, so all calls within one Claude session (main + any subagents) share the same daemon.
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

The browser is independent and headless; the user's live Chrome window is never touched. `--auto-connect` is **not** used in normal commands.

Do not export `AGENT_BROWSER_STATE`. If exported, the daemon may navigate to `origins[0]` on the first command and reject any subsequent `--state` flag with `⚠ --state ignored: daemon already running`. Passing `--state` on the initiating call avoids that failure mode. `AGENT_BROWSER_STATE_PATH` is intentionally not referenced either: it does not propagate reliably from the user's zsh through Claude's shell-snapshot mechanism into Bash subshells, so the literal path is used.

## Initial setup (one-time per Claude session)

Before the first agent-browser call, the state file must exist. The user populates it by running the host's `ab-state-refresh` zsh function (defined in `home/programs/zsh/init.zsh`), which connects to their running Chrome via CDP and saves cookies + localStorage to `~/.agent-browser-state/main.json` (mode 600).

If `agent-browser --session "claude-$PPID" --state "$HOME/.agent-browser-state/main.json" <cmd>` fails with `No such file or directory: .../main.json`, the state file has not been created yet. **Stop and tell the user**: `Run \`ab-state-refresh\` to import auth state from your Chrome.`

`agent-browser state save` only captures localStorage for the focused tab plus its iframes (single Page Target constraint of CDP attach). When multiple origins are needed, `ab-state-refresh URL1 URL2 ...` opens one tab per URL and merges origins; `ab-state-refresh -i` picks from open tabs interactively. See [references/authentication.md](references/authentication.md) for the full architecture, edge cases, and troubleshooting.

## Sharing one daemon across main + subagents

Within a single Claude session, the main agent and any subagents (Agent tool / Task tool) all see the same `$PPID`, so they share one `claude-$PPID` daemon. This is intended for e.g. `qa-planner` Mode C: Lead and QA Tester both interact with the same authenticated browser. **Neither side should `close` until the workflow is complete** — `close` tears down the daemon for everyone.

## Tab-Safe Navigation

`agent-browser open <url>` navigates the daemon's active tab. To keep multiple URLs in the same session without overwriting, always open a new tab:

```bash
agent-browser --session "claude-$PPID" tab new <url>
agent-browser --session "claude-$PPID" tab new <url> --label work   # name the tab for stable later reference
```

Tabs use stable string ids (`t1`, `t2`, ...). Pass `--label <name>` at creation time to reference the tab by a memorable name.

## Cleanup

Daemon idle timeout is disabled by default in this environment (`AGENT_BROWSER_IDLE_TIMEOUT_MS` unset), so each Claude session's daemon stays up until you close it:

```bash
# Normal cleanup at end of workflow
agent-browser --session "claude-$PPID" close

# Stale socket / pid sidecars from a previous crash
agent-browser doctor --fix
```

## Escape hatch: `--auto-connect`

`--auto-connect` (CDP attach to the user's live Chrome) is retained for cases where state-import + headless cannot reproduce the target behavior:

- Real-time interaction with the user's logged-in browser (e.g. observing in-flight OAuth popups they trigger manually).
- Sites whose state lives in IndexedDB / Service Worker / Web SQL that the cookie+localStorage state file does not capture.
- The `state save` operation itself (used internally by `ab-state-refresh`).

When using `--auto-connect`, expect to share the user's window — coordinate with them to avoid collisions. Prefer state-import for everything else.

## State-replay template

For state-replay bootstrap that respects the `--session "claude-$PPID"` / `$HOME/.agent-browser-state/main.json` convention, use the local template:

```bash
./templates/authenticated-session.sh <login-url>
```

It loads the saved state, verifies the session by checking the current URL for `login`/`signin` markers, and prompts the user to re-run `ab-state-refresh` when the state is expired. See [templates/authenticated-session.sh](templates/authenticated-session.sh) for the full script.

## Specialized skills

Load a specialized skill when the task falls outside plain browser web pages:

```bash
agent-browser skills get electron          # Electron desktop apps (VS Code, Slack, Discord, Figma, ...)
agent-browser skills get slack             # Slack workspace automation
agent-browser skills get dogfood           # Exploratory testing / QA / bug hunts
agent-browser skills get vercel-sandbox    # agent-browser inside Vercel Sandbox microVMs
agent-browser skills get agentcore         # AWS Bedrock AgentCore cloud browsers
```

Specialized skills do not inherit the environment defaults above automatically; apply `--session "claude-$PPID"` and the state-file flag by hand for their commands too.
