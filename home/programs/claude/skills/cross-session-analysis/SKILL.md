---
name: cross-session-analysis
description: >-
  Analyzes conversation history across multiple Claude Code sessions and projects to detect
  recurring patterns, then proposes Skill creation, CLAUDE.md improvements, and SubAgent
  opportunities. Uses Gemini for large-scale text analysis and Claude for synthesis and
  classification. Use when asked to "cross-session analysis", "複数セッション分析",
  "会話履歴を横断分析して", "セッション横断の振り返り", "過去の会話から改善点を抽出",
  or any request to analyze patterns across past sessions. Distinct from /session-retrospective
  (single session only). Defaults to past 30 days; use --days all for full history.
argument-hint: "[--days N|all] [project-filter]"
---

# Cross-Session Analysis

Analyze conversation history across all Claude Code projects to detect recurring patterns and propose improvements (Skills, CLAUDE.md entries, SubAgents).

**Key distinction from `/session-retrospective`**: This skill analyzes 100+ sessions across multiple projects. `/session-retrospective` reviews a single session.

## Arguments

Parse `$ARGUMENTS` for options:
- `--days N`: Limit analysis to sessions from the past N days (default: 30). If N is not a positive integer, default to 30
- `--days all`: Analyze all sessions regardless of date
- No `--days` flag: defaults to `--days 30`
- Project filter (remaining args): filter to projects whose path contains the argument (e.g., `dotfiles`)
- Examples: `/cross-session-analysis`, `/cross-session-analysis --days 7 dotfiles`, `/cross-session-analysis --days all`

## Workflow

### Phase 0: Preparation

```bash
mkdir -p /tmp/gemini_analysis/cross_session
echo "test" | gemini -m gemini-2.5-pro -p "respond with ok"
```

If Gemini is unavailable, stop and report the error.

### Phase 1: Index Analysis

Scan all projects and extract lightweight metadata for a quick overview.

1. List project directories:
   ```bash
   ls ~/.claude/projects/
   ```

2. For each project, check for `sessions-index.json`. Extract `firstPrompt` + `summary` from each session entry. For projects without an index, scan JSONL files for the first user message as fallback.

3. **Date filtering**: Compute cutoff date from `--days` argument (`new Date(Date.now() - days * 86400000)`). For each project:
   - If `sessions-index.json` exists: keep only entries where `created >= cutoffDate`
   - If no index: keep only `.jsonl` files where file mtime >= cutoffDate (use `stat` or `Deno.stat()`)
   - Write all target session IDs to `/tmp/gemini_analysis/cross_session/target_sessions.txt` (one ID per line)
   - Report to user before proceeding:
     ```
     Date filter: past N days (since YYYY-MM-DD)
     Sessions: X/Y in range, Z excluded
     ```
   - If `--days all`, skip this step entirely (no target file written).

4. Combine into a single file and send to Gemini for clustering:
   ```bash
   cat /tmp/gemini_analysis/cross_session/all_index.txt \
     | gemini -m gemini-2.5-pro -p "$(cat)" \
     > /tmp/gemini_analysis/cross_session/phase1_clusters.txt
   ```
   See [references/gemini-prompts.md](references/gemini-prompts.md) for the Phase 1 prompt.

5. Present cluster results to user for validation before proceeding.

### Phase 2: Text Extraction

Extract full text from target sessions using Deno. **Do not use jq** — `message.content` is sometimes a string, sometimes an array, and jq filters silently produce empty output.

Before extraction, read `/tmp/gemini_analysis/cross_session/target_sessions.txt` if it exists. Skip any JSONL file whose session ID (filename without `.jsonl`) is not in the target list. If the file does not exist (`--days all` was specified), extract all sessions.

See [references/extraction-logic.md](references/extraction-logic.md) for the Deno extraction script pattern.

Key requirements:
- Handle both string and array `message.content`
- Preserve session boundaries with `=== SESSION: <id> ===` markers
- Extract: user messages, assistant text blocks, tool_use names (not full content)
- Output one file per project: `/tmp/gemini_analysis/cross_session/{project}_messages.txt`

After extraction, check sizes:
```bash
wc -c /tmp/gemini_analysis/cross_session/*_messages.txt
```

### Phase 3: Batch Analysis with Gemini

For each project's extracted text:

1. **Split into batches** at session boundaries (max 800KB per batch). Do NOT use `split -C` — it breaks mid-session. Instead, accumulate sessions until the batch would exceed 800KB, then start a new batch file.

2. **Run Gemini analysis** (max 2 parallel, `sleep 5` between additional batches):
   ```bash
   cat "$batch" | gemini -m gemini-2.5-pro -p "$PROMPT" \
     > "/tmp/gemini_analysis/cross_session/result_${name}.txt" &
   ```
   See [references/gemini-prompts.md](references/gemini-prompts.md) for the comprehensive analysis prompt.

3. **Verify output**: Check each result file size. 0 bytes = silent failure. Re-split to 400KB and retry.

### Phase 4: Cross-Project Synthesis

Combine all batch results and run a Gemini synthesis pass:
```bash
cat /tmp/gemini_analysis/cross_session/result_*.txt \
  > /tmp/gemini_analysis/cross_session/all_results.txt
cat /tmp/gemini_analysis/cross_session/all_results.txt \
  | gemini -m gemini-2.5-pro -p "$SYNTHESIS_PROMPT" \
  > /tmp/gemini_analysis/cross_session/final_report.txt
```

If `all_results.txt` exceeds 800KB, split and synthesize in two passes.

### Phase 5: Claude Synthesis

Read the Gemini results with the Read tool and apply existing frameworks:

1. **Classify** findings using `session-retrospective`'s 5 learning categories:
   - Missing Context, Corrected Approaches, Repeated Workflows, Tool/Library Knowledge, Preference Patterns

2. **Detect skill opportunities** using the 6 signals from `session-retrospective/references/skill-opportunity-detection.md`:
   - Complex Multi-Step, User Teaching, Cross-Session Repetition, Tool Orchestration, Similar to Existing Skills, Knowledge Systematization

3. **Route** each finding:
   | Target | Criteria |
   |--------|----------|
   | New Skill | `/skill-name` invocation makes sense, 4+ steps, tool orchestration |
   | Skill Modification | Existing skill missing information discovered in analysis |
   | Global CLAUDE.md | Universal cross-project pattern, passive behavioral rule |
   | Project CLAUDE.md | Project-specific fact or convention |
   | SubAgent | Independent context needed, tool constraints, large output isolation |

4. **Deduplicate** against existing CLAUDE.md content and skills.

5. **Spot check**: Verify 2-3 findings against actual session data to ensure Gemini didn't hallucinate.

### Phase 6: Present Proposals

Group by action type and present one-by-one for user approval:

```
## Cross-Session Analysis Results

### New Skill Proposals (N items)
[name, invocation, workflow outline, why-not-CLAUDE.md justification]

### CLAUDE.md Improvements (N items)
[diff format, placement location]

### Existing Skill Modifications (N items)
[before/after diff]

### SubAgent Proposals (N items)
[name, description, tools, use case]
```

Apply only user-approved proposals. For skill creation, use `skill-creator` principles.

## Technical Constraints

- **Gemini**: `gemini -m gemini-2.5-pro`, stdin pipe only, 800KB/batch, max 2 parallel
- **Extraction**: Deno/TypeScript only (not jq — see Phase 2)
- **Session splitting**: At session boundaries, not arbitrary byte offsets
- **`!` in Deno eval**: Use `set +H &&` prefix to disable history expansion
- **Estimated Gemini calls**: 5-9 (Phase 1: 1, Phase 3: 3-6, Phase 4: 1-2)

## Related Skills

- **session-retrospective** — Single-session analysis (this skill is the multi-session version)
- **gemini-data-analyst** — Generic large text analysis with Gemini (this skill specializes it for session history)
- **skill-creator** — Used to implement approved skill proposals
- **skill-improver** — Used to implement approved skill modifications
