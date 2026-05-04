---
name: impl-codex
description: Codex 版の plan 実装 skill。$plan-codex で作成済みのプランをタスクごとに実装し、最後に内蔵 Audit + 4 観点 Review phase で AUDIT_VERDICT / REVIEW_VERDICT を出力する。明示的な `$impl-codex` 起動でのみ動き、auto-load は agents/openai.yaml で抑制してある。Codex には skill-to-skill invocation API がないため final-gate も同 skill 内で完結する。
---

# $impl-codex

`$plan-codex` が作成したプランを順次実装し、最後に内蔵 Audit + 4 観点 Review で完了判定する skill。Claude Code の `/impl` + `/completion-audit` + `/subagent-review` を Codex 用に統合した MVP。

## Approval gate (起動時の最初のチェック)

cwd-hash 計算 → `~/.codex/plans/.active-<hash>` の状態を確認:

| 状態 | 動作 |
|---|---|
| 存在 + mtime < 24h | 内容 (plan path) を読み Step 1 へ進む |
| 存在 + mtime >= 24h | 「.active marker が期限切れ。`$plan-codex` を再実行してください」と表示し終了 |
| 不在 + `.pending-<hash>` 存在 | 「計画は作成済だが承認されていない。`$impl-codex` を top-level prompt として打鍵してください (UserPromptSubmit hook が promote します)。AI 自己 chain は bypass されません」と表示し終了 |
| 両方とも不在 | 「`$plan-codex <request>` を先に実行してください」と表示し終了 |

cwd-hash は `realpath $PWD | shasum -a 256 | cut -c1-16`。

承認の唯一のルートは UserPromptSubmit hook (`codex-impl-approval-tracker.ts`) — ユーザーが `$impl-codex` を top-level prompt として打鍵した時のみ `.pending-` → `.active-` へ promote される。AI が同じ skill body 内で `$impl-codex` 相当の何かを連想しても hook は発火しない。

## Step 1: プラン読み込み + サイドカー JSON 整合性チェック

1. `.active-<hash>` の内容を読みプラン file path を取得
2. プラン file を全文 Read (Files to Change / Patterns to Mirror / Completion Criteria を後段で参照するため)
3. サイドカー JSON `~/.codex/plans/<plan-basename>.evidence.json` を Read
4. Codex の `update_plan` 現状と JSON の `tasks[].status` を比較
   - drift があれば JSON を source of truth として `update_plan` を再構築 (1 回呼び出しで全タスクを再登録)
   - JSON 自体が parse error なら処理を中断し、ユーザーにファイル損傷を警告する

## Step 2: タスクループ

JSON の `tasks` を **ID 昇順 (`task-1` から)** で処理する。最後のエントリ `Final Audit + Review` は Step 2 ではスキップし、Step 3-4 で実行する。

各 implementation task で以下を順に行う:

### Step 2a: in_progress 化 + baseline_sha 記録

```bash
deno eval --allow-read --allow-write --allow-run=git '
  const path = Deno.args[0];
  const taskId = Deno.args[1];
  const proc = await new Deno.Command("git", { args: ["rev-parse", "HEAD"], stdout: "piped" }).output();
  const sha = new TextDecoder().decode(proc.stdout).trim();
  const data = JSON.parse(await Deno.readTextFile(path));
  const t = data.tasks.find((t: any) => t.id === taskId);
  if (!t) { console.error("task not found: " + taskId); Deno.exit(1); }
  t.baseline_sha = sha;
  t.status = "in_progress";
  await Deno.writeTextFile(path + ".tmp", JSON.stringify(data, null, 2));
  await Deno.rename(path + ".tmp", path);
  console.log("baseline=" + sha);
' -- "$HOME/.codex/plans/<basename>.evidence.json" task-N
```

`update_plan` も該当タスクを `in_progress` に遷移させる (1 回呼び出しで全タスクの状態を渡し直す形になる)。

### Step 2b: 実装

プランの **Files to Change** と **Patterns to Mirror** に厳密に従う。命名 / error handling / 規約は Phase 2 EXPLORE で記録された既存パターンと一致させる。

apply_patch (Codex のファイル編集ツール) を使う際、`codex-plan-gate.ts` PreToolUse hook が `.active-<hash>` を確認して通すか block する。Step 0 で gate が通っていれば Step 2b の編集も通る。

### Step 2c: Verification + evidence 記録

タスク description の verification commands を実行し、stdout を verbatim で evidence に保存:

```bash
VERIFY_OUT=$(./run-verification.sh 2>&1)   # タスク固有の検証コマンド
echo "$VERIFY_OUT"                         # ユーザーにも見せる
deno eval --allow-read --allow-write '
  const path = Deno.args[0];
  const taskId = Deno.args[1];
  const evidence = Deno.args[2];
  const data = JSON.parse(await Deno.readTextFile(path));
  const t = data.tasks.find((t: any) => t.id === taskId);
  if (!t) { console.error("task not found: " + taskId); Deno.exit(1); }
  t.evidence = (t.evidence ? t.evidence + "\n---\n" : "") + evidence;
  await Deno.writeTextFile(path + ".tmp", JSON.stringify(data, null, 2));
  await Deno.rename(path + ".tmp", path);
' -- "$HOME/.codex/plans/<basename>.evidence.json" task-N "$VERIFY_OUT"
```

verification が EXPECTED 通りでなければ Step 2d へ進めず、原因を調査して再実装する (TaskUpdate を `pending` に戻すのではなく、同じ task 内で修正を継続)。

### Step 2d: completed 化

```bash
deno eval --allow-read --allow-write '
  const path = Deno.args[0];
  const taskId = Deno.args[1];
  const data = JSON.parse(await Deno.readTextFile(path));
  const t = data.tasks.find((t: any) => t.id === taskId);
  if (t) t.status = "completed";
  await Deno.writeTextFile(path + ".tmp", JSON.stringify(data, null, 2));
  await Deno.rename(path + ".tmp", path);
' -- "$HOME/.codex/plans/<basename>.evidence.json" task-N
```

`update_plan` も該当タスクを `completed` に。次のタスクへ。

### Atomic write 保証

サイドカー JSON への書き込みは必ず **`tmpfile` に書いてから `Deno.rename` で置き換える**。プロセスが書き込み中にクラッシュしても元 JSON は無傷。`Deno.rename` は同一 filesystem 内では POSIX atomic。

### Three elements 検証

各タスク description は (1) target files / (2) expected behavior / (3) verification commands + EXPECTED output を含むはず。1 つでも欠けていたら停止し「プラン task description が不完全。`$plan-codex` で再分解してください」と報告する (improvise しない)。

## Step 3 Audit (impl-codex 内蔵、旧 completion-audit 相当)

全 implementation task が completed になったら Audit phase へ。

### 評価対象

プラン file の `## Completion Criteria` を Read し、以下の subsection を順に評価:

- `### Autonomous Verification`: 各 `[file-state]` / `[orchestrator-only]` / `[outcome]` 項目について、サイドカー JSON の `tasks[].evidence` から該当する verification 結果を探し、EXPECTED と一致するか確認
- `### Requires User Confirmation`: 該当項目があれば「ユーザー手動確認が必要」と注記 (PASS 判定の対象外、情報のみ)
- `### Baseline`: 各タスクで verification が実施され evidence に記録されていることを確認

### 出力

評価が全て通れば 1 行で `AUDIT_VERDICT: PASS` を出力。
失敗があれば `AUDIT_VERDICT: FAIL <reason>` を 1 行で出力し、Step 4 はスキップして Step 5 へ。

verdict format は **正規表現 `^AUDIT_VERDICT: (PASS|FAIL)(\s|$)`** にマッチする形式を厳守する (`$plan-codex` の Phase 4 self-review で同じフォーマットを期待しており、外部 tooling からも grep で消費される可能性があるため)。

例:
```
AUDIT_VERDICT: PASS
AUDIT_VERDICT: FAIL evidence missing for [orchestrator-only] nix flake check
```

## Step 4 Review (Step 3 PASS 時のみ、旧 subagent-review 相当)

main session が以下 4 観点を **順次セルフ実行** する。Codex には Claude の `Agent({subagent_type: ...})` 並列起動 API がないため、各観点を 1 ターン内で連続して評価する形になる。

集約 diff は `git diff <first-task baseline_sha>..HEAD` で取得 (first-task baseline_sha はサイドカー JSON `tasks[0].baseline_sha`)。

### Step 4a: Spec Compliance

集約 diff とプラン `## Files to Change` / `## Approach` を読み比べ、以下を評価:
- プランに記載のファイル変更が実装に存在するか
- 実装にあってプランにない変更がないか (scope creep)
- プランの意図 (Approach の各番号項目) と実装が整合しているか

完了時に 1 行で出力:
```
SECTION_VERDICT: PASS
SECTION_VERDICT: FAIL <短い理由>
```

### Step 4b: Code Quality

集約 diff を読み、プロジェクト CLAUDE.md (`/Users/wadackel/dotfiles/CLAUDE.md` および `~/.claude/CLAUDE.md` の Development Guide / Coding Conventions) と照合:
- YAGNI / KISS / DRY 違反
- コメントの過剰 (CLAUDE.md は WHY のみコメント原則)
- 命名 / 責務分離 / error handling
- backward-compat shim や fallback path の不要追加

```
SECTION_VERDICT: PASS
SECTION_VERDICT: FAIL <短い理由>
```

### Step 4c: Domain

変更ファイルの拡張子 / コンテンツに応じて該当ドメインを評価。MVP では subagent 並列起動の代わりに main session が以下を順に確認 (該当なしならスキップ):
- `*.ts` (Deno script): Deno 2.x の慣習 (`new Response(Deno.stdin.readable).text()`、 `--allow-*` 最小化、stderr 取り扱い等)
- `*.nix`: pure 関数制約、profile 別設定、home.file の recursive 取り扱い
- `*.json` (hooks.json 等): JSON parse + schema 整合
- `SKILL.md` / agents/openai.yaml: frontmatter 必須項目、auto-load 抑制設定

```
SECTION_VERDICT: PASS
SECTION_VERDICT: FAIL <短い理由>
```

### Step 4d: Security heuristic

集約 diff を読み、以下のいずれかが triggered なら該当事項を評価し verdict 出力:
- ハードコードされた secret / token / password / credential
- shell injection / SQL injection / path traversal の可能性
- 権限拡大 (sandbox 緩和、sudo 追加、setuid 等)
- 外部入力を信頼してしまう箇所
- `.env` / credential ファイルへの誤コミット

該当なしなら `SECTION_VERDICT: PASS` (security trigger no-fire) を出力。

```
SECTION_VERDICT: PASS
SECTION_VERDICT: FAIL <短い理由>
```

### 最終 verdict

4 つの SECTION_VERDICT を集計し、最終行として 1 行出力:

```
REVIEW_VERDICT: PASS
```

または FAIL の場合 (FAIL の SECTION 一覧と理由を続けて出す):

```
REVIEW_VERDICT: FAIL
- Spec Compliance: <理由>
- Security: <理由>
```

verdict format は正規表現 `^(SECTION|REVIEW)_VERDICT: (PASS|FAIL)(\s|$)` を厳守。

## Step 5 終了

| 状態 | 動作 |
|---|---|
| `AUDIT_VERDICT: PASS` + `REVIEW_VERDICT: PASS` | サイドカー JSON 末尾エントリ `Final Audit + Review` を completed に、`update_plan` も同じ、`.active-<hash>` を削除、最終レポート (changed files / tests added / 差分サマリ) を表示 |
| `AUDIT_VERDICT: FAIL` | Step 4 はスキップ済。指摘箇所を `$plan-codex` で再分解するか、ユーザーが手動修正後 `$impl-codex` を再起動 |
| `AUDIT_VERDICT: PASS` + `REVIEW_VERDICT: FAIL` | FAIL の SECTION に挙がった項目をユーザーに提示し、Step 2 のループに戻って修正 (or 軽微なら同 turn で修正してから Step 3 を再実行) |

## Recovery after compaction / re-invocation

コンテキスト圧縮後や中断再開で `$impl-codex` を再起動する場合:
1. Step 0 (Approval gate) を再評価
2. Step 1 でサイドカー JSON を読み直す
3. `tasks[].status` から最も若い id の `pending` または `in_progress` を見つけて再開
4. `in_progress` の途中状態は `git diff <baseline_sha>..HEAD` で観察し、続行か revert + restart かをケースバイケースで判断

## Re-plan (実装中のプラン改訂)

実装中にプラン改訂が必要になったら:
1. ユーザーに「`$plan-codex` を再実行しますか？ completed タスクの evidence は維持されます」と尋ねる
2. 承認後、サイドカー JSON の `tasks` のうち `completed` 以外を削除、`update_plan` も再構築
3. `$plan-codex` を再起動 (新しい `.pending-` が作られ、ユーザーの再承認 `$impl-codex` で promote される)
4. 完了済 task のリストは新規 Phase 5 DECOMPOSE への入力 context として保持

## Design notes

- **per-task review gate なし**: 各タスクは acceptance verification (Step 2c) のみで進行する。Quality/Security adjudication は Step 3-4 の最終ゲートに集約 (Claude `/impl` の最新方針と同じ)。
- **subagent 並列なし**: Codex 0.128.0 の制約。Step 4a-4d は main session が連続して評価する。subagent dispatch が後日整備されたら parallel に格上げ可能。
- **skill-to-skill invocation 不可**: Codex 0.128.0 では skill から別 skill を呼ぶ API が存在しない (Codex Skills docs)。そのため Audit / Review を独立した `$final-gate-codex` skill に分けず、本 `$impl-codex` 内蔵 phase として実装した。手動 hand-off ステップ無し、ファイル経由 IPC 不要。
- **verdict format 固定**: `AUDIT_VERDICT` / `SECTION_VERDICT` / `REVIEW_VERDICT` の 3 種類のみ、各々 `PASS|FAIL` の 2 値。任意の追加情報は同行末尾 (`<理由>`) または別行に書く。`/usr/bin/grep` で機械抽出可能なフォーマットを保つ。
