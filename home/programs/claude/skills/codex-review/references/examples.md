# Code Review with Codex MCP — Examples

## Example 1: Plan review

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

## Example 2: Code review with auto-fix loop

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

## Example 3: Security-focused review

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
