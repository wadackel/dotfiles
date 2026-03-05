# Workflow Details

## Flag Reference

### gws drive files get flags (title fetch)

| Flag | Purpose |
|---|---|
| `--params '{"fileId":"<ID>","fields":"name"}'` | Fetch only the document name field |

Output is JSON: `{"name": "Document Title"}`. Pipe to `jq -r '.name'` to extract the string.

### gws drive files export flags (docx export)

| Flag | Purpose |
|---|---|
| `--params '{"fileId":"<ID>","mimeType":"..."}'` | Document ID and target MIME type |
| `--output "$DOCX_PATH"` | Save binary content to this path |

MIME type for docx: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

On success, gws prints a JSON summary to stdout: `{"bytes": N, "saved_file": "...", "status": "success"}`.

### pandoc flags

| Flag | Purpose |
|---|---|
| `--wrap=none` | Disables hard line-wrapping (default 72-char wrapping breaks GFM) |
| `--extract-media="media/${OUTPUT_STEM}"` | Extracts images into a per-document subdirectory, preventing overwrites when converting multiple documents |
| `tr '/' '-'` (on stem) | Replaces `/` in titles like "Q1/Q2 Report" to avoid `basename` truncation |

## Error Handling

| Situation | Action |
|---|---|
| `$ARGUMENTS` not provided | Use AskUserQuestion to prompt for URL or document ID |
| URL provided but no ID found | Report parsing failure; ask user to provide the raw document ID instead |
| gws auth / permission error | Report error; suggest running `gws auth login` to re-authenticate |
| Drive API not enabled | Report the error message; direct user to enable Drive API in GCP Console |
| DOCX path validation fails | Print raw gws output + temp dir path; stop |
| pandoc fails | Print error + temp dir path (docx preserved); stop |

## Known Limitations

- **Complex tables** and embedded charts may not convert cleanly from docx to GFM; manual cleanup may be needed.
- **Comments, tracked changes, and footnotes** have inconsistent pandoc output; review the result for these elements.
- **Re-running on the same document** overwrites the `.md` file silently, but images in `media/<title>/` are also overwritten. This is intentional; rename the output directory beforehand if you need to preserve a prior conversion.
