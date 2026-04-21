---
name: obsidian-cli
description: >-
  Interact with Obsidian vault using the obsidian CLI commands.
  Auto-loads when creating, reading, appending, searching, or managing notes
  in the Obsidian vault via the obsidian CLI. Use when asked to read vault files,
  create notes, append content, search the vault, open files in Obsidian,
  or list vault contents.
---

# Obsidian CLI

Use the `obsidian` CLI to interact with a running Obsidian instance.

## Prerequisites

**Obsidian must be running.** The CLI communicates with the active Obsidian app. If Obsidian is not open, all commands will fail.

Target vault: **Main** (default — no `vault=` needed in most cases).

## Syntax

**Parameters** take a value with `=`. Quote values with spaces:

```bash
obsidian create name="My Note" content="Hello world"
```

**Flags** are boolean switches with no value:

```bash
obsidian create name="My Note" overwrite
```

## File Targeting

- `file=<name>` — resolves like a wikilink (name only, no path or extension)
- `path=<path>` — exact path from vault root (e.g. `folder/note.md`)

When neither is given, the active file is used.

## Content Escaping (Important)

When passing content to `create`, `append`, or `prepend`:

- Use `\n` for newlines, `\t` for tabs (the CLI interprets these sequences)
- Escape `"` inside the content string as `\"`
- Escape `$` as `\$` to prevent shell variable expansion
- Backticks inside content should be escaped as `` \` ``
- Content containing `!` (e.g., Obsidian embedded links `![[file#heading]]`) triggers bash history expansion, corrupting `!` to `\!`. Prefix with `set +H`: `set +H && obsidian create path="..." content="..." overwrite`

Example — creating a note with frontmatter and body:

```bash
obsidian create path="00_Inbox/example.md" content="---\naliases:\ntags:\ndescription:\n---\n\n## Section\n\ncontent here" overwrite
```

## Note Formatting Rules

When creating notes (`obsidian create`), follow the formatting rules defined in [obsidian-notes](../obsidian-notes/SKILL.md):

- **h1 → filename**: If source content has `# Title`, use it as the filename and remove from content
- **Frontmatter**: Always include empty `aliases:`, `tags:`, `description:` fields — do NOT populate them
- **Start from h2**: Note body begins with `##`, never `#`

## Common Commands

```bash
# Read a file (returns full content)
obsidian read path="99_Tracking/Daily/2026-03-07.md"
obsidian read file="My Note"

# Create a file (overwrite if exists)
obsidian create path="00_Inbox/note.md" content="..." overwrite

# Append to a file
obsidian append path="00_Inbox/note.md" content="\n## New Section\n\ncontent"

# Search vault
obsidian search query="search term" limit=10
obsidian search:context query="term" limit=5

# List files in a folder
obsidian files folder="00_Inbox"

# List folders
obsidian folders

# Open a file in Obsidian
obsidian open path="99_Tracking/Weekly/2026-W10.md"

# Rename a file — routes through the running Obsidian app, so wikilinks
# pointing to the old name are auto-updated across the vault.
# `name=` is the new basename without the extension.
obsidian rename path="00_Inbox/old.md" name="new-basename"

# Move a file to another folder (wikilinks are auto-updated the same way)
obsidian move path="00_Inbox/old.md" to="02_Notes/"

# Daily note operations
obsidian daily:read
obsidian daily:append content="- [ ] New task"
obsidian daily:path

# Properties
obsidian property:set name="status" value="done" file="My Note"
obsidian property:read name="tags" file="My Note"

# Tags
obsidian tags sort=count counts

# Vault info
obsidian vault
obsidian files total
```

## Vault Directory Structure

| Directory | Purpose |
|---|---|
| `00_Inbox/` | Default destination for new files |
| `99_Tracking/Daily/` | Daily notes (`YYYY-MM-DD.md`) |
| `99_Tracking/Weekly/` | Weekly notes (`YYYY-WNN.md`) |

Full directory listing: see [obsidian-notes](../obsidian-notes/SKILL.md).

Run `obsidian help` to see all available commands with full parameter documentation.
