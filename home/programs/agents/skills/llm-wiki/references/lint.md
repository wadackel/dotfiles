# lint — audit vault health

`lint [genre]` scans the vault across seven observations and writes each finding as a proposal. Nothing reaches a note without the user applying it.

With no argument, the whole vault. With a genre, only that MOC's notes and its tagged articles.

`98_Maintenance/proposals/**` is never itself a scan target. Neither is `$VAULT/05_Private/` — see the Safety section of [SKILL.md](../SKILL.md). It stays in the resolvable index so links into it are not reported as broken, but its contents are never read, and its paths never appear in a report or proposal.

Before the observations below, run `scripts/wiki-doctor.ts` (see [SKILL.md](../SKILL.md)). It settles the mechanically-decidable questions — unresolved links, filename collisions, privacy leakage, frontmatter integrity — so the observations here spend their effort on the ones that actually need judgment.

## Phase 0 — pending reminder

Scan `98_Maintenance/proposals/` for pending files and offer to review them first, per [proposals.md](proposals.md).

## Observation 1 — contradictions

Two notes making incompatible claims about the same thing. Prioritize disagreements over numbers, dates, and definitions, which are checkable; treat differences of emphasis as noise.

Method: `Grep` for shared keywords to gather notes on one topic, then read the relevant passages side by side.

→ `kind: contradiction-found`, `risk_flags: [judgment-required]`, `confidence: medium`. The proposal recommends one of "両論併記" / "A を更新" / "B を更新"; the user decides.

## Observation 2 — orphans

Notes in `02_Notes/` that nothing links to. MOC notes are exempt.

Method: collect every `[[target]]` across the vault and subtract from the filenames in `02_Notes/`.

**Exclude `98_Maintenance/logs/` from the link sources.** The logs list every note `ingest` touched, so counting them means a note that nothing in the concept layer references still reads as linked — permanently. Same reason observation 7 excludes `98_Maintenance/proposals/**`.

`98_Maintenance/ORPHANED_FILES.md` holds a hand-made list from an earlier sweep. Treat it as historical, not as input — it is stale and does not update itself.

→ `kind: orphan-fix`, `risk_flags: [judgment-required]`, `confidence: medium`. The proposal names 1–3 plausible notes to link from. The user may instead decide to merge or delete it.

## Observation 3 — missing pages

A concept mentioned across several notes with no note of its own.

Method: extract proper nouns and domain terms from notes, compare against filenames, and report at the threshold of "mentioned in 3+ notes, no note exists".

→ `kind: missing-page`, `risk_flags: [hallucination-possible]`, `confidence: low`. The body is drafted without reading any original, which is exactly the shape of a plausible-sounding fabrication. Say so in the proposal.

## Observation 4 — stale notes

A note whose `updated` predates sources that have since been compiled into its genre.

Method: compare each note's `updated` against the `date` of the articles in its `sources`. Call out notes untouched for over a year separately.

Notes that predate this skill have no `updated` at all. Absence is not staleness — report those as "未計測" rather than as findings.

→ `kind: stale-fix`, `risk_flags: [judgment-required]`, `confidence: medium`.

## Observation 5 — weak cross-referencing

`ingest` does not backlink exhaustively as it goes, so this observation carries that load. Two detectors, run together.

### 5a. Title appears as plain text but is not linked

High precision, and the main source of useful link additions.

1. Collect note titles from `Glob "$VAULT/02_Notes/*.md"`.
2. Keep titles of **4 characters or more** that are not blacklisted.
3. Per genre, one batched search with the `Grep` tool. **Do not build an `rg` command string from note titles** — titles come from article content and a quote or `$(...)` in one would escape into the shell.
4. Run once more across the vault, excluding `05_Private/`, to catch cross-genre cases.
5. Discard matches that are: inside a heading, inside a code block (check the enclosing fences), inside frontmatter, inside a blockquote, in a file that already links that title, or in the title's own note.

Blacklist for this vault — short or generic enough to over-fire: `AI`, `CSS`, `Web`, `Go`, `SET`, `LYT`, `MOC`, `GPT`, `HTML`, `MECE`, `ADR`, `BFF`, `SRE`, `QA`, `データ`, `システム`, `概要`, `設計`, `テスト`. Extend it as false positives show up rather than lowering the length threshold.

**The detector matches substrings, so a title that is a prefix of another over-fires**: `WCAG` hits inside `WCAG2` and `WCAG 3.0`. The blacklist cannot express this. When a run produces prefix collisions, mark the proposal `low-precision` and keep it out of `apply-all-safe`.

→ `kind: link-fix`, `risk_flags: []`, `confidence: high` when the titles involved have no prefix collisions. Those are the proposals `apply-all-safe` exists for. With collisions present, `risk_flags: [low-precision]` and `confidence: medium`.

### 5b. Keyword overlap

Pairs that are clearly related in substance without sharing a title string. Extract each note's main terms, and report pairs with overlap above threshold that are not already in each other's `related`. Skip pairs 5a already found.

→ `kind: weak-relation`, `risk_flags: [low-precision]`, `confidence: low`. Most of these get rejected; that is expected.

## Observation 6 — incomplete compiles

`ingest` writes `type: source` and then the log entry. A failure between the two leaves an article marked done with no record of what it produced, and `ingest` will skip it forever.

Method:

1. `Glob "$VAULT/04_Literature/*.md"` (or the genre's tagged articles).
2. Keep the ones with `type: source`.
3. Read `generated_pages`. **An empty or missing `generated_pages` is itself the finding** — the completion marker is set but nothing records what it produced.
4. Read `98_Maintenance/logs/<MOC> 操作ログ.md` and check that at least one of the article's `generated_pages` targets appears there.
5. Report the ones failing step 3 or step 4.

Matching on `generated_pages` rather than on the article's own title is deliberate. Batch runs write **one aggregated entry per genre** (see the batch form in [conventions.md](conventions.md)), so the article's title never appears in the log — only the notes it produced do. Matching on titles would report every batch-compiled article as incomplete.

This deliberately consults the log, while compile-state detection deliberately does not ([conventions.md](conventions.md)). The two serve different questions and do not conflict.

→ `kind: ingest-incomplete`, `risk_flags: [judgment-required]`, `confidence: medium`. The proposal drafts the missing log entry from `generated_pages`. When that field is empty there is nothing to reconstruct from — recommend `recompile` instead and leave the proposal pending.

## Observation 7 — unresolved wikilinks

`[[targets]]` that resolve to nothing.

Method, and the two ways to get it wrong:

1. Build the resolvable set from **the entire vault** — root-level notes (`Home.md`), `Extra/`, `Templates/`, `98_Maintenance/`, `05_Private/`, and attachments (images, PDFs, `.excalidraw`), with and without extension. Indexing only the numbered layer directories reports `[[Home]]` and every embedded image as broken. Scanning for *sources* of broken links is narrower: `05_Private/` is excluded there, so its contents never reach the report.
2. Exclude Dataview and Templater placeholders — `${...}`, `<%...%>`. They sit inside `base` and code blocks, are expanded at render time, and are not links. This vault has roughly 126 of them, mostly `${d.file.name}` from a daily-note template. The same exclusion applies to any `[[...]]` inside an inline code span — Obsidian does not resolve those either, so a maintenance report that quotes broken links must backtick them or it manufactures the very findings it reports.

3. Exclude date-shaped targets — `YYYY-MM-DD` and `YYYY-Wnn`. Daily and weekly templates link to the previous and next period unconditionally, so every day the user did not write a note produces an unresolved link that is correct as-is. Counting them puts roughly 16 permanent entries in the report and buries the handful that are actually broken. `wiki-doctor.ts` applies the same exclusion (`isDate`); the two must agree or the same vault reports two different numbers.

What remains is genuinely broken: renamed notes, typos, notes never created. Report the counts this run actually produced — never carry a number from a previous run into this file.

Sort them by cause, because the fix differs:

| Pattern | Fix |
|---|---|
| A note that was renamed | Repoint the link |
| A date that has no daily note | Usually intentional — leave it |
| A typo | Correct it |
| A note that was never written | Feed it to observation 3 as a missing-page candidate |

→ `kind: link-fix`, `risk_flags: []` when the target is unambiguous, `[judgment-required]` when the intended target has to be guessed.

## Writing the proposals

Per [proposals.md](proposals.md): filed under the genre of the affected note, `mkdir -p` on first write, named `<YYYY-MM-DD>__<kind>__lint-<serial>.md`, always `status: pending`. Cross-genre findings go to the dominant genre with the rest recorded in `cross_genre`.

**One proposal per finding is the default.** A full-vault run can produce hundreds of 5a hits, and writing hundreds of files makes the review unusable — in that case group an observation's findings into a single **aggregated proposal**, following the rules in [proposals.md](proposals.md) under "Aggregated proposals".

The full detection output is written to `98_Maintenance/lint-report-<YYYY-MM-DD>.md` so the proposals can reference it instead of restating every hit. State the judgment caveats (which observations were skipped, which detectors over-fire) in that file's header.

## Report

```markdown
# Lint レポート — <today>

対象: <Vault 全体 / ジャンル名>
スキャン: 概念ノート <n>本 / 記事 <n>本

| 観点 | 検出 | proposals |
|---|---|---|
| 1. 矛盾 | <n> | <n> (judgment-required) |
| 2. 孤立ノート | <n> | <n> (judgment-required) |
| 3. 不足ページ | <n> | <n> (hallucination-possible) |
| 4. 古いノート | <n> | <n> (judgment-required) |
| 5a. 欠落リンク | <n> | <n> (リスクなし) |
| 5b. 関連候補 | <n> | <n> (low-precision) |
| 6. 取り込み不整合 | <n> | <n> (judgment-required) |
| 7. 未解決リンク | <n> | <n> |

配置先:
- 98_Maintenance/proposals/<MOC>/: <n>件 (⚠️<m>件)
```

State plainly that detection is not exhaustive and that the final call is the user's.

## Review

Runs the interactive flow from [proposals.md](proposals.md) immediately after the report. `apply-all-safe` sweeps the risk-free proposals — in practice the 5a link fixes, which is where `lint` pays for itself on a vault whose concept layer is still thinly connected.

## Constraints

- **`lint` never writes to a note directly.** Every change goes through a proposal the user applies.
- **`lint` does not touch `updated`.** That happens on apply.
- Detection is heuristic throughout. Say so in the report rather than implying the vault is clean because `lint` came back quiet.
