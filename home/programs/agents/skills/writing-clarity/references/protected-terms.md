# Protected Terms

Words that stay in their original form regardless of context. The vocabulary
test in SKILL.md decides everything else; this list only covers the categories
where no judgment is needed.

## Always original

- Code identifiers: function, variable, type, and module names as written in code
- Commands and their arguments: `git rebase`, `darwin-rebuild switch`, `deno fmt --check`
- File paths and extensions: `home/programs/claude/CLAUDE.md`, `.jsonl`
- Product, tool, and service names: Claude Code, nix-darwin, home-manager, GitHub Actions, tmux
- Skill and agent names: `/completion-audit`, `subagent-review`, `code-simplifier`
- Machine-contract labels: severity (MUST_FIX / SHOULD_FIX / NIT / CRITICAL / HIGH / MEDIUM / LOW), verdict values (PASS / FAIL / VERIFIED / ITERATE / CONVERGED), status values (pending / in_progress / completed)
- Established acronyms: API, CLI, PR, CI, URL, JSON, YAML, AST, LSP

## Domain terms that read naturally in Japanese tech prose

Keep these as-is; translating them loses precision or reads oddly:

diff, commit, push, merge, rebase, branch, stash, rebuild, flake, overlay,
symlink, frontmatter, hook, prompt, token, context, transcript, sandbox,
subagent, scratchpad

## Words that are findings when used as ordinary prose nouns

These commonly leak from workflow vocabulary into running prose. As headings,
table labels, or ID references they are fine; as ordinary nouns they should be
Japanese:

| Word | In prose, prefer |
|---|---|
| task | タスク / 作業 |
| gate | 最終確認 / 関門 |
| step / phase | 手順 / 段階 |
| baseline | 基準値 / 変更前の状態 |
| evidence | 記録 / 根拠 |
| criteria | 条件 / 基準 |
| deviation | 逸脱 / 計画との差分 |
| escalation | 引き上げ / 追加確認 |
| self-audit | 自己点検 |
| orchestrator | メインセッション |

The right column is a starting point, not a fixed mapping — pick the word the
sentence needs. When neither fits, keep the original (the norm's default).
