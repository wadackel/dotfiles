---
name: gogcli
description: Operates Google Workspace services via the gog CLI. Use when the user asks to search Gmail, read or send email, check Google Calendar, manage calendar events, list or upload Drive files, read or write Google Sheets, manage Tasks, send Google Chat messages, look up contacts, export Docs or Slides to PDF, or run any gog command against Google services.
allowed-tools: Bash(gog:*)
---

# Google Services CLI (gog)

Fast, script-friendly CLI for Google services. JSON output for automation, multiple accounts, least-privilege auth.

## Quick Start

```bash
gog auth list                              # Check configured accounts
gog gmail search 'newer_than:7d' --json   # Search recent Gmail
gog calendar events list --json           # List calendar events
gog drive list --json                     # List Drive files
```

## Output Formats

```bash
gog gmail search 'newer_than:7d'         # Default: human-friendly tables
gog gmail search 'newer_than:7d' --json  # JSON: structured output for scripting
gog gmail search 'newer_than:7d' --plain # TSV: stable tab-separated for piping
```

Progress goes to stderr; data to stdout. Colors auto-disable with `--json` / `--plain`.

## Authentication

```bash
gog auth credentials ~/Downloads/client_secret_....json   # Store OAuth credentials (first-time)
gog auth add you@gmail.com                                 # Add account
gog auth list --check                                      # Verify tokens
gog auth alias set work work@company.com                   # Set alias
gog auth add you@gmail.com --services drive,calendar --readonly  # Minimal scopes
gog auth service-account set you@domain.com --key ~/key.json     # Service account (Workspace)
```

Account selection: `--account you@gmail.com` flag or `GOG_ACCOUNT` env var.

## Commands

### Gmail

```bash
gog gmail search 'newer_than:7d'
gog gmail search 'from:alice subject:meeting is:unread'
gog gmail threads list
gog gmail messages list
gog gmail send user@example.com "Subject" "Body"
gog gmail send user@example.com "Subject" "Body" --track
gog gmail labels list
gog gmail labels create "Label Name"
gog gmail drafts list
gog gmail filters list
gog gmail vacation status
gog gmail attachments
```

### Calendar

```bash
gog calendar list
gog calendar events list
gog calendar events create
gog calendar events update
gog calendar events delete
gog calendar conflicts
gog calendar freebusy
gog calendar focus-time
gog calendar ooo
gog calendar working-location
```

### Drive

```bash
gog drive list
gog drive search "name contains 'report'"
gog drive upload ./file.pdf
gog drive download <file-id>
gog drive permissions <file-id>
gog drive shared-drives
```

### Docs / Slides

```bash
gog docs export <file-id> --format pdf
gog docs export <file-id> --format docx
gog docs export <file-id> --format txt
gog docs copy <file-id>
gog docs create
gog docs to-text
gog slides export <file-id> --format pptx
gog slides copy <file-id>
gog slides create
```

### Sheets

```bash
gog sheets read <spreadsheet-id>
gog sheets write <spreadsheet-id> <sheet-name> <values>
gog sheets append <spreadsheet-id>
gog sheets insert-rows <spreadsheet-id>
gog sheets insert-cols <spreadsheet-id>
gog sheets create
gog sheets export <file-id>
```

### Tasks

```bash
gog tasks list
gog tasks create "Task title"
gog tasks add "Task title"
gog tasks update <task-id>
gog tasks done <task-id>
gog tasks undo <task-id>
gog tasks delete <task-id>
gog tasks clear
```

### Chat

```bash
gog chat spaces list
gog chat spaces find "space name"
gog chat messages list <space-id>
gog chat messages send <space-id> "message"
gog chat threads list <space-id>
gog chat memberships <space-id>
gog chat dms
```

### Contacts / People

```bash
gog contacts search "name"
gog contacts list
gog contacts create
gog contacts directory
gog people profile
```

### Config / Utility

```bash
gog config get <key>
gog config set <key> <value>
gog config list
gog config path
gog time
gog --help
GOG_HELP=full gog --help
```

## Environment Variables

| Variable | Description |
|---|---|
| `GOG_ACCOUNT` | Default account (email or alias) |
| `GOG_JSON` | Enable JSON output by default |
| `GOG_PLAIN` | Enable TSV output by default |
| `GOG_TIMEZONE` | Output timezone (IANA name, UTC, or local) |
| `GOG_ENABLE_COMMANDS` | Command allowlist (e.g., `"calendar,tasks"`) |
| `GOG_KEYRING_PASSWORD` | File backend password (non-interactive/CI) |
| `GOG_KEYRING_BACKEND` | Keyring backend (file/keychain/auto) |

## Examples

### Find unread emails and summarize

```bash
gog gmail search 'is:unread newer_than:1d' --json
gog gmail search 'from:boss@company.com subject:urgent' --json
```

### Check today's schedule and mark tasks done

```bash
gog calendar events list --json
gog tasks list --json
gog tasks done <task-id>
```

### Export a document to PDF and upload result

```bash
gog docs export <doc-id> --format pdf
gog drive upload ./output.pdf
gog drive list --json | grep output
```

### Read a spreadsheet and append a row

```bash
gog sheets read <spreadsheet-id> --json
gog sheets append <spreadsheet-id>
```

### Send a Chat message to a space

```bash
gog chat spaces list --json
gog chat messages send <space-id> "Deployment complete ✓"
```

## Tips

- Use `--json` for all scripting; pipe to `jq` for further processing
- Set `GOG_ACCOUNT` to avoid repeating `--account` on every command
- Use `GOG_ENABLE_COMMANDS` to restrict access in sandboxed/agent contexts
- Request minimal auth scopes: `--services drive --readonly`
- Keep (notes) and some Workspace features require a service account

## Less Common Services

For Forms, Classroom, Apps Script, Groups, and Keep commands, see [references/commands.md](references/commands.md).
