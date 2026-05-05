---
name: plan-codex
description: Codex 版の design-first 計画作成 skill。Claude Code の /plan を Codex CLI 用に移植したもの。明示的な `$plan-codex <request>` 起動でのみ動き、auto-load は agents/openai.yaml で抑制してある。implicit invocation を期待する利用 (キーワードからの自動連想) は対象外。
---

# $plan-codex

Codex CLI 上で feature plan を作成する skill。Claude Code の `/plan` (`~/.agents/skills/plan/SKILL.md`) を Codex 用に再構成。`$plan-codex <request>` で明示的に起動する。終了時に `~/.codex/plans/.pending-<cwd-hash>` を作成し、ユーザーが次ターンで `$impl-codex` を打つと UserPromptSubmit hook (`codex-impl-approval-tracker.ts`) が `.pending-` を `.active-` に promote する。

## Argument extraction (Codex 固有)

Codex skill には Claude の `$ARGUMENTS` 展開がない。`$plan-codex README に追記` のように起動した場合、verbatim user message `$plan-codex README に追記` がそのまま skill body に渡る。

**最初の行動**: 自分が受け取った user prompt を読み、`$plan-codex` 以降の文字列を **request** として抽出する。空 (引数なし) の場合は「実装したい内容を教えてください」と尋ねて end turn し、次ターンの返答を request として扱う。

## Prerequisites (Phase 4 動作要件)

Phase 4 DEEPEN は Codex の subagent dispatch に依存する。以下の custom agent TOML が `~/.codex/agents/` 配下に配置されていること:

- `~/.codex/agents/plan-critic.toml`
- `~/.codex/agents/plan-adversarial.toml`
- `~/.codex/agents/plan-simplifier.toml`

dotfiles 実体は `home/programs/codex/agents/`。1 つでも欠けている場合は Phase 4 を実行できないため、`darwin-rebuild switch --flake .#private` を勧めて end turn する。

## Phase 1 PARSE

### Restate

ユーザー request を 1 文で言い直して確認: 「あなたが実装したいのは X ですね？」

### Complexity 推定

| Level | Signals | Scope |
|---|---|---|
| trivial | typo / コメント / 単一 config 値 / 1 行コピー編集 | 1 file, <10 行, 設計判断不要 |
| small | 単一 module 追加、明確な既存パターンに従う | 1-3 files, <100 行 |
| medium | 複数ファイル feature、既存規約踏襲 | 3-10 files, 100-500 行 |
| large | 横断的変更、新規 architectural piece | 10+ files, 500+ 行 |
| xl | 複数サブシステム / 構造的シフト | ユーザーに分割提案 |

**trivial short-circuit**: complexity が trivial なら Phase 2-4 をスキップして Phase 5 へ直行 (Context + Files to Change + Verification のみの最小プラン、1 タスク)。

### Requirement Clarification (small+)

判断基準は `~/.agents/skills/plan/references/requirement-checklist.md` を参照 (Claude 版と同一: 8 観察軸、cost-based triage、ambiguous qualifier 校正シグナル)。**Codex には Claude の AskUserQuestion がないため、対話モデルは "1 turn = 1 round"** に簡略化する:

1. Step A Walk: 8 観察 (Why / What / Who / When / Where / How / Success / Failure) を歩き、NotClear 項目を洗い出す。
2. Step B Triage: cost-if-wrong × downstream recoverability で Ask / Assume / Self-resolve を選ぶ。
3. Step C Self-resolve probe: 軽量な grep/read で答えられるものは自分で解決。
4. Step E Ask: 残った real question を **最大 3 件** (各々に AI 自身の推奨案を必ず明示)、テキストで列挙して **end turn**。次ターンのユーザー回答で round 終了。
5. Step F: 回答を踏まえ、Assumptions / Unresolved Items に振り分けて Phase 2 へ進む。

MVP では原則 1 round で収束させる (Phase 2 EXPLORE で codebase-recoverable な疑問は自己解決)。

### Phase 1 出力

`### Requirement Clarification` / `### Assumptions` / `### Self-resolved` / `### Unresolved Items` の 4 サブセクションを `## Overview` の直前に書く。subsection 名は英語固定 (downstream parsing のため)。

## Phase 2 EXPLORE (non-trivial only)

内蔵 `explorer` agent を **3 並列起動** して 3 つの discovery outcome を埋める。dispatch は自然言語ディレクティブ 1 メッセージで Codex orchestration に任せる:

```
Spawn three explorer subagents in parallel with these distinct mandates. Wait for all three and then return their findings together.

[explorer 1] Existing patterns
  既存の規約 (命名 / error handling / config / test layout / dependency style) を grep/read で集める。
  各発見を file:lines + snippet で記録。

[explorer 2] Execution paths and boundaries
  entry points / data flow / state transitions / API contracts / architectural seams を辿る。
  trigger から observable outcome までの経路を file:lines で記録。

[explorer 3] Existing behavior, constraints, verification conditions
  現状挙動・不変条件・関連既存テスト (file:lines) と検証手段を集める。
  Acceptance / Completion Criteria / Test Strategy を設計するのに足る情報を提供する。
```

3 mandate は Claude 版と同形。重複検索を避けるため mandate 境界を明示する。

結果は **Unified Discovery Table** (`Category | File:Lines | Pattern | Key Snippet`) に集約する。

### Empirical analysis (existing-behavior 改修時)

`## Files to Change` に UPDATE があり振る舞いを変える場合、または bug-fix / refactor / 仕様変更 / perf / CLI 出力 / semantics change の場合、3 mandate のうち 1 枠を empirical 観察に振り替える:

- historical signals: `~/.codex/plans/*.md`、`~/.codex/sessions/**/*.jsonl`、`~/.claude/retrospective-ledger.jsonl`、`git log -p`
- direct current-behavior observation: CLI 実行、hook 発火、effective config 読み

「spec が言うこと」vs「実際に起きること」を Tier 1/2 で記録し、Empirical Behavior 行として Discovery Table に追加。

## Phase 3 DRAFT (non-trivial only)

`~/.codex/plans/YYYYMMDDTHHmm-<slug>.md` にプラン本体を書く (slug は request から、max 40 chars、lowercase kebab)。

### Language policy

- 本文 prose: ユーザーの設定言語 (本リポジトリでは日本語)
- Section headers (`## Context` / `## Overview` / `## Approach` / `## NOT Building` / `## Mandatory Reading` / `## Patterns to Mirror` / `## Intentional Conventions` / `## Files to Change` / `## Task Outline` / `## Test Strategy` / `## Verification Commands` / `## Definition of Done` / `## Risks + Open Questions` / `## Deepening Log` / `## Completion Criteria`): **英語固定** (Phase 5 と $impl-codex Audit/Review が literal string で locate するため)
- Machine-consumed contents (`## Completion Criteria` 各サブセクション、Acceptance Criteria 行): 英語
- Phase 1 subsections の見出し: 英語固定 (`### Requirement Clarification` 等)
- File paths / commands / `EXPECT:` 値: as-is

### Required sections (complexity-gated)

Claude 版と同じ表に従う (trivial=Context+Files to Change+Verification+Task Outline+Definition of Done のみ、small=+Overview+Approach+NOT Building+Test Strategy+Risks、medium+=+Mandatory Reading+Patterns to Mirror+Intentional Conventions(applicable)+Deepening Log link)。

各セクションの中身ガイドラインは Claude 版 SKILL.md と同じ — ただし Codex 文脈で skill 起動構文 / hook 名 / ツール名は Codex 仕様に置き換える。

## Phase 4 DEEPEN (non-trivial only)

Iterative adversarial-critique flow。プロンプトは Claude 版と物理共有: `~/.agents/skills/plan/references/critic-prompt.md` / `adversarial-prompt.md`。Phase 4 の subagent は `~/.codex/agents/{plan-critic,plan-adversarial,plan-simplifier}.toml` で事前定義済 (Prerequisites 参照)。

### Step 1 — Context collection

argument-hint からの max-rounds (default 2, cap 5) を抽出 (例: `$plan-codex --max-rounds=3 ...`)。Phase 3 で書いたプラン本体、project CLAUDE.md (`~/.claude/CLAUDE.md` および当該リポジトリの CLAUDE.md) を context として用意。

### Step 2 — Critic Subagent (each round)

各 round で `plan-critic` subagent を spawn する:

```
Spawn the plan-critic subagent.
plan-critic input:
  {plan_content}: <full plan body>
  {project_context}: <CLAUDE.md summary + repo facts>
  {prior_log}: <previous round entries from <basename>.log.md, or "first round">
Wait for its response.
```

Critic は出力末尾に `### Verdict\n(CONVERGED|ITERATE)` を返す契約 (TOML `developer_instructions` でピン止めされている)。

### Step 3 — Process critique + classify

main session が Critic 出力を triage:

- **Self-resolvable**: main session が grep/read で解決し、プラン本文に `-- Why: ...` rationale 付きで反映
- **Needs user input**: Step 7 Consolidated Interview Queue へ
- **Reject**: 過去のユーザー決定に矛盾するもの

Verdict 抽出: `rg -m1 -A1 '^### Verdict$' <subagent-output>` の 2 行目が `CONVERGED` か `ITERATE`。`<plan-basename>.log.md` に Round N entry を append (verbatim subagent 出力)。

### Step 4 — Convergence check

以下のいずれかで Step 5 へ:
- Verdict `CONVERGED`
- max-rounds 到達
- 同一 issue が連続 2 round で repeat (escalate)
- zero Critical Issues

そうでなければ Step 2 に戻り、次 round を fresh spawn で実行。

### Step 5 + Step 6 — Adversarial + Simplifier (true parallel)

`plan-adversarial` と `plan-simplifier` を **同一メッセージ** で spawn する (Codex orchestration が並列で立ち上げる):

```
Spawn the plan-adversarial subagent and the plan-simplifier subagent in parallel.

plan-adversarial input:
  {plan_content}: <full plan body>
  {project_context}: <CLAUDE.md summary + repo facts>
  {file_paths}: <list of key file paths referenced in the plan>

plan-simplifier input:
  {plan_content}: <full plan body>
  {original_user_request}: <the user's original request that drove the plan>
  {project_design_principles}: <CLAUDE.md YAGNI/KISS/DRY framing>

Wait for both, then return their findings together.
```

Adversarial は finding を `(FALSIFIED|UNVERIFIED|VERIFIED|DESIGN_QUESTION)` tag 付きで返す。Simplifier は提案を `(HIGH|MEDIUM|LOW)` confidence tag 付きで返す。HIGH は subtractive only auto-apply、MEDIUM/LOW は Step 7 Queue へ。

**並列 dispatch 失敗時**: 同一メッセージで spawn したのに片方だけ応答が返る場合、欠損側は ITERATE (Adversarial) / 提案なし (Simplifier) と扱い、その round 内では再発火しない (次 round 以降の自然な再実行に任せる)。

### Step 7 — Consolidated Interview (round 末尾で 1 回)

Step 3 / Step 5 / Step 6 から繰り上がった needs-user-input items を 1 つのテキスト列挙 (max 4 questions) に集約し end turn する。Codex には AskUserQuestion API がないため、ユーザーは次ターンで自然言語で答える。`以下を自己解決しました:` ブロックで Self-resolved 内容を先に提示する。

### Step 8 — Definition of Done pipeline

Completion Criteria を以下の tagging で設計:

- `[file-state]`: Read / Grep / Glob で観測可能
- `[orchestrator-only]`: host access が必要なコマンド (`nix flake check`, `darwin-rebuild`, sudo 等)。main session が pre-run して evidence を埋める
- `[outcome]`: 循環的依存 (例: `$impl-codex` 内蔵 Review が PASS)

verdict format `^(AUDIT|SECTION|REVIEW)_VERDICT: (PASS|FAIL)$` は `$impl-codex` 内蔵 Audit + Review が消費する。

### Deepening Log artifact

`~/.codex/plans/<plan-basename>.log.md` に各 round の verbatim 出力を append する:

```markdown
## Round 1

### Critic
<verbatim subagent stdout>

### Adversarial
<verbatim subagent stdout>

### Simplifier
<verbatim subagent stdout>

### Applied changes
- <bullet 1>: <Why>
- ...
```

各 round entry は `### Round N` で始まる verbatim 出力で構成。subsection 構造は固定せず、subagent が返した形式をそのまま貼る (現時点で機械消費なし)。

プラン本文側は `## Deepening Log` セクションを 1 つ持ち、`See [./<basename>.log.md](./<basename>.log.md)` の link のみ書く (本文を肥大化させない)。

## Phase 5 DECOMPOSE

main session がタスクを Codex の `update_plan` に登録 + サイドカー JSON を初期化する。

### `update_plan` の制約 (probe で確認済)

- 戻り値は literal `"Plan updated"` のみ。タスク識別子は返らない。
- フィールドは `step` (1-5 word の短文) + `status` (pending|in_progress|completed) のみ。`metadata` 保持不可。
- 1 セッション内で永続、`codex resume` でも保持される。

### 1-call DECOMPOSE

タスクを **1 回の `update_plan` 呼び出し** で順序付き配列として登録する。Pass 1/2 分割は廃止 (戻り値に id がないため `blockedBy` 概念が成立しない):

```
update_plan({
  explanation: "Decompose plan into impl tasks",
  plan: [
    { step: "<task 1 short subject>", status: "pending" },
    { step: "<task 2 short subject>", status: "pending" },
    ...
    { step: "Final Audit + Review", status: "pending" }   // 最後は固定: $impl-codex 内蔵 phase の入口
  ]
})
```

### サイドカー JSON 初期化

`~/.codex/plans/<plan-basename>.evidence.json` をタスクと同じ順序で初期化する。task id は配列 index ベース (`task-1`, `task-2`, ...) で採番:

```bash
deno eval '
  const path = Deno.args[0];
  const subjects = JSON.parse(Deno.args[1]);
  const data = {
    plan: Deno.args[2],
    tasks: subjects.map((s, i) => ({
      id: `task-${i+1}`,
      subject: s,
      baseline_sha: null,
      evidence: null,
      status: "pending",
    })),
  };
  await Deno.writeTextFile(path + ".tmp", JSON.stringify(data, null, 2));
  await Deno.rename(path + ".tmp", path);
' -- /Users/$USER/.codex/plans/<basename>.evidence.json '["subject 1","subject 2","Final Audit + Review"]' '<basename>.md'
```

末尾の `Final Audit + Review` エントリは $impl-codex 内蔵 Audit/Review phase が「ここまで来たら Audit と Review を実行」と判断するためのマーカー。実装タスクではない。

### Decomposition Rules

Claude 版と同じ:
1. 1 task = 1 verifiable unit
2. Verification は各 implementation task に内包 (verification-only task は "Final Audit + Review" のみ許される)
3. Separation of concerns
4. Three elements (target files / expected behavior / verification commands + EXPECTED output)
5. 末尾 "Final Audit + Review" は $impl-codex skill が直接実行する内蔵 phase であり、独立の skill 起動は不要 (Codex には skill-to-skill invocation API がないため)

### Acceptance criteria by change type

Claude 版 (`~/.agents/skills/plan/SKILL.md`) の表をそのまま参照可能。

## Phase 6 ACTIVATE PENDING

`.pending-<cwd-hash>` のみ作成する (`.active-` には絶対しない)。`.active-` は次ターンでユーザーが `$impl-codex` を打鍵したときに `codex-impl-approval-tracker.ts` UserPromptSubmit hook が promote する。

```bash
REAL_PWD=$(realpath "$PWD")
CWD_HASH=$(printf '%s' "$REAL_PWD" | shasum -a 256 | cut -c1-16)
mkdir -p "$HOME/.codex/plans"
rm -f "$HOME/.codex/plans/.active-${CWD_HASH}"  # 過去の承認を必ず無効化 (re-plan ケース)
printf '%s\n' '<PLAN_FILE_PATH from Phase 3>' > "$HOME/.codex/plans/.pending-${CWD_HASH}"
```

`<PLAN_FILE_PATH from Phase 3>` は Phase 3 で決めた絶対パスを agent が template-substitute する (bash 変数展開ではなく文字列置換)。

### Output to user

プラン本体を inline で表示してから metadata block:

```
## Plan
<full plan body, verbatim>

---

## Plan ready
- File: <plan path>
- Complexity: <trivial/small/medium/large/xl>
- Tasks: <count> (+ Final Audit + Review)
- Status: PENDING APPROVAL — type `$impl-codex` to approve and execute

⚠️ AI が自己 chain で `$impl-codex` を打っても UserPromptSubmit hook は発火しないため、`.pending-` → `.active-` の promote は起こらない。承認はユーザーの明示打鍵でのみ成立する。
```

`xl` で plan body が ~600 行を超える場合は section heading の TOC + plan path に置き換え、metadata block は同じ。

## Integration with existing tooling

- `~/.agents/skills/plan/references/requirement-checklist.md`: Claude 版と共有 (linkHere whole-dir 経由で物理的に同一ファイル)。Phase 1 の判断基準。
- `~/.agents/skills/plan/references/critic-prompt.md` / `adversarial-prompt.md`: Phase 4 の subagent prompt 本体。`~/.codex/agents/{plan-critic,plan-adversarial}.toml` の `developer_instructions` から pointer 参照される (workspace 共有経路)。
- `~/.codex/agents/{plan-critic,plan-adversarial,plan-simplifier}.toml`: Phase 4 が依存する custom agent 定義。dotfiles 実体は `home/programs/codex/agents/`。
- `$impl-codex` skill: Phase 5 で登録した `update_plan` のタスク列を順次実行し、最後に内蔵 Audit + Review phase で `^(AUDIT|SECTION|REVIEW)_VERDICT: (PASS|FAIL)$` を出力する。
- PreToolUse hook (`codex-plan-gate.ts`): cwd 配下の apply_patch を `.active-<hash>` 不在/期限切れ時に block する。Phase 6 で `.pending-` のみを書く理由はこのゲートと連動するため。

## Design notes

- **subagent dispatch を活用**: Phase 2 EXPLORE は内蔵 `explorer` agent で 3 並列、Phase 4 DEEPEN は custom TOML agents (plan-critic / plan-adversarial / plan-simplifier) で Critic + Adversarial + Simplifier。`[agents]` config defaults (max_threads=6 / max_depth=1) で動作、MCP は optional。Codex 0.128.0 で empirical 検証済 (Phase 0 probe)。
- **`developer_instructions` は pointer 方式**: 各 TOML は prompt 本体を転記せず、`references/*.md` の絶対 path + placeholder 命名 + verdict format 契約のみを持つ。subagent は workspace 共有経路で参照ファイルを Read する。SSOT を `references/*.md` に維持し dual-source-of-truth 同期コストを回避。
- **Verdict format 契約**: `plan-critic` は `^### Verdict$\n(CONVERGED|ITERATE)$`、`plan-adversarial` は finding tag `(FALSIFIED|UNVERIFIED|VERIFIED|DESIGN_QUESTION)`、`plan-simplifier` は confidence tag `(HIGH|MEDIUM|LOW)`。main session が rg で抽出する。
- **`update_plan` の薄さをサイドカー JSON で補う**: ステータス + 短文しか持てないため、`baseline_sha` / `evidence` は `<basename>.evidence.json` に永続化する。
- **承認ゲート二重化**: `codex-plan-gate.ts` (PreToolUse) が apply_patch を機械的に止め、本 skill の `.pending-` 出力 + UserPromptSubmit hook が承認の唯一のルートを担保する。AI 自己 chain (`$plan-codex` → 同一ターンで `$impl-codex` を model 自身が打つ) では UserPromptSubmit hook が発火しないため、promote は起こらない。
- **skill-to-skill invocation API がない**: Codex 公式 docs に明文化された skill→skill の起動 API はなく、`$xxx` 言及からの auto-load は prompt-injection 経路に依存する非公式挙動。final gate を独立 skill に分けず `$impl-codex` 内蔵 Audit + Review phase に閉じる根拠。
