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

- If the source content contains `# Title`, **use that text as the filename** (e.g., `# Design Doc: git-prism.nvim` → `Design Doc: git-prism.nvim.md`) and **remove the h1 line** from the content
- If the user has already specified a filename, use that instead (user-specified takes priority)
- Start the note body from `##` (h2)

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
