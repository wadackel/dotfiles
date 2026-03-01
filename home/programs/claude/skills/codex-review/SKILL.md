---
name: codex-review
description: Reviews implementation plans and code changes through Codex MCP, enabling iterative quality assurance with automatic fix loops until Codex approves. Use when asked to "review with Codex", "Codex review", "plan review", "Codexでレビュー", "コードレビューして", "プランレビュー", "実装をレビューして", or when automated multi-round code review with an independent reviewer is needed after completing implementation.
argument-hint: "[plan|code|security]"
---

# Code Review with Codex MCP

## Quick start

```bash
# Plan review
Read plan.md
Read CLAUDE.md
mcp__codex__codex --sandbox read-only --prompt "[plan review prompt]"

# Code review
git diff HEAD
Read CLAUDE.md
mcp__codex__codex --sandbox workspace-write --prompt "[code review prompt]"

# Follow-up review
mcp__codex__codex-reply --threadId <id> --prompt "修正しました。再レビューをお願いします。"
```

## Core workflow

1. **Context collection**: Read CLAUDE.md and related files
2. **Start review**: Use `mcp__codex__codex` to start review session
3. **Analyze issues**: Extract issues from Codex response
4. **Apply fixes** (optional): Use Edit/Write tools to fix issues
5. **Follow-up** (optional): Use `mcp__codex__codex-reply` to continue review

## Commands

### Start plan review

1. Read plan file (plan.md)
2. Read CLAUDE.md for project guidelines
3. Call `mcp__codex__codex`:
   - `sandbox: "read-only"`
   - `approval-policy: "on-failure"`
   - Include plan content, guidelines, and review criteria in prompt

### Start code review

1. Collect changes: `git diff HEAD`
2. Read CLAUDE.md for coding standards
3. Call `mcp__codex__codex`:
   - `sandbox: "workspace-write"`
   - `approval-policy: "on-failure"`
   - Include diff, guidelines, and review criteria in prompt
4. Save threadId from response

### Continue review

1. Apply fixes using Edit/Write tools
2. Call `mcp__codex__codex-reply`:
   - `threadId: <saved-id>`
   - `prompt: "修正を適用しました。再度レビューをお願いします。"`
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

### 1. Context collection

**Always include:**
- Project CLAUDE.md (coding standards)
- Plan file (for plan review)
- Git diff (for code review)

**Include when relevant:**
- Architecture documents (for plan review)
- Test files (for code review)
- Security requirements (for security review)

**Avoid:**
- Loading all files at once (token inefficiency)
- Including irrelevant context

### 2. Clear review criteria

Specify what to review:
```javascript
const prompt = `
## レビュー観点（優先順位順）
1. セキュリティ（最優先）
2. コード品質
3. パフォーマンス
4. テスト

各指摘に重要度（Critical/High/Medium/Low）を明記してください。
`
```

### 3. Structured responses

Request JSON format for easier parsing:
```javascript
const prompt = `
レビュー結果を以下のJSON形式で提供してください:
{
  "overall_status": "approved|conditional|rejected",
  "issues": [
    {
      "severity": "critical|high|medium|low",
      "file": "path",
      "line": 123,
      "description": "...",
      "suggestion": "..."
    }
  ]
}
`
```

### 4. Loop safety

Prevent infinite loops (max 5 iterations). If the same issues persist after 3 attempts, stop and ask the user for guidance.

### 5. Progress reporting

Keep user informed during iteration cycles.

## Configuration reference

See `references/configuration.md` for sandbox modes and approval policies.

## Examples

See `references/examples.md` for complete examples of plan review, code review with auto-fix loop, and security-focused review.

## Limitations

1. **Token limits**: Large codebases may exceed token limits. Review diffs only, split by file.
2. **Network dependency**: Requires Codex MCP connection.
3. **Review quality variance**: AI responses are non-deterministic. Specify clear criteria, use human final review.
4. **Loop convergence**: Same issues may repeat. Max iteration limit (5 recommended).
5. **Security and privacy**: Code sent to Codex MCP servers. Exclude sensitive files (.env, credentials).

---

**Important**: This skill depends on Codex MCP availability. Review results are **reference information** - final decisions should be made by humans, especially for security and architecture changes.
