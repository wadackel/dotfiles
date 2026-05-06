---
name: codex-review
description: Reviews implementation plans and code changes through Codex CLI, enabling iterative quality assurance with automatic fix loops until Codex approves. Use when asked to "review with Codex", "Codex review", "plan review", "Codexでレビュー", "コードレビューして", "プランレビュー", "実装をレビューして", or when automated multi-round code review with an independent reviewer is needed after completing implementation.
argument-hint: "[plan|code|security]"
---

# Code Review with Codex CLI

## Quick start

```bash
# Code review (uncommitted changes, default criteria)
codex exec review --uncommitted --full-auto

# Code review (custom criteria — use `codex exec`, not `codex exec review`)
codex exec --full-auto "
Review uncommitted changes (run git diff to see them).
Review guidelines: ./CLAUDE.md
Criteria: code quality, security, performance
"

# Plan review
codex exec -s read-only "
Review the plan at ./plan.md
Project guidelines: ./CLAUDE.md
Related source: src/foo.ts, src/bar.ts
"

# Follow-up review
codex exec resume --last --full-auto "Fixes applied. Please re-review."
```

## Important: `codex exec review` vs `codex exec`

`codex exec review` scope selectors (`--uncommitted`, `--base`, `--commit`) and custom prompts are **mutually exclusive**:

- `codex exec review --uncommitted --full-auto` — reviews uncommitted changes with Codex's default criteria
- `codex exec review "custom instructions"` — custom review, but Codex decides the scope

For **custom criteria + specific scope**, use `codex exec --full-auto` instead and instruct Codex to read the diff:

```bash
codex exec --full-auto "
Review uncommitted changes (run git diff to see them).
Guidelines: ./CLAUDE.md
Focus on: security vulnerabilities
"
```

## Core workflow

1. **Context collection**: Gather file paths (not contents) for guidelines, plan, and related source
2. **Start review**: Invoke Codex CLI via Bash tool with paths in prompt
3. **Analyze issues**: Parse Codex's plain-text output for issues
4. **Apply fixes** (optional): Use Edit/Write tools to fix issues
5. **Follow-up** (optional): Use `codex exec resume` to continue the review session

## Commands

### Code review (standard)

Use when default review criteria are sufficient:

```bash
codex exec review --uncommitted --full-auto
```
- `--uncommitted`: Codex auto-reads staged/unstaged/untracked changes
- `--full-auto`: `-a on-request -s workspace-write`
- Use `--base <BRANCH>` instead of `--uncommitted` to review against a branch

### Code review (custom criteria)

Use when specific review focus is needed (security audit, guideline compliance, etc.):

```bash
codex exec --full-auto "
Review uncommitted changes (run git diff to see them).
Guidelines: ./CLAUDE.md
Review criteria:
1. Security (highest priority)
2. Code quality
3. Performance
Mark each issue with severity: Critical/High/Medium/Low
"
```
- Uses `codex exec` (not `codex exec review`) to allow custom prompt with scope instructions
- Codex reads the diff and referenced files locally

### Plan review

```bash
codex exec -s read-only "
Review the implementation plan:
- Plan: ./path/to/plan.md
- Guidelines: ./CLAUDE.md
- Related source: src/foo.ts, src/bar.ts

Review criteria: ...
"
```
- `-s read-only`: No filesystem writes, but Codex can read files
- Pass file paths only; Codex reads them locally

### Continue review (follow-up)

1. Apply fixes using Edit/Write tools
2. Invoke via Bash tool:
   ```bash
   codex exec resume --last --full-auto "Fixes applied. Please re-review."
   ```
   - `--last`: Resumes the most recent session in the current directory (cwd-filtered)
   - For parallel reviews, use explicit session ID: `codex exec resume <SESSION_ID> --full-auto "..."`
3. Repeat until no issues remain (max 5 iterations)

## Use cases

### Plan validation
Verify implementation plans before coding:
- Approach validation
- Technology selection review
- Risk identification
- Guideline compliance check

### Code quality review
Automated code review with fix iteration:
- Code quality (readability, maintainability)
- Security (OWASP Top 10, input validation)
- Performance (algorithm efficiency, async patterns)
- Guideline compliance (project coding standards)
- Test coverage

### Security audit
Focus on security aspects:
- Authentication/authorization
- Input validation and sanitization
- Sensitive data handling
- Error handling

## Best practices

### 1. Path-based context (not content)

Pass file **paths** in the prompt, not file contents. For detailed guidelines, see the **codex-cli** skill.

### 2. Clear review criteria

Specify what to review with prioritized criteria:
```
## Review criteria (priority order)
1. Security (highest)
2. Code quality
3. Performance
4. Test coverage

Mark each issue with severity: Critical/High/Medium/Low
```

### 3. Loop safety

Prevent infinite loops (max 5 iterations). If the same issues persist after 3 attempts, stop and ask the user for guidance.

### 4. Progress reporting

Keep user informed during iteration cycles.

### 5. Timeout awareness

Codex CLI runs synchronously via Bash tool. Default timeout is 10 minutes (max 20 minutes). For large reviews, consider:
- Splitting review by file groups
- Using `--base` with a narrow commit range

## CLI reference

For CLI flag details, run `codex exec review --help`. For general Codex CLI usage (sandbox modes, session management, path-based context), see the **codex-cli** skill.

## Examples

See `references/examples.md` for complete examples of plan review, code review with auto-fix loop, and security-focused review.

## Limitations

1. **Scope + prompt exclusivity**: `codex exec review` scope selectors (`--uncommitted`/`--base`/`--commit`) cannot be combined with custom prompts. Use `codex exec` for custom criteria.
2. **Token limits**: Large codebases may exceed Codex's context. Use `--uncommitted` (auto-scoped) or split by file groups.
3. **Review quality variance**: AI responses are non-deterministic. Specify clear criteria, use human final review.
4. **Loop convergence**: Same issues may repeat. Max iteration limit (5 recommended).
5. **Bash tool timeout**: Default 10 min, max 20 min. Large reviews may need to be split.
6. **Session resume scope**: `--last` selects the most recent session in cwd. For parallel reviews, use explicit session IDs.

---

**Important**: Review results are **reference information** - final decisions should be made by humans, especially for security and architecture changes.
