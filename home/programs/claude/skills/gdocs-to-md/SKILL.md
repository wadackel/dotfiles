---
name: gdocs-to-md
description: >-
  Convert a Google Docs document to GitHub Flavored Markdown via docx export.
  Extracts images to media/ alongside the output file. Downloads via gws drive
  files export, then converts with pandoc. Use when asked to "convert Google
  Docs to Markdown", "Google DocsをMarkdownに変換して", "docsをmdにして",
  "MarkdownにExportして", or when a Google Docs URL is provided with intent to
  produce a .md file.
argument-hint: "[Google Docs URL or ID]"
---

# Google Docs to Markdown

Convert a Google Docs document to GitHub Flavored Markdown. Downloads the document as docx via the gws CLI (Google Drive API), then converts it with pandoc — preserving formatting and extracting images into a per-document subdirectory.

## Prerequisites

- **gws CLI** — for Google Docs export via Drive API. See the **gws-shared skill** for auth setup.
- **jq** — for parsing gws JSON output.
- **pandoc** — for docx → GFM conversion.
- **Google Drive API** must be enabled for your GCP project (required for `drive files export`).

## Quick Start

```
/gdocs-to-md https://docs.google.com/document/d/<ID>/edit
/gdocs-to-md <document-ID>
```

Accepts either a full Google Docs URL or a raw document ID. If called with no argument, you will be prompted.

Output is written to the **current working directory**.

## Workflow

### Step 0 — Confirm output location

Display the current working directory to the user before writing any files:

```
Output will be written to: <cwd>
```

### Step 1 — Parse $ARGUMENTS

- **Full URL**: extract the document ID using the pattern `/d/([a-zA-Z0-9_-]+)/`
- **Raw ID**: use as-is (alphanumeric string, typically 30+ characters)
- **No argument**: use AskUserQuestion to ask for the URL or document ID

### Step 2 — Create isolated temp directory

```bash
WORK_DIR=$(mktemp -d -t gdocs-to-md)
```

### Step 3 — Download as docx

**Step 3a — Fetch document title:**

```bash
TITLE=$(gws drive files get --params '{"fileId":"<ID>","fields":"name"}' | jq -r '.name')
```

**Step 3b — Export as docx:**

```bash
DOCX_PATH="$WORK_DIR/${TITLE}.docx"
gws drive files export \
  --params '{"fileId":"<ID>","mimeType":"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}' \
  --output "$DOCX_PATH"
```

**After export, validate:**
- `$TITLE` is non-empty
- `test -f "$DOCX_PATH"` passes

If validation fails: print the raw gws output and `"temp files preserved at: $WORK_DIR"`, then stop.

**On gws failure**: print the error and `"temp files at: $WORK_DIR"`. If the error is an auth/permission issue, suggest running `gws auth login`. If the error mentions Drive API not enabled, direct user to enable it in GCP Console. Do not proceed to pandoc.

### Step 4 — Convert with pandoc

```bash
OUTPUT_STEM=$(basename "$DOCX_PATH" .docx | tr '/' '-')
pandoc "$DOCX_PATH" -f docx -t gfm \
  --wrap=none \
  --extract-media="media/${OUTPUT_STEM}" \
  -o "${OUTPUT_STEM}.md"
```

**On pandoc failure**: print the error and `"docx preserved at: $WORK_DIR"`, then stop.

### Step 5 — Cleanup (success only)

```bash
rm -rf "$WORK_DIR"
```

Only clean up after successful pandoc conversion.

### Step 6 — Report result

Verify the output file exists, then report absolute paths. Do not read the full file content into context.

```
✓ Conversion complete

Markdown : /absolute/path/to/${OUTPUT_STEM}.md
Images   : /absolute/path/to/media/${OUTPUT_STEM}/  (N images)
```

## Output

| File | Description |
|---|---|
| `<title>.md` | GitHub Flavored Markdown, no hard line-wrapping |
| `media/<title>/` | Extracted images (only present if the document contains images) |

Both are written to the current working directory.

## Additional Resources

- For flag explanations, error handling details, and known limitations, see [workflow-details.md](references/workflow-details.md)
