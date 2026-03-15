---
name: nvim-verify
description: >-
  Verifies Neovim configuration (init.lua) in headless mode. Checks startup
  errors, plugin loading, keymaps, and option values without requiring a
  terminal UI. Use this skill after editing init.lua or any Neovim
  configuration, when asked to "check nvim config", "verify neovim setup",
  "nvim動作確認", "init.lua確認", "設定チェック", "neovimが壊れてないか確認",
  or when you want to validate that a Neovim config change works correctly.
  Also use proactively after making any changes to init.lua — even if the
  user doesn't explicitly ask for verification, running at least the startup
  check catches errors before the user opens Neovim.
allowed-tools: Bash(*nvim-verify.ts*)
argument-hint: "[all|startup|plugins [name]|keymaps [lhs]|options [name...]]"
---

# nvim-verify

Neovim の設定を headless モードで検証する。init.lua を読み込んだ状態で
各種チェックを実行し、構造化 JSON で結果を返す。

## Quick start

```bash
# 起動チェック（最低限、init.lua 編集後に必ず実行）
nvim-verify.ts startup

# 全チェック
nvim-verify.ts all
```

## Workflow

### Step 1: Choose check scope

変更内容に応じて適切なサブコマンドを選択する。

| 変更内容 | 実行すべきチェック |
|---|---|
| init.lua の構文・設定変更 | `startup`（必須） |
| プラグインの追加・削除・設定変更 | `startup` + `plugins [name]` |
| キーマップの追加・変更 | `startup` + `keymaps "<lhs>"` |
| オプション値の変更 | `startup` + `options <name>` |
| よくわからない / 大きな変更 | `all` |

init.lua はシンボリンクなので、ファイル編集後すぐに検証できる
（darwin-rebuild 不要）。

### Step 2: Run the check

```bash
# 起動チェック
nvim-verify.ts startup

# 特定プラグインの確認（lazy.nvim の遅延ロードを強制解除して検証）
nvim-verify.ts plugins telescope.nvim

# 特定キーマップの確認（Neovim 内部表記で指定）
nvim-verify.ts keymaps "<Space>cc"

# オプション値の確認
nvim-verify.ts options number tabstop shiftwidth

# 全チェック
nvim-verify.ts all
```

### Step 3: Interpret the result

スクリプトは JSON を stdout に出力する。

**成功例:**
```json
{
  "check": "startup",
  "ok": true,
  "details": { "errmsg": "", "message_count": 0 },
  "errors": [],
  "warnings": []
}
```

**失敗例:**
```json
{
  "check": "startup",
  "ok": false,
  "details": { "errmsg": "E5108: Error executing lua..." },
  "errors": ["E5108: Error executing lua [string \":lua\"]:1: unexpected symbol"],
  "warnings": []
}
```

**結果の読み方:**

- `ok: true` → チェック通過。ユーザーに「設定は正常に読み込まれました」と報告
- `ok: false` → エラーあり。`errors` 配列の内容をユーザーに共有し、修正を提案
- `warnings` → 致命的ではないが注意が必要な項目。ユーザーに情報として共有

### Step 4: Report to user

チェック結果を簡潔にまとめてユーザーに報告する。

**報告例（成功時）:**
> init.lua の起動チェックを実行しました。エラーなく正常に読み込まれています。
> プラグイン 72 個が認識されており、telescope.nvim も正常にロードできました。

**報告例（失敗時）:**
> init.lua の起動チェックでエラーを検出しました:
> `E5108: Error executing lua: unexpected symbol near '!'`
> 該当箇所を修正します。

失敗時は原因を特定して修正を試み、修正後に再度 `startup` を実行して
修正が成功したことを確認する。

## Limitations

以下は headless モードの制約により検証できない。ユーザーに手動確認を
依頼すること:

- **視覚的な表示**: カラースキーム、ハイライト、UI プラグインの見た目
- **LSP**: headless では LSP サーバーが接続しないため、LSP 動作は検証不可
- **buffer-local キーマップ**: プラグインがバッファオープン時に設定するマップは
  headless のコンテキストでは取得できない
- **ローカルオプション**: `vim.wo`/`vim.bo`（ウィンドウ/バッファローカル）は
  headless のコンテキスト制約により対象外

## Notes

- `lazy = true`（デフォルト）のプラグインは起動時 `loaded: false` が正常。
  `plugins <name>` で強制ロードして確認できる
- keymaps の lhs は Neovim 内部表記を使う（例: `<Space>cc`、`<C-k>`、`<Leader>f`）
- `all` は startup → plugins → keymaps → options を順番に実行する
  （各チェックは別プロセスで実行されるため副作用の汚染なし）
