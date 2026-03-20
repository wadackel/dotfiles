# Behavioral Verification Guide

変更タイプ別の動作確認テンプレート。task-planner が検証タスク生成時に参照し、verification-before-completion の Gate Function 実行時に使用する。

## 原則

- **「コードを書いた」は「動作する」を意味しない** — 実際に実行して確認する
- **Baseline capture**: 変更前の状態を記録してから実装に入る。Before がないと After との比較ができない
- **出力値の正しさ**: エラーがないだけでなく、出力内容が期待通りかを確認する

## 変更タイプ別テンプレート

### CLI スクリプト新規作成

| Phase | Action |
|---|---|
| Baseline | — (新規のため不要) |
| Verification | スクリプトを実際に実行し、出力が期待値と一致することを確認 |
| Edge cases | 引数なし、不正な引数、空入力での動作を確認 |

### CLI スクリプト修正

| Phase | Action |
|---|---|
| Baseline | 修正前にスクリプトを実行し、出力を記録 |
| Verification | 修正後の出力と比較。意図した差分のみか確認 |
| Regression | 修正に関係ない既存機能が壊れていないか確認 |

### hook スクリプト

| Phase | Action |
|---|---|
| Baseline | フック追加/修正前の動作を確認（フックなしの状態） |
| Verification | フックが発火する操作を実行し、期待通りの介入を確認 |
| Non-firing | フックが発火すべきでない操作で発火しないことを確認 |

### Nix 設定変更

| Phase | Action |
|---|---|
| Baseline | `darwin-rebuild` 前の generation 番号を記録。変更対象の現在値を確認 |
| Verification | `darwin-rebuild` 後に新 generation で期待する設定が反映されているか確認 |
| Side effects | 関連する他の設定が壊れていないか確認 |

### skill / agent 追加

| Phase | Action |
|---|---|
| Baseline | — (新規のため不要) |
| Verification | skill-tester でトリガーテスト、または手動でスキルを呼び出して動作確認 |
| Discovery | description のトリガーフレーズで正しく発見されることを確認 |

### UI / Web 変更

| Phase | Action |
|---|---|
| Baseline | `/agent-browser` でスクリーンショットを取得、または現状の表示を記録 |
| Verification | 変更後に `/agent-browser` で再度スクリーンショット。レイアウト比較 |
| Console | ブラウザコンソールエラーがないことを確認 |
| Responsive | 異なるビューポートサイズでの表示を確認 |
| Interaction | ボタンクリック、フォーム入力などのインタラクションが機能することを確認 |

### パフォーマンス改善

| Phase | Action |
|---|---|
| Baseline | ベンチマーク baseline を取得。具体的な数値を記録 |
| Verification | 改善後に再計測。Before/After 数値で比較 |
| Threshold | 改善が有意な差であることを確認（ノイズでないこと） |
