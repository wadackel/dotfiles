# AGENTS.md

This file provides guidance to coding agents (Claude Code, Codex) when working with code in this repository.

## Repository Overview

This is a **declarative macOS development environment** managed with Nix, nix-darwin, and home-manager. The repository uses a flake-based configuration supporting multiple machine profiles (private and work).

**For setup instructions, basic commands, and directory structure, see [README.md](README.md).**

## Working with this Repository

### Claude's Responsibilities

When working on tasks in this repository, Claude Code should:

1. **Apply configuration changes**
   - After making changes to Nix files, Claude should apply the configuration using `darwin-rebuild`
   - Apply the profile that matches this machine; a profile sets the username and hostname, so applying the other one misconfigures the machine:
     - `.#private` for the personal machine (wadackel)
     - `.#work` for the work machine (tsuyoshi.wada)
   - Check the current user/hostname with `whoami` and `hostname` if uncertain
   - Example: `sudo darwin-rebuild switch --flake .#private`
   - When editing symlinked config files (tmux.conf, zshrc, etc.) managed by home-manager, darwin-rebuild is not needed. Changes are immediately reflected since the file is symlinked, not copied. Only run darwin-rebuild when modifying Nix files themselves (*.nix).

2. **Verify changes programmatically**
   - Use `nix flake check` before applying
   - After applying, verify the configuration took effect when possible
   - Report any errors or warnings encountered during application

### Workflow Example

When asked to add a new program or modify configuration:

1. Make the necessary changes to Nix files
2. Run `nix flake check` to verify syntax
3. Determine the correct profile (check hostname/username if needed)
4. Apply with `sudo darwin-rebuild switch --flake .#<profile>`
5. Report the results to the user

## Common Development Commands

| Command | Description |
|---------|-------------|
| `nix fmt` | Format all Nix files (treefmt/nixfmt) |
| `nix flake check` | Verify syntax and formatting |
| `sudo darwin-rebuild switch --flake .#private` | Apply configuration changes |

## Architecture

### Profile System

The repository supports two machine profiles defined in `flake.nix`:

- **`private`**: Personal machine (wadackel/wadackels-Mac-mini)
- **`work`**: Work machine (tsuyoshi.wada/tsuyoshiwadas-MacBook-Pro)

Profiles are the single source of truth for username, hostname, and can enable profile-specific behavior via the `profile` parameter.

### Key Files

- **`flake.nix`**: Main orchestration - defines profiles, creates both `homeConfigurations` (standalone) and `darwinConfigurations` (system+home)
- **`darwin/configuration.nix`**: System-level settings (Nix config, Homebrew, macOS defaults, keyboard/trackpad/Dock settings)
- **`home/home.nix`**: home-manager entry point, auto-imports all program modules
- **`home/programs/default.nix`**: Auto-discovery pattern - dynamically imports all `programs/*/default.nix`

### Program Module Pattern

All program configurations follow a consistent structure:

```
home/programs/<program-name>/
  ├── default.nix       # Nix module (enables program, sources configs)
  └── <config-files>    # Co-located configuration files
```

The `programs/default.nix` auto-imports all subdirectories, enabling modular configuration. To add a new program:

1. Create `home/programs/<name>/default.nix`
2. Place config files alongside the module
3. No manual imports needed - auto-discovery handles it

### `dotfiles.linkHere` and `recursive`

`lib/dotfiles-path.nix`'s `linkHere` creates out-of-store symlinks. When combined with `home.file`'s `recursive = true`, it creates individual file links via the Nix store, requiring `darwin-rebuild` when adding new files. Linking the entire directory (without `recursive`) allows new files to be reflected automatically.

`pathHere` returns the same worktree path as a plain string, for a module that must hand a path to a program instead of linking it (the Hermes Deno scripts). It asserts at evaluation that the file exists in the flake source, so a new file has to be tracked by Git first.

### Helper Functions in flake.nix

- **`mkHome`**: Creates standalone home-manager configuration
- **`mkDarwin`**: Creates nix-darwin configuration with embedded home-manager
- **`mkHomeDir`**: Derives home directory from username (`/Users/${username}`)

Both configurations use the same overlays and extraSpecialArgs to ensure consistency.

## Configuration Scope

### What's Managed by Nix

- **System settings**: All macOS defaults (keyboard, trackpad, Finder, Dock, etc.) in `darwin/configuration.nix`
- **CLI tools**: Most development tools are in `home/programs/packages/default.nix` as Nix packages
- **Fonts**: Nerd Fonts managed via home-manager (auto-synced to `~/Library/Fonts/HomeManager/`)
- **Shell configuration**: zsh, bash, fish with starship prompt
- **Program configs**: git, neovim, tmux, fzf, and 20+ other tools

### What's Still Using Homebrew

Despite Nix, Homebrew is used for:

- **Applications (casks)**: Arc, Chrome Canary, the Claude desktop app, Tinycast, WezTerm, 1Password CLI, etc.
- **Python**: `python@3.14` with `numpy` / `pillow`
- **Formulas**: `tree-sitter-cli` (nvim-treesitter needs a newer release than nixpkgs ships), `z3`, `cask`

Homebrew configuration is in `darwin/configuration.nix` under the `homebrew` section.

## Making Changes

### Adding a New Program

1. Create directory: `mkdir -p home/programs/<program-name>`
2. Create module: `home/programs/<program-name>/default.nix`
3. Add configuration files in the same directory
4. Track new files in Git: `git add home/programs/<program-name>/` (Nix flake only recognizes tracked files)
   - **For shell scripts**: Run `chmod +x <file>` to set the filesystem execute bit before `darwin-rebuild`
   - Note: `git update-index --chmod=+x` only changes the git INDEX, not the actual filesystem
   - The Nix store inherits the execute bit from the source, so `chmod +x` on the source → `darwin-rebuild` is required
5. Apply: `sudo darwin-rebuild switch --flake .#private`

Example module structure:

```nix
{ config, pkgs, ... }:
{
  programs.<program-name> = {
    enable = true;
    # ... program-specific options
  };
}
```

### Modifying macOS System Settings

Edit `darwin/configuration.nix` under the `system.defaults.*` sections. Settings are organized by category:

- `system.defaults.NSGlobalDomain.*`: Global macOS settings
- `system.defaults.dock.*`: Dock behavior
- `system.defaults.finder.*`: Finder settings
- `system.defaults.trackpad.*`: Trackpad configuration
- `system.defaults.screencapture.*`: Screenshot settings

### Profile-Specific Configuration

Use the `profile` parameter (available in darwin modules) for conditional configuration:

```nix
system.defaults.NSGlobalDomain.AppleShowScrollBars =
  if profile == "work" then "Always" else "Automatic";
```

### Updating Dependencies

```bash
# Update all flake inputs (nixpkgs, home-manager, nix-darwin, etc.)
nix flake update

# Update specific input
nix flake lock --update-input nixpkgs

# Apply updated configuration
sudo darwin-rebuild switch --flake .#private
```

For rollback commands and generation management, see [README.md](README.md#rollback).

## Troubleshooting

### Hot-reloading tmux Configuration

The tmux config file is located at the XDG path `~/.config/tmux/tmux.conf` (`~/.tmux.conf` does not exist).
Command to hot-reload after editing: `TMUX="" tmux source-file ~/.config/tmux/tmux.conf`

`\;` inside `bind-key`'s `if-shell` arguments does not function as a command separator (`tmux list-keys` shows `\\;`, meaning it is retained as a literal character). To execute multiple commands sequentially, separate with `\;` at the top level of `bind-key`:
- ✗ `bind-key h if-shell -F cond 'cmd1 \; cmd2'` — `cmd1 \; cmd2` treated as a single command
- ✓ `bind-key h if-shell -F cond 'cmd1' \; if-shell -F cond2 'cmd2'` — separated at top level

### Applying Hermes changes

The Hermes module (`home/programs/hermes/default.nix`) runs its Deno scripts from `~/dotfiles` through `dotfiles.pathHere`, not from the Nix store, so whatever is on disk there — another branch, a stash, a rebase in progress, a half-written file — is what the next run executes. Deno does not type-check at run time, so a broken script shows up only in `~/Library/Logs/hermes-agent.err.log` or `~/Library/Logs/hermes-feed-action.log`. The cron pre-run scripts and the `gcal` / `calendar` / `agenda` MCP servers also append a `start` line, an `exit` line, and every failed Apps Script bridge call to `~/Library/Logs/hermes-scripts.log` (`scripts/trace.ts`), because Hermes discards a pre-run script's stderr unless it exits non-zero. A run with no `start` line stalled before the script's own code, while Deno was loading modules; a `start` with no `exit` was killed, crashed, or is still running. Do longer Hermes work in a `.claude/worktrees/` worktree and run `deno check` before bringing it back.

| Change | How it takes effect |
|---|---|
| A cron pre-run script or `feed-action.ts` | The next run; each run spawns a new process |
| An MCP server script (`*-mcp.ts` and what it imports) | `/reload-mcp` in the Slack DM, or restarting the gateway. The gateway connects MCP servers once and keeps them, and cron jobs reuse those connections. `/reload-mcp` asks Once / Always / Cancel; Always stores `approvals.mcp_reload_confirm: false` |
| `settings`, `mcpServers`, `hermesHomeFiles`, or anything else in the Nix module | `sudo darwin-rebuild switch --flake .#private`, then restart the gateway |
| The Apps Script bridge (`home/programs/hermes/gas/`) | From `~/.config/hermes-google/clasp`, `clasp push` then `clasp redeploy <deploymentId> -d <what changed>`; the deployment ID is the path segment of the URL in `~/.config/hermes-google/bridge.json`. The clasp project's `rootDir` is the main checkout's `gas/`, so a worktree's edits are never pushed. `clasp push` replaces the whole remote project: `clasp pull -P` into a temporary `rootDir` first and diff (the pulled script arrives as `Code.js`) |

Slack sessions get exactly two MCP servers. `agenda` (`scripts/agenda-mcp.ts`) lists events on the primary calendar and reads the To-Do of the latest daily note, and writes nothing. `calendar` is `scripts/gcal-mcp.ts --slack`: its `create_event` shows the event on an MCP elicitation card in the DM and writes only when the owner presses an approve button; deny, a timeout, or a client without elicitation writes nothing. Session / Always on that card approve only that one event. Hermes masks what looks like a secret or a `+`-prefixed phone number on every approval card, so those parts of a title or description cannot be checked on the card before they are saved. Both servers log to `hermes-scripts.log` as `gcal-mcp` / `agenda-mcp`; the `calendar` process adds `mode slack, client elicitation: form` at connect and, per request, `approval: <action>` (a deny arrives as `decline`, Hermes' own 300-second approval timeout as `cancel`) or `approval failed: <error>` when the client has no elicitation or the MCP tool call itself was cancelled. Naming them in `platform_toolsets.slack` makes the list an allowlist, which keeps `gcal`'s unapproved `create_event` cron-only; listing no server would hand Slack every one of them.

Restart the gateway with `launchctl kickstart -k gui/$(id -u)/org.nix-community.home.hermes-agent`. `hermes gateway restart` looks for its own launchd label (`ai.hermes.gateway`), not the one home-manager installs, and can fall back to starting a second gateway in the foreground. After rolling back a generation, restart the gateway too: the running MCP servers keep the scripts they started with.

### Asking Claude through Hermes

A Slack DM starting with `!claude <repo or owner/repo> <request>` runs Claude Code on that repository; replies in its thread either approve (`merge`, `マージ`, `マージして`, `LGTM`, exact match) or go back to the same Claude session. Allowed owners are the `--owners` list in `home/programs/hermes/default.nix`; a bare repo name means `wadackel`.

- The `claude-task` plugin (`pre_gateway_dispatch`) takes these messages before the model sees them and starts `scripts/claude-task.ts`. It is a plugin rather than a file hook because only that hook can keep a message from the model.
- Claude runs `claude -p --restricted` in a sandbox that reads only the worktree and the toolchain and reaches only the npm registry, so it never loads `~/.claude/settings.json`, its hooks, or MCP servers. It only edits files; the script commits, pushes `claude/<thread ts>`, labels `claude`, opens the PR or issue, and merges after checking CI.
- State is `~/.config/hermes-claude/tasks/<thread ts>.json`; clones, worktrees and the pnpm store are under `~/.local/share/hermes-claude`. Logs go to `~/Library/Logs/hermes-claude-task.log`.
- The daily exploratory test of obsidian-web-clip is a no-agent cron job on `scripts/claude-explore-web-clip.sh`. Cron jobs live in `~/.hermes/cron/jobs.json`, not in Nix; it was registered with `hermes cron create "0 10 * * *" --script claude-explore-web-clip.sh --no-agent --deliver slack:D0C3V6SQABC --name claude-explore-web-clip`.

### Session Variables and tmux

A change to `home.sessionVariables` (for example `LLM_WIKI_VAULT_ROOT` in `home/programs/agents/default.nix`) does not reach a tmux server that was already running: new panes inherit the server's environment from when it started, so an agent launched inside tmux still sees the old value or none. Either push the variable into the server with `tmux set-environment -g VAR value` or restart the server. `/llm-wiki` asks before doing anything when the variable is empty rather than searching an empty path.

### Command Execution from launchd / macOS Notifications

Scripts executed on macOS notification click (e.g., `terminal-notifier -execute`) run in the launchd environment where PATH is limited to `/usr/bin:/bin:/usr/sbin:/sbin`. When using Nix-managed commands (tmux, jq, etc.), full paths must be provided.

### Configuration Not Applied

If system settings don't update after `darwin-rebuild`:

1. Check if the setting requires logout/reboot
2. Some Dock/Finder settings use post-activation scripts for immediate effect (see `system.activationScripts`)
3. Try: `killall Dock && killall Finder`

### Rollback After Bad Change

Nix keeps all previous generations - you can always rollback safely. See [README.md](README.md#rollback) for rollback commands.

## Claude Code Integration

This repository includes comprehensive Claude Code configuration:

- **Settings**: `home/programs/claude/settings.json` (symlinked to `~/.claude/settings.json`)
- **Agents**: `home/programs/claude/agents/` holds the reviewers `/gate` dispatches (`code-reviewer`, `security-auditor`, per-language and domain specialists, `comment-reviewer`) and task agents (`debugger`, `refactoring-specialist`, `build-error-resolver`, `tdd-guide`, `code-simplifier` / `plan-simplifier`, `architect-reviewer`, `skill-guide-reviewer`)
- **Scripts**: `home/programs/claude/scripts/` (symlinked to `~/.claude/scripts/`)
  - `claude-notify.ts`: terminal-notifier + tmux integration notifications. Debug: `~/.claude/scripts/claude-notify.ts debug`
  - `claude-memo.ts`: Stop hook that writes session summaries to Obsidian daily notes. Debug: `$TMPDIR/claude-memo.log`
  - `bash-policy.ts`: `PreToolUse` hook (always active) that blocks prohibited command patterns. Rules defined in: `bash-policy.yaml` (same directory). The `git push *renovate/*` rule exists because a direct push closes the Renovate PR; its message names the `stop-updating` label and the own-branch alternative instead of "push again", which the same rule would block
  - `write-policy.ts`: `PreToolUse` hook on `Write|Edit|MultiEdit` that blocks a personal identifier (`wadackel`, `tsuyoshi.wada`, host names) from entering a test or fixture path. A file that already carries the identifier stays editable, and `write-policy: allow` in the new content is the explicit escape. Tests: `deno test --allow-read --allow-write --allow-run=deno home/programs/claude/scripts/write-policy_test.ts`
  - `comment-metrics.ts <diff-file>`: counts added comment lines and comment blocks in a unified diff for `comment-reviewer`, which has no Bash; `/gate` appends its output to that reviewer's focus. Same file types and marker set as the reviewer's Scope; exit 0 whatever the diff contains, 2 only for a usage error. Tests: `deno test home/programs/claude/scripts/comment-metrics_test.ts`
  - `claude-pane-status.ts`: Hook that writes session state to tmux pane options for Agentower. Invoked per event by argv[0] (SessionStart/End/UserPromptSubmit/Stop/StopFailure/Notification/PermissionDenied/CwdChanged/Subagent*/Worktree*). Unknown events are a no-op. Debug: pipe JSON to stdin with `TMUX_PANE` set
  - `writing-metrics/`: readability measurement tools for dialogue and generated documents (Japanese-English mixing density, reply volume percentiles, workflow-vocabulary contexts). Run every few weeks to compare Writing-norm metrics before and after. `lint.ts <file.md>` detects Writing-norm violations in a single Japanese Markdown file; `fire-rate.ts --from 2026-08-31` tracks per-category violation density across transcripts — compare against `fire-rate-baseline.md` (committed 2026-08-30 snapshot) to judge the concise-style sentence constraints, plus bullet line and item length distributions by skill context and reply kind (2026-09-20 baseline in the same file). `reask-rate.ts [--from YYYY-MM-DD] [--list]` counts turn pairs (all assistant text since the previous real user message → next user message) and flags re-asks by Japanese regex; `--list` prints the candidates for hand curation into categories 1–4 (state missing / decision buried / undefined referent / process narration). Compare against `reask-baseline.md` (2026-09-19 snapshot) with `--from` set to 30 days before the measurement day
  - Running Claude script tests: `deno test --allow-env=HOME --allow-read --allow-write --allow-run home/programs/claude/scripts/<name>_test.ts` (`--allow-run` is required for test files that spawn the hook as a subprocess via `Deno.Command`, e.g. `bash-policy_test.ts`'s entry-point tests)
  - When adding new scripts, add `"Bash(*<script-name>*)"` to `permissions.allow` in `settings.json` (wildcard prefix handles full-path invocations by Claude. `Bash(<script-name>*)` does not match path-prefixed invocations)
  - Invocations with redirects (`2>/dev/null`, etc.) do not match `Bash()` patterns (known limitation), but `approve-piped-commands.ts` reads patterns from `settings.json` and auto-approves, so no additional work is needed
  - Exception: Scripts called from `hooks` are not Bash tool calls, so adding to `permissions.allow` is not required
  - When adding new scripts, grant execute permission with `chmod +x` (execute bit is required for hook execution. Git manages mode as 100644/100755, so a commit is also needed)
- **Output styles**: `home/programs/claude/output-styles/` (symlinked to `~/.claude/output-styles`). `concise` is the global default via `settings.json`'s `outputStyle` key. Health check: `claude -p 'STYLE-CHECK' --settings '{"outputStyle":"concise"}'` must return `concise-active` — if not, the style is not being loaded
- **Gate**: `/gate` is the final step of `/impl` and the standalone review entry. The evidence audit is `~/.agents/scripts/plan-state.ts coverage` / `complete` on `~/.claude/plans/<plan>.evidence.json` (shared with Codex `$impl`); the review wave and its findings go verbatim to `~/.claude/plans/<plan-slug>.gate.log.md`, and the reply carries only what the reader must decide. The impl final report and the standalone gate reply share one shape (three headings, defined once in `impl/SKILL.md`); under `/impl` the gate hands its items to the report instead of replying; Codex `$impl` reports the same three parts as prose without headings. `security-auditor` is selected by the data-flow triggers in `references/security-triggers.md`; Codex `$impl`'s rule that a change to review-controlling skill markdown needs security review is deliberately not mirrored on the Claude side
- **Shared contract**: `home/programs/agents/shared/plan/references/contract.md` defines every fixed string the plan / impl / gate skills, `check-plan.ts`, `plan-state.ts`, and the reviewer hook read (plan headings, Completion Criteria tags, the Requires User Confirmation form, `Final Audit + Review`, verdict vocabulary, sidecar names); `interview.md` next to it holds the question format and the ask-or-decide judgment shared by both plan skills and `requirements-interview`. `codex-plan-clarification-contract_test.ts` pins each entry against the files that carry it
- **Module**: `home/programs/claude/default.nix` manages symlinking to `~/.claude/`
- **Skills layout**:
  - `home/programs/claude/skills/`: public Claude Code skills exposed as `~/.claude/skills`
  - `home/programs/codex/skills/`: public Codex skills exposed as `~/.agents/skills`
  - `home/programs/agents/skills/`: common skill implementations shared by multiple agents
  - `home/programs/agents/memo/`: shared memo libraries used by Claude / Codex / opencode
    - The summary `claude -p` that all three memo scripts spawn runs with `~/.cache/claude-memo` as its cwd, so its transcripts collect under `~/.claude/projects/-Users-<name>--cache-claude-memo/` instead of the session's working directory, and are removed by the default 30-day cleanup
  - `home/programs/agents/shared/`: shared non-public skill assets such as plan reference prompts
  - Agent-specific skills with the same public name (for example `plan` and `impl`) live directly under each agent's public skill root
  - Generic skills used by multiple agents keep their implementation under `home/programs/agents/skills/`; each agent public root exposes them with symlinks
  - Both public skill roots are linked as whole directories without `recursive = true`; adding a new common skill under `home/programs/agents/skills/` plus per-agent symlinks under the public roots is reflected without adding new Nix `home.file` entries
- **Global CLAUDE.md**: `home/programs/claude/CLAUDE.md` is the symlink source for `~/.claude/CLAUDE.md`. Edit this file directly when modifying global settings
- **`permissions.allow`**: `Edit(~/.claude/**)` allows skills to edit files under `~/.claude/` without confirmation dialogs. File permission checks only consult `Edit(path)` rules, and an `Edit` rule covers every file-editing tool (`Write` and `NotebookEdit` included), so `Write(path)` entries in `allow` are ignored and Claude Code warns about them at startup. This means new-file creation under `~/.claude/` — plan files, `settings.json`, `bash-policy.yaml` — is also covered by the same single rule; narrowing it would require splitting `Edit(~/.claude/**)` into per-subtree rules

Editing existing Claude Code config files (settings.json, skills, etc.) is immediately reflected — no `darwin-rebuild` needed (they are symlinked). Only run `darwin-rebuild` when adding *new* files that need new symlinks created. One exception: a running session keeps the agent definition it loaded at start. Claude Code watches `~/.claude/agents/` for edits, but that directory is a symlink into the Nix store whose entries are symlinks into this repository, so an edit to `home/programs/claude/agents/<name>.md` never reaches the watcher; the next `Agent` dispatch in the same session still uses the old definition, and only a new session (or `claude -p`) picks up the change.

### abr (agent-browser auth state import)

`home/programs/agents/scripts/abr.ts` imports the running Chrome's cookies / localStorage / sessionStorage into `~/.agent-browser-state/main.json` for headless `agent-browser` replay. `home/programs/agents/default.nix` publishes the whole `scripts` directory at `~/.agents/scripts`, and `home/programs/zsh/init.zsh` wraps it in an `abr` zsh function.

- Tests: `deno test --allow-read --allow-write --allow-env --allow-net=127.0.0.1 --allow-run home/programs/agents/scripts/abr_test.ts` (a mock CDP server over `Deno.upgradeWebSocket`; `--allow-run` covers spawning the script as a subprocess)
- It speaks CDP directly and **never attaches to a target it did not create**. Do not replace this with `agent-browser connect`: that attaches to every page target and calls `Page.enable`, and Chrome's frozen background-tab renderers never answer, so the daemon hangs (`Resource temporarily unavailable (os error 35)`)
- Cookies are narrowed to the tracked origins by RFC 6265 domain-match; `--all-cookies` disables it when SSO needs a third-party domain
- `~/.agents/` is shared: `skills` is owned by `home/programs/codex/default.nix`, `scripts` by `home/programs/agents/default.nix`

### rebase-guard (WIP-commit verification for the rebase skill)

`home/programs/agents/scripts/rebase-guard.ts` is called by the `rebase` skill after a rebase: the skill parks uncommitted changes in a `wip: auto-commit before rebase` commit instead of `git stash`, unwinds it with `git reset --mixed HEAD~1` once the rebase is done, and then runs `rebase-guard.ts verify <wip-sha>` to confirm that every file of the WIP commit is still in the working tree. It is published at `~/.agents/scripts/rebase-guard.ts` like `abr.ts`.

- Tests: `deno test --allow-read --allow-write --allow-env --allow-run home/programs/agents/scripts/rebase-guard_test.ts` (builds a bare origin plus clones under a temp dir and spawns the script as a subprocess)
- Per file it reverse-applies the WIP patch with `git apply --reverse --check` and reports `PRESENT`, `IN_HEAD` (already committed, e.g. the base absorbed it and the rebase skipped the WIP commit), `LOST` (file or mode gone), or `UNCONFIRMED` (patch no longer reverse-applies, typically because the base changed adjacent lines). Exit 0 only when nothing is LOST or UNCONFIRMED; exit 2 means the guard could not run (not a WIP commit, rebase in progress, internal git error) and is never a loss verdict
- It runs every git call from `git rev-parse --show-toplevel` and uses `--path-format=absolute --git-path` for the rebase-state check, so it works from subdirectories and inside linked worktrees; do not replace the reverse-apply with line-set comparison — a line that also exists elsewhere in the file would make a lost hunk look absorbed

### check-plan (plan-body lint for /plan)

`home/programs/agents/scripts/check-plan.ts` lints a plan file against the plan-body contract. Both plan skills (Claude `/plan`, Codex `$plan`) run it right after DRAFT and again before ACTIVATE; a plan with any `error` cannot be activated. Published at `~/.agents/scripts/check-plan.ts` like the other scripts in that directory (allow entry `Bash(*check-plan*)`, the same substring shape as `rebase-guard`).

- Rules: `section-missing` (error: `## Context`, `## Files to Change`, `## Task Outline`, `## Completion Criteria` and its `### Autonomous Verification` / `### Requires User Confirmation` / `### Baseline`), `av-tag-missing` (error: an Autonomous Verification bullet without `[file-state]` / `[orchestrator-only]` / `[live]` / `[outcome]`), `ruc-format` (error: a Requires User Confirmation item that is neither `- None` nor a `[live]` / `[orchestrator-only]` bullet in the five-field `Observe / Why not autonomous / Needs / Your steps / Needed by` form with values from the template vocabulary), `live-missing` (warn: no `[live]` under Autonomous Verification), `self-resolved-grade` (error: a `### Self-resolved` bullet without a `source:` outside backticks that is immediately followed by `[Direct]` / `[Supported]` / `[Inferred]`, only an `[Unknown]` there, or a Direct / Supported grade with no backtick, `:N`, or `$` `./` `~/` token after it; an absent section, zero bullets, a `(none)` paragraph, or a lone `- None` produce nothing). Headings match whole lines and fenced blocks are ignored, so the item-format section of a plan about plans does not trip it. `self-resolved-grade` checks syntax only — whether the cited probe actually yields the cited lines is the critic's `### Round 1 evidence check` and the adversarial pass (`home/programs/agents/shared/plan/references/contract.md` defines the grades)
- Tests: `deno test --allow-read --allow-write --allow-run=deno home/programs/agents/scripts/check-plan_test.ts` (fixtures are written to a temp dir at run time; no fixtures directory)
- The required headings and the `Needs:` / `Needed by:` vocabulary are constants in the script and must be changed together with the heading table in `home/programs/agents/shared/plan/references/contract.md` (mirrored in the Codex plan skill) and the item template line pinned by `codex-plan-clarification-contract_test.ts`; the `source:` template line is likewise pinned across both plan skills and `contract.md`
- It does not check line-number anchors or run any command from the plan: on real plans an anchor range check produced zero errors and dozens of warnings on deliberate path abbreviations, and the anchor mistakes that actually surface (bare `:N`, ranges pointing at the wrong prose) are not decidable from the file. Those stay with the DEEPEN critic and adversarial agent

### config-lint (repository configuration lint in `nix flake check`)

`home/programs/agents/scripts/config-lint.ts` is the second flake check next to `formatting` (`checks.config-lint` in `flake.nix` runs it with `deno run --no-remote --no-prompt`; the script has no import for that reason). Published at `~/.agents/scripts/config-lint.ts`; run it by hand as `config-lint.ts .` from the repository root.

- Rules: `policy-parse` (error: a `- pattern:` line in the global `bash-policy.yaml` that is not `- pattern: "<glob>"`, or a policy with no rule), `skill-policy-conflict` (error: a command line inside a `bash` / `sh` / `shell` / `zsh` fence of a `SKILL.md` or `references/*.md` under `home/programs` that matches a bash-policy pattern; `<!-- config-lint: allow -->` on the line above the fence skips it, and vendored skill directories with a `.<vendor>-source` marker are skipped), `home-literal` (error: a `/Users/<name>` literal in `settings.json`, `hooks.json`, `*.nix`, `*.yaml`, `*.yml`, `*.json`; `$`, `*`, `{` after the slash are templates; `config-lint: allow` on the line or an entry in the script's `HOME_LITERAL_ALLOW` set exempts a line, the latter for strict JSON)
- Not covered: untagged fences, inline code spans, `exclude:` in the policy, heredoc bodies, and `cd x && git -C y` compounds (the lint matches whole lines; the hook splits on the bash AST). The rule is preventive
- Tests: `deno test --allow-read --allow-write --allow-run=deno home/programs/agents/scripts/config-lint_test.ts` (temp-dir fixtures)

### Vendored skills sync

Third-party SKILL.md sets are vendored under `home/programs/agents/skills/` and reachable from Claude / Codex / opencode via the standard common-skill symlinks. Vendors are declared in the `VENDORS` table of `home/programs/agents/scripts/sync-vendored-skills.ts`:

- `figma`: `figma-{use,generate-design,generate-library,use-slides}/` mirror upstream `figma/mcp-server-guide`
- `gh-stack`: `gh-stack/` mirrors upstream `github/gh-stack` (`skills/gh-stack`); the extension itself is installed via `pkgs.gh-stack` in `home/programs/gh/default.nix`

Commands:

- Re-sync all vendors: `./home/programs/agents/scripts/sync-vendored-skills.ts`; pass vendor names to limit (e.g. `... gh-stack`)
- Check for upstream drift without writing: `./home/programs/agents/scripts/sync-vendored-skills.ts --check [vendor...]`
- Each vendored skill root has a `.<vendor>-source` (`.figma-source`, `.gh-stack-source`) recording `upstream:` / `commit:` / `synced_at:` — `commit:` is the rollback anchor
- `.gitattributes` marks `figma-use/references/plugin-api-standalone.d.ts` as `-diff` so the 445KB typings file does not flood PR review UI

### agentower-verify (Agentower e2e)

After changing `home/programs/tmux/agentower/agentower-main.ts`, `home/programs/tmux/agentower/agentower.tsx`, `home/programs/tmux/agentower/agentower_e2e_harness.ts`, or `home/programs/tmux/agentower/agentower_e2e_test.ts`, run `.claude/skills/agentower-verify/agentower-verify.ts` (or invoke the `/agentower-verify` skill). It spins up an isolated `tmux -L agentower-e2e-$PID` server, runs every e2e scenario in `agentower_e2e_test.ts`, and emits a JSON verdict. Escape-driven exit is exercised in every scenario, so a broken quit path fails CI-style rather than leaking a stuck Agentower into the sandbox. Do not claim Agentower changes are complete while `ok: false`.

### Agentower binary (prefix+w)

**Agentower** is the tmux `prefix+w` popup that lists the Claude Code / Codex / opencode panes with their status and jumps to the selected one (older records call it the tmux picker).

`home/programs/tmux/config/tmux.conf`'s `bind-key w` invokes the AOT-compiled binary at `~/.local/share/agentower/agentower`, not `deno run`. The entry point is `agentower/agentower-main.ts`; `agentower.tsx` exports `main()` and is reached through a dynamic import so that `Deno.stdin.setRaw(true, { cbreak: true })` runs before the ink module graph. Bytes typed before that call sit in the tty's canonical queue where Deno's node-compat stdin cannot see them until the next keypress, so the entry split is what makes keys typed during startup arrive at all.

`home.activation.compileAgentowerBin` in `home/programs/tmux/default.nix` builds the binary in four steps: `deno check` → `deno bundle --minify` → `agentower/bundle-postprocess.ts` → `deno compile --no-check`. `--minify` is there for React rather than size: it is the only switch that makes esbuild fold `NODE_ENV` to the production build, and without it the bundle carries React's development build with no way to patch the production one back in. Because `agentowerSrcHash` covers the `.ts` sources and not `default.nix`, a change to these flags alone never triggers a rebuild. The explicit `deno check` is there because neither of the last two looks at types, and `deno compile` used to. Bundling shortens the module graph (see `agentower-bench-baseline.md` for the measured difference); the post-process stage exists only because bundling hoists ink's devtools imports (`ws`, `react-devtools-core`) to the top level, which `deno compile` then refuses. That script asserts it made exactly 3 replacements and exits 1 otherwise, and the activation branches on it rather than calling `exit` (an `exit` would abort the activation fragments that follow). **If an ink upgrade breaks the assert**, either re-derive the three lines or drop the bundle stage and compile `agentower-main.ts` directly — the flags are otherwise the same.

After `mv`, the activation runs the new binary once, because macOS charges ~1.4s to the first exec of a freshly written Mach-O of this size and the next `prefix+w` would otherwise pay it. Its exit code must be 2 — `main()`'s own guard on the missing `TMUX` — because that is also the only check that the binary starts at all; anything else keeps the old stamp so the next activation rebuilds. The `</dev/null` keeps the warm-up off the `darwin-rebuild` terminal's stdin. (It is **not** needed to protect the terminal mode: Deno restores termios at exit, measured on 2.9.5 — `stty -a` reports `icanon` before and after a run that sets cbreak and exits 2.)

`deno bundle` is experimental. If a Deno upgrade changes `--external` or `-o`, or an ink upgrade breaks the post-process assert, drop the bundle and post-process stages and compile `agentower-main.ts` directly with the same `deno compile` flags minus `--no-check`.

Hash-skip keys on a Nix eval-time sha256 over the `.ts`/`.tsx` sources in `home/programs/tmux/agentower/` and `home/programs/tmux/shared/` (tests, the e2e harness, and `agentower-bench.ts` excluded), so editing any of them — including `shared/pane-shared.ts` — triggers a rebuild on the next activation.

Agentower covers three AI agents: `claude` / `opencode` / `codex`. Each agent has its own pane-status writer that emits `@pane_*` tmux options (claude: `claude-pane-status.ts` invoked by Claude Code hooks; opencode: in-process Bun plugin at `home/programs/opencode/plugin.ts`; codex: `home/programs/codex/scripts/codex-pane-status.ts` invoked by Codex CLI lifecycle hooks registered in `home/programs/codex/hooks.json`). All three follow the same single-shot script + stdin JSON pattern.

Implications when editing Agentower source:

- `/agentower-verify` runs the suite against the source entry. Set `AGENTOWER_E2E_BIN=<path>` to run the same scenarios against a compiled binary instead — that is the only way to check the shipped artifact.
- To make changes visible to `prefix+w`, run `sudo darwin-rebuild switch --flake .#private` — the activation detects the source hash change and rebuilds.
- To iterate without a full rebuild, re-run the four steps directly (arg set must match the activation):
  ```
  deno check home/programs/tmux/agentower/agentower-main.ts
  deno bundle --minify --external ws --external react-devtools-core -o /tmp/agentower.bundle.js home/programs/tmux/agentower/agentower-main.ts
  deno run --allow-read --allow-write home/programs/tmux/agentower/bundle-postprocess.ts /tmp/agentower.bundle.js
  deno compile --no-check --allow-env --allow-read --allow-run --no-prompt --output ~/.local/share/agentower/agentower /tmp/agentower.bundle.js
  ```
- Do not claim Agentower work is complete based solely on source-mode output — the binary is the thing users invoke.

### agentower-bench (startup and input measurement)

`home/programs/tmux/agentower/agentower-bench.ts` measures what the popup costs and whether keys survive its startup, so a regression can be attributed to a phase instead of "it feels slow". It drives a binary inside the e2e harness's isolated tmux server and reads the `AGENTOWER_TRACE` marks the binary writes to stderr (`entry-start`, `raw-on`, `ink-module-eval-done`, `io-done`, `first-commit`, `input-received`, `tick-commit`, `render-us`, `tick-us`; off and free when the env var is unset). The `-us` pair carries a duration in microseconds rather than a timestamp: `render-us` is Ink's own timing of one `render(rootNode)`, so it is the frame's real cost, and one mark per frame makes it the frame counter that `tick-commit` is not (`tick-commit` sees App's commits only, never a frame driven by `Preview` alone).

```
home/programs/tmux/agentower/agentower-bench.ts --after <binary> [--before <binary>] [--pretty]
```

`agentower-bench-baseline.md` next to it holds the numbers from 2026-09-21 with the commands that produced them. Absolute values move with the machine — read the before/after pair. The bench is excluded from the compile hash, so editing it costs nothing at activation.

It is deliberately **not** in `permissions.allow`: `--after` execs whatever path it is given, so it takes a confirmation each run. A `Bash(*agentower-bench*)` wildcard would also match a same-named file in any repository under review — the same reason `plan-state.ts` is allowed by path rather than by bare name.

### Project Directory Encoding Rules

Directory names under `~/.claude/projects/` are encoded from the project path: strip the leading `/`, add `-` as a prefix, and replace both `/` and `.` with `-`.
Example: `/Users/foo/github.com/bar` → `-Users-foo-github-com-bar`

### bash-policy

`bash-policy.ts` evaluates all Bash commands as a global `PreToolUse` hook.
- **Blocking behavior**: exit 2 → command not executed → stderr returned to Claude as error feedback → self-correction
- **Global rules**: `~/.claude/scripts/bash-policy.yaml`
- **Project rules**: Create `.claude/bash-policy.yaml` and it will be auto-loaded by searching upward from `cwd` (already in global gitignore)
- **Rule format**: YAML with `pattern: "npx *"` + `message: "..."` (glob matching)

### Hook Data

Claude Code hooks receive JSON via stdin with common fields (`session_id`, `transcript_path`, `hook_event_name`, `cwd`) plus event-specific fields. `cwd` reflects the current shell cwd: Claude Code tracks Bash `cd` and updates the payload accordingly, so it is NOT stable for the lifetime of the session. Hooks that need a per-session stable key must scope on `session_id`, not on `cwd`. Stop hook: `stop_hook_active`. Notification hook: `message`, `title`, `notification_type`.

### `permissions.allow` Limitations

Commands containing pipes `|`, `&&`, `||`, `;`, or redirects `2>&1` do not match `Bash(cmd *)` patterns — this is a known limitation ([Issue #13137](https://github.com/anthropics/claude-code/issues/13137)). Workaround:
- Use a `PermissionRequest` hook to segment commands containing shell syntax (pipes, redirects, etc.), match against a whitelist, and auto-approve (see `home/programs/claude/scripts/approve-piped-commands.ts`)
- `PermissionRequest` fires only just before a permission dialog appears, making it lower overhead than `PreToolUse`

`Tool(**)` patterns (e.g., `Read(**)`) only cover paths within the project directory and `additionalDirectories`. For paths outside the project like `~/.claude/`, add `Tool(~/.claude/**)` separately. `Read(~/.claude/**)` and `Edit(~/.claude/**)` are needed; the `Edit` rule also covers `Write`.

### plan-state / plan-evidence (shared evidence sidecar)

`home/programs/agents/scripts/plan-state.ts` (entry point, shebang) and `plan-evidence.ts` (library) are the evidence machinery shared by Claude `/impl` and Codex `$impl`; the commands (`init` / `start` / `require` / `snapshot` / `record` / `append-evidence` / `coverage` / `complete` / `reconcile`) and the check schema are described in `home/programs/codex/skills/impl/references/evidence.md`, and the fixed strings in `home/programs/agents/shared/plan/references/contract.md`. Published at `~/.agents/scripts/plan-state.ts`.

- The sidecar `<plan basename>.evidence.json` must sit under `~/.codex/plans` or `~/.claude/plans`; whichever of the two exists is accepted (`plansDirs`), so a machine with one agent works
- `coverage <evidence>` reads the plan next to the sidecar and exits 1 listing every `### Autonomous Verification` bullet whose `cc-<n>` id (bullet order) no task requires; `[outcome]` bullets are numbered but never required. `complete` on the final task (`Final Audit + Review`) needs at least one `review` check; an `audit` check is accepted, not required
- Tests: `deno test --allow-read --allow-write --allow-env=HOME --allow-run=git,deno home/programs/agents/scripts/plan-state_test.ts home/programs/agents/scripts/plan-evidence_test.ts` (`--allow-run` covers the git fixtures and the lock test that spawns the script)
- `permissions.allow` carries `Bash(*/.agents/scripts/plan-state.ts*)` and the two test paths rather than the usual `Bash(*<script-name>*)`: a bare name would also match a same-named file in any reviewed repository, and `plan-state` is a plausible name to collide on
