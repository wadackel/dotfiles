# init — create a genre

`init <tag>` turns a `clip/*` tag into a genre by creating its tier-2 MOC note and its log file, and linking it from a tier-1 MOC.

There is no `init _root`: the vault, `Home.md`, and the 12 tier-1 MOCs already exist.

Most `clip/*` tags in this vault have no MOC yet, so this is the verb `ingest` calls most often during backfill.

## Argument

The `clip/*` tag, with or without the prefix — `init clip/Team` and `init Team` are the same. Case is taken from the tag as written in the vault.

**Tagless mode**: the argument may instead be a genre name that no `clip/*` tag backs. Books in `03_Books/` carry no genre tag and cannot be given one — `tags` is a human field — so a genre that exists only for books is created this way ([books.md](books.md)). Which genres are still missing changes as books get compiled, so check at run time rather than trusting a list here.

Decide which mode you are in *before* preflight, from whether a `clip/*` tag matching the argument exists. Do not fall into tagless mode because a `Grep` for the tag came back empty by accident — say which mode you chose and why.

## Preflight

1. `date +%Y-%m-%d` for `<today>`.
2. Confirm the tag actually exists on articles, using the `Grep` tool with the tag as a literal pattern. Do not interpolate the tag into a shell command — it can come from article content ([SKILL.md](../SKILL.md) Safety). Zero hits means a typo: report the closest existing tags and stop. **Skipped in tagless mode** — there is no tag to confirm.
3. Decide the MOC name (see below), then check for a collision against **both** `Glob "$VAULT/02_Notes/<MOC>.md"` and `03_Books/` (`Glob "$VAULT/03_Books/*.md"` and `"$VAULT/03_Books/*/*.md"`). The second target matters in tagless mode, where the name is derived from the books that will hang off the genre, so it can land on a book's own filename — and `wiki-doctor` fails on that collision ([books.md](books.md)). If the note already exists, do not overwrite. Either it is already this genre's MOC (report "already exists" and stop) or it is an unrelated note with the same name (pick a qualified name and continue).
4. Confirm no other MOC already claims the tag, again with the `Grep` tool. A hit means the genre exists under a different name — report it and stop. **In tagless mode**, check instead that no existing MOC already covers the subject; a near-synonym of an existing genre is a reason to stop and use that one.

## Naming the MOC

Per [conventions.md](conventions.md): Japanese where Japanese reads naturally, the original form for product and technology names. The MOC name does not have to match the tag — `clip/A11y` → `アクセシビリティ`, `clip/Team` → `チーム`, `clip/TypeScript` → `TypeScript`.

Derive the name from what the tagged articles are actually about, not from a literal translation of the tag. Read the titles of 5–10 tagged articles before deciding. In tagless mode, derive it from the books that will hang off it — read their index notes.

## Choosing the parent MOC

Read `$VAULT/Home.md` for the 12 tier-1 MOCs, then read the 2–3 plausible candidates to see how each one groups its children. Pick one. When nothing fits, `Engineering` is the fallback for technical genres and `Interests` for everything else.

## Files created

### `$VAULT/02_Notes/<MOC>.md`

````markdown
---
aliases:
tags:
description:
type: moc
updated: <today>
---
[[<親MOC>]]

## 知識マップ

<!-- ingest がジャンルの構造を把握したら、ネストした箇条書きで埋める。
     コードフェンスで囲まないこと — フェンス内の [[...]] は解決されない -->

## 横断テーマ

<!-- 3ノート以上で扱われる論点・対立軸が見えたら追記する -->

## Notes

```base
views:
  - type: table
    name: Table
    filters:
      and:
        - file.name.contains("<MOC>")
        - file.name != "<MOC>"
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

The human fields stay empty — the user fills `aliases` when the genre needs one.

**In tagless mode, omit the `## Articles` view entirely.** Its only filter is `file.hasTag("clip/<Tag>")`, and there is no tag — an empty view that can never fill is worse than no view. There is no book equivalent to add in its place: books carry `memo/book` with no genre component, so a per-genre book view cannot be expressed. The genre's books are reachable through its concept notes' `sources`, and through the `Books` MOC's own catalog. Should a `clip/*` tag for the subject appear later, add the view then.

`file.name.contains("<MOC>")` is a substring match, so a short or common MOC name pulls in unrelated notes. When the name is short (roughly 3 characters or fewer) or is a common substring, use `containsAny` with the specific forms instead, the way `アクセシビリティ` does:

```
- file.name.lower().containsAny("アクセシビリティ", "a11y")
```

### `$VAULT/98_Maintenance/logs/<MOC> 操作ログ.md`

```markdown
[[<MOC>]]

操作ログ。追記専用。

## <today>

- init: ジャンル作成（tag: `clip/<Tag>`, 親: [[<親MOC>]]）
```

In tagless mode the tag field reads `tag: なし（書籍のみ）` instead.

`mkdir -p "$VAULT/98_Maintenance/logs"` first. No frontmatter — this is bookkeeping, not a note.

`98_Maintenance/proposals/<MOC>/` is **not** created here. `lint` and `curiosity` create it lazily.

## Parent MOC update

Add `- [[<MOC>]]` to the parent's list, under the section where its siblings sit (`## ジャンル`, `## MoC`, or whichever the parent uses). Match the surrounding style — some parents annotate, most do not.

Do not touch the parent's frontmatter beyond leaving it as-is. Tier-1 MOCs are hand-maintained.

## Completion report

List the files created, the parent MOC, the tag, and the article count the genre starts with. Close with the next command: `/llm-wiki ingest` compiles the genre's articles. In tagless mode, say so explicitly, name the books the genre was created for, and note that the `## Articles` view was omitted.

## Idempotence

`init` writes three things: the MOC, the log, the parent link. Each is checked before writing, so a re-run after a partial failure completes the missing pieces without duplicating the others.
