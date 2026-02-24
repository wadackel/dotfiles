# Batch Constraints Reference

Technical constraints for running Gemini CLI on large text datasets. Empirically verified during a 1.2GB Claude Code session analysis (2026-02-24).

---

## Token Limits

| Model | Context Limit | Notes |
|-------|--------------|-------|
| `gemini-2.5-pro` | 1,048,576 tokens | Available on Vertex AI |
| `gemini-2.5-flash` | 1,048,576 tokens | Available on Vertex AI, faster |
| `gemini-3-pro-preview` | — | Was unavailable on Vertex AI (default config) |

**Always test model availability before running a batch job:**
```bash
echo "test" | gemini -m gemini-2.5-pro -p "respond with ok"
```

---

## Token Density by Language

| Language | Chars per token | Safe batch size (≤800K tokens) |
|----------|----------------|-------------------------------|
| Japanese | ~2.5 chars/token | ~2MB raw → use 800KB chunks |
| English | ~4 chars/token | ~3.2MB raw → use 800KB chunks |
| Mixed | ~3 chars/token | ~2.4MB raw → use 800KB chunks |

**Conservative recommendation**: Use 800KB regardless of language. At 800KB:
- Japanese: ~320K tokens (68% below limit)
- English: ~200K tokens (80% below limit)

---

## OOM (Out of Memory) Risk

The Gemini CLI is a Node.js process with a default heap of ~1.5-2GB.

**OOM symptoms**: Process exits with `FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory`

**OOM thresholds observed:**
- 800KB–1.0MB: Generally safe
- 1.0MB–1.2MB: Occasionally fails (2-3 retries may succeed)
- >1.2MB: High OOM risk; split further

**If a chunk consistently OOM's:**
1. Split to 600KB and retry
2. If still failing, split to 400KB
3. If 3 attempts all fail, skip the chunk and note it in synthesis
4. Coverage from other chunks is usually sufficient for analysis tasks

---

## Rate Limiting

**Vertex AI limits**: Approximately 2 concurrent gemini sessions before 429 errors.

**Error**: `429 Resource Exhausted: Too many requests`

**Safe parallelism pattern:**
```bash
# Max 2 parallel, add 5s delay between groups
for chunk in chunk_*; do
  cat "$chunk" | gemini -m gemini-2.5-pro -p "$PROMPT" > "result_${chunk}.txt" &
  if [[ $(jobs -r | wc -l) -ge 2 ]]; then
    wait
    sleep 5
  fi
done
wait
```

**If 429 occurs during a run**: Wait 30 seconds, then retry the failed chunk(s) one at a time.

---

## File Splitting

```bash
# Split by size (recommended for most cases)
split -C 800k input.txt /tmp/chunks/chunk_

# Check results
ls -lh /tmp/chunks/
wc -l /tmp/chunks/chunk_*  # Verify no chunk is suspiciously small (empty file = split error)
```

**Chunk naming**: `split` generates suffixes `aa`, `ab`, `ac`... Use `chunk_` prefix for easy globbing.

---

## Silent Failures

The Gemini CLI may produce 0-byte output without error messages in two cases:

1. **Token limit exceeded**: Input exceeds 1M tokens → silent empty output
2. **Network timeout**: Long-running request times out

**Detection**: Always check output file size after each batch:
```bash
for f in result_*.txt; do
  size=$(wc -c < "$f")
  if [[ $size -lt 100 ]]; then
    echo "WARNING: $f is suspiciously small ($size bytes)"
  fi
done
```

**Fix**: If output is 0 bytes, split the corresponding chunk in half and retry.

---

## Stdin Pipe vs `--include-directories`

| Method | When to use | Behavior |
|--------|-------------|----------|
| `cat file \| gemini -m model -p "..."` | Text data analysis | Sends file content as context; no filesystem tool |
| `gemini -p "..." --include-directories /path/` | Codebase analysis | Enables filesystem tool; Gemini can navigate files |

**Never use `--include-directories` for text data analysis.** If the text content contains file paths (e.g., plan files referencing `./src/`), Gemini will attempt to read those paths, resulting in "Path not in workspace" errors for every reference.

---

## Synthesis Size Planning

After collecting batch results, the combined `all_results.txt` may also exceed limits.

| Batch count | Typical result size | Synthesis approach |
|------------|--------------------|--------------------|
| 1–5 | <800KB | Single synthesis pass |
| 6–15 | 800KB–3MB | Two-pass: group results → synthesize groups → final merge |
| >15 | >3MB | Multi-level synthesis tree |

**Two-pass example:**
```bash
# Group A: batches 1-5
cat result_chunk_a[a-e].txt | gemini -m gemini-2.5-pro -p "$SYNTH" > synth_group_a.txt

# Group B: batches 6-10
cat result_chunk_a[f-j].txt | gemini -m gemini-2.5-pro -p "$SYNTH" > synth_group_b.txt

# Final merge
cat synth_group_*.txt | gemini -m gemini-2.5-pro -p "$FINAL_SYNTH" > final_report.txt
```

---

## Working Directory

Use `/tmp/gemini_analysis/` as the working directory for intermediate files. It is cleaned on reboot and does not require cleanup.

```bash
mkdir -p /tmp/gemini_analysis
# All intermediate files go here
# Final report should be saved to the user's preferred location
```
