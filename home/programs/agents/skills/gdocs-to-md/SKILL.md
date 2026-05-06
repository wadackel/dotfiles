---
name: gdocs-to-md
description: >-
  Convert a Google Docs document to GitHub Flavored Markdown via Docs API.
  Fetches document structure as JSON via gws docs, then converts with a Deno
  script. Use when asked to "convert Google Docs to Markdown",
  "Google DocsをMarkdownに変換して", "docsをmdにして",
  "MarkdownにExportして", or when a Google Docs URL is provided with intent to
  produce a .md file.
argument-hint: "[Google Docs URL or ID]"
---

# Google Docs to Markdown

Convert a Google Docs document to GitHub Flavored Markdown. Fetches the document via `gws docs documents get` (Google Docs API), then converts the JSON structure to GFM using a Deno script.

## Prerequisites

- **gws CLI** — for Google Docs API access. See the **gws-shared skill** for auth setup.
- **jq** — for JSON parsing.
- **Deno** — for running the conversion script.
- **Google Docs API** must be enabled for your GCP project.

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

### Step 2 — Create isolated temp file

```bash
TMP_JSON=$(mktemp -t gdoc-XXXXXX.json)
```

### Step 3 — Fetch document JSON

```bash
gws docs documents get --params '{"documentId":"<ID>"}' > "$TMP_JSON"
```

**Validate after fetch:**
- Check `jq -e '.body' "$TMP_JSON" > /dev/null` passes — confirms a valid document response
- Extract title: `TITLE=$(jq -r '.title' "$TMP_JSON")`
- Check `$TITLE` is non-empty

If validation fails: print the raw content of `$TMP_JSON` and `"temp file preserved at: $TMP_JSON"`, then stop.

**On gws failure**: print the error and `"temp file at: $TMP_JSON"`. If the error is an auth/permission issue, suggest running `gws auth login`. If the error mentions Docs API not enabled, direct user to enable it in GCP Console. Do not proceed to conversion.

### Step 4 — Convert with Deno script

```bash
OUTPUT_STEM=$(echo "$TITLE" | tr '/' '-')
~/.claude/skills/gdocs-to-md/gdoc-json-to-md.ts < "$TMP_JSON" > "${OUTPUT_STEM}.md"
```

**On conversion failure**: print the error and `"JSON preserved at: $TMP_JSON"`, then stop.

### Step 5 — Cleanup (success only)

```bash
rm -f "$TMP_JSON"
```

Only clean up after successful conversion. On failure, preserve `$TMP_JSON` for debugging.

### Step 6 — Report result

Verify the output file exists, then report absolute paths. Do not read the full file content into context.

```
✓ Conversion complete

Markdown : /absolute/path/to/${OUTPUT_STEM}.md
```

## Output

| File | Description |
|---|---|
| `<title>.md` | GitHub Flavored Markdown, no hard line-wrapping |

Written to the current working directory.

## Additional Resources

- For flag explanations, error handling details, and known limitations, see [workflow-details.md](references/workflow-details.md)
