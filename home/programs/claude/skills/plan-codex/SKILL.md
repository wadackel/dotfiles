---
name: plan-codex
description: Codex 版の design-first 計画作成 skill。Claude Code の /plan を Codex CLI 用に移植したもの。明示的な `$plan-codex <request>` 起動でのみ動き、auto-load は agents/openai.yaml で抑制してある。implicit invocation を期待する利用 (キーワードからの自動連想) は対象外。
---

# $plan-codex

Codex CLI 上で feature plan を作成する skill。Claude Code の `/plan` (`~/.agents/skills/plan/SKILL.md`) を Codex 用に再構成した MVP。`$plan-codex <request>` で明示的に起動する。終了時に `~/.codex/plans/.pending-<cwd-hash>` を作成し、ユーザーが次ターンで `$impl-codex` を打つと UserPromptSubmit hook (`codex-impl-approval-tracker.ts`) が `.pending-` を `.active-` に promote する。

## Argument extraction (Codex 固有)

Codex skill には Claude の `$ARGUMENTS` 展開がない。`$plan-codex README に追記` のように起動した場合、verbatim user message `$plan-codex README に追記` がそのまま skill body に渡る。

**最初の行動**: 自分が受け取った user prompt を読み、`$plan-codex` 以降の文字列を **request** として抽出する。空 (引数なし) の場合は「実装したい内容を教えてください」と尋ねて end turn し、次ターンの返答を request として扱う。

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

判断基準は `~/.agents/skills/plan/references/requirement-checklist.md` を参照 (Claude 版と同一: 8 観察軸、cost-based triage、ambiguous qualifier 校正シグナル)。**ただし Codex には Claude の AskUserQuestion がないため、対話モデルは "1 turn = 1 round"** に簡略化する:

1. Step A Walk: 8 観察 (Why / What / Who / When / Where / How / Success / Failure) を歩き、NotClear 項目を洗い出す。
2. Step B Triage: cost-if-wrong × downstream recoverability で Ask / Assume / Self-resolve を選ぶ。
3. Step C Self-resolve probe: 軽量な grep/read で答えられるものは自分で解決。
4. Step E Ask: 残った real question を **最大 3 件** (各々に AI 自身の推奨案を必ず明示)、テキストで列挙して **end turn**。次ターンのユーザー回答で round 終了。
5. Step F: 回答を踏まえ、Assumptions / Unresolved Items に振り分けて Phase 2 へ進む。

MVP では原則 1 round で収束させる (Phase 2 EXPLORE で codebase-recoverable な疑問は自己解決)。

### Phase 1 出力

`### Requirement Clarification` / `### Assumptions` / `### Self-resolved` / `### Unresolved Items` の 4 サブセクションを `## Overview` の直前に書く。subsection 名は英語固定 (downstream parsing のため)。

## Phase 2 EXPLORE (non-trivial only)

main session が逐次 grep/read で 3 つの discovery outcome を埋める (Codex には Explore subagent 並列起動の MCP API がないため main 単独実行):

1. **Existing patterns**: 既存の規約 (命名 / error handling / config / test layout / dependency style)。`file:lines` + snippet を記録。
2. **Execution paths and boundaries**: entry points / data flow / state transitions / API contracts / architectural seams。
3. **Existing behavior, constraints, and verification conditions**: 現状挙動、不変条件、関連既存テスト (`file:lines`) と検証手段。

結果は **Unified Discovery Table** (`Category | File:Lines | Pattern | Key Snippet`) に集約。

### Empirical analysis (existing-behavior 改修時)

`## Files to Change` に UPDATE があり振る舞いを変える場合、または bug-fix / refactor / 仕様変更 / perf / CLI 出力 / semantics change の場合、historical signals (`~/.codex/plans/*.md`、`~/.codex/sessions/**/*.jsonl`、`git log -p`) と直接観察 (CLI 実行、hook 発火、effective config 読み) を行い、「spec が言うこと」vs「実際に起きること」を Tier 1/2 で記録。Empirical Behavior 行として Discovery Table に追加。

## Phase 3 DRAFT (non-trivial only)

`~/.codex/plans/YYYYMMDDTHHmm-<slug>.md` にプラン本体を書く (slug は request から、max 40 chars、lowercase kebab)。

### Language policy

- 本文 prose: ユーザーの設定言語 (Claude/Codex とも `~/.claude/CLAUDE.md` 等の設定に従う、本リポジトリでは日本語)
- Section headers (`## Context` / `## Overview` / `## Approach` / `## NOT Building` / `## Mandatory Reading` / `## Patterns to Mirror` / `## Intentional Conventions` / `## Files to Change` / `## Task Outline` / `## Test Strategy` / `## Verification Commands` / `## Definition of Done` / `## Risks + Open Questions` / `## Completion Criteria`): **英語固定** (Phase 5 と $impl-codex Audit/Review が literal string で locate するため)
- Machine-consumed contents (`## Completion Criteria` 各サブセクション、Acceptance Criteria 行): 英語
- Phase 1 subsections の見出し: 英語固定 (`### Requirement Clarification` 等)
- File paths / commands / `EXPECT:` 値: as-is

### Required sections (complexity-gated)

Claude 版と同じ表に従う (trivial=Context+Files to Change+Verification+Task Outline+Definition of Done のみ、small=+Overview+Approach+NOT Building+Test Strategy+Risks、medium+=+Mandatory Reading+Patterns to Mirror+Intentional Conventions(applicable))。

各セクションの中身ガイドラインは Claude 版 SKILL.md と同じ — ただし Codex 文脈で skill 起動構文 / hook 名 / ツール名は Codex 仕様に置き換える。

## Phase 4 SELF-REVIEW (簡素化版)

MVP では Critic / Adversarial / Simplify を独立 subagent としては回さず、main session が自己レビューする:

1. **No Prior Knowledge Test**: このプランだけ読んで実装可能か (= references/snippets が十分か) を自問。不足があれば Patterns to Mirror に追加。
2. **Completion Criteria 妥当性**: 各 [file-state] / [orchestrator-only] / [outcome] が実際に観察可能か。verdict format `^(AUDIT|SECTION|REVIEW)_VERDICT: (PASS|FAIL)$` を $impl-codex skill が消費することを意識する。

(Codex `[agents]` で subagent を事前宣言 + MCP 並列起動が後日整備されたら、この Phase を Claude 同等の Critic/Adversarial/Simplify に格上げ可能。)

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
deno eval --allow-read --allow-write '
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
- $impl-codex skill: Phase 5 で登録した `update_plan` のタスク列を順次実行し、最後に内蔵 Audit + Review phase で `^(AUDIT|SECTION|REVIEW)_VERDICT: (PASS|FAIL)$` を出力する。
- PreToolUse hook (`codex-plan-gate.ts`): cwd 配下の apply_patch を `.active-<hash>` 不在/期限切れ時に block する。Phase 6 で `.pending-` のみを書く理由はこのゲートと連動するため。

## Design notes

- **subagent 並列を MVP で使わない**: Codex の subagent は `[agents]` 事前宣言 + MCP 必須でセットアップが重い。Phase 2 EXPLORE / Phase 4 SELF-REVIEW は main session 単独で代替する。
- **`update_plan` の薄さをサイドカー JSON で補う**: ステータス + 短文しか持てないため、`baseline_sha` / `evidence` は `<basename>.evidence.json` に永続化する。
- **承認ゲート二重化**: `codex-plan-gate.ts` (PreToolUse) が apply_patch を機械的に止め、本 skill の `.pending-` 出力 + UserPromptSubmit hook が承認の唯一のルートを担保する。AI 自己 chain (`$plan-codex` → 同一ターンで `$impl-codex` を model 自身が打つ) では UserPromptSubmit hook が発火しないため、promote は起こらない。
