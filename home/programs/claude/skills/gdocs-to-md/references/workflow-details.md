# Workflow Details

## Flag Reference

### gws docs documents get

| Flag | Purpose |
|---|---|
| `--params '{"documentId":"<ID>"}'` | Fetch the full document structure |

Output is the bare Google Docs API JSON response. Top-level keys: `body`, `documentId`, `documentStyle`, `lists`, `namedStyles`, `revisionId`, `suggestionsViewMode`, `title`.

Pipe directly to the Deno script via stdin, or save to a temp file first:

```bash
TMP_JSON=$(mktemp -t gdoc-XXXXXX.json)
gws docs documents get --params '{"documentId":"<ID>"}' > "$TMP_JSON"
```

### gdoc-json-to-md.ts

Located at `~/dotfiles/home/programs/claude/scripts/gdoc-json-to-md.ts`.

Reads JSON from stdin, writes GitHub Flavored Markdown to stdout.

```bash
deno run ~/dotfiles/home/programs/claude/scripts/gdoc-json-to-md.ts < "$TMP_JSON" > output.md
```

No Deno permission flags required (stdin-only, no file/network access).

## Error Handling

| Situation | Action |
|---|---|
| `$ARGUMENTS` not provided | Use AskUserQuestion to prompt for URL or document ID |
| URL provided but no ID found | Report parsing failure; ask user to provide the raw document ID instead |
| gws auth / permission error | Report error; suggest running `gws auth login` to re-authenticate |
| Docs API not enabled | Report the error message; direct user to enable Docs API in GCP Console |
| `.body` missing in response | Print raw temp file content + path; stop |
| Title empty | Print raw temp file content + path; stop |
| Deno script fails | Print error + temp file path (JSON preserved); stop |

## Known Limitations

- **Images are not supported**: The Google Docs API does not provide image binary data. Documents containing inline images will have `<!-- image omitted -->` placeholders in the output.
- **Complex tables** may not convert cleanly; manual cleanup may be needed for merged cells or nested tables.
- **Comments, tracked changes, and footnotes** are ignored.
- **Re-running on the same document** overwrites the `.md` file silently. Rename the output file beforehand if you need to preserve a prior conversion.
