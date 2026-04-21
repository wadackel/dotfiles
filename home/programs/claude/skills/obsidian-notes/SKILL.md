---
name: obsidian-notes
description: Obsidian vault conventions and note formatting rules. Covers vault directory structure (00_Inbox, 01_Projects, 02_Notes, etc.), note creation format (no h1, start from h2), and frontmatter template. Auto-loads when creating or editing Obsidian notes, using obsidian CLI commands, or saving content to the vault.
---

# Obsidian Note Conventions

Formatting and organizational rules for creating notes in the Obsidian vault.

## When This Applies

- Creating new notes via obsidian CLI (`obsidian create`, `obsidian append`, etc.)
- Saving research results, meeting notes, or other content to the vault
- User asks to "write to Obsidian", "save as a note", or similar

## Vault Directory Structure

Directories use numeric prefixes. **Do not guess directory names** -- verify with `obsidian files` or `obsidian folders` before saving.

| Directory | Purpose |
|---|---|
| `00_Inbox/` | Default destination for new files |
| `01_Projects/` | Project-related notes |
| `02_Notes/` | General notes |
| `03_Books/` | Book notes and reviews |
| `05_Private/` | Private notes |
| `99_Tracking/Daily/` | Daily notes (`YYYY-MM-DD.md`) |
| `99_Tracking/Weekly/` | Weekly notes (`YYYY-WNN.md`) |

New files go to `00_Inbox/<filename>.md` unless specified otherwise.

## Note Format

### h1 → filename conversion

Obsidian displays the filename as the note title — h1 headings in the content are redundant and hurt readability.

- If the source content contains `# Title`, **use that text as the filename** (e.g., `# Design Doc - git-prism.nvim` → `Design Doc - git-prism.nvim.md`) and **remove the h1 line** from the content
- If the user has already specified a filename, use that instead (user-specified takes priority)
- Start the note body from `##` (h2)
- Apply **Filename-safe characters** rules below before writing the file

### Filename-safe characters

The vault is synced across macOS / iOS / Android. macOS accepts most characters, but Android's vfat and Windows filesystems forbid `< > : " / \ | ? *` — filenames containing these break sync and become inaccessible on other devices. Always sanitize filenames before calling `obsidian create` / `rename` / `move`.

**Default substitution — ASCII hyphen (`-`)**:

- `:` (especially as a separator like `Foo: Bar`) → ` - ` (space-hyphen-space)
- `/` and `\` → `-` (always — path separators never allowed in the basename)
- `"` in English-only titles → remove, or rewrite with `-`
- `<` `>` `|` `?` `*` → `-` when they are not load-bearing

**Exception — full-width equivalent when ASCII substitution would break the title's meaning**:

| ASCII | Full-width | Use when |
|---|---|---|
| `:` | `：` | Ratios, times, references (e.g. `Ratio 1:2`, `10:30 Standup`) where `-` would change meaning |
| `"` | `「...」` (Japanese) | A quoted phrase inside Japanese text |
| `*` | `＊` | Stylistic/intentional asterisk in the title |
| `?` | `？` | Question mark is semantically required |
| `\|` | `｜` | Pipe is a visual separator the author chose |
| `<` / `>` | `＜` / `＞` | Angle brackets are meaningful (rare) |

Never use full-width for `/` or `\` — they are always `-`.

Judge in context. The rule is "preserve the title's meaning with the least intrusive substitution" — default to `-`, escalate to full-width only when `-` would distort it.

**Examples**:

- `# Design Doc: git-prism.nvim` → `Design Doc - git-prism.nvim.md` (`:` is a separator, hyphen works)
- `# Ratio 1:2 comparison` → `Ratio 1：2 comparison.md` (`:` is a ratio operator, hyphen would destroy meaning)
- `# "The Essence of Software" 読書メモ` → `「The Essence of Software」 読書メモ.md` (quotes around a title inside Japanese text)
- `# All You Need Is *` → `All You Need Is ＊.md` (`*` is intentional stylization)
- `# src/parser.ts バグ修正` → `src-parser.ts バグ修正.md` (`/` always becomes `-`)

### Frontmatter

Every note starts with YAML frontmatter based on `Templates/Note_Template.md`. **Leave all fields empty** — the user fills them in later. **Do NOT populate `tags` or `description`**, even if you know appropriate values:

```yaml
---
aliases:
tags:
description:
---
```

### Example

For a file named `Meeting Notes 2026-03-07.md`:

```markdown
---
aliases:
tags:
description:
---

## Attendees

- Alice, Bob, Charlie

## Discussion

Key points discussed...
```

## Workflow Examples

**New research note**: Create in `00_Inbox/`, use descriptive filename, add empty frontmatter, structure with h2 sections.

**Daily note**: Follow existing daily note patterns in the vault. Check `Templates/` for daily note template if available.

**Project note**: If a project directory exists under `01_Projects/`, save there. Otherwise, use `00_Inbox/` and let the user refile.
