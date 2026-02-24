---
name: gemini-data-analyst
description: >-
  Analyzes large text datasets with Gemini by splitting into batches and synthesizing
  results. Distinct from gemini-research (which is for codebases with --include-directories):
  this skill handles arbitrary text files—logs, JSONL exports, CSV, conversation history,
  chat exports, etc. Use when asked to "analyze this large data", "geminiで分析して",
  "大量のログを解析して", "バッチに分けてGeminiに投げて", or when a dataset exceeds
  Gemini's context limit.
argument-hint: "[batch-size-kb]"
---

# Gemini Data Analyst

## Overview

This skill analyzes large text datasets with Gemini CLI using stdin piping, batch splitting, and multi-pass synthesis. It handles arbitrary text files that cannot fit in a single Gemini context window.

**Key distinction from `gemini-research`**:
| Skill | Target | Method |
|-------|--------|--------|
| `gemini-research` | Codebases | `--include-directories` (filesystem tool) |
| `gemini-data-analyst` | Arbitrary text data | stdin pipe + batch splitting + synthesis |

## Quick Start

```
/gemini-data-analyst          # Analyze with default 800KB batches
/gemini-data-analyst 400      # Use 400KB batches (smaller chunks for dense text)
```

**Typical flow**: Share the data path and analysis goals → Claude extracts text, splits into batches, runs Gemini → synthesized final report.

## Technical Constraints

Before running any analysis, internalize these constraints to avoid failures:

- **Model**: Always specify explicitly: `gemini -m gemini-2.5-pro`
  - The default model may be unavailable on Vertex AI; explicit spec is required
  - Test availability first: `echo "test" | gemini -m gemini-2.5-pro -p "respond with ok"`

- **Method**: Use stdin pipe, NOT `--include-directories`
  - `--include-directories` enables the filesystem tool, causing Gemini to follow file path references in content—never appropriate for text data analysis
  - ✓ `cat file.txt | gemini -m gemini-2.5-pro -p "..."`
  - ✗ `gemini -p "..." --include-directories /path/`

- **Batch size**: ≤ 800KB per batch (Japanese: ~320K tokens; English: ~200K tokens)
  - Japanese text: ~2.5 chars/token → 800KB ≈ 320K tokens (safe margin below 1M limit)
  - English text: ~4 chars/token → 800KB ≈ 200K tokens
  - Even within token limits, files > 1.2MB risk JS heap OOM in the gemini CLI process

- **Parallelism**: Max 2 concurrent sessions. Use `sleep 5` between additional batches
  - 3+ parallel sessions causes 429 Rate Limit on Vertex AI

See [references/batch-constraints.md](references/batch-constraints.md) for detailed technical reference.

## Workflow

### Step 1 — Parse Arguments

If `$ARGUMENTS` is provided (e.g., `/gemini-data-analyst 400`), use it as the batch size in KB. Otherwise default to 800.

Set `BATCH_KB` before proceeding:
- With argument: `BATCH_KB=$ARGUMENTS`
- Without argument: `BATCH_KB=800`

### Step 2 — Understand the Data

Clarify with the user:
- **Data location**: Path to the file or directory
- **Format**: JSONL, plain text, CSV, log files, etc.
- **Analysis goal**: What insights are needed?

Determine preprocessing based on format:
- `.jsonl`: Extract text-only fields (e.g., `jq` to filter by type/role)
- `.log` / `.txt`: Filter empty lines with `grep -v '^$'`
- Other: Check size with `wc -c` to assess batching needs

### Step 3 — Prepare Data

```bash
mkdir -p /tmp/gemini_analysis

# Example for JSONL conversation export:
# Extract only user/assistant text messages, skip tool calls and progress events
jq -r '
  select(.message != null) |
  select(.message.role == "user" or .message.role == "assistant") |
  "[\(.timestamp // "?")] [\(.message.role | ascii_upcase)] " +
  ([.message.content[]? | select(.type == "text") | .text] | join("\n")) |
  select(length > 30)
' input.jsonl > /tmp/gemini_analysis/data.txt

# Check size
wc -c /tmp/gemini_analysis/data.txt

# Split into chunks
split -C ${BATCH_KB}k /tmp/gemini_analysis/data.txt /tmp/gemini_analysis/chunk_
```

Verify chunk count: `ls /tmp/gemini_analysis/chunk_* | wc -l`

### Step 4 — Run Analysis Batches

Test model availability first:
```bash
echo "test" | gemini -m gemini-2.5-pro -p "respond with ok"
```

Run analysis via stdin pipe. Limit to 2 parallel sessions:

```bash
ANALYSIS_PROMPT="Analyze this data and extract: [specific goals]"

# Run 2 at a time with delays for rate limiting
for chunk in /tmp/gemini_analysis/chunk_*; do
  name=$(basename "$chunk")
  cat "$chunk" | gemini -m gemini-2.5-pro -p "$ANALYSIS_PROMPT" \
    > "/tmp/gemini_analysis/result_${name}.txt" &

  # Limit parallelism: every 2nd job, wait and add delay
  if [[ $(jobs -r | wc -l) -ge 2 ]]; then
    wait
    sleep 5
  fi
done
wait
```

Monitor for failures: `ls -la /tmp/gemini_analysis/result_*.txt`
Empty files indicate silent failures (token limit exceeded or OOM). Split those chunks further and retry.

See [references/analysis-prompts.md](references/analysis-prompts.md) for prompt templates by data type.

### Step 5 — Synthesize

Combine batch results and run a synthesis pass:

```bash
cat /tmp/gemini_analysis/result_*.txt > /tmp/gemini_analysis/all_results.txt

SYNTHESIS_PROMPT="You are synthesizing analysis results from multiple batches of the same dataset.
Deduplicate findings, merge related insights, and produce a single coherent report.
Remove redundancy while preserving all unique findings."

cat /tmp/gemini_analysis/all_results.txt \
  | gemini -m gemini-2.5-pro -p "$SYNTHESIS_PROMPT" \
  > /tmp/gemini_analysis/final_report.txt
```

If `all_results.txt` exceeds 800KB, split and synthesize in two passes.

### Step 6 — Output

Present results according to user preference:

- **Chat display**: Summarize key findings inline
- **File save**: Write to a specified path
- **Obsidian save**: Use the **obsidian-mcp-tools** for vault file creation
  - List vault structure before saving: `list_vault_files` to confirm target directory
  - Default inbox: `00_Inbox/<filename>.md`

## Common Data Types

### JSONL Conversation Export

```bash
# Extract text-only, skip tool calls (133x compression typical)
jq -r '
  select(.message != null) |
  select(.message.role == "user" or .message.role == "assistant") |
  "[\(.message.role | ascii_upcase)] " +
  ([.message.content[]? | select(.type == "text") | .text] | join("\n")) |
  select(length > 30)
' sessions.jsonl
```

### Log Files

```bash
# Filter noise, keep meaningful lines
grep -v '^$' application.log | grep -v '^#' > /tmp/gemini_analysis/data.txt
```

### CSV / Structured Data

```bash
# Convert to readable format for Gemini
head -1 data.csv  # Check headers
# For large CSVs, analyze samples or aggregate first
```

## Error Recovery

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ModelNotFoundError` | Default model unavailable | Add `-m gemini-2.5-pro` explicitly |
| Empty output (0 bytes) | Token limit exceeded silently | Split chunk further (try 400KB) |
| `JS heap out of memory` | OOM in gemini CLI | Split to ≤600KB, retry once; skip if persists |
| `429 Resource Exhausted` | Too many parallel sessions | Reduce to 2 parallel, add `sleep 10` |
| Path reference errors | `--include-directories` activated | Switch to stdin pipe method |
