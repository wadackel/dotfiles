# Protected Terms

Words that stay in their original form regardless of context. The vocabulary
test in SKILL.md decides everything else; this list only covers the categories
where no judgment is needed.

## Always original

- Code identifiers: function, variable, type, and module names as written in code
- Commands and their arguments: `git rebase`, `darwin-rebuild switch`, `deno fmt --check`
- File paths and extensions: `home/programs/claude/global-instructions.md`, `.jsonl`
- Product, tool, and service names: Claude Code, nix-darwin, home-manager, GitHub Actions, tmux
- Skill and agent names: `/impl`, `check-plan`, `code-simplifier`
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
| gate | 最後のレビュー / レビューを通す（「関門」とは書かない） |
| step / phase | 手順 / 段階 |
| baseline | 基準値 / 変更前の状態 |
| evidence | 確認した結果 / 根拠 |
| criteria | 条件 / 基準 |
| deviation | 計画と違う点 |
| escalation | 利用者に判断を求める / 上の担当に回す |
| self-audit | 自分で見直す |
| orchestrator | メインセッション |

The right column is a starting point, not a fixed mapping — pick the words the
sentence needs, and prefer a phrase that says what happens over a one-word
translation, which tends to become a coined word the reader has never seen.
When nothing fits, keep the original (the norm's default).

## Additional allowlist

Machine-readable extension of the allow vocabulary, consumed by
`writing-metrics/lint.ts` together with the Domain terms list, the
"Established acronyms" line, and the table above. One word per line; `#` starts
a comment. Keep this fence in sync with the prose sections when either changes.
Seeded from the measured keep-as-is classes in `writing-metrics/vocab-mapping.md`.

```allowlist
# products / tools (vocab-mapping A-1)
nix
nixpkgs
deno
tmux
zsh
git
github
homebrew
claude
codex
tsc
pnpm
colima
deadnix
ubuntu
macos
darwin-rebuild
plist
tar
gitignore
localhost
shebang
cask
# skills / repos (A-2, A-3; self-audit stays a finding — see table above)
code-simplifier
agent-browser
agentower
agentower-verify
llm-wiki
writing-clarity
writing-metrics
# established dev terms (A-5, A-6)
lint
patch
fixture
codegen
clone
assert
allowlist
vault
wikilink
feed
note
ctx
# lint severity values (machine contract, like the labels above)
warn
info
```
