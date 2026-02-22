## 開発ガイド

### Agent Guidelines

正確さよりもシンプルさを常に優先する。YAGNI、KISS、DRY。循環的複雑度を増やさずに無償で得られる場合を除き、後方互換シムやフォールバックパスは不要。

### Git コマンドの実行規則

`git -C <path>` を使用しないこと。`permissions.allow` のパターン（例: `Bash(git diff *)`）にマッチせず毎回権限確認が発生する。代わりに作業ディレクトリで直接 git コマンドを実行する。別ディレクトリを操作する場合は `cd <path> && git <subcommand>` を使用。

### Browser Automation

ブラウザを利用する操作には **chrome-devtools スキル**（Chrome DevTools MCP）を積極的に使用すること。

**Plan mode での実測確認:**
- ブラウザUIやレンダリングに関する技術的問題を Plan mode で調査する際は、理論的推測だけでなく chrome-devtools MCP で実測確認を行うこと
- DOM 要素のサイズ、CSS 適用状態、レイアウト計算などは実測値を取得してから計画を立てる

### gemini-research スキル使用ガイドライン

ユーザーが明示的にスキル名を出さなくても、以下の状況では積極的に使用:
- 大規模・未知のコードベースの構造分析やアーキテクチャ調査
- ライブラリ・フレームワーク選定や比較
- エラー調査・トラブルシューティング
- ベストプラクティスや最新トレンドの調査
- 初めて使う API・ライブラリの使い方調査

gemini-research は**調査・分析**担当（コード分析を含む）。実装コードは Claude Code が書く。

**例外**: Claude Code 自体の仕様（permissions、hooks、settings等）は gemini-research や claude-code-guide より公式ドキュメントを直接 WebFetch する方が正確:
- `https://code.claude.com/docs/en/permissions`
- `https://code.claude.com/docs/en/settings`
- `https://code.claude.com/docs/en/security`

### codex-review スキル使用時の特別ルール

codex-review で Plan→実装を行う場合、以下のフローを必ず完遂:

1. **Plan Review**: `mcp__codex__codex`（sandbox: "read-only"）で計画レビュー
2. **Implementation**: 計画承認後、テスト含め完全に実装
3. **Code Review Loop（最重要）**: 実装完了後、自動的に開始。`git diff HEAD` で変更を収集し、`mcp__codex__codex`（sandbox: "workspace-write", approval-policy: "on-failure"）でレビュー。指摘がゼロになるまで修正→再レビューを反復（最大 5 回）
4. **Completion**: レビュー完了報告、サマリー、次のステップ提案

**絶対ルール**: 実装完了時にレビューループをスキップしない（ユーザーが「レビュー不要」と明示した場合のみ例外）

### Skill 設計原則

- **スキルは英語で作成する**
  - SKILL.md のコンテンツ（説明文、セクション見出し、コメント等）は原則英語で記述
  - ユーザーが明示的に日本語を指定した場合のみ例外

- **新規スキル作成後は skill-improver を実行する**
  - スキル作成完了後、`/skill-improver <name>` で品質評価と最適化を実施してから完了とする

- **ツール/スキルの委譲パターン**
  - スキル内で他のスキルやツールの詳細な使い方（コマンド例、フラグ、引数など）を記載しない
  - 代わりに「Use the **[skill-name] skill** for [purpose]」のような簡潔な委譲指示を使用
  - 詳細はそのツール/スキルのドキュメントに委ねる
  - 例: qa-planner では chrome-devtools MCP のコマンド例を列挙せず、「Use the **chrome-devtools skill** for browser automation」と記載

- **引数を受け取るスキルには `argument-hint` を追加する**
  - `$ARGUMENTS` を使用するスキルは `argument-hint: "[引数名]"` を frontmatter に記述
  - オートコンプリート時にユーザーへヒントが表示される（例: `/plan-deeper [max-rounds]`）

### 全般

- `AskUserQuestion` の `options` は1質問あたり最大4つまで（それ以上は ValidationError）

- **Plan mode で具体的な実装コードを確認したい場合**
  - プランに実装コード全体を含めてユーザーに提示
  - ユーザーが「いいね」「OK」と確認してから実装フェーズへ移行
  - 実装後の修正コストを削減
- **Plan mode での完了条件（Definition of Done）の明示**
  - プランには作業の完了条件を含める（例: 実装のみ、実装＋軽量検証＋PR＋CI など）
  - 完了条件を事前に定義することで、実装フェーズでの Claude の自律性が高まりユーザーへの確認頻度を下げられる
  - `/plan-deeper` を使用する場合はスキルが自動的に提案・合意フローを実行する

- **実装完了後の動作確認**
  - 実装が完了したら、必ず動作確認を実施すること
  - スクリプトなら実行して期待通りの出力を得る
  - 変更検知のテストも含める（意図的に変更 → 再実行 → 検知確認 → 元に戻す）
  - ユーザーの確認を待たず、Claude が主体的に検証する
  - テストファイルが存在する場合、挙動変更に伴う期待値の更新と新ケースの追加もプランと実装に含めること
- **検証用の一時ファイル（test-*.mjs, verify-*.sh 等）**
  - ローカル動作確認のために作成した一時スクリプトはコミット対象外
  - git add 時に明示的に除外
  - 必要に応じて .gitignore への追加を提案
- ユーザーから修正指示を受けた場合の動作:
    - どのような作業にも適用できる汎用的な指示の場合は `~/.claude/CLAUDE.md` へ追記することを検討する
    - 追記を行うべきと判断した場合は、必ずユーザーへの確認を行う。承認が得られた場合にのみ追加作業を行うこと

### GitHub URL の扱い

GitHub の Issue や Pull Request など、ユーザーから提供された URL は Private Repository が多いため直接参照できないことが多い。そのため、原則ユーザーから提供された GitHub の URL に関しては `gh` コマンドを使って情報を参照すること。

## 設計原則

- 単一責任は文脈に応じて柔軟に。内部実装では副作用を許容、公開 API は純粋関数寄せ
- 3 つ以上の引数はオブジェクトにまとめる
- よくあるパターンは早期に抽象化、ドメイン固有は Rule of Three
- 継承より関数合成。過度な抽象化は避ける
- エクスポートは説明的な名前、ローカルは簡潔に

## コーディング規則

### CSS/レイアウトのベストプラクティス

**flexbox と transform の相互作用:**
- flex コンテナ内で `transform: scale()` を使う場合、`flex-shrink: 0`（Tailwind: `shrink-0`）を指定して flex による縮小を防ぐ
- ブラウザデフォルトの `max-width: 100%` も transform との組み合わせで二重制約を引き起こすため、`max-w-none` も併用
- 例: 画像を transform でスケーリングする場合 → `class="shrink-0 max-w-none max-h-none"`

### Deno スクリプト

- stdin 読み取りは `new Response(Deno.stdin.readable).text()`（Deno 2.x）。パーミッションフラグ不要
- inline コード実行は `deno eval`。`deno run -e` は存在しない

### ファイル構成

- 依存関係順にコードを配置（下から上へ読める構造）
    - 最初に基本的な定数、型定義、ヘルパー関数
    - 最後にそれらを使用するメインのロジックやエクスポート
- ファイルを下から読み上げることで依存関係が理解できる構成を意識
- 循環参照を避ける設計
