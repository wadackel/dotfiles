---
name: mise-update
description: Updates the mise-managed languages and tools pinned in this dotfiles repository (agent-browser, rust, node, gws, ...) together with the skills tied to them. Use when asked to update or upgrade any of them.
argument-hint: "[tool...]"
allowed-tools: Bash(*mise-update/status.ts*)
---

# mise-update

Every tool in `programs.mise.globalConfig.tools` (`home/programs/mise/default.nix`) is pinned to an exact version, because `latest` and `lts` stop at whatever was current when each machine installed them and the private and work machines drift apart. Nothing moves a pin but an edit, and some tools carry skills whose text has to move with them. Both have already gone wrong: the 16 gws-* skills stayed as copied in March while the CLI moved on, and agent-browser 0.43 changed when `--state` relaunches the browser, which left its SKILL.md, references and template describing the old behavior (1d8154a).

The goal of a run: the tools the user chose are on their new versions on this machine, every skill tied to them matches that version, and nothing that relies on them broke.

Out of scope: Nix and Homebrew packages and mise itself (the flake.lock update workflow covers them), vendored skills not tied to a mise tool (`sync-vendored-skills.ts` covers those), and project-level mise configs.

## Show the list and let the user choose

Run `.claude/skills/mise-update/status.ts`. It prints JSON with the pins read from the Nix config, compared with what mise has installed and what is newer:

- `languages` (go, node, python, rust): `inLine` is the newest release on the pinned line, `overall` the newest release when it is on another line.
- `tools`: everything else that has a newer release; `kind` marks `major` and `0.x-minor` bumps.
- `staleSkills`: skills whose NOTICE records a version other than the pin. Their tool may be current.
- `pinMismatch`: the pin is not what is installed and active, usually after a `git pull` on the other machine without a switch. The skill text is already new there (skills are linked to the worktree) while the CLI is still old. A switch resolves it.
- `upToDate`: nothing to do. A tool in `pinMismatch` is never listed here.
- `unknownTools`: NOTICE `Tool:` values that name no pinned tool, a typo or a tool taken out of mise; their skills are compared with nothing until the NOTICE is fixed.
- `errors`: lookups that failed. A tool whose lookup failed may be missing from the groups above, so show these to the user with the list instead of calling the rest current.

Show it to the user in those four groups, with `unknownTools` (a NOTICE to fix) and `errors` beside them, and ask with AskUserQuestion which to update, on every run, also when a tool was named in the request: the user decides the scope each time, sometimes everything, sometimes one tool. For a language, offer the in-line and the line-change version as separate choices and say that a line change also reaches projects that do not pin their own version. A named tool that is already current gets only the skill comparison. Rust's nightly is new almost every day, so it shows up on most runs.

Illustrative shape, not a template:

```
言語
  python   3.13.17 → 3.13.18（同じ系列） / 3.15.2（系列を変える）
  rust     nightly-2026-09-23 → nightly-2026-11-28
ツール
  usage    6.11.0 → 7.4.1   メジャー
スキルだけ古い
  gws-* (16)   NOTICE の記録は unknown、固定した版は 0.22.5
```

## Update each chosen tool

Check before changing the pin, and change the pin before the one switch at the end. The old and the new version have to be installed side by side to compare them, and a successful switch proves nothing about the install: the `mise install` inside it is allowed to fail (`|| true` in the activation).

1. Install the new version next to the old one with `mise install <tool>@<version>`; the config stays as it is. Run either version by its path under `mise where <tool>@<version>` (`node_modules/.bin/<command>` for an npm tool), not through `mise exec`: `Bash(mise *)` is allowed without confirmation, so whatever follows `mise exec … --` would run unasked. Keep every file a check writes (a saved browser state, a screenshot, a generated skill) in a temporary directory outside the repository.
2. Read the release notes between the two versions and look for what this repository relies on: search the whole tree for the tool's command name (skills outside the tool's own, hooks, scripts, `settings.json`), not only the skills its NOTICE names. A list of consumers is not kept anywhere because it would go stale.
3. Update every skill tied to the tool; there is no option to leave one behind, because a skill that describes a different version than the installed CLI is what this skill exists to prevent. Each tied skill has a `Tool:` line in its NOTICE.
    - A copied skill (`Vendored version:`) is copied again from the package of the new version, not from GitHub, and the modifications its NOTICE lists are applied again. Drop `allowed-tools` and `hooks` from the copied frontmatter and list that among the NOTICE's modifications: those fields would let upstream text run commands here without confirmation, and agent-browser's packaged skill already sets `allowed-tools`. Say in the report when upstream added either. Update the version wherever the skill or its NOTICE records it.
        - gws: `gws generate-skills` (from the new version) writes into the current directory, even with `--help`; run it inside an empty temporary directory, never in the repository.
        - modern-web-guidance and chrome-extensions: `<mise where …>/node_modules/modern-web-guidance/skills/<name>/`.
    - A skill the package newly ships is taken in when a skill already carried links to it (`../<name>/SKILL.md`), so links stay whole and the skill listing grows only by what the carried skills already point at; every new skill adds a line to both the Claude and the Codex listing in every session. Give it a NOTICE, and link it from `home/programs/claude/skills/` and `home/programs/codex/skills/` like its siblings. Report only the count of the others. Do not add the new commands to `permissions.allow`: some of them send mail.
    - A skill written here (`Verified version:`) states CLI behaviors. Run the same steps on the old and the new version and compare. Also check what the text names against what the new version ships, not only the difference between the two versions (agent-browser: every specialized skill the text names is in the new `agent-browser skills list`, and its bundled `skills/` did not change what the text relies on). For agent-browser, use session names of your own and close them afterwards, so the user's browsers are left alone. Record the new version in the NOTICE once the behaviors hold.
4. When a premise broke (a skill's text, a hook or script, a consumer found in step 2), fix it now: read `~/.claude/skills/do/SKILL.md` and follow its Understand first, Ask, Proceed, Done and Review sections for the fix. Its Ship and Report sections are replaced by step 5, Apply and finish, and Report below, so the fix lands in the tool's own commit and nothing is pushed before Apply and finish. `/do` cannot be invoked by the model, and reading it keeps that setting.
5. Change the pin in `home/programs/mise/default.nix`, then commit the tool with its skills and fixes as one commit, one tool per commit, so each can be reverted alone. Stage only those paths, not the whole tree.

Rust needs a nightly that has every component the pin lists (rust-analyzer, rust-src); a nightly can ship without one, and `mise install rust@<nightly>` does not add components that are not in the config yet. Install the candidate with `rustup toolchain install <nightly> --component rust-analyzer --component rust-src`, which refuses a nightly that lacks one; then step back a day at a time.

## Apply and finish

- Run `nix flake check`, then switch once. On the private profile run `sudo -n darwin-rebuild switch --flake .#private` and continue below. On the work profile push first, then ask the user to run `sudo darwin-rebuild switch --flake .#work`, because it needs their Touch ID; the run ends there with the checks done and the switch pending, and the report lists the steps below for after the switch.
- Confirm each new version in a fresh login shell (`zsh -lic '<command> --version'`): a running shell keeps the PATH it started with. For rust also check `rustup component list --installed --toolchain <nightly>`.
- Remove the old versions of the updated CLIs (`mise uninstall <tool>@<old>`) and the old rust nightly (`rustup toolchain uninstall`); they are used only by this repository. Keep the old go, node and python, which projects elsewhere may use, and report the space they take. Never run `mise prune`: it also removes versions of tools outside this config, such as pnpm.
- Push to main, the repository's shipping default (on the work profile this already happened before the switch).

## Report

For each tool: the old and the new version; what the release notes changed that this repository relies on, and how it was fixed; the skills taken in and the count of those left out; the old versions kept and their size; and, on the work machine, what the user still has to do.
