# Gemini Prompt Templates

## Phase 1: Index Clustering

```
You are analyzing session metadata from a Claude Code user's conversation history across multiple projects.

Each entry contains:
- Project name (encoded directory path)
- Session ID
- First prompt (what the user initially asked)
- Summary (auto-generated session summary, may be absent)

Your task:

1. **Cluster sessions by topic/workflow type** (e.g., "Nix configuration", "PR management", "skill development", "browser automation", "debugging")

2. **Detect recurring topics** appearing in 3+ sessions. For each:
   - Topic name
   - Session count
   - Which projects it spans

3. **Flag correction language** — sessions where firstPrompt or summary contains correction signals:
   - Japanese: "修正", "直して", "ではなく", "違う", "間違い", "やり直し"
   - English: "fix", "wrong", "instead of", "not X but Y", "correct"

4. **Identify cross-project patterns** — workflows or topics appearing in 2+ different projects

Output as structured markdown with clear headings and counts.
```

## Phase 3: Comprehensive Per-Project Analysis

```
You are analyzing Claude Code conversation transcripts from the project "{PROJECT_NAME}".

The text contains multiple sessions separated by "=== SESSION: <id> ===" markers.
Each session contains user messages (USER), assistant messages (ASSISTANT), and tool usage indicators.

Analyze ALL sessions comprehensively and extract findings in these three areas:

### 1. Recurring Patterns
- Workflows repeated across 2+ sessions (same sequence of steps)
- Topic clusters (same type of task requested multiple times)
- Tool chain patterns (same tools used in the same order)
- Common starting points (how sessions typically begin)

### 2. Corrections & Instructions
- User corrections to Claude's behavior (e.g., "use X not Y", "that's wrong")
- Repeated instructions the user gives every time (signals missing CLAUDE.md)
- Implicit preferences revealed through approval/rejection patterns
- Japanese correction signals: "ではなく", "違う", "そうじゃなくて", "修正して"
- English correction signals: "instead of", "not X but Y", "wrong", "fix this"

### 3. Automation Gaps
- Multi-step procedures (4+ steps) that could be automated as a skill
- Tasks where the user explains a complex process step by step
- Delegation patterns (user asks Claude to coordinate multiple tools)
- Setup/boilerplate that recurs across sessions

For EACH finding, output in this format:

## Finding: [descriptive title]
- **Category**: Pattern / Correction / Workflow / Gap
- **Frequency**: N sessions (list session IDs if visible)
- **Evidence**: Direct quotes from user messages (Japanese or English as found)
- **Specificity**: Project-specific / Universal (would apply to any project)
- **Actionable**: Skill / CLAUDE.md / Agent / Skill-modification / None
- **Details**: Brief explanation of the finding and its significance

Be specific. Cite actual user quotes. Avoid generic observations.
Do NOT invent findings — only report what is directly evidenced in the data.
```

## Phase 4: Cross-Project Synthesis

```
You are synthesizing analysis results from multiple projects belonging to the same Claude Code user.
Each section below contains findings from a different project's conversation history.

Your task:

1. **Deduplicate**: Merge identical or near-identical findings across projects
2. **Identify universal patterns**: Findings that appear in 2+ projects (highest value — these are cross-project habits)
3. **Rank by frequency**: More cross-project mentions = higher confidence
4. **Separate**: Clearly distinguish "Universal" (multi-project) from "Project-specific" findings
5. **Preserve evidence**: Keep all direct quotes and session references

Output format:

## Universal Patterns (cross-project)
[Findings appearing in 2+ projects, ranked by frequency]

## Project-Specific Patterns
### [Project Name]
[Findings unique to this project]

## Top Improvement Opportunities (ranked by impact)
For each opportunity:
- **Action**: Skill / CLAUDE.md / Agent / Skill-modification
- **Confidence**: High / Medium / Low
- **Evidence**: Key quotes
- **Impact**: Why this improvement matters
- **Proposed implementation**: Brief description of what to create/modify
```
