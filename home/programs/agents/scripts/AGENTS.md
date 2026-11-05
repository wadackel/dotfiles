# Shared agent scripts

Notes for `home/programs/agents/scripts/`, published at `~/.agents/scripts/`.

## abr (agent-browser auth state import)

`home/programs/agents/scripts/abr.ts` imports the running Chrome's cookies / localStorage / sessionStorage into `~/.agent-browser-state/main.json` for headless `agent-browser` replay. `home/programs/agents/default.nix` publishes the whole `scripts` directory at `~/.agents/scripts`, and `home/programs/zsh/init.zsh` wraps it in an `abr` zsh function.

- Tests: `bun test home/programs/agents/scripts/abr_test.ts` (a mock CDP server on `node:http` plus `ws`'s `WebSocketServer`, which under Bun is Bun's built-in implementation of that package; the tests spawn the script as a subprocess)
- It speaks CDP directly and **never attaches to a target it did not create**. Do not replace this with `agent-browser connect`: that attaches to every page target and calls `Page.enable`, and Chrome's frozen background-tab renderers never answer, so the daemon hangs (`Resource temporarily unavailable (os error 35)`)
- Cookies are narrowed to the tracked origins by RFC 6265 domain-match; `--all-cookies` disables it when SSO needs a third-party domain
- `~/.agents/` is shared: `skills` is owned by `home/programs/codex/default.nix`, `scripts` by `home/programs/agents/default.nix`

## rebase-guard (WIP-commit verification for the rebase skill)

`home/programs/agents/scripts/rebase-guard.ts` is called by the `rebase` skill after a rebase: the skill parks uncommitted changes in a `wip: auto-commit before rebase` commit instead of `git stash`, unwinds it with `git reset --mixed HEAD~1` once the rebase is done, and then runs `rebase-guard.ts verify <wip-sha>` to confirm that every file of the WIP commit is still in the working tree. It is published at `~/.agents/scripts/rebase-guard.ts` like `abr.ts`.

- Tests: `bun test home/programs/agents/scripts/rebase-guard_test.ts` (builds a bare origin plus clones under a temp dir and spawns the script as a subprocess)
- Per file it reverse-applies the WIP patch with `git apply --reverse --check` and reports `PRESENT`, `IN_HEAD` (already committed, e.g. the base absorbed it and the rebase skipped the WIP commit), `LOST` (file or mode gone), or `UNCONFIRMED` (patch no longer reverse-applies, typically because the base changed adjacent lines). Exit 0 only when nothing is LOST or UNCONFIRMED; exit 2 means the guard could not run (not a WIP commit, rebase in progress, internal git error) and is never a loss verdict
- It runs every git call from `git rev-parse --show-toplevel` and uses `--path-format=absolute --git-path` for the rebase-state check, so it works from subdirectories and inside linked worktrees; do not replace the reverse-apply with line-set comparison — a line that also exists elsewhere in the file would make a lost hunk look absorbed

## check-plan (plan-body lint for /plan)

`home/programs/agents/scripts/check-plan.ts` lints a plan file against the plan-body contract. Both plan skills (Claude `/plan`, Codex `$plan`) run it right after DRAFT and again before ACTIVATE; a plan with any `error` cannot be activated. Published at `~/.agents/scripts/check-plan.ts` like the other scripts in that directory (allow entry `Bash(*check-plan*)`, the same substring shape as `rebase-guard`).

- Rules: `section-missing` (error: `## Context`, `## Files to Change`, `## Task Outline`, `## Completion Criteria` and its `### Autonomous Verification` / `### Requires User Confirmation` / `### Baseline`), `av-tag-missing` (error: an Autonomous Verification bullet without `[file-state]` / `[orchestrator-only]` / `[live]` / `[outcome]`), `ruc-format` (error: a Requires User Confirmation item that is neither `- None` nor a `[live]` / `[orchestrator-only]` bullet in the five-field `Observe / Why not autonomous / Needs / Your steps / Needed by` form with values from the template vocabulary), `live-missing` (warn: no `[live]` under Autonomous Verification), `self-resolved-grade` (error: a `### Self-resolved` bullet without a `source:` outside backticks that is immediately followed by `[Direct]` / `[Supported]` / `[Inferred]`, only an `[Unknown]` there, a `[Direct]` with no backtick, `:N`, path-like token (a `/` with non-space on both sides), `$`-prefixed token, or `.<ext>` after it, or a `[Supported]` with nothing after it; the `[Direct]` message carries an example line; an absent section, zero bullets, a `(none)` paragraph, or a lone `- None` produce nothing), `section-duplicate` (error: the same heading line twice outside fences; the second occurrence is reported with the first one's line number, because a scripted `String.replace` whose replacement string expands `$` once duplicated part of a plan), `direct-excerpt` (warn: a `[Direct]` source with no `→ <output excerpt>` after the probe; the critic re-runs such a probe instead of reading the excerpt), `assumption-scope` (error: a `### Assumptions` bullet carrying `user-overridden: default` outside backticks with no `scope:` field; the rule that provisional defaults are for scope boundaries only was already in prose and was broken anyway). Headings match whole lines and fenced blocks are ignored, so the item-format section of a plan about plans does not trip it. `self-resolved-grade` checks syntax only — whether the cited probe actually yields the cited lines is the critic's reading of the quoted excerpt in its `### Round 1 evidence check` (or its re-run when there is none) and the adversarial pass (`home/programs/agents/shared/plan/references/contract.md` defines the grades)
- Tests: `bun test home/programs/agents/scripts/check-plan_test.ts` (fixtures are written to a temp dir at run time; no fixtures directory)
- The required headings and the `Needs:` / `Needed by:` vocabulary are constants in the script and must be changed together with the heading table in `home/programs/agents/shared/plan/references/contract.md` (mirrored in the Codex plan skill) and the item template line pinned by `codex-plan-clarification-contract_test.ts`; the `source:` template line is likewise pinned across both plan skills and `contract.md`
- It does not check line-number anchors or run any command from the plan: on real plans an anchor range check produced zero errors and dozens of warnings on deliberate path abbreviations, and the anchor mistakes that actually surface (bare `:N`, ranges pointing at the wrong prose) are not decidable from the file. Those stay with the plan's review: Codex's critic and adversarial agent, Claude's single self-review

## config-lint (repository configuration lint in `nix flake check`)

`home/programs/agents/scripts/config-lint.ts` is the second flake check next to `formatting` (`checks.config-lint` in `flake.nix` runs it with `bun --no-env-file --no-install --config=/dev/null` inside the Nix sandbox, where there is no `node_modules`; the script imports only `node:*` modules for that reason, and a test pins it). Published at `~/.agents/scripts/config-lint.ts`; run it by hand as `config-lint.ts .` from the repository root.

- Rules: `policy-parse` (error: a `- pattern:` line in the global `bash-policy.yaml` that is not `- pattern: "<glob>"`, or a policy with no `- pattern:` line that is not an explicit `rules: []`), `skill-policy-conflict` (error: a command line inside a `bash` / `sh` / `shell` / `zsh` fence of a `SKILL.md` or `references/*.md` under `home/programs` that matches a bash-policy pattern; `<!-- config-lint: allow -->` on the line above the fence skips it, and vendored skill directories with a `.<vendor>-source` marker are skipped), `home-literal` (error: a `/Users/<name>` literal in `settings.json`, `hooks.json`, `*.nix`, `*.yaml`, `*.yml`, `*.json`; `$`, `*`, `{` after the slash are templates; `config-lint: allow` on the line or an entry in the script's `HOME_LITERAL_ALLOW` set exempts a line, the latter for strict JSON)
- Not covered: untagged fences, inline code spans, `exclude:` in the policy, heredoc bodies, and `cd x && git push origin renovate/y` compounds (the lint matches whole lines; the hook splits on the bash AST). The rule is preventive
- Tests: `bun test home/programs/agents/scripts/config-lint_test.ts` (temp-dir fixtures)

## vocab (the owner's vocabulary, injected at session start)

`home/programs/agents/scripts/vocab.ts` (entry), `vocab-lib.ts` (pure: read, lint, digest, apply) and `vocab-propose.ts` (material from sessions, the weekly packet) keep the owner's short-instruction vocabulary in the Obsidian vault, not in this repository: one note per term in `06_Vocabulary/`, the allowed kinds and relations declared in `06_Vocabulary/_schema.md`, and agent proposals in `98_Maintenance/proposals/Vocabulary/` until the owner sets `status: approved` in the `06_Vocabulary/語彙レビュー` Bases view. The `vocab` skill registers terms and drafts the weekly proposals; `/weekly-review` runs it.

- Injection: Claude and Codex run `vocab.ts hook claude|codex` on SessionStart (Codex's `hooks.json` is a store copy, so a change needs `darwin-rebuild`); opencode's `plugin.ts` adds the digest through `experimental.chat.system.transform`, once per session; Hermes `!claude` gets only the target repository's terms through `claude-task.ts` `repoVocabulary`. `VOCAB_DIGEST=off` turns injection off. Approved but unapplied proposals are part of the digest, pending ones never are
- Capture: the three memo scripts call `proposeFromSession` after their summary (Codex from `mainWorker`, never the 5-second Stop hook), through a lazy `import()` so a broken vocabulary module cannot stop the memo. It calls no model: it records corrections, answers to the agent's questions, and unregistered terms used twice in `~/.local/state/vocab/` (anything containing a `05_Private/` filename, `[[`, a URL or a token is dropped). Definitions are drafted weekly by the agent running `/weekly-review` from the packet `vocab.ts propose --weekly` prints — Haiku given a few excerpts proposed only generic tool names. At most five automatic proposals wait at a time
- Module layout: the memo scripts of `claude/`, `codex/` and `opencode/` and `vocab.ts` import `vocab-lib.ts`, `vocab-propose.ts` and `memo-shared.ts` by their real relative paths (`../../agents/…`); Bun resolves a script through its real path, so nothing is published next to them. After editing, run `bunx tsc --noEmit` from the repository root
- Approval: `vocab.ts add` only ever writes a pending proposal, even for a definition the owner dictated. It is in `permissions.allow`, so a direct write would let text injected into a session become approved vocabulary for every agent and for Hermes
- Tests: `bun test home/programs/agents/scripts/vocab-lib_test.ts home/programs/agents/scripts/vocab-propose_test.ts home/programs/agents/scripts/vocab_test.ts`

## Vendored skills sync

Third-party SKILL.md sets are vendored under `home/programs/agents/skills/` and reachable from Claude / Codex / opencode via the standard common-skill symlinks. Vendors are declared in the `VENDORS` table of `home/programs/agents/scripts/sync-vendored-skills.ts`:

- `figma`: `figma-{use,generate-design,generate-library,use-slides}/` mirror upstream `figma/mcp-server-guide`
- `gh-stack`: `gh-stack/` mirrors upstream `github/gh-stack` (`skills/gh-stack`); the extension itself is installed via `pkgs.gh-stack` in `home/programs/gh/default.nix`
- `typesafe-ai`: `typesafe-ai/` mirrors upstream `typesafe-ai/skills` (`skills/typesafe-ai`); design guidance for Jev / System One judgments that defers API details to the live docs at `docs.typesafe.ai`
- `docker`: `docker-{project-foundations,build-strategies,compose-patterns,destructive-guardrails}/` mirror upstream `docker/skills`; its Docker Sandboxes (`sbx`) and Docker Agent skills are left out because neither tool runs on the colima setup here

Commands:

- Re-sync all vendors: `./home/programs/agents/scripts/sync-vendored-skills.ts`; pass vendor names to limit (e.g. `... gh-stack`)
- Check for upstream drift without writing: `./home/programs/agents/scripts/sync-vendored-skills.ts --check [vendor...]`
- Each vendored skill root has a `.<vendor>-source` (`.figma-source`, `.gh-stack-source`, `.typesafe-ai-source`, `.docker-source`) recording `upstream:` / `commit:` / `synced_at:` — `commit:` is the rollback anchor
- `.gitattributes` marks `figma-use/references/plugin-api-standalone.d.ts` as `-diff` so the 445KB typings file does not flood PR review UI
