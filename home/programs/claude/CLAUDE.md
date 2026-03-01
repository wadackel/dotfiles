## 開発ガイド

### Agent Guidelines

正確さよりもシンプルさを常に優先する。YAGNI、KISS、DRY。循環的複雑度を増やさずに無償で得られる場合を除き、後方互換シムやフォールバックパスは不要。

ただし構文解析（シェルコマンド、AST 等）では正規表現より専用パーサーライブラリを優先する。正規表現はクォートやエスケープのエッジケースに弱い。

### CLI ツールの優先順位

- ファイル検索には `find` ではなく `fd` を使用すること
- 内容検索には `grep` ではなく `rg` を使用すること（専用の `Grep` ツールが利用できる場合はそちらを優先）

### Plan mode での静的解析活用

lint エラーや型エラーの修正タスクでは、plan mode 中に `pnpm lint:script` / `tsc` を実行して
実際のエラー内容を確認してから修正方針を決定すること。
理論的推測だけで方針を立てると、実際には違うエラーが出て無駄な修正になる。

### Git Workflow

#### 安全なステージング

`git add -A` や `git add .` を使用する前に `git status --porcelain` を実行し、
意図しないファイル（.env, credentials*, *.pem, secrets* など）が含まれていないか必ず確認してください。
機密情報が含まれる可能性がある場合は、個別に `git add <file>` を使用します。

#### Git コマンドの実行規則

`git -C <path>` を使用しないこと。`permissions.allow` のパターン（例: `Bash(git diff *)`）にマッチせず毎回権限確認が発生する。代わりに作業ディレクトリで直接 git コマンドを実行する。別ディレクトリを操作する場合は `cd <path> && git <subcommand>` を使用。**この規則は `bash-policy.ts` により自動強制されており、違反コマンドは実行前にブロックされる。**

### tmux コマンドの実行規則

`TMUX` 環境変数が設定された状態（tmux セッション内）で `tmux` コマンドを実行する場合は `TMUX=""` プレフィックスを付けること。付けないと入れ子 tmux セッションとして扱われ、`send-keys` の内容が自セッションのペインに混入する等の意図しない挙動が発生する。

- ✗ `tmux send-keys -t "0:1.1" "text" ""`
- ✓ `TMUX="" tmux send-keys -t "0:1.1" "text" ""`

Claude Code の TUI に tmux send-keys でプロンプトを送る場合、テキストと Enter を同じコマンドで送ると改行扱いになる。テキスト送信後に `sleep 2` を挟んでから Enter を送ること:
- `TMUX="" tmux send-keys -t TARGET "prompt text" && sleep 2 && TMUX="" tmux send-keys -t TARGET Enter`

`tmux capture-pane -p` は tall terminal（63行以上）では末尾に大量の空行が現れる。最後の N 行を取る場合は空行をフィルタしてからスライスする: `.filter(l => l.trim() !== "").slice(-5)`

### Bash ツールでのシェル固有構文

Bash ツールのシェル環境では `$'...'`（ANSI-C quoting）がパイプ内で正しく解釈されないことがある。bash 固有構文を含むコマンドの動作確認は `bash -c '...'` でラップして実行すること。

### Bash ツールでのバックグラウンドプロセス

長時間実行プロセス（dev サーバー等）は `&` や `;` でチェーンせず、`run_in_background: true` で起動する。起動確認は別の Bash コールで `sleep N && curl ...` のように行う。`cmd &` + 後続コマンドを1つの Bash コールに入れると引数パースが壊れる。

### Write/Edit ツールの Unicode 制限

Write/Edit ツールは Unicode Private Use Area (PUA) の文字（Nerd Font アイコン等）をドロップすることがある。PUA 文字をファイルに含める場合は、直接埋め込まず `printf '\uXXXX'` / `printf '\U000XXXXX'` でランタイム生成するコードを書くこと。

### Browser Automation

ブラウザを利用する操作には Claude Code 組み込みの **Chrome インテグレーション**（chrome-devtools MCP, claude-in-chrome MCP）を使用すること。

**Plan mode での実測確認:**
- ブラウザUIやレンダリングに関する技術的問題を Plan mode で調査する際は、理論的推測だけでなく Chrome インテグレーションで実測確認を行うこと
- DOM 要素のサイズ、CSS 適用状態、レイアウト計算などは実測値を取得してから計画を立てる

### gemini-research スキル使用ガイドライン

ユーザーが明示的にスキル名を出さなくても、以下の状況では積極的に使用:
- 大規模・未知のコードベースの構造分析やアーキテクチャ調査
- ライブラリ・フレームワーク選定や比較
- エラー調査・トラブルシューティング
- ベストプラクティスや最新トレンドの調査
- 初めて使う API・ライブラリの使い方調査

gemini-research は**調査・分析**担当（コード分析を含む）。実装コードは Claude Code が書く。

**テキストデータ一括分析には `gemini-data-analyst` スキルを使用**:
- `gemini-research` はコードベース探索専用（`--include-directories`）
- JSONL・ログ・テキストデータの分析には `/gemini-data-analyst` を使う

**例外**: Claude Code 自体の仕様（permissions、hooks、settings等）は gemini-research や claude-code-guide より公式ドキュメントを直接 WebFetch する方が正確:
- `https://code.claude.com/docs/en/permissions`
- `https://code.claude.com/docs/en/settings`
- `https://code.claude.com/docs/en/security`
- `https://code.claude.com/docs/en/hooks`

### Claude Code Hooks の注意点

- **`Skill` ツールは `PreToolUse` でマッチできない**: 有効なマッチ対象は `Bash`, `Edit`, `Write`, `Read`, `Glob`, `Grep`, `Task`, `WebFetch`, `WebSearch`, MCP tools のみ（公式ドキュメント記載）
- **スキル実行前に処理を挟む場合は `UserPromptSubmit` を使う**: stdin JSON の `prompt` フィールドで `/skill-name` を検知。例: `jq -e '.prompt | test("^/skill-name")' >/dev/null 2>&1`
- **hook コマンドの JSON エスケープ**: `bash -c '...'` ラップは避ける。JSON 文字列に直接コマンドを書き `\"` でエスケープする（シングルクォートとのネスト問題を回避）
- **`UserPromptSubmit` でブロックする場合**: exit 2 より `{"decision":"block","reason":"..."}` を stdout に出力 + exit 0 の方が理由を Claude に伝えられる
- **`PostToolUse` で承認追跡**: `PermissionRequest` は「ダイアログが表示された」事実のみ記録（承認/拒否を区別不可）。実際に実行された（承認済み）コマンドを追跡するには `PostToolUse` hook を組み合わせる。高頻度ツール（Read/Glob/Grep）は matcher で除外してオーバーヘッドを抑える

### codex-review スキル使用時の特別ルール

**絶対ルール**: 実装完了後の Code Review Loop を必ず実行する（ユーザーが明示的に「レビュー不要」と言った場合のみ例外）。詳細フローは codex-review スキルの SKILL.md を参照。

### Skill 設計原則

- **対話フローでの情報提示**
  - ユーザーに判断（追加/スキップ等）を求める前に、判断材料となる具体的情報（コマンド例、影響範囲、理由）を必ず提示する
  - 不可逆操作（ログ削除、データ変更等）はユーザーがアクションを取った対象のみに適用し、スキップされた項目には触れない

- **スキルは英語で作成する**
  - SKILL.md のコンテンツ（説明文、セクション見出し、コメント等）は原則英語で記述
  - ユーザーが明示的に日本語を指定した場合のみ例外

- **新規スキル作成後は skill-improver を実行する**
  - スキル作成完了後、`/skill-improver <name>` で品質評価と最適化を実施してから完了とする

- **ツール/スキルの委譲パターン**
  - スキル内で他のスキルやツールの詳細な使い方（コマンド例、フラグ、引数など）を記載しない
  - 代わりに「Use the **[skill-name] skill** for [purpose]」のような簡潔な委譲指示を使用
  - 詳細はそのツール/スキルのドキュメントに委ねる
  - 例: qa-planner では curl のフラグ詳細を列挙せず、対象ツールのドキュメントに委ねる

- **引数を受け取るスキルには `argument-hint` を追加する**
  - `$ARGUMENTS` を使用するスキルは `argument-hint: "[引数名]"` を frontmatter に記述
  - オートコンプリート時にユーザーへヒントが表示される（例: `/plan-deeper [max-rounds]`）

### 全般

- `AskUserQuestion` の `options` は1質問あたり最大4つまで（それ以上は ValidationError）
- ユーザーから修正指示を受けた場合、汎用的な指示なら `~/.claude/CLAUDE.md` への追記を検討し、ユーザー承認を得てから追記する

#### Plan mode

- **具体的な実装コードを確認したい場合**: プランに実装コード全体を含めてユーザーに提示し、確認後に実装フェーズへ移行
- **データ処理ツールの計画**: ログ解析・集計ツールの改善計画では、架空シナリオではなく実ファイルを使った Before/After を plan mode 中に提示してから ExitPlanMode すること。ユーザーが実データで問題の規模感を確認してから承認判断する
- **完了条件（Definition of Done）の明示**: プランに作業の完了条件を含める（例: 実装のみ、実装＋軽量検証＋PR＋CI など）。`/plan-deeper` 使用時はスキルが自動的に提案・合意フローを実行
- **ExitPlanMode 前の必須確認**: 不具合調査・修正を含む計画では以下をプランに明記:
  - 「どのコマンド・ログ・実測でこの修正が効いたことを確認するか」
  - 「この修正方針が間違いである可能性を検討し、否定できた根拠」

#### 実装と検証

- **実装完了後の動作確認**: 必ず動作確認を実施。スクリプトなら実行、変更検知テストも含める（意図的に変更 → 再実行 → 検知確認 → 元に戻す）。ユーザーの確認を待たず Claude が主体的に検証
- **テスト**: テストファイルが存在する場合、挙動変更に伴う期待値の更新と新ケースの追加もプランと実装に含める。ユーザーが「test planは不要」と明示しない限りテストを作業計画に含める
- **検証用の一時ファイル（test-*.mjs, verify-*.sh 等）**: コミット対象外。git add 時に除外し、必要に応じて .gitignore への追加を提案

#### バグ修正

- **原因調査の方針**: 以下の2点を必ず確認:
  1. **直接観察の手段が計画に含まれているか** — ログ出力・デバッグコマンド・実測確認など「事実を直接見る手段」を計画に組み込む。非対話環境では `exec >> /tmp/<name>.log 2>&1` でデバッグログを先に仕込む
  2. **修正方針の反証を行ったか** — 反証できていない推測を修正方針として採用しない
- **選択肢提示**: ワークアラウンド的な最小修正と根本解決の両方が存在する場合は両案提示。TODO コメントや技術的負債の解消が示唆されている箇所では、その解消を含む案を優先検討

### Obsidian

Vault のディレクトリ構造（数字プレフィックス付き）:
- 新規ファイルの保存先: `00_Inbox/<filename>.md`
- 主なディレクトリ: `00_Inbox/`, `01_Projects/`, `02_Notes/`, `03_Books/`, `05_Private/`
- ディレクトリ名を推測しないこと。`list_vault_files` で確認してから保存する

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
- スクリプト自身のディレクトリ取得: `new URL(".", import.meta.url).pathname`（設定ファイルを同じディレクトリに置くパターンで有用）

### ファイル構成

- 依存関係順にコードを配置（下から上へ読める構造）
    - 最初に基本的な定数、型定義、ヘルパー関数
    - 最後にそれらを使用するメインのロジックやエクスポート
- ファイルを下から読み上げることで依存関係が理解できる構成を意識
- 循環参照を避ける設計
