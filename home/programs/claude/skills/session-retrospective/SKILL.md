---
name: session-retrospective
description: Review the current session to extract learnings and propose improvements to CLAUDE.md files and skills. Run at the end of a session or when asked to reflect on what was learned. Routes project-specific learnings to the project CLAUDE.md, universal patterns to the global ~/.claude/CLAUDE.md, and repeated workflows to skill creation/modification proposals. Triggers include "retrospective", "session retro", "振り返って", "何を学んだ？", "セッションの学び", "what did we learn?", "improve from this session".
---

# Session Retrospective

Review the current session to extract learnings and propose improvements to CLAUDE.md files and skills, making Claude more autonomous with each session.

## Overview

This skill analyzes the conversation history to identify learnings that should be codified into:
- **Project CLAUDE.md** — Project-specific patterns, commands, and conventions
- **Global ~/.claude/CLAUDE.md** — Universal coding styles, Claude behaviors, and cross-project patterns
- **Skills** — Repeated multi-step workflows that can be automated

Unlike `/revise-claude-md` which focuses on missing context, this skill provides broader analysis including corrected approaches, repeated workflows, and skill improvement opportunities.

## Quick Start

```
/session-retrospective
```

No arguments needed. The skill analyzes the current session context automatically.

## Workflow

### Phase 1: Analyze Session

Gather full session data and reflect on it:

1. **Extract full transcript history** (Compact で失われた内容も含む完全な記録):
   ```bash
   extract-session-history.ts
   ```
   stdout に出力されたファイルパスを Read ツールで読み込む。

2. **Review extracted history** focusing on:
   - Tasks performed and their outcomes
   - Errors encountered and how they were resolved
   - Questions asked to the user (signals missing context)
   - User corrections to Claude's approach
   - Repeated patterns of work
   - Tool usage patterns (Tool Usage Summary セクション参照)
   - Compact boundaries (セッション内のフェーズ遷移を示す)

3. **Git activity** (if in a git repository):
   ```bash
   git log --oneline -20
   git diff --stat HEAD~5..HEAD
   ```

4. **Current context files**:
   - Read project CLAUDE.md (if exists)
   - Read global ~/.claude/CLAUDE.md
   - List existing skills in ~/.claude/skills/

### Phase 2: Categorize Learnings

Classify each learning into categories. See [references/learning-categories.md](references/learning-categories.md) for detailed definitions and examples.

**Summary of categories:**

1. **Missing Context** — Information Claude needed but did not have
   - Example: "This project uses pnpm, not npm"
   - Example: "Always run nix flake check before darwin-rebuild"

2. **Corrected Approaches** — User corrections to Claude's behavior
   - Example: "User prefers Japanese commit messages"
   - Example: "Use `gh` for GitHub URLs, not WebFetch"

3. **Repeated Workflows** — Multi-step procedures performed multiple times
   - Example: "Check CI → read logs → fix → push → wait (repeated 3 times)"
   - Example: "Every nix change: edit → nix flake check → darwin-rebuild switch"

4. **Tool/Library Knowledge** — Discoveries about specific tools or APIs
   - Example: "ast-grep requires stopBy: end for relational rules"
   - Example: "playwright-cli session-list should be checked first"

5. **Preference Patterns** — User style or preference observations
   - Example: "User prefers concise output, dislikes verbose explanations"
   - Example: "User wants draft PRs with English descriptions"

### Phase 3: Route Proposals

Determine where each learning belongs using routing logic. See [references/routing-logic.md](references/routing-logic.md) for the full decision tree.

**Quick routing summary:**

- **Project-specific** (contains project paths, build commands, framework-specific details)
  → Project CLAUDE.md

- **Universal/cross-project** (coding style, general tool usage, Claude's behavior)
  → ~/.claude/CLAUDE.md

- **Repeated workflow** (2+ occurrences, 3+ steps, generalizable)
  → New skill or skill modification proposal

- **Tool-specific knowledge for existing skill**
  → Skill modification proposal

### Phase 4: Draft Proposals

For each routed learning, draft a concrete proposal:

**CLAUDE.md additions:**
- Format: One line per concept (consistent with `/revise-claude-md`)
- Show exact placement (after which section heading)
- Use diff format for clarity
- Example:
  ```diff
  ## Development Commands
  + nix flake check - Validate Nix syntax before applying changes
  ```

**New skill proposals:**
- Proposed name and description (frontmatter)
- Brief SKILL.md outline
- Needed resources (scripts/, references/)
- Example:
  ```
  Skill: nix-rebuild-workflow
  Description: Automates nix flake check → darwin-rebuild switch workflow
  Resources: None (uses Read, Bash tools only)
  ```

**Skill modification proposals:**
- Show before/after diff of changes
- Explain rationale for the modification
- Example:
  ```diff
  ## Quick Start

  - playwright-cli session-list
  + playwright-cli session-list - Check active sessions first
  ```

### Phase 5: Present and Apply

Present all proposals grouped by target:

```
## Session Retrospective Results

### Project CLAUDE.md Proposals (N items)
[numbered proposals with diffs]

### Global CLAUDE.md Proposals (N items)
[numbered proposals with diffs]

### Skill Proposals (N items)
[new skills and modifications]

---
Which proposals would you like to apply?
(all / specific numbers like 1,3,5 / none)
```

**After user approval:**
- Apply CLAUDE.md changes with Edit tool
- Create new skills (use skill-creator toolchain or direct file creation)
- Apply skill modifications with Edit tool
- Report what was applied

## Guidelines

### What NOT to Propose

- Information Claude already knows (well-known concepts, standard library usage)
- Temporary or one-off decisions that don't generalize
- Information already present in the target CLAUDE.md or skill
- Overly specific instructions that reduce flexibility

### Proposal Quality

- Each proposal should be actionable (specific text to add, not vague suggestions)
- Each proposal should justify its token cost (high signal-to-noise ratio)
- Prefer additions that prevent future mistakes over documenting facts
- Keep proposals concise — one line per concept for CLAUDE.md entries

### Respecting Existing Content

- Read existing CLAUDE.md files before proposing additions
- Do not duplicate existing entries
- Match the style and language of the existing file (Japanese or English)
- Place additions in the appropriate section (do not append everything at the end)

### Language Matching

When proposing CLAUDE.md additions:
- Detect the primary language of the target file
- Write proposals in that language
- For mixed-language files, match the language of the relevant section

## Related Skills

- **/revise-claude-md** — Focused CLAUDE.md updates based on missing context (narrower scope)
- **skill-improver** — Evaluates and improves existing skill quality
- **skill-creator** — Creates new skills from scratch
- **skill-tester** — Validates skill behavior after modifications
