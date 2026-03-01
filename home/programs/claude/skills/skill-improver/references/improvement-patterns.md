# Common Improvement Patterns

## Pattern 1: Vague Description → Specific Description

**Before:**
```yaml
description: Helps with code review
```

**After:**
```yaml
description: Reviews code changes for quality, security, and adherence to project conventions. Use when reviewing pull requests, staged changes, or when the user asks for code review, quality check, or feedback on their code.
```

## Pattern 2: Missing Progressive Disclosure

**Before:** 400-line SKILL.md with everything inline

**After:**
- ~150-line SKILL.md with overview and navigation
- `references/` directory with detailed content
- Clear links from SKILL.md to references

## Pattern 3: Over-Explained Content

**Before:**
```markdown
Git is a distributed version control system that helps you track changes...
[lengthy explanation of git basics]

To see recent commits, run:
```

**After:**
```markdown
See recent commits:
```

## Pattern 4: Unclear Workflow

**Before:** Prose-style instructions without clear steps

**After:**
```markdown
## Workflow

1. First, do X
2. Then, do Y
3. Finally, do Z
```

## Pattern 6: Missing argument-hint

**Before:**
```yaml
---
name: my-skill
description: Does X with $ARGUMENTS.
---
```

**After:**
```yaml
---
name: my-skill
description: Does X with $ARGUMENTS.
argument-hint: "[target-name]"
---
```

Skills that reference `$ARGUMENTS` should have `argument-hint` so the user sees a hint during autocomplete (e.g., `/my-skill [target-name]`).

## Pattern 7: Missing Prerequisite Validation

**Before:**
```markdown
## Workflow

### Step 1: Get pane list
```bash
tmux list-panes ...
```
```

**After:**
```markdown
## Workflow

### Step 0: Validate environment
Check required env vars and tools are available:
```bash
echo "${TMUX_PANE:-}"  # empty = not in a tmux session → stop and inform user
```

### Step 1: Get pane list
```bash
tmux list-panes ...
```
```

For skills that depend on external tools, env vars, or running services, add a Step 0 that validates the prerequisite and provides a clear error if it's missing.

## Pattern 8: No Workflow Selection in Multi-Workflow Skills

**Before:**
```markdown
## Workflows

### Workflow 1: Repository Analysis
...

### Workflow 2: Library Research
...

### Workflow 3: Error Investigation
...
```

**After:**
```markdown
## Workflows

### Step 0: Select Workflow
```
Exploring an unfamiliar codebase?          → Workflow 1
Choosing or comparing libraries?           → Workflow 2
Investigating a build error?               → Workflow 3
```

### Workflow 1: Repository Analysis
...
```

When a skill has multiple distinct workflows, add a decision tree at the top so Claude (and the user) can immediately navigate to the right one.

## Pattern 9: Unsafe Shell Commands

**Before:**
```bash
git add -A
git commit -m "fix: ..."
```

**After:**
```bash
git status --porcelain
# Review output — ensure no sensitive files (.env, credentials*, *.pem) are included
git add <file1> <file2> ...
git commit -m "fix: ..."
```

Replace blind staging/deletion commands with safety-first patterns. Always check before side-effect operations that can't be undone.

## Pattern 5: Missing Trigger Phrases

**Before:**
```yaml
description: Processes Excel files
```

**After:**
```yaml
description: Processes Excel files, creates pivot tables, generates charts. Use when analyzing Excel files, spreadsheets, tabular data, .xlsx files, or when the user asks to "work with Excel" or "analyze this spreadsheet".
```
