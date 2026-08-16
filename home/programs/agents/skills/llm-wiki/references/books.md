# books — compiling reading notes from `03_Books/`

`03_Books/` holds the user's own reading notes. They are sources in the same sense `04_Literature/` articles are — `ingest` compiles them into concept notes, `type: source` marks them done, `generated_pages` records what they produced — but almost every other property is inverted, and this file exists so the two never get read under the same assumptions.

The user's own account of the workflow lives in `02_Notes/読書メモの作り方.md` and `02_Notes/読書のやり方.md`. Step 4 of the latter — "特に面白い部分については、自分の知見まとめノートにカテゴリごとに整理する" — is exactly what this file automates. Read both before compiling; they are the constraint, not background reading.

## The safety premise is inverted

`04_Literature/` is text from the open web, so [SKILL.md](../SKILL.md) treats it as untrusted input. A book is the opposite: it is the user's own writing, it is not recoverable from anywhere, and the vault has no Git history.

There is no prompt-injection concern here. There is a data-loss concern, and it is worse.

- **Never rewrite a body.** Not the index note's, not a chapter note's. Only the index note's frontmatter changes.
- **Never touch a chapter note's frontmatter.** Chapter notes carry none at all today, and the QuickAdd workflow the user built assumes they never will.
- This is the one rule `wiki-doctor` can settle mechanically: run it with `--baseline` and it fails if any chapter note drifted by a single byte. Without `--baseline` the check reports `未検証` — it does not pass, because nothing was compared.
- `rating`, `date`, `aliases`, `tags` are human fields ([conventions.md](conventions.md)). Read them; do not write them.

## The compile unit is the book

Two shapes exist, both created from `Book_Index_Template`:

```
03_Books/本タイトル.md                 # 単一ファイル
03_Books/本タイトル/本タイトル.md       # インデックス + 章ノート
03_Books/本タイトル/章N.md
```

**The index note is identified by path, not by content:**

- `03_Books/<name>.md` — a direct child of `03_Books/`
- `03_Books/<dir>/<dir>.md` — the file whose basename equals its parent directory

Everything else under `03_Books/` is a chapter note. All 14 book directories follow this rule.

Do **not** identify the index note by "has frontmatter" or a chapter note by "has none". That happens to be true today and stops being true the first time the user adds a property to one chapter. The path predicate does not have that failure mode.

Only the index note carries `type: source` and `generated_pages`. Chapter notes are body text that `ingest` reads and never writes.

`04_Literature/どうしてあなたの共通化は間違っているのか/` is **not** a precedent for this. It is a Qiita article series, and all six of its files carry `type: source` — the opposite arrangement, produced by an explicit single-path compile.

## What to read, in priority order

1. **Callouts** (`> [!...]`) — the user's own words. `読書メモの作り方.md`: 「本に記載のない自分の言葉は Callout で残す」. Highest signal.
2. **Blockquotes** (`> `) — passages the user chose to copy out. What they chose is itself signal.
3. **Bullet-list body** — the user's summary of the book's structure. This is the bulk of the material and the part concept notes need most.
4. **`## モチベーション`** — why the book was picked up. A clipped article never carries this; use it as context for what the user was trying to solve, not as a claim to record.

Callouts are the top of the list but not the majority of the material: 117 of them across 26 files, out of 76 files total. Fifty files have none. Treating callouts as the only signal means reading two thirds of the vault's reading notes and extracting nothing.

Everything a concept note asserts must trace to the reading note. The book's own text is not in the vault — do not fill gaps from model knowledge, and do not fetch anything to fill them.

## Genre

Books carry no `clip/*` tag, and they cannot be given one — `tags` is a human field. Infer the genre from content.

- **One to three genres per book.** The single-genre rule for articles comes from the tag being singular; it does not apply here. `解像度を上げる` is 思考のフレームワーク and プロダクト; `スタッフエンジニア` is Career and Management.
- When no tier-2 MOC fits, run [init.md](init.md) in its tagless mode first. Several books need this — check which of them actually lack a MOC at compile time rather than trusting a list here, since each run creates some.
- The `Books` MOC is a tier-1 catalog whose Bases view already lists every `memo/book` note. **Write nothing to it.**

## The knowledge map is not optional here

`ingest.md` B-5 says to update `## 知識マップ` only when the genre's structure changed. **That does not apply to book-ingest.**

`wiki-doctor.ts` check 11 requires every `type: concept` note to be reachable from `Home.md` through body links alone, and the vault currently passes it. A new concept note that no MOC body lists fails it. Following B-5 across a book backfill would break the check by construction.

So: **every concept note created by book-ingest is listed in its parent MOC's `## 知識マップ`** (or the MOC's child list) in the same run that creates it. `## 横断テーマ` keeps B-5's original discipline — add to it only when a genuine tension across three or more notes appears.

## Source frontmatter

```yaml
---
aliases:
tags:
  - memo/book
date: YYYY-MM
rating: N
type: source
generated_pages: ["[[概念ノートA]]", "[[概念ノートB]]"]
---
```

Some books have no frontmatter block at all. Create one containing `type` and `generated_pages` only — **do not invent `tags`, `date`, or `rating`**. The body below it stays byte-identical.

As everywhere else, `type: source` is written last, after the notes and the log ([ingest.md](ingest.md) B-6).

`type: parked` applies to books too, and reading notes reach it more often than articles do: a book whose memo is a chapter-heading skeleton, or a link plus a publisher's blurb, has no claim a concept note could carry. Park it, record why in the log, and it stops returning to every run. Removing the `type` later is all it takes to pick it back up.

## Reading notes are mutable

A clipped article is fixed once saved. A reading note is not: re-reading a book adds callouts to it years later. `type: source` is still the completion marker, but it means "compiled as of then", not "finished forever".

When a book's notes have grown since its compile, use `recompile <path>`. Do not strip `type` to force a re-`ingest` — that loses `generated_pages`, which is what `recompile` reads to avoid duplicating content.

## Wikilinks into `03_Books/`

`conventions.md` forbids relative-path wikilinks. Chapter notes are the exception: `03_Books/` is not flat, and `はじめに.md` exists in two books, so a bare `[[はじめに]]` resolves to whichever copy Obsidian finds nearest.

Link to a chapter note as `[[03_Books/解像度を上げる/はじめに|はじめに]]`. The user already writes them this way. Link to an index note by bare filename — those are unique across the vault.

Cite the book in `sources`, and the chapter in the body where a reader would want to verify a specific claim.

**`## ソース` lists the book's index note only.** Chapter links belong in the prose or in a heading, never in that section — `wiki-doctor` check 9 requires every `## ソース` entry to appear in frontmatter `sources`, and chapter notes never do.

## Batch size and order

**One book per batch.** Report and wait before the next one.

This is not the article backfill's economics. `ingest.md`'s "read only `## Summary`" is what keeps articles cheap; a book has no summary standing in for its content, so compiling one means reading its index plus up to eight chapter files — `スタッフエンジニア/第 2 章` alone is 36KB.

Order by `rating` descending. Seven books have no rating; put them last, and break ties by file size descending so the books with the most material come first.

## Invocation

| Call | Behavior |
|---|---|
| `/llm-wiki ingest` | **Books are not included.** Articles only |
| `/llm-wiki ingest books` | The book backfill, one book per batch |
| `/llm-wiki ingest 03_Books/<...>.md` | That one book |
| `/llm-wiki recompile 03_Books/<...>.md` | Re-process a book whose notes have grown |

The no-argument exclusion is deliberate. The article backlog is nearly drained, so without it the books would be most of what a bare `ingest` finds — and the "more than 30 targets, ask first" guard in [ingest.md](ingest.md) does not fire at the size of this shelf. A bare `ingest` would quietly start a whole-shelf run.

## Operation log

Use the batch form from [conventions.md](conventions.md), one entry per book:

```markdown
## <today>

- ingest: [[<本タイトル>]]（rating <N>, 章 <M> 本）
  - 新規: [[ノートA]], [[ノートB]]
  - 更新: [[ノートC]]（<理由>）
  - 知識マップ更新: [[ノートA]], [[ノートB]] を追加
```

**Write to the log of every MOC whose notes were created or updated** — not only the one whose knowledge map changed. [lint.md](lint.md) observation 6 checks that a source's `generated_pages` targets appear in that MOC's log; a note logged under the wrong genre reads as an incomplete compile forever.

For a book spanning several genres, put the full entry in the primary genre's log and a short entry naming only the relevant notes in each other genre's log.

## Completion report

Per book: the genres assigned and the confidence of each, notes created / updated, MOCs whose knowledge map changed, any genre created by `init`, and the chapter notes read. State explicitly that no chapter note was written to.
