# Proposals

The quarantine that `lint` and `curiosity` write into. Where `ingest` / `save` / `recompile` write to the vault directly, these two verbs generate text the model chose to generate, so it lands as a file, gets reviewed, and only then reaches a note.

## Layout

```
$VAULT/98_Maintenance/proposals/<MOC>/
├── <YYYY-MM-DD>__<kind>__<origin>-<serial>.md   # pending
├── applied/
└── rejected/
```

Directories are created lazily on first write (`mkdir -p`). `init` does not pre-create them.

`<serial>` is a per-day, per-origin counter. Before writing, `Glob "$VAULT/98_Maintenance/proposals/**/*.md"` across pending, `applied/`, and `rejected/`, then take the highest serial for that date and origin plus one. Including the archives is what makes re-runs after a partial failure safe.

## Frontmatter

```yaml
---
type: proposal
origin: curiosity | lint
kind: new-page | append | contradiction | contradiction-found | missing-page | stale-fix | link-fix | orphan-fix | weak-relation | ingest-incomplete
target: "[[対象ノート]]"
status: pending | applied | rejected
risk_flags: []
confidence: high | medium | low
cross_genre: ["<MOC1>", "<MOC2>"]
created: YYYY-MM-DD
applied: YYYY-MM-DD
rejected: YYYY-MM-DD
---
```

Required: `type`, `origin`, `kind`, `target`, `status`, `confidence`, `created`. Optional: `risk_flags` (omit or `[]` when there is no risk), `cross_genre` (only when the proposal spans genres), `applied` / `rejected` (added on the corresponding transition).

`target` is always a wikilink. For `new-page` and `missing-page` it names the note that does not exist yet. For `ingest-incomplete` it names the source article.

New proposals are always `pending`.

Proposal files live outside `02_Notes/` and `04_Literature/`, so the human-vs-machine frontmatter split does not apply to them — this schema is self-contained.

## Body

```markdown
# 提案概要

<何を反映したいかを一行で>

## 起点

<curiosity: どの問いから生まれたか / 対象ノート>
<lint: どの検出項目か（例: 5a 欠落リンク）/ 検出箇所 file:line>

## 提案内容

<反映する文面そのもの。new-page なら本文全体、append なら追記テキスト、link-fix なら before/after>

## 信頼度・リスク

<risk_flags に応じた注意書き。空でも「critic 評価: OK」は書く>

## 根拠

- [[04_Literature の記事]]: <参照した記述>
- 既存 [[関連ノート]]: <対比・補強の関係>
```

`## 信頼度・リスク` is mandatory.

## Kinds

This table is canonical. `lint.md` and `curiosity.md` reference it rather than restating it.

| kind | origin | Proposes | Typical risk_flags |
|---|---|---|---|
| `new-page` | curiosity | A new synthesis note | `hallucination-possible` |
| `append` | curiosity | A new angle added to an existing note | `hallucination-possible` |
| `contradiction` | curiosity | A conflict between a note and a source | `judgment-required` |
| `contradiction-found` | lint | A conflict between two notes | `judgment-required` |
| `missing-page` | lint | A note for a concept referenced but never written | `hallucination-possible` |
| `stale-fix` | lint | An update to a note whose sources moved on | `judgment-required` |
| `link-fix` | lint | Plain text → `[[ノート]]`, including broken-link repair | — |
| `orphan-fix` | lint | Link sources for a note nothing points at | `judgment-required` |
| `weak-relation` | lint | A relation inferred from keyword overlap | `low-precision` |
| `ingest-incomplete` | lint | A missing log entry for a compiled source | `judgment-required` |

Starting confidence: `link-fix` is `high` (mechanically decidable); `missing-page` skews `low` (body text generated without reading the original); everything else is `medium` by default.

## Aggregated proposals

One proposal per finding is the default, and it is what the apply semantics above assume. A full-vault `lint` breaks that assumption: observation 5a alone can produce hundreds of hits, and hundreds of files make the review unusable.

When an observation's findings run past roughly 20, write **one aggregated proposal for that observation** instead:

- `target` names the genre MOC rather than a single note (`target: "[[Obsidian]]"`), since no one note is the subject
- The body groups the findings by cause and states what to do with each group, rather than listing every hit — the full list lives in the `lint` report file, which the proposal cites
- `apply` on an aggregated proposal is **not mechanical**. It means working through the groups with the user; the proposal stays `pending` until all of them are resolved, then moves to `applied/`
- Aggregated proposals never qualify for `apply-all-safe`, regardless of `risk_flags`

The trade is deliberate: individual proposals are mechanically appliable but drown the reviewer; aggregated ones are reviewable but need a human to walk them. Pick by count.

## Risk flags

| Flag | Meaning | Review stance |
|---|---|---|
| `hallucination-possible` | Body text was generated; parts may not trace to a source | Verify against `## Summary` or the external URL before applying |
| `judgment-required` | More than one reasonable resolution exists | Edit the proposal to the chosen resolution, then apply |
| `low-precision` | The detector is known to over-fire | Expect to reject most of these |

`confidence` is a separate axis: risk flags say what kind of risk exists, confidence says how sound the proposal itself looks. Show both during review.

## Cross-genre proposals

When a proposal spans genres, count the genres of the `[[notes]]` it mentions and file it under the most frequent one. Ties go to the sampled note's genre for `curiosity`, and to the detected note's genre for `lint`. Record the other genres in `cross_genre` so a misfiling is visible and correctable later.

## Apply semantics

| kind | What apply does |
|---|---|
| `new-page` | Create `02_Notes/<name>.md` from the conventions template. Update the MOC's `## 知識マップ` only if a structural trigger fires |
| `append` | Edit the target note, adding to the named section or the end of the body |
| `contradiction` / `contradiction-found` | Edit the target, or add `## 異論・補足` presenting both positions. Add the new source to `sources` |
| `missing-page` | Same as `new-page`, but re-confirm with `AskUserQuestion` first — the body was written without reading the original |
| `stale-fix` | Edit the named section |
| `link-fix` | Replace the plain text with `[[ノート]]` via Edit (old_string / new_string; the recorded `file:line` is a pointer, not the matcher) |
| `orphan-fix` | Add `- [[孤立ノート]] — <理由>` to the link source's `## 関連ページ`, and to its `related` |
| `weak-relation` | Add reciprocal links to both notes' `## 関連ページ` and `related` |
| `ingest-incomplete` | Write the missing log entry from the source's `generated_pages`. If that field is empty, do not guess — leave the proposal `pending` and point the user at `recompile` |

After any apply: move the target's `updated` to today, append to `98_Maintenance/logs/<MOC> 操作ログ.md`, set `status: applied` with `applied: <today>`, and `mv -n` the proposal into `applied/`.

`append`, `contradiction`, `stale-fix`, `orphan-fix`, and `weak-relation` respect the existing body structure — they add and amend, never replace a whole section. When a proposal seems to want a rewrite, `edit` it first.

## Review flow

Fires at the end of `lint` / `curiosity`.

**Step 1** — after writing the files, ask:

```
<N>件の提案を保存しました。
  ⚠️ リスクあり: <M>件
  ✓ リスクなし: <N-M>件

今レビューしますか?
  - yes: 順番にレビュー
  - later: 後で。次回 lint/curiosity 起動時にリマインド
  - apply-all-safe: リスクなしのみ全件 apply
```

**Step 2** — on `yes`, show one at a time, risky first:

```
[<i>/<N>] <アイコン> <kind>: <target> (genre: <MOC>)
  origin: <curiosity | lint>
  risk_flags: <list> | confidence: <level>

<本文プレビュー>

選択:
  - apply / edit / skip / reject / quit
```

Icon: `⚠️` when `hallucination-possible` or `judgment-required` is present, `?` when only `low-precision`, none when there is no risk flag.

**Step 3** — report applied / edited / skipped / rejected counts and where the remaining pending proposals sit.

Under `apply-all-safe`, when more than 10 targets are queued, pause every 5 to confirm.

**Before any bulk apply, confirm a current backup exists.** Apply edits `02_Notes/` directly and the vault has no Git history; a backup taken before the last `ingest` does not cover notes written since. Same bar as [ingest.md](ingest.md) sets for backfill.

## Pending reminder

`lint` and `curiosity` both open by scanning `98_Maintenance/proposals/` for pending files:

```
⚠️ pending な提案が残っています:
  - proposals/アクセシビリティ/: <N>件 (⚠️<M>件)

先にレビューしますか?
  - yes / no
```

On `yes`, run the Step 2 flow over them before starting the new cycle.

## Safety

- `reject` is a `mv -n` into `rejected/` after setting `status: rejected` and `rejected: <today>`. Nothing is deleted — the vault has no Git history to recover from.
- `skip` leaves the file `pending` so the next run surfaces it again.
- Proposals never bypass review, no matter how mechanical the change looks.
