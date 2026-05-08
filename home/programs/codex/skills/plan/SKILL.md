---
name: plan
description: Codex 版の design-first 計画作成 skill。Claude Code の /plan を Codex CLI 用に移植したもの。明示的な `$plan <request>` 起動でのみ動き、auto-load は agents/openai.yaml で抑制してある。implicit invocation を期待する利用 (キーワードからの自動連想) は対象外。
---

# $plan

Codex CLI 上で feature plan を作成する skill。Claude Code の `/plan` (`~/.claude/skills/plan/SKILL.md` / worktree: `home/programs/claude/skills/plan/SKILL.md`) を Codex 用に再構成。`$plan <request>` で明示的に起動する。終了時に `~/.codex/plans/.pending-<cwd-hash>` を作成し、ユーザーが次ターンで `$impl` を打つと UserPromptSubmit hook (`codex-impl-approval-tracker.ts`) が `.pending-` を `.active-` に promote する。

## Argument extraction (Codex 固有)

Codex skill には Claude の `$ARGUMENTS` 展開がない。`$plan README に追記` のように起動した場合、verbatim user message `$plan README に追記` がそのまま skill body に渡る。

**最初の行動**: 自分が受け取った user prompt を読み、以下の優先順位で解釈する。

1. 明示構文 `$plan --answer <回答>` について、user prompt の先頭が `^\s*\$plan\s+--answer(?:\s+|$)` に一致する場合のみ、通常の `$plan <request>` より優先して Blocking Interview の継続回答として扱う。対応する `.clarifying-<cwd-hash>.json` を読み、保存済み `request` と今回の `<回答>` を統合して Phase 1 を再開する。質問時に提示した `interviewId` が marker と一致しない場合は継続しない。
2. user prompt の先頭が `^\s*\$plan(?:\s+|$)` に一致する場合は、`$plan` 以降の文字列を **request** として抽出する。
3. 空 (引数なし) の場合は「実装したい内容を教えてください」と尋ねて end turn し、次ターンの返答を request として扱う。

`.clarifying-<cwd-hash>.json` が見つからない状態で `$plan --answer` が来た場合は、「継続中の確認セッションが見つかりません。もう一度 `$plan <request>` から始めてください。」と伝えて end turn する。

## Prerequisites (Phase 4 動作要件)

Phase 4 DEEPEN は Codex の subagent dispatch に依存する。以下の custom agent TOML が `~/.codex/agents/` 配下に配置されていること:

- `~/.codex/agents/plan-critic.toml`
- `~/.codex/agents/plan-adversarial.toml`
- `~/.codex/agents/plan-simplifier.toml`

dotfiles 実体は `home/programs/codex/agents/`。1 つでも欠けている場合は Phase 4 を実行できないため、`darwin-rebuild switch --flake .#private` を勧めて end turn する。

## Core behavior

`$plan` は、実装者がユーザー意図から逸れずに実装できる計画を作るための skill。曖昧な要求に対して、実装経路が見えているだけで plan 作成へ進んではいけない。

small / medium / large の要求では、user-intent decision が解消されるまで `plan file / evidence sidecar / pending marker` を作らない。解消とは、ユーザーが回答した、ユーザーが明示的に仮定を選んで進行を許可した、または残りが codebase-recoverable technical discovery として具体的な downstream `next:` を持つ状態を指す。

コード・設定・ログ・既存 issue・現在の会話から観測できる事実は、質問前に軽量調査で自己解決する。ユーザーの望む振る舞い、優先度、scope boundary、成功条件、risk tolerance、trade-off acceptance は観測から推測しない。

Facts can be inferred from observation; user intent cannot.

調査をその turn で実行できない文脈 (dry-run、read-only smoke、"first message only" 指示など) では、「これから調査する」とだけ返して終わらない。観測で解ける候補は `Self-resolved later` として短く示し、残る最重要の `User decision` を recommended answer (推奨案) と rationale 付きで質問して end turn する。

すべての real clarification question には recommended answer (推奨案) と短い rationale を付ける。推奨案を出せない場合は、調査不足・質問の粒度が広すぎる・または user-only decision の候補が整理できていない状態なので、質問を狭めるか追加調査し、推奨案と rationale を付けられる形にしてから聞く。

## Phase 1 PARSE

### Restate

ユーザー request を 1 文で要約する。これは理解の restate であり、Ask の代替確認ではない: 「あなたが実装したいのは X ですね？」

### Complexity 推定

| Level | Signals | Scope |
|---|---|---|
| trivial | typo / コメント / 単一 config 値 / 1 行コピー編集 | 1 file, <10 行, 設計判断不要 |
| small | 単一 module 追加、明確な既存パターンに従う | 1-3 files, <100 行 |
| medium | 複数ファイル feature、既存規約踏襲 | 3-10 files, 100-500 行 |
| large | 横断的変更、新規 architectural piece | 10+ files, 500+ 行 |
| xl | 複数サブシステム / 構造的シフト | ユーザーに分割提案 |

**trivial short-circuit**: complexity が trivial なら Phase 2-4 をスキップして Phase 5 へ直行 (Context + Files to Change + Verification Commands + Completion Criteria の最小プラン、1 タスク)。

### Requirement Clarification (small+)

This subsection defines the Blocking Interview Protocol for non-trivial `$plan` requests.

判断基準は `home/programs/agents/shared/plan/references/requirement-checklist.md` (公開 path: `~/.agents/skills/plan/references/requirement-checklist.md`、Claude 側は `~/.claude/skills/plan/references/requirement-checklist.md`) を参照 (Claude 版と同一: 8 観察軸、cost-based triage、ambiguous qualifier 校正シグナル)。

**Clarity-gated loop**: Phase 1 は clarity-gated に進める。small / medium / large は、要求が実装計画を書ける程度に明確になるまで必要に応じて質問を続ける。`trivial` は Phase 1 を skip し、`xl` は分割提案に進む。

**Interview gate**: 未解決の ambiguity は plan 作成前に必ず分類する。

| Bucket | Meaning | Action |
|---|---|---|
| **Observed fact** | codebase、関連ログ、docs、既存 issue、現在の会話から観測できる | 軽量 grep/read で自己解決し、secret / token / credential を plan や log に残さない |
| **User decision** | desired behavior、priority、scope boundary、audience、risk tolerance、success criteria、trade-off acceptance に依存する | ユーザーに聞く。reasonable default があっても Draft assumption にしない |
| **Technical deferral** | codebase-recoverable だが Phase 1 の軽量 probe では重すぎる technical discovery | `### Unresolved Items` に具体的な `next:` を書き、Phase 2 / Phase 4 / implementation へ委譲する |
| **Draft assumption** | ユーザーが明示的に仮定で進めることを許可した、または non-blocking technical/default detail | `### Assumptions` に理由付きで記録する |

`User decision` が 1 つでも残る場合、この turn では `plan file / evidence sidecar / pending marker を一切作らない`。質問して end turn する。

**Each clarification pass**:

1. **Step A Walk**: 8 観察 (Why / What / Who / When / Where / How / Success / Failure) を歩き、過去回答を反映したうえで NotClear 項目を洗い出す。Restate は理解の要約であり、Ask の代替ではない。
2. **Step B Triage**: cost-if-wrong × downstream recoverability で Ask / Assume / Self-resolve を選ぶ。Ask しない項目は `no-ask reason` を `### Assumptions` / `### Self-resolved` / `### Unresolved Items` のいずれかに記録する。user intent に依存する値は、ユーザーの明示選択なしに Assume しない。
3. **Step C Self-resolve probe**: 軽量な grep/read で答えられるものは自分で解決する。codebase-recoverable だが Phase 1 で確定できない項目は、具体的な `next:` を持たせて後続 Phase に委譲する。user-only knowledge に依存するなら Ask に昇格する。
4. **Step D Re-Ask trigger detection**: trigger は (i) prior answer に含まれる open-ended return question、(ii) ambiguous / empty answer、(iii) tentative Assumption が re-walk でまだ NotClear、(iv) deferred Ask items の繰り越し。同じ trigger が残り続ける場合、回数消化で進まず、ユーザーに「明示した仮定で進める / リスクを承知で進める / 追加確認する / scope out する」を選ばせる。
5. **Step E Ask issuance**: 残った real question を impact-priority で最大 4 件にまとめる。各 question には recommended answer (推奨案) と短い rationale を必ず付ける。質問を出す直前に `~/.codex/plans/.clarifying-<cwd-hash>.json` を作成または上書きする。schema は `request`, `questions`, `selfResolvedSummary`, `createdAt`, `cwd`, `version`, `interviewId` を含む。`interviewId` は質問文にも表示し、継続時に照合する。新しい Blocking Interview を始める場合は既存 marker を上書きする。
6. **Step F Wait**: `ここで回答を待ちます。次の turn で自然言語で回答するか、確実な継続が必要なら $plan --answer <回答> を使ってください。` と明記して **end turn** する。
7. **Step G Answer handling**: 次ターンの自然言語回答は best-effort で直前の `.clarifying-<cwd-hash>.json` に紐づける。保証された継続には `$plan --answer <回答>` を使う。ユーザーが AI 推奨案を選んだ場合は該当値を記録する。ユーザーが「X と仮定して進めて」のように明示した場合のみ、user-judgment-bound observation を `### Assumptions` に `user-overridden: true` 付きで記録して進める。空または曖昧な回答は次 pass の re-Ask trigger とする。
8. **Step H Cleanup**: clarity gate が満たされたら marker を削除して Phase 2 へ進む。plan 作成が成功したら `.clarifying-<cwd-hash>.json` を削除する。新しい non-clarifying `$plan <request>` が plan 作成まで成功した場合も、古い clarifying marker を削除する。

**Convergence conditions** (any one):

- Ask / re-Ask trigger が 0 件、かつ `User decision` が残っていない
- 残る uncertainty が codebase-recoverable で、具体的な downstream `next:` とともに `### Unresolved Items` へ記録済み
- ユーザーが明示的な仮定で進行を許可した、または repeated uncertainty を scope out した

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

### Subagent Lifecycle Budget

main session は subagent を起動したら、その場で `agent_id / role / phase / status / closed` の簡易 ledger を保持する。subagent の出力を plan 本文・Unified Discovery Table・Deepening Log に統合したら、その subagent は result-integrated と見なし、次 phase へ進む前に `close_agent` で閉じる。`close_agent` は結果統合後または terminal/known completed agent にだけ使い、実行中の調査を途中で打ち切る目的では使わない。

通常時の live subagents は 3 以下を目安にする。Phase 2 の explorer 3 並列は許容するが、3 件の結果を Unified Discovery Table に集約した直後に 3 件すべてを `close_agent` する。Phase 4 に入る前には ledger を確認し、known completed なのに未 close の subagent があれば先に閉じる。

spawn が `agent thread limit reached` で失敗した場合だけ、known completed / terminal agents を `close_agent` で閉じ、失敗した dispatch を retry exactly once する。retry 後も失敗する場合は追加の spawn を繰り返さず、該当 phase の失敗時ルールに従って degrade するか停止する。

### Empirical analysis (existing-behavior 改修時)

`## Files to Change` に UPDATE があり振る舞いを変える場合、または bug-fix / refactor / 仕様変更 / perf / CLI 出力 / semantics change の場合、3 mandate のうち 1 枠を empirical 観察に振り替える:

- historical signals: `~/.codex/plans/*.md`、`~/.codex/sessions/**/*.jsonl`、`~/.claude/retrospective-ledger.jsonl`、`git log -p`
- direct current-behavior observation: CLI 実行、hook 発火、effective config 読み

「spec が言うこと」vs「実際に起きること」を Tier 1/2 で記録し、Empirical Behavior 行として Discovery Table に追加。

## Phase 3 DRAFT (non-trivial only)

`~/.codex/plans/YYYYMMDDTHHmm-<slug>.md` にプラン本体を書く (slug は request から、max 40 chars、lowercase kebab)。書き込み前に `mkdir -p ~/.codex/plans` を実行する。

### Language policy

- 本文 prose: ユーザーの設定言語 (本リポジトリでは日本語)
- Section headers (`## Context` / `## Overview` / `## Approach` / `## NOT Building` / `## Mandatory Reading` / `## Patterns to Mirror` / `## Intentional Conventions` / `## Files to Change` / `## Task Outline` / `## Test Strategy` / `## Verification Commands` / `## Definition of Done` / `## Risks + Open Questions` / `## Deepening Log` / `## Completion Criteria`): **英語固定** (Phase 5 と $impl Audit/Review が literal string で locate するため)
- Machine-consumed contents (`## Completion Criteria` 各サブセクション、Acceptance Criteria 行): 英語
- Phase 1 subsections の見出し: 英語固定 (`### Requirement Clarification` 等)
- File paths / commands / `EXPECT:` 値: as-is

### Required sections (complexity-gated)

Claude 版と同じ表に従う (trivial=Context+Files to Change+Verification Commands+Task Outline+Definition of Done+Completion Criteria、small=+Overview+Approach+NOT Building+Test Strategy+Risks、medium+=+Mandatory Reading+Patterns to Mirror+Intentional Conventions(applicable)+Deepening Log link)。

`## Completion Criteria` は全 complexity で必須。trivial short-circuit でも `### Autonomous Verification` / `### Requires User Confirmation` / `### Baseline` の 3 subsection を必ず生成する。

各セクションの中身ガイドラインは Claude 版 SKILL.md と同じ — ただし Codex 文脈で skill 起動構文 / hook 名 / ツール名は Codex 仕様に置き換える。

## Phase 4 DEEPEN (non-trivial only)

Iterative adversarial-critique flow。プロンプトは Claude 版と物理共有: `home/programs/agents/shared/plan/references/critic-prompt.md` / `adversarial-prompt.md` (Codex 公開 path: `~/.agents/skills/plan/references/`、Claude 公開 path: `~/.claude/skills/plan/references/`)。Phase 4 の subagent は `~/.codex/agents/{plan-critic,plan-adversarial,plan-simplifier}.toml` で事前定義済 (Prerequisites 参照)。

### Step 1 — Context collection

argument-hint からの max-rounds (default 2, cap 5) を抽出 (例: `$plan --max-rounds=3 ...`)。Phase 3 で書いたプラン本体、project CLAUDE.md (`~/.claude/CLAUDE.md` および当該リポジトリの CLAUDE.md) を context として用意。

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

Critic は `### Verdict` の次行に `CONVERGED` または `ITERATE` を返す契約 (TOML `developer_instructions` でピン止めされている)。shared prompt の `Reasoning:` 行が続いても、main session は verdict 行の次の 1 行だけを読む。

### Step 3 — Process critique + classify

main session が Critic 出力を triage:

- **Self-resolvable**: main session が grep/read で解決し、プラン本文に `-- Why: ...` rationale 付きで反映
- **Needs user input**: Step 7 Consolidated Interview Queue へ
- **Reject**: 過去のユーザー決定に矛盾するもの

Verdict 抽出: `rg -m1 -A1 '^### Verdict$' <subagent-output>` の 2 行目が `CONVERGED` か `ITERATE`。`<plan-basename>.log.md` に Round N entry を append (verbatim subagent 出力)。

Critic 出力を triage し、verdict 抽出と log append が完了したら、その round の `plan-critic` agent を `close_agent` で閉じる。次 round を fresh spawn する前に ledger 上の critic が closed であることを確認する。

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

Step 5 + Step 6 を開始する前に、ledger 上の result-integrated subagents がすべて closed であることを確認する。Adversarial / Simplifier の結果を Step 7 queue や plan 本文に反映したら、両方を `close_agent` で閉じる。

**並列 dispatch 失敗時**: 同一メッセージで spawn したのに片方だけ応答が返る場合、欠損側は ITERATE (Adversarial) / 提案なし (Simplifier) と扱い、その round 内では再発火しない (次 round 以降の自然な再実行に任せる)。ただし失敗理由が `agent thread limit reached` と観測できる場合だけ、Subagent Lifecycle Budget のルールに従って cleanup 後に missing side を retry exactly once してよい。

### Step 7 — Consolidated Interview (round 末尾で 1 回)

Step 3 / Step 5 / Step 6 から繰り上がった needs-user-input items を 1 つのテキスト列挙 (max 4 questions) に集約し end turn する。Codex には AskUserQuestion API がないため、ユーザーは次ターンで自然言語で答える。`以下を自己解決しました:` ブロックで Self-resolved 内容を先に提示する。ここで出す real question も Phase 1 と同じく recommended answer (推奨案) と短い rationale を必ず付ける。推奨できない場合は、質問を狭めるか追加調査し、推奨案と rationale を付けられる形にしてから聞く。

### Step 8 — Definition of Done pipeline

Completion Criteria を以下の tagging で設計:

- `[file-state]`: Read / Grep / Glob で観測可能
- `[orchestrator-only]`: host access が必要なコマンド (`nix flake check`, `darwin-rebuild`, sudo 等)。main session が pre-run して evidence を埋める
- `[outcome]`: 循環的依存 (例: `$impl` 内蔵 Review が PASS)

`## Completion Criteria` は machine-consumed section なので、subsection 名を固定する:

```markdown
## Completion Criteria

### Autonomous Verification
- [file-state] ...
- [orchestrator-only] ...

### Requires User Confirmation
- None

### Baseline
- Each implementation task has raw verification evidence recorded in the sidecar JSON.
- The reserved `Final Audit + Review` task is completed only after `$impl` emits `AUDIT_VERDICT: PASS` and `REVIEW_VERDICT: PASS`.
```

`[outcome]` は `### Autonomous Verification` に書いてよいが、`$impl` Audit では循環 item として verdict から除外され、Review 後の最終状態で確認される。verdict format `^(AUDIT|SECTION|REVIEW)_VERDICT: (PASS|FAIL)(\s|$)` は `$impl` 内蔵 Audit + Review が消費する。

### Deepening Log artifact

`~/.codex/plans/<plan-basename>.log.md` に各 round の verbatim 出力を append する。secret / token / credential が含まれる場合は `[REDACTED]` に置換し、未編集の secret を log に保存しない:

```markdown
### Round 1

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
    { step: "Final Audit + Review", status: "pending" }   // 最後は固定: $impl 内蔵 Audit + Codex subagent review phase の入口
  ]
})
```

### サイドカー JSON 初期化

`~/.codex/plans/<plan-basename>.evidence.json` をタスクと同じ順序で初期化する。task id は helper が配列 index ベース (`task-1`, `task-2`, ...) で採番する。全呼び出しは execute bit に依存せず、以下の permissioned command shape を使う:

```bash
deno run --allow-env=HOME --allow-read --allow-write --allow-run=git --no-prompt ~/.codex/scripts/codex-plan-state.ts init /Users/$USER/.codex/plans/<basename>.evidence.json '<basename>.md' '["subject 1","subject 2","Final Audit + Review"]'
```

helper は `subjects-json` の末尾が `Final Audit + Review` でない場合に exit 1 で失敗する。サイドカー JSON の書き込みは helper 内で tmpfile + rename により atomic に行う。

末尾の `Final Audit + Review` エントリは $impl 内蔵 Audit + Codex subagent review phase が「ここまで来たら Audit と fresh reviewer subagent review を実行」と判断するためのマーカー。実装タスクではない。

### Decomposition Rules

Claude 版と同じ:
1. 1 task = 1 verifiable unit
2. Verification Commands は各 implementation task に内包 (verification-only task は "Final Audit + Review" のみ許される)
3. Separation of concerns
4. Three elements (target files / expected behavior / verification commands + EXPECTED output)
5. 末尾 "Final Audit + Review" は $impl skill が直接実行する内蔵 Audit + Codex subagent review phase であり、独立の skill 起動は不要 (Codex には skill-to-skill invocation API がないため)

### Acceptance criteria by change type

Claude 版 (`~/.claude/skills/plan/SKILL.md` / worktree: `home/programs/claude/skills/plan/SKILL.md`) の表をそのまま参照可能。

## Phase 6 ACTIVATE PENDING

`.pending-<cwd-hash>` のみ作成する (`.active-` には絶対しない)。`.active-` は次ターンでユーザーが `$impl` を打鍵したときに `codex-impl-approval-tracker.ts` UserPromptSubmit hook が promote する。

marker 操作は deterministic helper に委譲する。agent は cwd-hash や marker path を inline shell で組み立てない。

```bash
deno run --allow-env=HOME --allow-read="$HOME/.codex/plans,$PWD" --allow-write="$HOME/.codex/plans" --no-prompt ~/.codex/scripts/codex-plan-marker.ts activate-pending '<PLAN_FILE_PATH from Phase 3>' "$PWD"
```

`<PLAN_FILE_PATH from Phase 3>` は Phase 3 で決めた絶対パスを agent が template-substitute する (bash 変数展開ではなく文字列置換)。helper は `$PWD` を `codex-plan-gate.ts` と同じ canonical cwd-hash へ変換し、`~/.codex/plans` を作成し、re-plan 時の古い active marker を削除してから pending marker を atomic write する。

### Output to user

ユーザーが plan file を開かずに `$impl` 承認可否を判断できるよう、まず承認判断に足る summary を出し、その後に plan body と metadata block を出す。`## Approval Summary` は plan 本文の該当 section から抽出し、`Overview` / `Approach` / `Files to Change` を必ず先に示す。summary は plan body の再掲ではなく approval decision surface なので、各 subsection は compact に保つ:

````
## Plan

## Approval Summary

### Overview
<2-4 bullets or a short paragraph that states what Codex understood and what will change. Source: ## Overview. If ## Overview is absent for trivial plans, use the request and ## Context.>

### Approach
<3-5 bullets describing the intended implementation direction, key design choices, and notable non-goals/tradeoffs. Source: ## Approach. If ## Approach is absent, derive only from ## Task Outline and ## NOT Building.>

### Files to Change
<tree-style code block showing only affected paths, annotated with CREATE / UPDATE / DELETE and one-line impact. Source: ## Files to Change. Collapse by directory and point to the plan file when the tree would exceed ~20 lines.>

```text
path/
└── to/
    └── file.ext  UPDATE: one-line impact
```

### Execution
- Task outline: <implementation task subjects, excluding Final Audit + Review; max 5 tasks, one line each> (source: ## Task Outline)
- Verification: <commands and expected outcomes; max 3 commands, summarize if more> (source: ## Verification Commands)
- Risks / open questions: <top 1-3 items, or `None` when the section is absent> (source: ## Risks + Open Questions)

## Plan body
<full plan body, verbatim unless xl fallback applies>

---

## Plan ready
- File: <plan path>
- Complexity: <trivial/small/medium/large/xl>
- Tasks: <count> (+ Final Audit + Review)
- Status: PENDING APPROVAL — type `$impl` to approve and execute

⚠️ AI が自己 chain で `$impl` を打っても UserPromptSubmit hook は発火しないため、`.pending-` → `.active-` の promote は起こらない。承認はユーザーの明示打鍵でのみ成立する。
````

`xl` で plan body が ~600 行を超える場合は `## Plan body` を section heading の TOC + plan path に置き換え、metadata block は同じ。Approval Summary は省略不可。

## Integration with existing tooling

- `home/programs/agents/shared/plan/references/requirement-checklist.md` (Codex 公開 path: `~/.agents/skills/plan/references/requirement-checklist.md`、Claude 公開 path: `~/.claude/skills/plan/references/requirement-checklist.md`): Claude 版と共有 (linkHere whole-dir 経由で物理的に同一ファイル)。Phase 1 の判断基準。
- `home/programs/agents/shared/plan/references/critic-prompt.md` / `adversarial-prompt.md` (Codex 公開 path: `~/.agents/skills/plan/references/`、Claude 公開 path: `~/.claude/skills/plan/references/`): Phase 4 の subagent prompt 本体。`~/.codex/agents/{plan-critic,plan-adversarial}.toml` の `developer_instructions` から pointer 参照される (workspace 共有経路)。
- `~/.codex/agents/{plan-critic,plan-adversarial,plan-simplifier}.toml`: Phase 4 が依存する custom agent 定義。dotfiles 実体は `home/programs/codex/agents/`。
- `$impl` skill: Phase 5 で登録した `update_plan` のタスク列を順次実行し、最後に内蔵 Audit + Codex subagent review phase で `^(AUDIT|SECTION|REVIEW)_VERDICT: (PASS|FAIL)(\s|$)` を出力する。
- PreToolUse hook (`codex-plan-gate.ts`): cwd 配下の apply_patch を `.active-<hash>` 不在/期限切れ時に block する。Phase 6 で `.pending-` のみを書く理由はこのゲートと連動するため。
- Marker helper (`codex-plan-marker.ts`): Phase 6 の pending activation、`$impl` 起動時の active requirement、final PASS 後の active cleanup、UserPromptSubmit hook の promote 処理を担う deterministic helper。

## Design notes

- **subagent dispatch を活用**: Phase 2 EXPLORE は内蔵 `explorer` agent で 3 並列、Phase 4 DEEPEN は custom TOML agents (plan-critic / plan-adversarial / plan-simplifier) で Critic + Adversarial + Simplifier。`[agents]` config defaults (max_threads=6 / max_depth=1) で動作、MCP は optional。Codex 0.128.0 で empirical 検証済 (Phase 0 probe)。ただし skill 側では Subagent Lifecycle Budget により result-integrated agents を `close_agent` で閉じ、通常時の live subagents を bounded に保つ。
- **`developer_instructions` は pointer 方式**: 各 TOML は prompt 本体を転記せず、`references/*.md` の絶対 path + placeholder 命名 + verdict format 契約のみを持つ。subagent は workspace 共有経路で参照ファイルを Read する。SSOT を `references/*.md` に維持し dual-source-of-truth 同期コストを回避。
- **Verdict format 契約**: `plan-critic` は `^### Verdict$\n(CONVERGED|ITERATE)$`、`plan-adversarial` は finding tag `(FALSIFIED|UNVERIFIED|VERIFIED|DESIGN_QUESTION)`、`plan-simplifier` は confidence tag `(HIGH|MEDIUM|LOW)`。main session が rg で抽出する。
- **`update_plan` の薄さをサイドカー JSON で補う**: ステータス + 短文しか持てないため、`baseline_sha` / `evidence` は `<basename>.evidence.json` に永続化する。
- **承認ゲート二重化**: `codex-plan-gate.ts` (PreToolUse) が apply_patch を機械的に止め、本 skill の `codex-plan-marker.ts activate-pending` + UserPromptSubmit hook が承認の唯一のルートを担保する。AI 自己 chain (`$plan` → 同一ターンで `$impl` を model 自身が打つ) では UserPromptSubmit hook が発火しないため、promote は起こらない。
- **skill-to-skill invocation API がない**: Codex 公式 docs に明文化された skill→skill の起動 API はなく、`$xxx` 言及からの auto-load は prompt-injection 経路に依存する非公式挙動。final gate を独立 skill に分けず `$impl` 内蔵 Audit + Review phase に閉じる根拠。
