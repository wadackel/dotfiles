# recompile — re-process a compiled source

`recompile <path>` re-evaluates a source that already carries `type: source` against the current state of the vault. It updates concept notes and the source's frontmatter. The source body is never touched.

Maintenance only. Normal operation does not use this verb.

## When it applies

- The genre's `## 知識マップ` evolved and older sources should be placed against the new structure
- [decision-rules.md](decision-rules.md) changed and something previously judged "do not save" deserves another look
- A concept note was split, and sources whose `generated_pages` point at the old note need updating
- The frontmatter schema changed

## Argument

The path is required. There is no bulk mode — an unattended sweep across a compiled backlog would rewrite a large part of the concept layer with no review, and the vault has no Git history to fall back on. To re-process several files, loop explicitly and check each result.

```
/llm-wiki recompile 04_Literature/10Xのテストコード規約 - 10X Product Blog.md
```

## Preflight

`Read` the file and confirm:

- It is under `04_Literature/`, or it is an index note under `03_Books/` ([books.md](books.md)). A path in `00_Inbox/` means the genre is undecided — point at `ingest` and stop. A chapter note is not a target.
- `type: source` is present. Without it the file was never compiled — point at `ingest` and stop.
- It carries a `clip/*` tag whose MOC exists. Without a MOC, run [init.md](init.md) first. Books carry no tag; check instead that the MOCs their `generated_pages` notes hang off still exist.

Books are the common case for this verb rather than the rare one. A clipped article is fixed once saved, but a reading note grows every time the book is re-read — `recompile` is how those additions reach the concept layer. Never strip `type` to force a re-`ingest` instead: that discards `generated_pages`, which is exactly what step 1 below needs.

## Flow

### 1. Recover the previous result

Read `generated_pages` — that is the record of what the last compile touched. When it is missing (a source compiled before the field existed, or by hand), fall back to `98_Maintenance/logs/<MOC> 操作ログ.md` and search for the source's title.

When neither yields anything, say so and stop rather than guessing. A recompile that cannot see what it produced last time will duplicate content.

### 2. Refresh the vault state

As [ingest.md](ingest.md) B-1: read the MOC, `Grep` `02_Notes/` for related notes.

### 3. Re-extract

From the source's `## Summary` and `## Memo`, re-evaluate where the material sits in the current structure. The summary has not changed — what changed is the vault around it.

### 4. Diff

| Previously | Now | Action |
|---|---|---|
| Created note A | A has since been merged elsewhere | Nothing. The user's reorganization stands |
| Updated note B | More to add | `Edit` to append |
| Not mentioned | A relation to C is now visible | `Edit` C and add it to `related` |
| Split D → E | E was merged into F | Repoint `generated_pages` from E to F |

**The user's organization of the concept layer wins.** `recompile` does not recreate notes it made before, and does not overwrite how things were rearranged. It appends and it strengthens links.

### 5. Knowledge map

Same triggers as [ingest.md](ingest.md) B-5, applied more strictly. `recompile` exists to respect the existing structure; when in doubt, leave the map alone.

### 6. Source frontmatter

Rewrite `generated_pages` to match reality and fix broken links in it. Sources carry no `updated` field ([conventions.md](conventions.md)) — do not add one. The body — `## Summary`, `## 議論`, `## Memo`, and for a book every chapter note — is not touched.

The concept notes touched in step 4 do get their `updated` moved to today.

### 7. Log

```markdown
## <today>

- recompile: [[<記事タイトル>]]
  - 更新: [[ノートB]], [[ノートC]]（<理由>）
  - リンク修正: [[ノートD]] → [[ノートE]]
```

## Safety

- **No new notes by default.** When the re-extraction surfaces a genuinely new concept, ask before creating it.
- **No destructive rewrites.** `Edit` to append only. Replacing a whole section needs confirmation.
- **One file at a time.** Report each result before moving on.
- Category reorganization is out of scope. That belongs to manual editing or to acting on `lint` findings.

## Completion report

The source re-processed, the notes updated, links repaired, and anything needing a decision (new concepts found, structural change suggested).

## Against ingest

| | `ingest` | `recompile` |
|---|---|---|
| Target | Sources without `type` | Sources with `type: source` |
| No-argument mode | Yes | No — path required |
| Creates notes | Actively | Only after confirmation |
| Edits existing notes | Appends, splits when warranted | Appends and cross-links only |
| Knowledge map | Updates on trigger | Stricter; prefers not to |
| Purpose | Daily operation | Maintenance |
