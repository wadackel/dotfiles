# Requirement Clarification Checklist

Phase 1 PARSE の **Requirement Clarification** 小節で参照される仕様。non-trivial 要求 (small 以上) に対して、Phase 2 以降へ進む前に曖昧性を体系的に検出するための 8 観点 walk を定義する。

## 位置付け

- 対象: `/plan` Phase 1 PARSE (main agent が直接 walk を実行)
- 発動条件: complexity が `small` / `medium` / `large` のいずれか (trivial と xl は対象外)
- ラウンド: **Round 1 のみ** (single-pass walk、再走はしない)
- 既存 "Question triage" (CLAUDE.md `/plan Workflow` 節) の 3-category を Step 2 で再利用する

## 2 段階 Walk 手順

### Step 1 — Gate (Clear vs NotClear)

各観点に対し下記 **Clear signals** をチェックする。どれか 1 つでも match すれば `Clear` とし、Step 2 対象から外す。match なしは `NotClear` として Step 2 に進む。

signal 判定は要求文 (restate 済みの原文) と、必要に応じて軽量 Grep/Read の併用で行う。subjective な判断語 ("強い" "自明" "普通") の使用は禁止。

### Step 2 — Triage (NotClear のみ)

NotClear 項目に対し、CLAUDE.md `/plan Workflow` "Question triage before AskUserQuestion" 節の 3-category を適用:

- **Ask**: user-only knowledge が必要 → Round 1 AskUserQuestion の候補
- **Assume**: codebase default / 慣習から合理的推定可 → plan 本文に `Assumption: <observation>: <value> because <signal source>` を必ず記録
- **Self-resolve**: Grep/Read/Explore で解決可能 → Phase 2 EXPLORE で自力解決

各観点の default triage は下表の "Default triage (NotClear)" 列を参照。

## 8 観点表

### 1. Why (motivation)

- **Clear signals** (要求文中のいずれかに match):
  - 意図動詞 + 目的語: `〜したい`, `〜したくて`
  - 理由マーカー: `ので`, `〜ため`, `理由は`
  - 課題表明: `困って`, `問題`, `不便`, `辛い`
  - 外部参照: `Issue #\d+`, `バグ`, `report`, `ticket`
  - 因果接続詞を含む完結した reason clause
- **Default triage (NotClear)**: **Ask** (user-only)
- **Probe template**: 「この変更で何を解消したい？根本的な課題は？」

### 2. What (deliverable)

- **Clear signals**:
  - 成果物 noun 明示: `新 command`, `function`, `config`, `UI`, `file`, `skill`, `agent`, `hook`, `script`, `option`
  - 具体的 file/path 名 / symbol 名の直接参照
- **Default triage (NotClear)**: **Self-resolve** (codebase 探索で推測可能 → Phase 2 EXPLORE)。探索で決まらなければ **Assume**
- **Probe template**: 「具体的に何が作られる？ (command / function / config / UI 等)」

### 3. Who (actor)

- **Clear signals**:
  - 主体明示: `自分`, `自分用`, `チーム`, `ユーザー`, `他人`, `自分以外`
  - Role 名詞: `reviewer`, `contributor`, `operator`, `maintainer`
- **Default triage (NotClear)**: **Assume** (dotfiles 文脈では単一 user を default とする)
- **Probe template**: 「誰がこれを使う？一人？チーム？自分以外の想定は？」

### 4. When (trigger/context)

- **Clear signals**:
  - Trigger 語: `手動`, `自動`, `hook`, `CI`, `起動時`, `コマンド実行時`, `session 中`, `startup`, `shutdown`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `on-<event>` 形式の event 名 (例: `on-save`, `on-change`)
- **Default triage (NotClear)**: **Self-resolve** (既存 code の呼び出し pattern から推測可能ならそれ → Phase 2)。不能なら **Assume**
- **Probe template**: 「いつ / どの文脈で起動する？手動？自動？ trigger は？」

### 5. Where (scope boundary)

- **Clear signals**:
  - Scope 指定: 具体的 file path, skill/agent 名, repo 全体, external service, プロセス境界
  - 範囲修飾語: `特定の〜だけ`, `〜全体`, `以外の〜は除く`
- **Default triage (NotClear)**: **Ask** (scope は user 判断が必要、silent assumption 危険)
- **Probe template**: 「どこまで含める？逆に含めないものは？」

### 6. How (approach preference)

- **Clear signals** (明示的指定時のみ Clear):
  - 具体的 library / framework / pattern 名
  - 「既存の X を踏襲」「Y と同じ方式」といった明示的参照
- **Default triage (NotClear)**: **Always Assume** — user preference は尊重だが codebase signal を参考に合理的 default を採用。採用時は plan 本文に `Assumption: How as <approach> because <signal source>` を**必ず**記録。質問することは稀 (Ask ≥ 5 時の優先度最下位)
- **Probe template** (rarely asked): 「実装方針の好みは？既存 pattern 踏襲？新規設計？」

### 7. Success (observable)

- **Clear signals**:
  - Acceptance 語: `〜できたら OK`, `〜すれば成功`, `〜が確認できれば完了`
  - 測定語: `時間`, `回数`, `率`, `数`, `size`, `latency`
  - Test 語: `テスト`, `test`, `check`, `assert`, `verify`
- **Default triage (NotClear)**: **Ask** (user-only, 「動けば OK」は Clear 扱いしない)
- **Probe template**: 「何をもって成功？観測可能な条件は？」

### 8. Failure (anti-req)

- **Clear signals**:
  - Anti-req 語: `〜はダメ`, `避けたい`, `〜してはいけない`, `〜しない`, `must not`, `禁止`
  - Safety/Regression 語: `safety`, `regression`, `副作用`, `壊れない`
- **Default triage (NotClear)**: **Ask** (user-only。silent assumption で user の design constraint を見逃す危険が高い)
- **Probe template**: 「絶対してはいけないこと / 避けたい副作用は？」

## Ask 項目の batch 規則

walk 終了後、Step 2 で `Ask` に分類された項目に対して以下を適用:

| Ask 件数 | 挙動 |
|---|---|
| **0** | AskUserQuestion は **skip**。plan 本文の `## Overview` 直前に `Requirement Clarification: all 8 observations auto-resolved (Clear/Assume/Self-resolve breakdown: ...)` を一行記載 |
| **1 - 4** | 全件を 1 回の AskUserQuestion に batch。冒頭に "以下を自己解決しました:" block (Clear/Assume/Self-resolve 項目の一覧) を併記 |
| **5 以上** | Impact priority 順で上位 4 件を AskUserQuestion に batch、残り (切り捨て分) は plan 本文に `Assumption (deferred from Phase 1 Ask truncation): <observation>: unresolved — requires user confirmation in Phase 4 Critic` として記録 (codebase signal が無い Ask 項目は tentative default を作らず `unresolved` のまま Phase 4 に送る)。Phase 4 Critic / Adversarial Falsification での再検出を必須化 |

## Impact priority (cost-if-wrong order)

Ask ≥ 5 件時の上位 4 選定、および batch 内での質問順決定に使用。「誤ったときの plan 全体への波及コストが大きい順」で並べる:

1. **Outcome 層** — Why / Success — 誤ると plan 全体が無価値化
2. **Boundary 層** — Where / Failure — 誤ると余計な実装 or 不足、user design constraint violation
3. **Context 層** — Who / When — 誤ると UX 齟齬 / 起動設計ミス
4. **Definition 層** — What / How — Phase 2 EXPLORE / Phase 4 Critic で比較的拾いやすい

**Tiebreaker**: 同 tier 内で複数 Ask が残った場合は **observation # 昇順** (Why < What < Who < When < Where < How < Success < Failure) で決定論的に並べる。

## Self-resolved block 規約

Round 1 AskUserQuestion を発行する際、冒頭に以下形式の block を併記する:

```
以下を自己解決しました:
- Clear: [観点名列挙] — 要求文中の signal により確定
- Assume: [観点名 — <tentative value> because <signal source>] 列挙
- Self-resolve: [観点名 — Phase 2 EXPLORE で確定予定] 列挙
```

これにより user は即座に誤判定 (例: "いや What は全体じゃなくて個別 skill 限定") を flag できる。

## Walk 後の plan 本文への記録

- **Assume 項目** (How を含む): `## Approach` または該当 section に `Assumption: <observation>: <value> because <signal source>` として必ず記録
- **Self-resolve 項目**: Phase 2 EXPLORE 終了時点で決定した値を、該当 section に記述
- **Clear 項目**: 明示記録は不要 (要求文に存在するため)

## 既存 Ambiguity Gate との責任分界

本 checklist は **positive walk** (8 観点の逐次確認) を担当する。SKILL.md の既存 "Ambiguity Gate" は、本 checklist で拾えない exception ケース専用:

- 要求文の **restate 自体が失敗** するケース (意味解釈不能 / 矛盾 / 情報量不足で 1 文にまとめられない)
- 要求文が 1 語 / 2 語のみで 8 観点のいずれの signal も得られないケース

Gate 発動時は checklist walk は実行せず、再質問で要求文を取得し直してから walk を開始する。
