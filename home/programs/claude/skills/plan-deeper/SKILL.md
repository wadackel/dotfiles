---
name: plan-deeper
description: Deepens plan quality through iterative adversarial critique and user interviews. Each round spawns a fresh critic subagent to challenge assumptions and identify weaknesses, then interviews the user on items requiring domain knowledge, and refines the plan until convergence. Plan mode only. Use when asked to "反証して", "計画を深掘りして", "悲観的に評価して", "計画の精度を上げて", "もっと練って", "plan deeper", "challenge this plan", "deepen the plan", or when adversarial plan improvement is needed.
---

# Plan Deeper

Plan mode で計画の精度を反復的に向上させる。毎ラウンド新しい Critic Subagent を生成し、確証バイアスのない独立した視点から計画を批判する。Critic の指摘のうちユーザーのドメイン知識が必要な項目はインタビューで解消し、計画を改善する。

**Plan mode 専用。** 計画の精錬に特化しており、実装は行わない。

## Quick Start

```
/plan-deeper        # デフォルト: 最大3ラウンド
/plan-deeper 5      # 最大5ラウンド
```

## Workflow

### Step 1: コンテキスト収集

1. 現在の計画を取得（plan file またはコンテキストから）
2. プロジェクトの CLAUDE.md を読み込み（コードベース整合性の判断材料）
3. `$ARGUMENTS` から最大ラウンド数を取得（デフォルト: 3、上限: 5）

### Step 2: Critic Subagent の生成（各ラウンド）

**毎ラウンド新しい Subagent を生成する。** 継続した Subagent は前ラウンドの視点を引き継ぎ、確証バイアスが蓄積するため。

```
Task:
  subagent_type: "Plan"
  model: "sonnet"
  prompt: [references/critic-prompt.md のテンプレートに基づいて構築]
```

Critic に渡す情報:
- 計画の全文
- プロジェクトコンテキスト（CLAUDE.md の要約）
- ラウンド番号
- 前ラウンドの Deepening Log（あれば）

Critic が返す情報:
- 6つの評価軸ごとの構造化された批評
- Critical Issues（修正必須）のリスト
- Improvement Suggestions（検討推奨）のリスト
- Verdict: `ITERATE`（続行）または `CONVERGED`（収束）

### Step 3: 批評の処理・ユーザーインタビュー・計画更新

Critic の返答を処理する:

1. Critical Issues と Suggestions を抽出
2. 各指摘を3種に分類:
   - **自己解決可能**: メインエージェントが文脈に基づいて判断・対応
   - **ユーザー判断が必要**: 前提の確認、トレードオフの選択、要件の曖昧さ解消
   - **却下**: 文脈上不適切な指摘
3. ユーザー判断が必要な項目がある場合、AskUserQuestion でインタビュー:
   - Critic が検出した未検証の前提について「この前提は正しいですか？」
   - 代替アプローチの提案に対して「どちらのアプローチを好みますか？」
   - スコープの過不足について「この機能は必要ですか？」
   - 実装の曖昧な部分について「この部分の期待動作は？」
4. ユーザーの回答と自己判断を踏まえて計画を更新
5. Deepening Log を計画に追記:

```markdown
## Deepening Log

### Round N
- **Accepted**: [反映した変更のリスト]
- **User Clarified**: [ユーザーに確認した項目と回答]
- **Rejected**: [却下した指摘と理由]
- **Verdict**: ITERATE | CONVERGED
```

**インタビューの原則:**
- Critic の指摘のうちユーザーしか答えられない項目のみ質問する（自明な技術判断は聞かない）
- 1ラウンドの質問は最大4問（AskUserQuestion の制約）に絞り、優先度の高いものから
- ユーザーの回答は計画に直接反映し、後続の Critic にも伝わるようにする

### Step 4: 収束判定

以下のいずれかで停止:

| 条件 | アクション |
|------|-----------|
| Critic の Verdict が CONVERGED | 停止 — 計画は十分堅牢 |
| 最大ラウンド到達 | 停止 — 未解決項目を報告 |
| 前ラウンドと同一の指摘が繰り返される | 停止 — ユーザーに判断を委ねる |
| Critical Issues がゼロ | 停止 — 計画は準備完了 |

収束していない場合、Step 2 に戻り新しい Subagent を生成。

### Step 5: 結果報告

```
## Plan Deepening Complete

**Rounds**: N (収束理由)
**Critical issues resolved**: X
**Improvements applied**: Y

### Changes Summary
[計画に加えた主要な変更]

### Remaining Considerations
[未解決の項目やトレードオフ（あれば）]
```

## 評価軸

Critic は 6 つの軸で計画を評価する。各軸の詳細定義とプロンプトテンプレートは [references/critic-prompt.md](references/critic-prompt.md) を参照。

| # | 軸 | 観点 |
|---|------|------|
| 1 | **前提の妥当性** | 未検証の仮定はないか？ |
| 2 | **失敗モード** | 何が失敗しうるか？ |
| 3 | **代替アプローチ** | より単純な方法はないか？ |
| 4 | **スコープの適切性** | 過剰設計または不足はないか？ |
| 5 | **実装の具体性** | 曖昧さなく実装できるか？ |
| 6 | **コードベース整合性** | 既存パターンと一貫しているか？ |

## 設計判断

**新しい Subagent を毎ラウンド生成する理由:**
同一の Subagent を継続すると、前ラウンドの議論を引き継ぎ確証バイアスが蓄積する。異なるレビュアーに見てもらうのと同じ効果を得るため、毎回新規生成する。

**"Plan" type Subagent を使う理由:**
Critic は読み取りと分析のみ行い、ファイル変更は不要。読み取り専用の "Plan" type が適切。

**デフォルト 3 ラウンドの理由:**
実践上、Round 1 で主要な問題の大半を検出し、Round 2 で修正確認と二次的問題を発見、Round 3 で収束確認。3 ラウンド以降は収穫逓減。

**Deepening Log を計画に追記する理由:**
計画の進化過程をユーザーに可視化するとともに、次の Critic に「前ラウンドで何が対処されたか」を伝える文脈として機能する。

## Tips

- 初期ドラフトを書いた後に `/plan-deeper` を実行するのが最も効果的
- Critic の指摘すべてが正しいとは限らない — メインエージェントが会話コンテキストに基づいて取捨選択する
- 複雑な計画では `/plan-deeper 5` で徹底的なレビューを
- ユーザーへのインタビューは計画精度の鍵 — Critic が見つけた問題のうち、ドメイン知識が必要なものはユーザーに聞く方が正確で速い
- **qa-planner** (Mode A) と組み合わせると、深掘り後にテストケース設計まで一気に進められる
