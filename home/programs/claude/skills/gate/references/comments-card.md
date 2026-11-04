# Comments review card
Trigger: added comment lines (`//`, `#`, `--`, `;`, `/*`, `*`) in a `.rs .go .ts .tsx .jsx .mts .cts .py .rb .lua .nix .sh .dart` file of the diff.
Scope: newly added code comments, for `code-reviewer`; the conventions are `~/.claude/CLAUDE.md` § Code (comments explain only why an obvious alternative was rejected or why the natural approach is a trap).

## Check
- A `Why:`, `Why-Not:`, `Note:` or similar label opening the comment — SHOULD_FIX.
- Conversational residue: "as requested", "per the conversation", a PR or issue number, a reviewer or author named, revision history — SHOULD_FIX.
- A newly added block of seven or more consecutive comment lines — SHOULD_FIX, with a version that keeps the rejected alternative and the reason in six lines or fewer.
- A comment whose reason is no longer true for the code beside it (the code changed, the comment did not) — SHOULD_FIX.
- A comment that restates what the next line says, or narrates the mechanical steps — NIT.
- A secret, credential, internal URL or personal data in a comment — MUST_FIX (`security-auditor` runs only on data-flow triggers, so this card is where a comment's secret is caught).

## Do not flag
- Docstrings (`///`, `/** */`, `""" """`, JSDoc, RDoc `##`, Lua `---`), license headers, shebangs, generated files.
- Comments in test files (`*_test.*`, `*.test.*`, `*.spec.*`, `tests/`, `__tests__/`).
- `TODO`, `FIXME`, `HACK`, `XXX`, `WIP`.
- A comment that names a rejected alternative or a non-obvious invariant: "because", "instead", "would" are signs of a legitimate why-not, not of residue.
