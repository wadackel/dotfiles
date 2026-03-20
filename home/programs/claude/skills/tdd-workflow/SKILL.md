---
name: tdd-workflow
description: Enforces test-first development patterns. Use when writing new features, fixing bugs with reproducible symptoms, or creating testable scripts. Guides through defining expected behavior FIRST, writing failing tests, then implementing. Triggers include "テストファーストで", "TDDで", "test-first", "write tests first", "テスト駆動で".
---

# TDD Workflow

テストファーストの開発パターンを強制する。「実装 → 検証」ではなく「検証の設計 → 実装 → 検証の実行」の順序で作業する。

## When to Use

- 新機能の実装（テスト可能な振る舞いがある場合）
- バグ修正（再現可能な症状がある場合）
- CLI スクリプトの作成・修正
- hook スクリプトの作成・修正
- 新機能実装時に proactive に使用

## When NOT to Use

- 設定値の変更のみ
- ドキュメント修正
- 既存テストカバレッジ内のリファクタリング

## Workflow

### Step 1: 期待される振る舞いを定義する

実装を始める前に、「何が正しい動作か」を具体的に書き出す。

- Deno スクリプト → `_test.ts` にテストケースを書く
- Nix 設定 → 期待される出力（`which <command>`, generation 番号変化）を定義
- hook → 入力→期待出力のペアを列挙
- skill → positive/negative トリガーテストケースを定義

### Step 2: テストを書く → 失敗を確認する (RED)

```bash
# Deno の場合
deno test --allow-env=HOME --allow-read --allow-write path/to/script_test.ts
# → FAILED が出ることを確認（実装がないので当然）
```

テストが失敗することの確認は必須。既に通るテストを書いても意味がない。

### Step 3: 最小限の実装 (GREEN)

テストを通すためだけのコードを書く。余分な機能は追加しない。

```bash
# 再度テスト実行
deno test --allow-env=HOME --allow-read --allow-write path/to/script_test.ts
# → PASSED を確認
```

### Step 4: リファクタリング

テストがパスし続けることを確認しながら、コード品質を改善する。

### Step 5: 検証完了を宣言

全テストがパスし、期待される振る舞いが実装されたことを確認してから完了を宣言する。

## コンテキスト別ガイド

### Deno スクリプト

既存のテストパターンに従う:
- `bash-policy_test.ts` — glob パターンマッチのテスト
- `approve-piped-commands_test.ts` — パイプコマンド分割のテスト
- `shell-utils_test.ts` — ユーティリティ関数のテスト

テスト実行: `deno test --allow-env=HOME --allow-read --allow-write <path>`

### Nix 設定

純粋な TDD ではなく「構造検証ゲート」:
1. 期待結果を事前定義（例: "htop が PATH に存在する"）
2. `nix flake check` で構文検証
3. `darwin-rebuild switch` で適用
4. 期待結果を確認

### hook スクリプト

1. テストシナリオ定義（stdin JSON → 期待 stdout/exit code）
2. hook 実装
3. テストシナリオ実行

### skill 定義

1. skill-tester のテストケース定義（positive/negative/edge triggers）
2. SKILL.md 作成
3. skill-tester 実行

## Related

- **tdd-guide agent** — TDD の実行を支援するサブエージェント
- **verification-before-completion** — 完了前の検証ゲート
- **qa-planner** — QA テストケース設計
