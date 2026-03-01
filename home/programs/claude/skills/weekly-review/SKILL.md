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
- `W08` → current year's W08
- `2026-W08` → as-is
- Empty → current week via `date +%G-W%V`

Compute Monday–Sunday dates and prev/next week numbers using `deno eval`:

```ts
const [y, w] = [YEAR, WEEK];
const jan4 = new Date(Date.UTC(y, 0, 4));
const dayOfWeek = jan4.getUTCDay() || 7;
const mon = new Date(jan4.getTime() + ((w - 1) * 7 - (dayOfWeek - 1)) * 86400000);
for (let i = 0; i < 7; i++) {
  const d = new Date(mon.getTime() + i * 86400000);
  console.log(d.toISOString().slice(0, 10));
}
```

Replace `YEAR` and `WEEK` with actual values at runtime.
Handle year boundaries: ISO 8601 allows Dec 29–31 to belong to W01 of the next year.

### Step 2: Load Data (Parallel)

Fetch all of the following in a **single parallel call** using `get_vault_file`:

1. **Weekly note**: `99_Tracking/Weekly/YYYY-WWW.md` — if not found, print error and **abort**
2. **Previous week**: `99_Tracking/Weekly/YYYY-W{prev}.md` — for "next week" carryover; skip if missing
3. **Daily notes**: Mon–Sun (7 files) — skip missing days silently

Total: up to 9 files in one parallel call.

### Step 3: Collect & Parse Data

Extract from each daily note:

- **To-Do** (`## 📝 To-Do`): `[x]` completed / `[ ]` incomplete
- **Tasks** (`## 🧑‍💻 Tasks`): long-term task items
- **Memo** (`## ✍️ Memo`): timestamped entries
  - Project identification: extract `repo-name` from `` `(repo-name/short-hash)` `` pattern
  - Entries without pattern: work-related → `Misc`, personal → material for "feelings" section
- **Frontmatter**: `emotion` score (0 may mean "not recorded"; if all days are 0, infer tone from Memo content)

Assess existing weekly note state:

- **Bare template**: all subsections (0–3) are empty or contain only `- tba` → **fresh generation** (no merge needed)
- **Partially filled**: 1+ subsections have substantive content → **merge mode**
- Always discard `- tba` placeholder under `## Notes`
- `## Analysis`: **preserve dataviewjs blocks verbatim** (never modify)
- `## History` / `## Reading`: validate and fix in Step 5

### Step 4: Synthesize Content

Generate 4 subsections in Japanese:

#### `0.今週やること`

- Start from **all items** in previous week's "来週やること" (carry over even if not seen in daily notes)
- Supplement with this week's To-Do items
- **Merge mode**: respect existing content, add only new items; deduplicate against carryover items

#### `1.今週やったこと`

- Group completed To-Do `[x]` items and Memo achievements by project label
- Project labels: use repo names (`P&L`, `dotfiles`, `concierge-app`, etc.) or `Misc`
- **Merge mode**: preserve existing manual entries; deduplicate (keep the more detailed version)

#### `2.来週やること`

- Collect incomplete To-Do `[ ]` items + Tasks + "next week" mentions from Memo
- **Merge mode**: respect existing content, add only new items

#### `3.感想`

- Emotion trend (only days with recorded values), notable events, overall tone (3–5 bullets)
- Write in first-person conversational Japanese
- **Merge mode**: preserve existing reflections, add new insights from daily notes

### Step 5: Fix History & Reading Dates (Conditional)

Only modify when corruption is detected. This addresses known Templater bugs.

**History validation**:
- Extract all `### [[YYYY-MM-DD]]` dates
- Compare against Mon–Sun dates from Step 1
- Corruption = missing dates, wrong order, or out-of-range dates
- If corrupted → regenerate 7 entries (Mon–Sun) in correct order
- If valid → preserve as-is

**Reading validation**:
- Extract `date >= "START"` and `date <= "END"` values
- START must equal Monday, END must equal Sunday
- Corruption = mismatch or inversion (START > END)
- If corrupted → fix to correct Monday/Sunday values
- If valid → preserve as-is

### Step 6: Rewrite Weekly Note

Before writing, output a brief summary: section counts, major changes, merge/fresh mode.

Use `create_vault_file` for full rewrite (not `patch_vault_file` — emoji headings cause errors):

- **Frontmatter**: preserve existing values exactly
- **`## Notes`**: Step 4 synthesized content (no `- tba`)
- **`## Analysis`**: **verbatim copy** of existing dataviewjs blocks (do NOT paraphrase or modify)
- **`## History`**: Step 5 result (fixed or preserved)
- **`## Reading`**: Step 5 result (fixed or preserved)

### Step 7: Open in Obsidian

Use `show_file_in_obsidian` to display the updated weekly note.

## Content Style Guidelines

- Generated Obsidian content is written in **Japanese**
- Use project labels as prefixes: `P&L`, `dotfiles`, `concierge-app`, `Misc`, etc.
- Bullet points only, no prose paragraphs
- Feelings section uses first-person conversational Japanese
- Missing or sparse Sat/Sun notes are normal (especially when running on Friday)
