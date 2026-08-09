# save — capture the current conversation as a source

`save [title]` extracts what the current session established, writes it into `04_Literature/` as a conversation source, and compiles it.

This is the entry point that matters most day to day: the vault has 1,290 daily notes but only 14 links from them into `02_Notes/`, so insight from working sessions has never been reaching the concept layer.

## Working outside the vault

Development happens in other repositories. `save` resolves everything through `$VAULT` (from `LLM_WIKI_VAULT_ROOT`) as an absolute path and never depends on the working directory. It needs no Obsidian instance and no `obsidian` CLI — it writes files.

Validate `$VAULT` per [SKILL.md](../SKILL.md) before the first write — non-empty, absolute, and the expected directories present. An empty string is not "unset" and would resolve writes to the filesystem root.

## Arguments

| Form | Behavior |
|---|---|
| `/llm-wiki save` | Infer the title and subject from the conversation |
| `/llm-wiki save <title>` | Use the given title |

## When it applies

Worth saving: a concept or definition that got settled, a comparison with its axes, a design decision and the reasoning behind it, a trade-off analysis, a failure and what it taught, an important correction to something the vault already claims.

Not worth saving: short exchanges, clarifying questions, command logs, records of a decision that only matters to the task at hand, restatements of what the vault already holds.

When torn, do not save. It can be captured later.

## Step 1 — extract

Pull from the conversation what has standing value: established definitions, comparison tables and their axes, design decisions with rationale, trade-offs, corrections to existing notes, failures and lessons.

Leave out: back-and-forth that got superseded, preference checks, command output, confirmations of what was already known.

## Step 2 — decide whether to save

- Under roughly three lines of substance → do not save. Report "保存価値のある内容が見つかりませんでした" and stop. Never write an empty source file.
- Substance amounts only to a small addition to one existing note → `Edit` that note directly, move its `updated` to today, log it, and stop. No source file.
- More than that → continue.

## Step 3 — title

Use the argument when given. Otherwise name the central topic in 10–30 characters. Sanitize per the `obsidian-notes` skill. Check `04_Literature/` and `02_Notes/` for a collision and qualify with the date if needed (`LLM Wiki設計議論-<today>`).

## Step 4 — genre

Same logic as [ingest.md](ingest.md) A-2, and it works better here because the conversation states its own subject. Assign automatically; record confidence and rationale for the report. When the genre has no MOC, run [init.md](init.md) first.

`save` does not pass through `00_Inbox/` — triage exists for material that arrived without context, which is the opposite of this case.

## Step 5 — write the source

The conversation is the original, so what gets written is a cleaned-up record of the discussion, not a summary of it. Keep the question, the reasoning, the conclusion, and the grounds. Include code, numbers, and proper nouns verbatim when they appeared. Compressing this into a few lines destroys exactly what makes it worth having — structuring is the concept note's job, not this file's.

`$VAULT/04_Literature/<title>.md`:

```markdown
---
tags:
  - memo/conversation
  - clip/<Genre>
date: <today>
generated_pages: []
---

Claude Code セッション（<today>）の議論記録。

## Summary

- <確立した内容の要点>

## 議論

<問い → 検討 → 結論 → 根拠 の流れ。具体例・コード・数値は逐語で>

## Memo

- 📝
```

`memo/conversation` is a new tag, deliberately distinct from `memo/web`: this is not a clipping, and the maintenance Bases view that lists under-tagged clippings filters on `memo/web`, so conversations correctly stay out of it. The `## Summary` heading is kept so that `ingest`, `recompile`, and `query` read conversation sources the same way they read clippings.

**`type` is not set here.** If the run fails after this point, the file reads as uncompiled and the next `ingest` finishes the job.

## Step 6 — concept notes

Same as [ingest.md](ingest.md) B-1 through B-3, following [decision-rules.md](decision-rules.md).

Conversation-derived notes are usually `type: synthesis` — they integrate across sources by nature. Use `concept` when the session established a single idea with enough substance, or `entity` when it analyzed one specific tool.

## Step 7 — knowledge map

Same triggers as [ingest.md](ingest.md) B-5. Conversations surface cross-cutting tensions more often than articles do, so `## 横断テーマ` earns an addition here more frequently.

## Step 8 — finish, in this order

1. Update the MOC if Step 7 fired.
2. Add `type: source` to the source's frontmatter and fill `generated_pages` with the notes from Step 6.
3. Append to `$VAULT/98_Maintenance/logs/<MOC> 操作ログ.md`:

```markdown
## <today>

- save: [[<タイトル>]]（会話由来）
  - 新規: [[ノートA]]
  - 更新: [[ノートB]]（<理由>）
```

## Completion report

Title, number of points extracted, notes created and updated, whether the knowledge map changed, and the genre call with its confidence.

## Edge cases

**The session is long and earlier context is gone.** `save` covers what is in context. For earlier discussion, write the source file by hand and run `ingest` on it.

**Several unrelated topics in one session.** Ask:

```
複数トピックを検出: 「A の設計」「B の比較」「C の問題」
→ 1つの synthesis にまとめる / トピックごとに save する / 主要トピックだけ save する
```

**A source on the same topic already exists.** Ask: new file with a dated slug, merge the new material into the existing source, or skip.

## Choosing between the three entry points

| Verb | Source | Use for |
|---|---|---|
| `ingest` | Clipped articles, URLs, inbox files | External writing |
| `save` | The current conversation | Discussion, analysis, design decisions |
| `recompile` | Already-compiled sources | Maintenance after a structural change |
