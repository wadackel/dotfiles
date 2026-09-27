---
name: vocab
description: >-
  Registers and maintains the owner's vocabulary: the short words and workflow
  names they use in instructions, kept in the Obsidian vault's 06_Vocabulary/
  and injected into every Claude Code, Codex, opencode, and Hermes !claude
  session. Use when the owner defines a term or asks to remember what a word
  means ("この語を登録して", "語彙に追加", "〜は〜のこと、覚えておいて",
  "register this term", "add to vocabulary"), or asks to check or apply the
  vocabulary ("語彙を反映して", "語彙をチェックして", "vocab apply", "vocab lint").
  Not for knowledge notes (use llm-wiki) or for Claude Code auto memory.
argument-hint: "[add <term> | apply | lint | weekly]"
---

# vocab

The vocabulary lives in the vault, not in this repository. Every change goes through `~/.agents/scripts/vocab.ts`; never edit `06_Vocabulary/` or `98_Maintenance/proposals/Vocabulary/` with file tools.

## Add or change a term

Every addition and change is a pending proposal that becomes vocabulary only when the owner sets `status: approved` in the `06_Vocabulary/語彙レビュー` Bases view. Nothing, including a definition the owner dictated, is written to `06_Vocabulary/` directly: this command runs without a permission prompt, so text injected into a session must not be able to become approved vocabulary.

```bash
~/.agents/scripts/vocab.ts add <term> [--kind <term|workflow|workflow-step|decision|repo>] [--definition "<one or two sentences>"] [--alias <a>]... [--rel <relation>=<term>]... [--refers-to <path>]... [--path <repo path>] [--draft] [--origin explicit|weekly]
```

- A new term needs `--kind` and `--definition`. For an existing term the same command proposes a change: a new definition, added relations, or added aliases
- Add `--draft` when you wrote the definition rather than the owner; the proposal's evidence line says which
- Keep the definition to what the owner said; do not fill gaps from general knowledge
- Relations allowed by `06_Vocabulary/_schema.md`: `distinct_from` (a term it is confused with), `applies_in` (a `repo` note), `part_of` (a workflow), `supersedes`, and for decisions `because` / `rejected`
- A term used only in one repository gets `--rel applies_in=<repo>`; a `repo` term gets `--path` so a relative `refers_to` can be checked

Report the proposal path it printed and that it waits for the owner's approval.

## Weekly drafting

The memo scripts only record material — corrections, answers to your questions, and unregistered terms the owner repeats — in `~/.local/state/vocab/`; no model writes a definition at session end. Once a week (from `/weekly-review`, or when the owner asks), turn that material into proposals:

```bash
~/.agents/scripts/vocab.ts propose --weekly
```

1. It writes the proposals that need no judgment (a `refers_to` that no longer exists, an owner-invoked skill with no term) and prints a packet: the week's excerpts, recurring terms, and the "Alternatives Considered" of this week's plans, plus how many more automatic proposals fit (at most five wait at a time).
2. For each item in the packet that shows the owner using a word in their own sense, draft one proposal with `add --draft --origin weekly` (it refuses once five automatic proposals are waiting). The definition says only what the excerpt shows; a term whose meaning the packet does not show is skipped, not guessed. A correction usually also means `distinct_from` the term that was misread.
3. Stop when the packet's remaining count reaches zero.
4. Reflect the owner's approvals and check the result:

```bash
~/.agents/scripts/vocab.ts apply
~/.agents/scripts/vocab.ts lint
```

## Apply and lint on request

`apply` turns proposals the owner set to `approved` into notes and archives rejected ones; `lint` exits 1 on errors. Run them outside the weekly flow only when the owner asks. Report `lint` errors verbatim; fix a note only through an `add` proposal.
