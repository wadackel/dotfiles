---
name: codex-review
description: Review implementation plans and code using Codex MCP. Enables iterative quality assurance through plan validation, code review, and automatic fix loops until Codex approval.
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

## Examples

### Example 1: Plan review

```javascript
// 1. Collect context
const planContent = await Read({ file_path: "plan.md" })
const guidelines = await Read({ file_path: "CLAUDE.md" })

// 2. Start review
const result = await mcp__codex__codex({
  prompt: `あなたは経験豊富なシニアアーキテクトです。
以下の実装計画をレビューしてください。

## 実装計画
${planContent}

## プロジェクトガイドライン
${guidelines}

## レビュー観点
- 実装アプローチの妥当性
- 技術選択の適切性
- リスクと代替案
- ガイドライン準拠
- スケーラビリティと保守性

レビュー結果を以下の形式で提供してください:
1. 総合評価（承認/条件付き承認/再検討推奨）
2. 強み（良い設計判断）
3. 懸念事項（改善が必要な点）
4. 代替案（あれば）
5. 推奨アクション`,
  sandbox: "read-only",
  "approval-policy": "on-failure"
})

// 3. Analyze and report results
```

### Example 2: Code review with auto-fix loop

```javascript
// 1. Collect changes
const gitDiff = await Bash({
  command: "git diff HEAD",
  description: "Get uncommitted changes for review"
})
const guidelines = await Read({ file_path: "CLAUDE.md" })

// 2. Start review
let review = await mcp__codex__codex({
  prompt: `あなたは厳格なシニアコードレビューアです。
以下のコード変更を徹底的にレビューしてください。

## 変更内容
${gitDiff}

## プロジェクトガイドライン
${guidelines}

## レビュー観点
- コード品質（可読性、保守性、命名規則）
- セキュリティ（OWASP Top 10、入力検証）
- パフォーマンス（アルゴリズム効率、非同期処理）
- ガイドライン準拠
- テストカバレッジ
- エラーハンドリング

各指摘には以下を含めてください:
1. ファイル名と行番号
2. 問題の説明
3. 重要度（Critical/High/Medium/Low）
4. 修正方法の提案`,
  sandbox: "workspace-write",
  "approval-policy": "on-failure"
})

const threadId = review.threadId
let iteration = 0
const maxIterations = 5

// 3. Fix loop
while (iteration < maxIterations) {
  iteration++

  const issues = parseCodexResponse(review)

  if (issues.length === 0) {
    console.log("✓ すべての指摘が解消されました")
    break
  }

  console.log(`反復 ${iteration}: ${issues.length}件の指摘を修正中...`)

  // Apply fixes
  for (const issue of issues) {
    await Edit({
      file_path: issue.file,
      old_string: issue.problematicCode,
      new_string: issue.suggestedFix
    })
  }

  // Continue review
  review = await mcp__codex__codex_reply({
    threadId: threadId,
    prompt: `${issues.length}件の指摘を修正しました。再度レビューをお願いします。`
  })
}
```

### Example 3: Security-focused review

```javascript
const diff = await Bash({ command: "git diff HEAD" })
const guidelines = await Read({ file_path: "CLAUDE.md" })

const securityReview = await mcp__codex__codex({
  prompt: `セキュリティレビューを実施してください。

## 変更内容
${diff}

## ガイドライン
${guidelines}

## セキュリティチェック項目（優先順位順）
1. **OWASP Top 10**: SQLインジェクション、XSS、CSRF、認証不備
2. **入力検証**: すべての外部入力のサニタイズと検証
3. **機密データ**: パスワード、トークン、APIキーの安全な取り扱い
4. **認証・認可**: 適切な権限チェックとセッション管理
5. **暗号化**: 転送時・保管時の暗号化
6. **エラーハンドリング**: 機密情報の漏洩防止
7. **依存関係**: 既知の脆弱性を持つライブラリの使用

Critical/High の指摘を最優先で報告してください。`,
  sandbox: "workspace-write",
  "approval-policy": "on-request"  // 厳格なレビューでは毎回確認
})
```

## Configuration

### Sandbox modes

| Mode | Use case | Description |
|------|----------|-------------|
| `read-only` | Plan review | No filesystem changes |
| `workspace-write` | Code review + auto-fix | Allow file changes in workspace |
| `danger-full-access` | System-wide changes | Not recommended (rarely needed) |

### Approval policies

| Policy | Use case | Description |
|--------|----------|-------------|
| `on-failure` | Normal review | Confirm only on failures (recommended) |
| `on-request` | Strict review | Confirm all operations |
| `never` | Full automation | No user confirmation (use with caution) |

### Recommended settings

**Plan review:**
```javascript
{
  sandbox: "read-only",
  "approval-policy": "on-failure"
}
```

**Code review with auto-fix:**
```javascript
{
  sandbox: "workspace-write",
  "approval-policy": "on-failure"
}
```

**Security audit:**
```javascript
{
  sandbox: "workspace-write",
  "approval-policy": "on-request"
}
```

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

Prevent infinite loops:
```javascript
const maxIterations = 5
let previousIssueCount = Infinity

for (let i = 0; i < maxIterations; i++) {
  const issues = await performReview()

  if (issues.length === 0) break

  if (issues.length >= previousIssueCount) {
    console.log("⚠ 進捗なし。手動対応が必要です。")
    break
  }

  previousIssueCount = issues.length
  await applyFixes(issues)
}
```

### 5. Progress reporting

Keep user informed:
```javascript
console.log(`\n=== レビュー反復 ${i}/${maxIterations} ===`)
console.log(`修正中: ${issues.length}件の指摘`)
```

## Limitations

### 1. Token limits
- Large codebases may exceed token limits
- **Solution**: Review diffs only, split by file

### 2. Network dependency
- Requires Codex MCP connection
- **Solution**: Implement retry mechanism

### 3. Review quality variance
- AI responses are non-deterministic
- **Solution**: Specify clear criteria, human final review

### 4. Loop convergence
- Same issues may repeat
- **Solution**: Max iteration limit (5 recommended)

### 5. Security and privacy
- Code sent to Codex MCP servers
- **Solution**: Exclude sensitive files (.env, credentials)

---

**Important**: This skill depends on Codex MCP availability. Review results are **reference information** - final decisions should be made by humans, especially for security and architecture changes.
