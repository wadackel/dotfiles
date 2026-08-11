# Writing conventions

Rules every note touched by `llm-wiki` follows.

## Language of generated content

Note titles and bodies are written in **Japanese**. Identifiers inside code blocks, commands, URLs, product names, and technology names stay in their original form.

## Frontmatter: two disjoint field sets

The vault splits frontmatter into fields the user owns and fields this skill owns. Crossing the line in either direction is a defect.

| Set | Fields | Who writes |
|---|---|---|
| Human | `aliases`, `tags`, `description` | The user only |
| Machine | `type`, `sources`, `related`, `updated`, `generated_pages` | `llm-wiki` only |

The `obsidian-notes` skill instructs agents to leave `aliases` / `tags` / `description` empty when creating notes. That rule stands unchanged — it governs the human set. Machine fields are a separate category and are exempt from it.

Read the existing frontmatter before editing and write back the human fields byte-identical, including empty values and trailing spaces.

### Concept notes (`02_Notes/`)

```yaml
---
aliases:
tags:
description:
type: concept | entity | comparison | synthesis | moc | term | memo | record
sources: ["[[記事タイトル1]]", "[[記事タイトル2]]"]
related: ["[[関連ノート1]]", "[[関連ノート2]]"]
updated: YYYY-MM-DD
---
```

`genre` is not stored: the wikilink to the parent MOC on the first body line already carries it. `created` is not stored either — `file.ctime` is what the Bases views already sort by.

| `type` | Use for |
|---|---|
| `concept` | Abstractions, theories, techniques |
| `entity` | Concrete tools, products, people |
| `comparison` | Side-by-side comparisons |
| `synthesis` | Cross-source integration — the payoff of the whole system |
| `moc` | MOC notes (both tiers) |
| `term` | A term card — one definition, no synthesis. A candidate for absorption into a `concept` note |
| `memo` | A first-person working record with reuse value: tool verification, a procedure that worked. Material for a future compile |
| `record` | Tied to one project at one point in time — design docs, interview notes, incident notes. **Permanently excluded from the knowledge path** |

`term` / `memo` / `record` describe notes the user wrote before the compile layer existed. Only `/llm-wiki` writes them, same as every other machine field.

Three values, not five, because **a value earns its place only when the system treats it differently**: `term` is an absorption candidate, `memo` is compile material, `record` is excluded. Tool-verification notes and how-to notes were deliberately merged into `memo` — their consumer is identical, and the boundary between them ("is a record of getting QuickJS to run a verification or a procedure?") is ambiguous enough to make classification drift between runs. An inconsistent machine field is worse than a coarse one: it looks like structure and cannot be trusted.

Classify by **reuse value, not document form**. A design doc is a serious technical document, but it is bound to one project at one moment, so it is `record`. Whatever is universal inside it gets extracted into a concept note — the doc itself is never wired into the knowledge path.

Do not bulk-assign `term` / `memo` by filename heuristics. A trial run put MOCs, tool notes, and project notes in the same bucket. Classify incrementally, when a compile run touches the note anyway.

### Sources (`04_Literature/`)

```yaml
---
tags:
  - memo/web
  - clip/<Genre>
date: YYYY-MM-DD
type: source
generated_pages: ["[[概念ノートA]]", "[[概念ノートB]]"]
---
```

`tags` and `date` are pre-existing Web Clipper output — do not touch them. `type: source` and `generated_pages` are added by `ingest`.

`generated_pages` lists every concept note this source touched, whether created, updated, or split out. It is the reverse of the concept note's `sources` field, and `recompile` reads it to find what to re-process.

### `type` is the compile-completion marker

For files under `04_Literature/`, the presence of `type: source` is the **only** signal of compile state. Do not grep the log for it — quoting and Unicode normalization make that unreliable.

| State | `type` | Meaning |
|---|---|---|
| Uncompiled | absent | Target of the next `ingest` |
| Compiled | `source` | Done. Re-process with `recompile` |
| Shelved | `parked` | Triaged and deliberately skipped — no concept note can host it. Terminal |

`parked` exists because `type: source` is the only completion marker: without a second terminal state, an article nobody will ever compile stays in the uncompiled set forever and returns to every triage. Record the reason in the operation log, not in frontmatter — the reason is a sentence, not a field. `wiki-doctor.ts` excludes both `source` and `parked` from its uncompiled count.

Never write `type: source` by hand — doing so hides the file from `ingest` forever.

## Sources hold a summary, not the original text

Upstream LLM Wiki keeps raw source text. This vault does not: `04_Literature/` articles are Web Clipper output whose body is a `## Summary` list plus an empty `## Memo` section, and the original text was never captured.

Consequences:

- `ingest` reads `## Summary` — that is the source of record. Do not attempt to re-fetch the original to replace it.
- When a verbatim quote, a statistic, or a code sample is needed, follow the `[title](url)` link on the article's first body line to the original. `query` has a branch for this.
- Anything a concept note asserts must be traceable to the `## Summary` or to the external URL. If it is traceable to neither, it does not belong in the note.
- `## Memo` is the user's own commentary. Read it — it is signal about what they took from the article — but never write into it.

## Wikilinks

- Reference by filename only: `[[ノート名]]`. Never relative paths.
- Alias display: `[[ノート名|表示テキスト]]`. Section: `[[ノート名#見出し]]`.
- Both `02_Notes/` and `04_Literature/` are flat, and Obsidian resolves by filename, so the same syntax reaches either.

## Filenames

Follow the `obsidian-notes` skill for filesystem-safe characters — the vault syncs to iOS and Android, where `< > : " / \ | ? *` break sync.

Beyond that:

- Avoid spaces where a compound word reads fine without them; wikilinks are more stable that way.
- `02_Notes/` is flat, so a new concept note can collide with one of the existing notes. Before creating, `Glob "$VAULT/02_Notes/<name>.md"`. On collision, disambiguate by qualifier rather than by number: `インデックス_RDB.md`, not `インデックス2.md`.

## Concept note body

```markdown
[[親MOC]]

> [出典タイトル](URL)

<2〜5行の要旨>

## <本論の見出し>

<内容>

## 関連ページ

- [[関連ノート1]] — <一行説明>

## ソース

- [[04_Literature の記事タイトル]]
```

No `#` heading — the filename is the title. The first body line is a wikilink to the parent MOC, matching the existing notes.

**The quote block is for single-source notes only.** A note distilled from one article carries `> [出典タイトル](URL)` so the reader lands on the original in one hop. A `synthesis` note built from many sources omits it — there is no single original to point at — and goes straight from the parent MOC link to the 2–5 line summary. The summary is required in both cases.

**Frontmatter is canonical; the body sections are a reading aid.** `sources` and `related` list everything; `## ソース` and `## 関連ページ` list the entries a reader would actually want to follow, which for a note built from a dozen articles is a subset. `query` traverses the frontmatter, so completeness lives there. The rule applies to the `## 関連ページ` and `## ソース` sections only: a wikilink listed there but absent from `related` / `sources` is a defect. Inline links in the prose are free — they are how a note reads, not how it is traversed, and forcing every one of them into `related` would make the field meaningless.

**The parent MOC is the note's genre.** When a note is produced by compiling genre X but conceptually belongs under genre Y, the first line names Y and the log entry stays in X's log. Record the discrepancy in the log entry so the split is visible.

## MOC notes

Two tiers, with different responsibilities.

**Tier 1** — the 12 MOCs linked from `Home.md` (`Engineering`, `Design`, `Career`, …). Hand-maintained topic lists. This skill adds at most a `## 横断テーマ` section and otherwise leaves them alone.

**Tier 2** — MOCs that articles hang off directly (`アクセシビリティ`, `AI`, `TypeScript`, …). Structure:

````markdown
[[親MOC]]

- [[子ノート1]]
- [[子ノート2]]

## 知識マップ

- **<カテゴリ>**
    - [[ノート]] — <一行説明>

## 横断テーマ

- **<テーマ名>**: <3ページ以上で扱われる論点・対立軸>

## Notes

```base
views:
  - type: table
    name: Table
    filters:
      and:
        - file.name.contains("<MOC名>")
        - file.name != "<MOC名>"
        - file.folder == "02_Notes"
    sort:
      - property: file.ctime
        direction: DESC
```

## Articles

```base
views:
  - type: table
    name: Table
    filters:
      and:
        - file.hasTag("clip/<Tag>")
    sort:
      - property: date
        direction: DESC
```
````

The two Bases views are a self-updating convenience catalog, so **no separate index file is ever created**. They are not complete, and the difference matters when deciding where a new note has to be listed.

`## Articles` is reliable — it filters on the `clip/*` tag, which every clipped article carries. `## Notes` is not: it filters on substrings of the filename, so a note whose title shares no keyword with the genre never appears no matter how central it is. A 2026-08-12 audit found `不変条件と整合性境界`, `機械強制できる担保とその境界`, and `律速の移動と待ち行列` all invisible in their parent's view for this reason.

**`## 知識マップ` is therefore the authoritative catalog for concept notes**, and a new note that the `## Notes` filter does not match must be listed there or it is unreachable. Two fixes were tried and rejected:

- *Extend the keyword list.* `エンジニアリング組織` is already at 19 keywords and grows with every note.
- *Filter on `file.hasLink("<MOC>")` instead.* The parent link is a tree edge, not a genre label. Piloted on `アーキテクチャ`: it gained the 9 missing notes but dropped 37, including `Reactのコンポーネント設計` (parent `[[React]]`), `単一責任の原則` (parent `[[SOLID]]`), and the whole `プログラミングの原則・法則` family — genuine members of the genre that sit one hop further down. Grandchildren are invisible to `hasLink`.

**Never wrap the knowledge map in a code fence.** Obsidian does not resolve `[[...]]` inside fenced blocks or inline code, so a fenced tree turns the genre's entire navigation into inert text — the opposite of what the map is for. Use nested bullets. The same rule is why [lint.md](lint.md) observation 7 excludes code spans when counting unresolved links.

`## 知識マップ` is updated only when the genre's structure changes: a new category appears, a category grows past ~3 notes on one sub-theme and wants splitting, a split promotes a new parent concept, or a new tension belongs in `## 横断テーマ`. A single new note that fits an existing category is not a structural change. When unsure, do not update.

### Naming a MOC

Follow the existing vault: Japanese where Japanese reads naturally (`アクセシビリティ`, `テスト`, `作業ログ`), the original form for product and technology names (`TypeScript`, `Claude Code`, `GitHub Actions`). The MOC name and the `clip/*` tag need not match — `clip/A11y` maps to `アクセシビリティ`.

## Operation log

`98_Maintenance/logs/<MOC> 操作ログ.md`, one file per genre, append-only.

**The ` 操作ログ` suffix is load-bearing.** Naming the log after the MOC alone puts two files with the same basename in the vault, and Obsidian resolves a wikilink to the copy nearest the linking file — so `[[アクセシビリティ]]` written inside the log would resolve to the log itself, not the MOC. Same for any proposal that targets a genre.

**Single-source form** — one article ingested on its own:

```markdown
## YYYY-MM-DD

- ingest: [[記事タイトル]]
  - 新規: [[ノートA]], [[ノートB]]
  - 更新: [[ノートC]]（<理由>）
  - 分割: [[元ノート]] → [[新ノート]]
  - 知識マップ更新: <理由>（該当時のみ）
```

**Batch form** — a whole genre compiled at once (`ingest <tag>`, and the backfill in general). Writing one entry per article would produce hundreds of lines, so the batch is recorded as a single entry naming the count and the notes produced:

```markdown
## YYYY-MM-DD

- ingest: `clip/<Tag>` <N> 本を一括 compile
  - 新規: [[ノートA]], [[ノートB]], ...
  - 更新: [[ノートC]]（<理由>）
  - 知識マップ更新: <理由>（該当時のみ）
  - 全 <N> 本に `type: source` と `generated_pages` を付与。未接続の記事は <M> 件
```

The batch form deliberately omits per-article wikilinks. Traceability back to the individual article lives in that article's `generated_pages` field, which is what [lint.md](lint.md) observation 6 checks against — do not make the log the source of truth for per-article completion.

Never delete old entries. `curiosity` builds its exclusion set from these files, so the granularity matters: what happened, to which note, and why.

## Dates

`YYYY-MM-DD`, taken from `date +%Y-%m-%d`. On update, move `updated` to today and leave everything else.

## Prohibited

- Writing to `aliases`, `tags`, or `description`
- Writing into a source's `## Summary` or `## Memo`
- Creating an index file per genre (the Bases views are the catalog)
- Creating genre subdirectories under `02_Notes/` or `04_Literature/` (existing Bases filter on `file.folder == "02_Notes"`)
- Relative-path wikilinks
- Setting `type: source` anywhere other than the final step of `ingest` ([ingest.md](ingest.md) B-6) or `save` ([save.md](save.md) Step 8)
- Writing a literal `[[wikilink]]` into prose that is *describing* link syntax rather than linking — wrap it in backticks, or the maintenance artifact creates the unresolved links it reports
