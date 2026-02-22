# Workflow Details

## Flag Reference

### gog export flags

| Flag | Purpose |
|---|---|
| `--format=docx` | Export as Microsoft Word format (required for pandoc conversion) |
| `--out="$WORK_DIR"` | Output directory; filename is derived from document title |
| `--plain` | Tab-separated output: line 1 is `path\t<filepath>` |

**Critical**: Use `-F'\t'` in awk — whitespace splitting breaks on document titles with spaces.

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
| gog auth / permission error | Report error; suggest `--account <email>` if multiple accounts exist |
| DOCX path validation fails | Print raw gog output + temp dir path; stop |
| pandoc fails | Print error + temp dir path (docx preserved); stop |

## Known Limitations

- **Complex tables** and embedded charts may not convert cleanly from docx to GFM; manual cleanup may be needed.
- **Comments, tracked changes, and footnotes** have inconsistent pandoc output; review the result for these elements.
- **Re-running on the same document** overwrites the `.md` file silently, but images in `media/<title>/` are also overwritten. This is intentional; rename the output directory beforehand if you need to preserve a prior conversion.
