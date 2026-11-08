# Codex CLI integration

This module keeps the Codex CLI configuration close to the Claude Code workflow
used in this dotfiles repo.

## Development workflows

| Work | Entry point |
|---|---|
| Small, well-defined changes | Native Plan mode |
| Everyday development | `$plan` followed by `$impl [absolute-plan-path]` |
| Proofs of concept | `requirements-interview`, then Goal with explicit acceptance and stopping conditions |

Plan handoffs retain purpose, non-goals, constraints, acceptance criteria, and
implementation discretion. Accepted decisions carry forward; material new
decisions still require an answer.

`$impl` runs each acceptance check as a plain command and keeps the output in
the conversation; no record file is written. At its start it sets the ref
`refs/impl-base/<plan basename>`, and review diffs from it, untracked files
included. Its final gate re-runs every acceptance check on the final tree and
requires independent review verdicts and fresh live observations. An unavailable
required check remains incomplete unless the user explicitly waives it.

Plan paths remain stable across compaction and expired Agentower markers. Markers
control display only, with Agentower's 24-hour freshness window, and are not read
for task progress.

See the [evaluation protocol](evals/harness/README.md) for model and harness
comparisons.

## Implemented parity

- `codex-pane-status.ts`: writes Codex lifecycle state to tmux `@pane_*` options
  so Agentower (`prefix+e`) can show Codex panes next to Claude and opencode
  panes. It also writes best-effort diagnostics to
  `~/.codex/logs/codex-pane-status.log`.
- `codex-hook-log.ts`: records sanitized hook payloads to
  `~/.codex/logs/hooks.jsonl`. This is intentionally observational: it does not
  block, rewrite, or approve anything.
- `codex-notify.ts`: manages Codex completion notifications declaratively and
  restores tmux/WezTerm activation behavior where tmux context is available.
  Debug with `~/.codex/scripts/codex-notify.ts debug`.
- `codex-memo.ts`: records Codex Stop summaries to the Obsidian daily note,
  first with a fast heuristic placeholder and then with a best-effort
  `claude -p` (Haiku) refinement when it completes within the hook budget. Debug with
  `~/.codex/logs/codex-memo.log`.
- RTK instructions: `~/.codex/AGENTS.md` includes `~/.codex/RTK.md`, matching
  `rtk init -g --codex`. Codex does not get Claude's transparent Bash rewrite;
  instead, persistent instructions tell it to prefix shell commands with `rtk`.

## Deferred parity

- Bash policy blocking: needs empirical confirmation that Codex hook output can
  reliably block tool execution in the same way Claude `PreToolUse` can.
- RTK transparent command rewrite: needs a Codex equivalent to Claude's
  `updatedInput` hook output before it can be ported safely. Current Codex
  hooks parse `updatedInput` but do not support applying it.
- Plan gate: Codex edit/apply-patch hook coverage must be verified before
  enforcing a cwd marker gate.
