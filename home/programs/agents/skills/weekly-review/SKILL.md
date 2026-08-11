---
name: weekly-review
description: >-
  Generates weekly review content in Obsidian by reading daily notes,
  synthesizing completed work, planned tasks, and reflections,
  then filling the Notes section of the weekly note.
  Use when asked to "weekly review", "weekly note",
  "fill in the weekly note", "weekly note を埋めて",
  "週の振り返り", "今週の振り返り", "週次レビュー",
  or similar requests about weekly notes.
disable-model-invocation: true
argument-hint: "[week e.g. W08]"
---

# Weekly Review

Generate a weekly review by reading Obsidian daily notes and synthesizing them into the weekly note's Notes section.

## Quick Start

```
/weekly-review        # Current week (based on ISO week)
/weekly-review W08    # Week 8 of current year
/weekly-review 2026-W08  # Specific year and week
```

## Vault Paths

- Daily notes: `99_Tracking/Daily/YYYY-MM-DD.md`
- Weekly notes: `99_Tracking/Weekly/YYYY-WWW.md`

## Workflow

### Step 1: Determine Target Week

Parse `$ARGUMENTS`:
- `W08` -> current year's W08
- `2026-W08` -> as-is
- Empty -> current week via `date +%G-W%V`

Compute Monday-Sunday dates and prev/next week numbers:

```
deno run ~/.claude/skills/weekly-review/iso-week.ts YYYY-WNN
```

Output: 7 lines of dates (Mon-Sun as `YYYY-MM-DD`), then `PREV:YYYY-WNN` and `NEXT:YYYY-WNN`.

### Step 2: Load Data (Parallel)

Fetch all of the following in **parallel Bash calls** using `obsidian read`:

1. **Weekly note**: `99_Tracking/Weekly/YYYY-WWW.md` -- if not found, print error and **abort**
2. **Previous week**: `99_Tracking/Weekly/YYYY-W{prev}.md` -- for "next week" carryover; skip if missing
3. **Daily notes**: Mon-Sun (7 files) -- skip missing days silently

Total: up to 9 files in one parallel call.

### Step 3: Collect & Parse Data

Extract from each daily note:

- **To-Do** (`## 📝 To-Do`): `[x]` completed / `[ ]` incomplete
- **Tasks** (`## 🧑‍💻 Tasks`): long-term task items
- **Memo** (`## ✍️ Memo`): timestamped entries
  - Project identification: extract `repo-name` from `` `(repo-name/short-hash)` `` pattern
  - Entries without pattern: work-related -> `Misc`, personal -> material for "feelings" section
- **Frontmatter**: `emotion` score (0 may mean "not recorded"; if all days are 0, infer tone from Memo content)

Assess existing weekly note state:

- **Bare template**: all subsections (0-3) are empty or contain only `- tba` -> **fresh generation** (no merge needed)
- **Partially filled**: 1+ subsections have substantive content -> **merge mode**
- Always discard `- tba` placeholder under `## Notes`
- `## Analysis`: **preserve dataviewjs blocks verbatim** (never modify)
- `## History` / `## Reading`: validate and fix in Step 5

### Step 4: Synthesize Content

Generate 4 subsections in Japanese.

**Why Notes can be lossy**: every weekly note's `## History` embeds all 7 days' `## ✍️ Memo` verbatim through `![[YYYY-MM-DD#✍️ Memo]]`. Anything a daily Memo records stays reachable from inside the same note, so Notes does not have to preserve it. Notes is an index a human scans in 30 seconds; the detail already lives one section below. This does **not** extend past Memo — `## 📝 To-Do` and `## 🧑‍💻 Tasks` are not embedded, so their completion state has no other home.

**Budget** — Step 6 enforces these mechanically and blocks the write. They are not advice.

| Subsection | Limit |
|---|---|
| `1.今週やったこと` | 300 characters total |
| `1.今週やったこと`, any single bullet | 40 characters |
| `3.感想` | 120 characters total |
| Anywhere in Notes | zero Issue / PR numbers, commit SHAs, file paths, item counts |

Every body line inside `### 0.` … `### 3.` counts toward its subsection, bullet marker or not. Dropping the markers, switching to prose, or nesting under a deeper heading changes nothing — and a line that lands outside all four subsections fails the check outright.

#### `0.今週やること`

- Start from **all items** in previous week's "来週やること" (carry over even if not seen in daily notes)
- Strip Issue / PR numbers and paths while carrying an item over — older notes contain them, and copying one in verbatim fails Step 6 on an item you did not write
- Supplement with this week's To-Do items
- Granularity: task-level (one bullet per planned task). The milestone rollup rules from `1.今週やったこと` do NOT apply here
- **Merge mode**: respect existing content, add only new items; deduplicate against carryover items

#### `1.今週やったこと`

- Group completed To-Do `[x]` items and Memo achievements by project label
- Project labels: use repo names, or `Misc` for everything else
- One bullet states one milestone. When several items would exceed the budget, raise them to a single higher-level statement — do **not** chain them into one line with `、` `/` `+` to make them fit. A packed line satisfies the character count while defeating its purpose
- Daily notes are dense because a Stop hook writes Claude Code auto-summaries into them. Aggregating them as-is always overshoots; compress before emitting, not after
- **Merge mode**: keep existing human-written entries as they are and add only what is missing

Aim for this shape:

```
- Atlas
    - 認証基盤を OIDC へ移行
    - 管理画面のリリース手順を整備
- Beacon
    - ドッグフーディング開始
- Misc
    - 健康診断
```

#### `2.来週やること`

- Collect incomplete To-Do `[ ]` items + Tasks + "next week" mentions from Memo
- **Group by project label** (same as "今週やったこと"): repo names, or `Misc`
- Use nested bullet format:
  ```
  - Atlas
      - 認証プロキシのリファクタ
      - バックグラウンド切り替え対応
  - Misc
      - 面接コンテンツの見直し
  ```
- Carry over sub-item structure from To-Do where available
- Strip Issue / PR numbers and paths from anything carried over, for the same reason as `0.今週やること`
- Granularity: task-level (one bullet per planned task). The milestone rollup rules from `1.今週やったこと` do NOT apply here
- **Merge mode**: respect existing content, add only new items

#### `3.感想`

- Lead with the emotion trend when values are recorded (e.g. `月 7 → 火 8 → 水 6`). Skip that bullet entirely when every recorded value is 0
- Then the week's turning point — what actually moved, or what is carried forward
- Each event or project appears in **one bullet only**
- Write in first-person conversational Japanese
- **Merge mode**: keep existing reflections and add only what is missing

Aim for this shape:

```
- 月 7 → 火 8 → 水 6 → 木 7 → 金 7 と中盤に落ちたが持ち直した週
- Atlas の移行が山場を越えた。来週は Beacon に寄せたい
```

### Step 5: Fix History & Reading Dates (Conditional)

Only modify when corruption is detected. This addresses known Templater bugs.

**History validation**:
- Extract all `### [[YYYY-MM-DD]]` dates
- Compare against Mon-Sun dates from Step 1
- Corruption = missing dates, wrong order, or out-of-range dates
- If corrupted -> regenerate 7 entries (Mon-Sun) in correct order
- If valid -> preserve as-is

**Reading validation**:
- Extract `date >= "START"` and `date <= "END"` values
- START must equal Monday, END must equal Sunday
- Corruption = mismatch or inversion (START > END)
- If corrupted -> fix to correct Monday/Sunday values
- If valid -> preserve as-is

### Step 6: Enforce the Budget

A precondition for writing, not a review. Do not reach Step 7 until this passes.

1. Write the fully composed note to a temporary file. Use a literal absolute path such as `/tmp/weekly-YYYY-WNN.md` — the Write tool does not expand `$TMPDIR`
2. Run the checker:

   ```
   deno run --allow-read ~/.claude/skills/weekly-review/check-budget.ts /tmp/weekly-YYYY-WNN.md
   ```

   It reports `S1` / `S3` / `S1MAX` / `TOKENS` / `ORPHAN` against their limits, lists any forbidden tokens it found, and exits non-zero when anything fails.
3. On `FAIL`, rewrite the offending subsection and repeat from 1. Compress it — reaching the limit by rewording the same content back to the same length is not a fix. Dropping bullet markers, switching to prose, or nesting under a deeper heading does not compress anything: every body line counts either way
4. On `ORPHAN` above 0, a body line landed outside `### 0.` … `### 3.`. Move it into the subsection it belongs to
5. On `RESULT:UNPARSEABLE`, the note structure itself is broken — `## 🦄 Notes` is missing, or one of the four `### 0.` … `### 3.` headings is absent or malformed. Restore them and repeat from 1. Never continue to Step 7 while this persists
6. After two failed attempts, **stop**. Do not write to the vault. Report the checker output and say what is blocking further compression

The file that passed is the artifact. Step 7 writes **that exact content** — if you touch Notes again after the check, the check no longer covers what you are writing, so come back here and re-run it.

**Merge mode exception** — the one case that may proceed to Step 7 without a passing check. It covers **entries that were already in the note**, never what you are adding now:

- Never delete a pre-existing entry to satisfy the checker
- Compress what you add so that pre-existing + new still fits the budget
- When the pre-existing entries alone already exceed it, add nothing, report the overage, and continue
- This exception does not apply to `RESULT:UNPARSEABLE` or `ORPHAN`

Otherwise re-running on the same week would let the previous run's output count as pre-existing, and the budget would stop applying from the second run onward.

### Step 7: Rewrite Weekly Note

Before writing, output a brief summary: section counts, major changes, merge/fresh mode.

Use the **Write tool** to write directly to the vault file path: `~/Documents/Main/99_Tracking/Weekly/YYYY-WNN.md`

> **Why not `obsidian create`?** The CLI escapes `!` to `\!` in content, breaking Obsidian embed syntax (`![[...]]`) and JS double negation (`!!`) in dataviewjs blocks. The Write tool bypasses shell escaping entirely.

- **Frontmatter**: preserve existing values exactly
- **`## Notes`**: byte-for-byte the content that passed Step 6 (no `- tba`). Do not recompose or re-edit it here
- **`## Analysis`**: **verbatim copy** of existing dataviewjs blocks (do NOT paraphrase or modify)
- **`## History`**: Step 5 result (fixed or preserved)
- **`## Reading`**: Step 5 result (fixed or preserved)

### Step 8: Open in Obsidian

Use `obsidian open path="99_Tracking/Weekly/YYYY-WNN.md"` to display the updated weekly note.

## Content Style Guidelines

- Generated Obsidian content is written in **Japanese**
- Use project labels as prefixes: repo names, or `Misc` for everything else
- Bullet points only, no prose paragraphs
- Feelings section uses first-person conversational Japanese
- Missing or sparse Sat/Sun notes are normal (especially when running on Friday)
