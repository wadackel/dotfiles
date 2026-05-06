---
name: impl
description: Codex 版の plan 実装 skill。$plan で作成済みのプランをタスクごとに実装し、最後に内蔵 Audit + Codex subagent Review phase で AUDIT_VERDICT / REVIEW_VERDICT を出力する。明示的な `$impl` 起動でのみ動き、auto-load は agents/openai.yaml で抑制してある。Codex には skill-to-skill invocation API がないため final-gate も同 skill 内で完結する。
---

# $impl

`$plan` が作成したプランを順次実装し、最後に内蔵 Audit + Codex subagent Review で完了判定する skill。Claude Code の `/impl` + `/completion-audit` + `/subagent-review` を Codex 用に統合した workflow。

## Approval gate (起動時の最初のチェック)

cwd-hash 計算 → `~/.codex/plans/.active-<hash>` の状態を確認:

| 状態 | 動作 |
|---|---|
| 存在 + mtime < 24h | 内容 (plan path) を読み Step 1 へ進む |
| 存在 + mtime >= 24h | 「.active marker が期限切れ。`$plan` を再実行してください」と表示し終了 |
| 不在 + `.pending-<hash>` 存在 | 「計画は作成済だが承認されていない。`$impl` を top-level prompt として打鍵してください (UserPromptSubmit hook が promote します)。AI 自己 chain は bypass されません」と表示し終了 |
| 両方とも不在 | 「`$plan <request>` を先に実行してください」と表示し終了 |

cwd-hash は `realpath $PWD | shasum -a 256 | cut -c1-16`。

承認の唯一のルートは UserPromptSubmit hook (`codex-impl-approval-tracker.ts`) — ユーザーが `$impl` を top-level prompt として打鍵した時のみ `.pending-` → `.active-` へ promote される。AI が同じ skill body 内で `$impl` 相当の何かを連想しても hook は発火しない。

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
deno eval '
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

タスク description の verification commands を実行し、stdout を evidence に保存する。実行前に verification command が非破壊であり、secret を出力・永続化・外部送信しないことを確認する。出力に secret / token / credential が含まれる場合は、値を `[REDACTED]` に置換して evidence に保存し、未編集の secret を会話やログに出さない。

```bash
VERIFY_OUT=$(./run-verification.sh 2>&1)   # タスク固有の検証コマンド
echo "$VERIFY_OUT"                         # ユーザーにも見せる
deno eval '
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
deno eval '
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

### Deno eval permissions

この環境の `deno eval` は implicit permissions で動作し、`--allow-read` / `--allow-write` / `--allow-run` などの permission flags を受け付けない。`$impl` 内の `deno eval` snippet には permission flags を付けない。

### Atomic write 保証

サイドカー JSON への書き込みは必ず **`tmpfile` に書いてから `Deno.rename` で置き換える**。プロセスが書き込み中にクラッシュしても元 JSON は無傷。`Deno.rename` は同一 filesystem 内では POSIX atomic。

### Three elements 検証

各タスク description は (1) target files / (2) expected behavior / (3) verification commands + EXPECTED output を含むはず。1 つでも欠けていたら停止し「プラン task description が不完全。`$plan` で再分解してください」と報告する (improvise しない)。

## Step 3 Audit (impl 内蔵、旧 completion-audit 相当)

全 implementation task が completed になったら Audit phase へ。

### 評価対象

プラン file の `## Completion Criteria` を Read し、以下の subsection を順に評価:

- `### Autonomous Verification`: 各 `[file-state]` / `[orchestrator-only]` / `[outcome]` 項目について、サイドカー JSON の `tasks[].evidence` から該当する verification 結果を探し、EXPECTED と一致するか確認
- `### Requires User Confirmation`: 該当項目があれば「ユーザー手動確認が必要」と注記 (PASS 判定の対象外、情報のみ)
- `### Baseline`: 各タスクで verification が実施され evidence に記録されていることを確認

### 出力

評価が全て通れば 1 行で `AUDIT_VERDICT: PASS` を出力。
失敗があれば `AUDIT_VERDICT: FAIL <reason>` を 1 行で出力し、Step 4 はスキップして Step 5 へ。

verdict format は **正規表現 `^AUDIT_VERDICT: (PASS|FAIL)(\s|$)`** にマッチする形式を厳守する (`$plan` の Phase 4 self-review で同じフォーマットを期待しており、外部 tooling からも grep で消費される可能性があるため)。

例:
```
AUDIT_VERDICT: PASS
AUDIT_VERDICT: FAIL evidence missing for [orchestrator-only] nix flake check
```

## Step 4 Review (Step 3 PASS 時のみ、旧 subagent-review 相当)

Claude `/subagent-review` と同じ順序で、fresh Codex subagent による final-gate review を実行する。main session の実装報告や要約を reviewer に渡さず、plan / diff / changed files / 実ファイルを読ませる。

集約 diff は `git diff <first-task baseline_sha>` で取得する。未コミットの `$impl` 実装差分を review 対象に含めるため、`git diff <sha>..HEAD` は使わない。`first-task baseline_sha` はサイドカー JSON の最初の implementation task (`tasks[0].baseline_sha`) を使う。

### Step 4a: Spec Compliance

fresh `code-reviewer` subagent を spawn する。入力は以下のみ:
- task spec / plan section (`## Files to Change`、`## Approach`、該当 `## Task Outline`)
- aggregated diff (`git diff <first-task baseline_sha>`)
- changed file list (`git diff --name-only <first-task baseline_sha>`)

期待出力は `MUST_FIX` / `SHOULD_FIX` / `NIT` と最終行 `VERDICT: PASS|FAIL`。`VERDICT: FAIL`、non-empty `MUST_FIX` section、または No VERDICT / malformed output は section FAIL として扱う。

完了時に main session が 1 行で出力:
```
SECTION_VERDICT: PASS
SECTION_VERDICT: FAIL <短い理由>
```

### Step 4b: Code Quality

Spec Compliance PASS 後、fresh `code-reviewer` subagent を再 spawn する。入力は以下のみ:
- changed file list
- aggregated diff
- `/Users/wadackel/dotfiles/CLAUDE.md`
- `~/.claude/CLAUDE.md`
- code-quality focus: YAGNI / KISS / DRY、命名、責務分離、error handling、不要な fallback / compatibility shim、コメント過剰

`VERDICT: FAIL`、non-empty `MUST_FIX` section、または No VERDICT / malformed output は section FAIL。SHOULD_FIX / NIT は報告するが blocker ではない。

```
SECTION_VERDICT: PASS
SECTION_VERDICT: FAIL <短い理由>
```

### Step 4c: Domain-Specific Reviewer Dispatch

Code Quality PASS 後、変更ファイルと diff hunk から該当する specialist reviewer を **全て**選び、同一 assistant turn で並列 spawn する。単一選択や優先順位 cutoff はしない。

Trigger table:

| Agent | Trigger |
|---|---|
| `rust-reviewer` | `.rs` file in diff |
| `go-reviewer` | `.go` file in diff |
| `dart-reviewer` | `.dart` file in diff |
| `nix-reviewer` | `.nix` file in diff |
| `typescript-reviewer` | `.ts` / `.tsx` / `.mts` / `.cts` file in diff |
| `react-reviewer` | `.jsx` / `.tsx` file in diff OR diff contains `from "react"` / `from "react-dom"` |
| `a11y-reviewer` | `.css` / `.scss` / `.html` file in diff OR `.jsx` / `.tsx` file in diff |
| `database-reviewer` | `.sql` / `migrations/` / `schema.(sql|prisma|ts)` in diff, OR SQL DML/DDL in app code |
| `deno-reviewer` | `Deno.` API reference in diff OR `jsr:` / `npm:` specifier added in diff OR `deno.jsonc` / `deno.json` modified |
| `cloud-architecture-reviewer` | `.tf` / `*.tfvars` / k8s yaml / Helm chart / `Dockerfile` / `docker-compose.yml` / `serverless.yml` / `.github/workflows/*.yml` |

Detection command shape:

```bash
DIFF_FILES=$(git diff --name-only "${BASELINE_SHA}")
DIFF_HUNKS=$(git diff "${BASELINE_SHA}")

AGENTS=()
printf '%s\n' "$DIFF_FILES" | rg -q '\.rs$' && AGENTS+=(rust-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.go$' && AGENTS+=(go-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.dart$' && AGENTS+=(dart-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.nix$' && AGENTS+=(nix-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.(ts|tsx|mts|cts)$' && AGENTS+=(typescript-reviewer)
{ printf '%s\n' "$DIFF_FILES" | rg -q '\.(jsx|tsx)$' || printf '%s' "$DIFF_HUNKS" | rg -q 'from ["'\'']react(-dom)?["'\'']'; } && AGENTS+=(react-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.(css|scss|html|jsx|tsx)$' && AGENTS+=(a11y-reviewer)
{ printf '%s\n' "$DIFF_FILES" | rg -q '\.sql$|migrations/|schema\.(sql|prisma|ts)$' || printf '%s' "$DIFF_HUNKS" | rg -qi '(INSERT INTO|UPDATE .* SET|DELETE FROM|CREATE TABLE|ALTER TABLE)'; } && AGENTS+=(database-reviewer)
{ printf '%s' "$DIFF_HUNKS" | rg -q '^\+.*(\bDeno\.|["'\'']jsr:|["'\'']npm:)' || printf '%s\n' "$DIFF_FILES" | rg -q 'deno\.(json|jsonc)$'; } && AGENTS+=(deno-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.tf$|\.tfvars$|Dockerfile|docker-compose\.ya?ml$|serverless\.ya?ml$|\.github/workflows/.*\.ya?ml$' && AGENTS+=(cloud-architecture-reviewer)
```

各 specialist には changed file list と aggregated diff を渡す。出力に `VERDICT: FAIL`、non-empty `MUST_FIX` section、No VERDICT、malformed output があれば Domain section は FAIL。Domain retry では、PASS 済み reviewer は再実行せず、FAIL した specialist だけを fresh instance で再 dispatch する。該当 reviewer なしなら `SECTION_VERDICT: PASS (no domain trigger)`。

```
SECTION_VERDICT: PASS
SECTION_VERDICT: FAIL <短い理由>
```

### Step 4d: Security Dispatch Heuristic

Domain PASS 後、Claude `/subagent-review` の security heuristic と同形の trigger を評価する。trigger が 1 つでも fire したら fresh `security-auditor` subagent を spawn する。trigger なしなら security は PASS。

Summary of triggers:
- Path: `scripts/`, `hooks/`, `auth`, `session`, `cookie`, `credential`, `secret`, `token`, `api/`, `webhook`, `oauth`, `sso`, `crypto`, `encrypt`, `decrypt`
- Content: `child_process`, `spawn`, `execFile`, `execFileSync`, `exec(`, `execSync`, `eval(`, `new Function(`, SQL DML, `.query(`, `.exec(`, `.run(`, `password`, `passwd`, `passphrase`, `process.env.XXX`, API key / secret key / access token, `os/exec`, `exec.Command`, Rust `unsafe`, `.unwrap()`, template-literal `fetch`, string-concat HTTP calls
- Config / control plane: `settings.json`, `.claude/**`, `.codex/**`, `.env*`, `permissions.allow*`, `secrets*.{yml,yaml,json,toml}`, `auth*.config*`, `cors*.config*`, `home/programs/codex/hooks.json`, `home/programs/codex/default.nix`, `home/programs/codex/RTK.md`, `home/programs/claude/agents/**`, `home/programs/codex/agents/**`, `home/programs/agent-skills/**`, `home/programs/claude/skills/**`, `home/programs/codex/skills/**`
- Reviewer self-modification: if the diff touches a Claude reviewer Markdown file referenced by a Codex reviewer TOML, a Codex reviewer TOML, or a Codex/Claude skill that controls review or approval flow, security review MUST fire and treat the change as prompt/control-plane modification. If this path is not reviewed, Security section is FAIL.

`security-auditor` の出力に `VERDICT: FAIL`、non-empty `MUST_FIX` section、No VERDICT、malformed output があれば Security section は FAIL。SHOULD_FIX / NIT は報告するが blocker ではない。

```
SECTION_VERDICT: PASS
SECTION_VERDICT: FAIL <短い理由>
```

### Review failure handling

各 stage は最大 3 attempts。FAIL 時は MUST_FIX / malformed output の原因を修正してから fresh subagent で再 review する。同じ subagent instance を再利用しない。3 attempts 連続で FAIL した場合は、サイドカー JSON の `Final Audit + Review` を `in_progress` のまま残し、未解決 blocker をユーザーに提示して停止する。

### 最終 verdict

全 SECTION_VERDICT を集計し、最終行として 1 行出力:

```
REVIEW_VERDICT: PASS
```

または FAIL の場合は、FAIL の SECTION 一覧と理由を先に出し、最終行を `REVIEW_VERDICT: FAIL` にする:

```
- Spec Compliance: <理由>
- Security: <理由>
REVIEW_VERDICT: FAIL
```

verdict format は正規表現 `^(SECTION|REVIEW)_VERDICT: (PASS|FAIL)(\s|$)` を厳守し、review 全体の最終出力行は `REVIEW_VERDICT: PASS` または `REVIEW_VERDICT: FAIL` にする。

## Step 5 終了

| 状態 | 動作 |
|---|---|
| `AUDIT_VERDICT: PASS` + `REVIEW_VERDICT: PASS` | サイドカー JSON 末尾エントリ `Final Audit + Review` を completed に、`update_plan` も同じ、`.active-<hash>` を削除、最終レポート (changed files / tests added / 差分サマリ) を表示 |
| `AUDIT_VERDICT: FAIL` | Step 4 はスキップ済。指摘箇所を `$plan` で再分解するか、ユーザーが手動修正後 `$impl` を再起動 |
| `AUDIT_VERDICT: PASS` + `REVIEW_VERDICT: FAIL` | FAIL の SECTION に挙がった項目をユーザーに提示し、Step 2 のループに戻って修正 (or 軽微なら同 turn で修正してから Step 3 を再実行) |

## Recovery after compaction / re-invocation

コンテキスト圧縮後や中断再開で `$impl` を再起動する場合:
1. Step 0 (Approval gate) を再評価
2. Step 1 でサイドカー JSON を読み直す
3. `tasks[].status` から最も若い id の `pending` または `in_progress` を見つけて再開
4. `in_progress` の途中状態は `git diff <baseline_sha>` で観察し、続行か revert + restart かをケースバイケースで判断

## Re-plan (実装中のプラン改訂)

実装中にプラン改訂が必要になったら:
1. ユーザーに「`$plan` を再実行しますか？ completed タスクの evidence は維持されます」と尋ねる
2. 承認後、サイドカー JSON の `tasks` のうち `completed` 以外を削除、`update_plan` も再構築
3. `$plan` を再起動 (新しい `.pending-` が作られ、ユーザーの再承認 `$impl` で promote される)
4. 完了済 task のリストは新規 Phase 5 DECOMPOSE への入力 context として保持

## Design notes

- **per-task review gate なし**: 各タスクは acceptance verification (Step 2c) のみで進行する。Quality/Security adjudication は Step 3-4 の最終ゲートに集約 (Claude `/impl` の最新方針と同じ)。
- **fresh subagent review**: Step 4 は main session の自己レビューではなく、`~/.codex/agents/*.toml` の reviewer subagent を fresh context で起動する。Spec / Quality は順次、Domain specialists は該当 reviewer を同一 turn で並列 dispatch する。
- **Claude reviewer Markdown を SSOT にする**: Codex reviewer TOML は Claude 側 agent definition を pointer 参照し、Codex 用の出力 adapter (`MUST_FIX` / `SHOULD_FIX` / `NIT` / `VERDICT: PASS|FAIL`) だけを追加する。長い reviewer rubric は複製しない。
- **skill-to-skill invocation 不可**: Codex 0.128.0 では skill から別 skill を呼ぶ API が存在しない (Codex Skills docs)。そのため Audit / Review を独立した `$final-gate-codex` skill に分けず、本 `$impl` 内蔵 phase として実装した。手動 hand-off ステップ無し、ファイル経由 IPC 不要。
- **verdict format 固定**: `AUDIT_VERDICT` / `SECTION_VERDICT` / `REVIEW_VERDICT` の 3 種類のみ、各々 `PASS|FAIL` の 2 値。任意の追加情報は同行末尾 (`<理由>`) または別行に書く。`/usr/bin/grep` で機械抽出可能なフォーマットを保つ。
