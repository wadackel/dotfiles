---
name: instinct-learner
description: Extracts atomic behavioral rules (instincts) from session learnings with confidence scoring. Integrates with session-retrospective Phase 2.6 to accumulate learnings across sessions. Instincts with high confidence (0.7+) are promoted to CLAUDE.md. Triggers include "instinct-learner", "instinct を抽出", "学びを蓄積", "extract instincts".
---

# Instinct Learner

セッションの学びを原子的な「instinct」（1行ルール + confidence スコア）として蓄積し、十分な確信度に達したら CLAUDE.md に昇格させる。

## Overview

session-retrospective が学びを抽出 → instinct-learner が原子的ルールとして蓄積 → confidence が蓄積 → CLAUDE.md に昇格

```
Session A: "出力件数を確認しなかった" → instinct 作成 (confidence: 0.5)
Session B: "テスト結果の値を検証しなかった" → 同じ instinct を reinforce (confidence: 0.6)
Session C: ユーザーが "数を確認して" と補正 → reinforce +0.2 (confidence: 0.8)
→ confidence 0.7+ → CLAUDE.md promotion 候補
```

## When to Use

- `/session-retrospective` の Phase 2.6 から自動呼び出し
- 手動で `/instinct-learner` として呼び出し（instinct の管理）

## Instinct Format

ストレージ: `~/.claude/instincts.jsonl`（1行1 instinct、JSON Lines）

```json
{
  "id": "inst-001",
  "rule": "出力値の正しさを検証する（エラー不在だけでなく）",
  "status": "active",
  "confidence": 0.5,
  "domain": "verification",
  "source_sessions": ["session-abc"],
  "created": "2026-03-19",
  "last_reinforced": "2026-03-19",
  "promoted_at": null,
  "claude_md_section": null
}
```

## Confidence Scoring

| イベント | confidence 変化 |
|---|---|
| 初回作成 | 0.5 |
| 別セッションで再観測 | +0.1 |
| ユーザー補正による確認 | +0.2（最強シグナル） |
| 5セッション以上で強化なし | -0.1 |

| 閾値 | アクション |
|---|---|
| 0.3 以下 | 自動 prune（status=active のもののみ） |
| 0.7 以上 | CLAUDE.md promotion 候補 |
| 0.9 | 上限 |

## Lifecycle States

- **active**: デフォルト。蓄積中
- **promoted**: CLAUDE.md に昇格済み。prune 対象外
- **pruned**: 削除済み

## CLI Commands

```bash
# 新規 instinct 追加
instincts.ts add --rule "ルール文" --domain "verification" --session "session-id"

# 既存 instinct の強化
instincts.ts reinforce <id>

# 一覧表示
instincts.ts list [--min-confidence 0.5]

# 低 confidence の prune
instincts.ts prune

# promotion 候補の表示
instincts.ts promote
```

## Domains

instinct の分類:
- `verification` — 検証に関するルール
- `workflow` — 作業フローに関するルール
- `code-style` — コーディングスタイル
- `debugging` — デバッグ手法
- `git` — Git 操作
- `tool-usage` — ツール使用法
- `communication` — ユーザーとのコミュニケーション

## Integration with session-retrospective

Phase 2.6 (Instinct Extraction) で呼び出される:

1. **Corrected Approaches** と **Repeated Workflows** カテゴリの学びを対象
2. Generalization Check を通過した学びを `instincts.ts add` で登録
3. 既存 instinct と類似する場合は `instincts.ts reinforce` で強化
4. **Missing Context** と **Tool Knowledge** は instinct ではなく CLAUDE.md 直接提案にルーティング

## Promotion to CLAUDE.md

confidence 0.7+ の instinct は `/session-retrospective` Phase 4 の CLAUDE.md 提案に含まれる。ユーザー承認後:
1. CLAUDE.md に1行ルールとして追加
2. instinct の status を `promoted` に更新
3. `promoted_at` と `claude_md_section` を記録

## Related

- **session-retrospective** — Phase 2.6 で instinct-learner を呼び出す
- **cross-session-analysis** — 複数セッションの横断分析（より大規模）
