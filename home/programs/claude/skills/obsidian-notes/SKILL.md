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

### No h1 heading

Obsidian displays the filename as the note title. Do not add `# Title` at the top. Start content from `##` (h2).

### Frontmatter

Every note starts with YAML frontmatter based on `Templates/Note_Template.md`. Leave all fields empty (the user fills them in later):

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
