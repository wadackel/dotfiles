# query — search the vault and answer from it

`query <question>` reads across the vault, synthesizes an answer, and cites it so the reader can verify the chain.

## Route

`Home.md` → MOC → concept notes → wikilinks (2 hops) → `Grep` as a fallback. No embeddings: freshness and auditability beat recall for a vault the user edits by hand.

### Read budget

At most **8 concept notes** per question. `Home.md`, MOC notes, and `Grep` calls do not count toward it.

### Parallel reads

Issue every read at the same dependency level in one message. Reading one file per round trip inflates latency and re-counts cached context each turn, for an identical set of files.

- **Level 1** — `Home.md` alone, to pick genres.
- **Level 2** — all candidate MOCs at once.
- **Level 3** — all selected concept notes at once.
- **Level 4+** — one level per wikilink hop; the notes within a hop go together.

## Step 1 — pick genres

Read `$VAULT/Home.md`. It lists the 12 tier-1 MOCs with a line of description each. Narrow to 1–3.

When nothing narrows: with a handful of plausible tier-1 MOCs, read them in parallel and stop at their child lists. Otherwise skip to the `Grep` fallback rather than reading everything.

## Step 2 — read the MOCs

In one message, read every candidate MOC. Also run `Grep -l "type: synthesis" "$VAULT/02_Notes/"*.md` in the same message — synthesis notes are the integration points and the Bases catalogs do not mark them.

From each MOC:

- `## 知識マップ` — where the question sits in the genre
- `## 横断テーマ` — the tensions that span notes. For "compare", "which should I use", or "what's the overall picture", this is the most valuable section in the vault
- The child list and the `## Notes` Bases view — candidate notes
- The `## Articles` view — which `clip/*` tag holds the underlying sources

Select at most **5** notes here. Priority: synthesis notes, then notes named in `## 横断テーマ`, then the rest.

## Step 3 — read the notes and follow links

Read the selected notes in one message. From `## 関連ページ` and inline `[[wikilinks]]`, pick the ones that actually bear on the question — do not walk every link. Each hop is one message, up to 2 hops.

**A wikilink does not show which directory it resolves to**, and three tier-1 MOCs link into `05_Private/` — so a link one hop from `Home.md` can be an identity document. Reading it fails at the permission layer ([SKILL.md](../SKILL.md) Safety). When that happens, report exactly `private のため参照しない`, **without naming the file**, and move on. Do not retry through Bash or another skill.

Steps 3 and 4 together add at most **3** more notes, for 8 total.

## Step 4 — Grep fallback

Only when: no genre could be identified, the MOCs showed nothing relevant, or the notes read turned out to be insufficient. Otherwise skip to Step 5.

Scope as tightly as possible (`$VAULT/02_Notes/*.md`, widening to `04_Literature/` only if the concept layer has nothing). `$VAULT/05_Private/` and `$VAULT/98_Maintenance/` are never searched — the first is out of scope entirely, the second holds unreviewed proposal drafts that must not be read as established knowledge. Try several forms of the keyword — Japanese, English, abbreviation, differing case.

Heavy reliance on this fallback means the MOCs' knowledge maps are behind. Note it in the report; `lint` proposes fixes.

## Step 5 — answer

Cite in three levels, inline, per claim:

1. **Concept note** — `[[ノート名]]` next to the claim it supports. Every specific fact, number, name, or date carries the note it came from. A citation list at the top is not a substitute.
2. **Source article** — `[[記事タイトル]]` from the note's `sources` field when quoting a fact or a figure.
3. **External URL** — for anything where currency matters, or for papers, announcements, and attributed statements.

**Source articles hold a Web Clipper summary, not the original text.** For a verbatim quote, a code sample, or a precise figure, the summary is not enough: follow the `[title](url)` on the article's first body line to the original and cite that. Say plainly when a claim rests on the summary alone.

Where two notes disagree, present both — "A says X, B says Y" — rather than silently reconciling them. Where the answer needs something the vault does not contain, say "Wiki には記述なし" and mark what came from outside.

Where the vault's record and current model knowledge diverge, present both and name the divergence. The vault is the authoritative account of what the user concluded and the weaker account of what is currently true, so give the record first, then what has changed since, with the note's `updated` date so the user can judge whether the position still holds — say the note carries no date rather than supplying one when `updated` is absent, as it is on notes written before the compile layer. Deferring silently turns the vault from external memory into a commitment to a past view; overriding silently discards the reason it exists.

Close with the concept notes and source articles consulted, so the reader can see how wide the search was.

## Step 6 — save or not

Per [decision-rules.md](decision-rules.md). Ask before saving.

Most `query` answers should not be saved: recombining existing notes produces nothing the notes do not already hold. Save when a genuinely new angle appeared, a concept the vault lacks got introduced, or several sources integrated into something none of them stated. Save via [save.md](save.md), as `type: synthesis`.

When the answer amounts to a small addition to one note, `Edit` it directly and move `updated` to today.

## Step 7 — log

Append to `98_Maintenance/logs/<MOC> 操作ログ.md` for every genre whose notes were read, **whether or not anything was saved**. This is what keeps `curiosity` from re-probing notes that were just exercised.

```markdown
## YYYY-MM-DD

- query: <質問の要約（30文字程度）>
  - 参照: [[ノートX]], [[ノートY]]
  - 結果: <no-save / save-rejected / saved as [[新ノート]] / appended to [[既存ノート]]>
```

List every concept note read; MOCs do not count. When notes spanned genres, write the same entry to each genre's log.

## Report

Notes read and their paths, the answer, which route was taken (`Home.md` から素直に到達 / 全ジャンル横断 / Grep フォールバック), the save decision, and any contradiction worth handing to `lint`.

## Notes on searching

- Always read `## 知識マップ` and `## 横断テーマ`. They are what makes the search cheap.
- `type: synthesis` notes are integration points — go there first for comparisons and overviews.
- The vault's concept layer is unevenly developed: some genres are well linked, others are little more than a tag with articles behind it. When a genre turns out to be thin, say so — "この領域は記事はあるが概念ノートが育っていない" is a useful answer, and it is a hint for what to backfill next.
