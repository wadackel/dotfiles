# Requirement Clarification Checklist

Phase 1 PARSE の **Requirement Clarification** 小節で参照される仕様。non-trivial 要求 (small 以上) に対して、Phase 2 以降へ進む前に曖昧性を体系的に検出するための 8 観点 walk を定義する。

## 位置付け

- 対象: `/plan` Phase 1 PARSE (main agent が直接 walk を実行)
- 発動条件: complexity が `small` / `medium` / `large` のいずれか (trivial と xl は対象外)
- ラウンド: **Multi-round loop (全 non-trivial で最大 3 round 固定)** — 各 round で walk → triage → Self-resolve probe → Ask (override 選択肢を含む) を実施。User override、再 Ask trigger 0 件、same-trigger repeats escalate、または max rounds (3) reached で収束。詳細は SKILL.md Phase 1 の Step A–F 仕様を参照。
- 既存 "Question triage" (CLAUDE.md `/plan Workflow` 節) の 3-category を Step 2 で再利用する

## Round 内 3 段階 Walk 手順

各 Round (1..3) は以下の Step を順に実行する。詳細な Round loop 構造 (Step A–F、Escalate 条件、収束判定) は SKILL.md Phase 1 側で定義。本 checklist は Step B Triage / Step C Self-resolve probe / Step D 再 Ask trigger のうち、8 観察 walk に属する仕様を担当する。

### Step 1 — Gate (Clear vs NotClear)

各観点に対し下記 **Clear signals** をチェックする。どれか 1 つでも match すれば `Clear` とし、Step 2 対象から外す。match なしは `NotClear` として Step 2 に進む。

**証拠レベル要件**: Clear 判定時は Clear signals リスト中の **exact token を要求文から引用して Round 収束記録に残す必須** (例: `Why: Clear (要求文の 'ズレた' が課題表明 signal に match)`)。類推や推測ベースでの Clear 判定は禁止 — 「文脈から分かる」等の根拠は NotClear として Step 2 Triage 対象に入れる。

signal 判定は要求文 (restate 済みの原文) と、必要に応じて軽量 Grep/Read の併用で行う。subjective な判断語 ("強い" "自明" "普通") の使用は禁止。

**ambiguous qualifier override**: 要求文中に主観形容詞 / 程度副詞 / 曖昧技術語 (例: 野暮ったい、わかりづらい、見づらい、モダンじゃない、大幅に、そこそこ、しっかり、リアルタイム、なめらか、軽量 — 類似語は Claude semantic 判断で拡張可) が含まれる場合、他の Clear signal と併存しても該当観察 (主に What / Success) を NotClear に強制降格する。list は anchor、semantic 判断が first-class。降格された項目は Step 2 Triage の Calibration Probe subtype (下記) で扱う。

### Step 2 — Triage (NotClear のみ)

NotClear 項目に対し、CLAUDE.md `/plan Workflow` "Question triage before AskUserQuestion" 節の 3-category を適用:

- **Ask**: user-only knowledge が必要 → 当該 Round の AskUserQuestion 候補
- **Assume**: codebase default / 慣習から合理的推定可 → plan 本文に `Assumption: <observation>: <value> because <signal source>` を必ず記録。signal が弱い場合は **tentative Assumption** とし次 round で再評価
- **Self-resolve**: Grep/Read で解決可能 → **Round 内の Step C Self-resolve probe で解決試行** (Phase 1 では Explore subagent 未使用、軽量 Grep/Read のみ)。probe 不能時の fallback は observation 依存 (各観点の "Default triage" に従う): Self-resolve default 観点 (What / When) は Phase 2 EXPLORE に委譲、Ask default 観点 (Why / Where / Success / Failure) は Ask に昇格して次 round Ask 候補に加える

**Calibration Probe subtype** (Step 1 ambiguous qualifier override 経由で NotClear 降格した項目専用): Ask 項目の subtype として生成する — **通常 Ask と同じく Step E batch rule の per-round real-question slot を 1 slot 消費**し、Impact priority (Outcome > Boundary > Context > Definition) で通常 Ask 項目と並び替え対象となる。observation が What/Success (主な Calibration 対象) の場合は Outcome/Boundary tier として上位に来る。slot 超過時は通常 Ask と同じく trigger iv で次 round 繰り越し。

Preview 生成: Claude が 3 個の concrete candidate を研究/推測し、AskUserQuestion `options` に提示する。候補は observable condition (例: 「野暮ったい」pointer → pointer 文字を別 Unicode に変更 / 色で強調 / pointer 削除 + 行背景反転) または threshold value (例: 「リアルタイム」表示 → event-driven / 1s polling / 5s polling / snapshot-only) のどちらを用いるかを Claude が状況判断する。1 つに (Recommended) tag を付けて top に置き、末尾に Other を含めることで user override を許容する (requirements-interview Phase 3 の recommended-option pattern)。options 配列は 3 candidates + Other = 4 options 固定 (CLAUDE.md の "AskUserQuestion options limited to 4" 上限)。**候補生成不能時 fallback**: 3 個以上の defensible な concrete candidate を研究不能な場合は Calibration Probe 化を諦め、通常 Ask として "この `<曖昧語>` の具体像は？" を自由記述で問う (Step 2 Ask default に降格)。

各観点の default triage は下表の "Default triage (NotClear)" 列を参照。

### Step 3 — Self-resolve probe (Round 内実施)

Step 2 で `Self-resolve` 分類された項目を Round 内で実際に解決試行する。SKILL.md Phase 1 Step C の仕様に従い、Explore subagent は起動せず軽量 `rg` / `fd` / `Read` のみで解決する (Phase 2 EXPLORE との責務重複回避)。解決できた項目は Assume と同じく plan 本文の `## Approach` または該当 section に記録。probe 不能時の fallback は observation 依存 (Step 2 記述と同じ): Self-resolve default 観点 (What / When) は **Phase 2 EXPLORE に委譲**、Ask default 観点 (Why / Where / Success / Failure) は **Ask に昇格**。

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
- **Default triage (NotClear)**: **Self-resolve** (codebase 探索で推測可能 → Round 内 Step C probe で試行、probe 不能なら Phase 2 EXPLORE へ委譲)。探索で決まらなければ **Assume**
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
- **Default triage (NotClear)**: **Self-resolve** (既存 code の呼び出し pattern から推測可能ならそれ → Round 内 Step C probe、probe 不能なら Phase 2 EXPLORE)。不能なら **Assume**
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

各 Round 内で、Step 2 で `Ask` に分類された項目に対して以下を適用 (override 質問が AskUserQuestion の 4 slot 中 1 を消費するため real 質問上限は 3)。詳細は SKILL.md Phase 1 Step E を参照:

| Round 内 Ask 件数 | 挙動 |
|---|---|
| **0** | Round 1: override 質問のみ発行 (User 脱出口を必ず残す)。Round 2+ でかつ再 Ask trigger も 0 件: AskUserQuestion 自体 skip して収束、plan 本文の `## Overview` 直前に `Requirement Clarification: Round N で収束 (reason: trigger 0)` を記載 |
| **1 - 3** | 全件 + override で 1 回の AskUserQuestion に batch (合計 max 4 questions)。冒頭に "以下を自己解決しました:" block (Clear/Assume/Self-resolve 項目の一覧) を併記 |
| **4 以上** | Impact priority 順で上位 3 件 + override で batch、残りは次 round Ask 候補先頭に繰り越し (impact priority 通り)。3 round 使い切っても残った項目は `Assumption (unresolved after 3 rounds): <observation>: unresolved — requires user confirmation in Phase 4 Step 7 Consolidated Interview` として記録 |

## Divergence Probing

Round 1 のみ実施する未言及派生機能の能動提案。Step C Self-resolve probe 完了後、Step E 通常 Ask 発行 **とは別の AskUserQuestion call** として発行する (SKILL.md Phase 1 Step E 参照)。

**抽出 source**:
- 要求文中の keyword (技術用語 / UI 語彙 / モード名 等)
- 参考実装 URL (given 時) の機能群
- user の request context 全体

**候補生成**:
- 「user が明示していないが要求の自然な延長として考え得る機能」を 0-4 個抽出 (0 件時は skip)
- **発行形式** (case-split、抽出 candidate 数で決定):
  - **0 candidates**: Divergence Probing skip (AskUserQuestion 発行なし)
  - **1 candidate (exactly)**: disposition single-select で 1 question、options = [「今回 scope に含める」「別 plan で追跡」「対象外」「Other」]
  - **2-4 candidates**: multiSelect で 1 question:
    - **2-3 candidates**: options = 各 candidate + 「Other」 (2-4 options 合計、CLAUDE.md 4-option cap 厳守)
    - **4 candidates**: options = 各 candidate のみで Other 省略 (4 options 合計、cap 厳守のため)
    - **Step F 正規化**: 選択された candidate は「今回 scope に含める」、非選択 candidate は **暗黙的に「対象外」** として plan 本文に記録 (各 candidate × disposition の per-candidate decision へ分解)。「Other」選択は free-text で別 plan / 追加検討の意思表明として記録
- 参考実装 URL given 時は **delta 分析 mandate**: 参考実装の機能のうち user 要求に明示されていないものを 2-4 個列挙し上記 2-4 candidates 形式 (multiSelect) で問う質問を必ず含める (0 or 1 candidate しか抽出できない場合も最低 2 個を研究して多様化する努力義務あり)

**Round 制限**:
- Round 1 のみ発動。Round 2+ は user 回答反映 round であり、延長提案は Phase 4 Critic の Scope Appropriateness 軸に委譲 (重複担保)
- Round 1 で AskUserQuestion が 2 call (通常 Ask batch + Divergence) 発生することを許容

**Divergence 回答の Round 2+ handling**:
- Divergence Probing の回答は通常 Ask 回答と同じく Step F で処理される
- Divergence 回答中に曖昧語 / 逆質問 / 空文字が含まれる場合は、Round 2+ の Step D 再 Ask trigger (i)(ii) と同じ扱い (同 trigger 適用) で Round 2 Ask 候補に加える
- 「scope に含める / 別 plan / 対象外」の明示選択は通常の決定として plan 本文に記録、曖昧/未回答時は trigger 化

**Phase 1 cycle call 上限との関係**:
- CLAUDE.md global の `Phase 1 cycle up to 3 AskUserQuestion calls per cycle` 制約下で、Round 2/3 と合わせて消費。典型的には Round 1 の Divergence 発火で Round 2 は trigger 0 収束、Round 3 未発火となる
- Round 2 以降も Ask 必要で 3 call 上限に達し新規 Ask 発行不能となった場合は、**本ファイル `## Ask 項目の batch 規則` の「4 以上」行と同じ長形式 escalate record** (`Assumption (unresolved after N rounds): <observation>: unresolved — requires user confirmation in Phase 4 Step 7 Consolidated Interview`) で残余項目を plan 本文記録し Phase 4 Critic / Step 7 Consolidated Interview に委任する (SKILL.md Step D の同-trigger-repeat 短形式 escalate とは trigger 条件も記録形式も異なる — Ask overflow / budget overflow は長形式で Phase 4 委任、Step D 同-trigger-repeat は短形式で Phase 2 遷移)

## Round 間の引き継ぎ規則

Multi-round loop における Round N → Round N+1 の情報引き継ぎは以下の通り:

- Round N の Self-resolve 項目は Step C (Self-resolve probe) で解決試行。解決不能時は observation 依存 fallback (Step 2/3 記述参照): Self-resolve default 観点 (What / When) は Phase 2 EXPLORE に委譲、Ask default 観点 (Why / Where / Success / Failure) は Ask に昇格して Round N+1 Ask 候補に加える
- Round N の tentative Assumption (Clear signal 弱) は Round N+1 で再評価、still NotClear なら Ask に昇格 (trigger iii)
- Round N Ask 回答内の曖昧語 / 逆質問は Round N+1 で再 Ask trigger (i)(ii)。Ask 回答空文字 / 空白のみも trigger (ii)
- Round N の Ask 候補で slot 不足により繰り越された項目は Round N+1 Ask 候補先頭 (trigger iv)。impact priority で並べ替え
- **Escalate 条件**: 同じ trigger 項目が Round N と Round N-1 で連続検出された場合、Ask 発行せず `unresolved after N rounds: <item>` を plan 本文に記録して Phase 2 へ進む (SKILL.md Phase 1 Step D 参照)

## Impact priority (cost-if-wrong order)

Round 内 Ask 件数が 4 以上のときの上位 3 選定 (override が slot 1 を消費するため real 質問は max 3)、および batch 内での質問順決定に使用。「誤ったときの plan 全体への波及コストが大きい順」で並べる:

1. **Outcome 層** — Why / Success — 誤ると plan 全体が無価値化
2. **Boundary 層** — Where / Failure — 誤ると余計な実装 or 不足、user design constraint violation
3. **Context 層** — Who / When — 誤ると UX 齟齬 / 起動設計ミス
4. **Definition 層** — What / How — Phase 2 EXPLORE / Phase 4 Critic で比較的拾いやすい

**Tiebreaker**: 同 tier 内で複数 Ask が残った場合は **observation # 昇順** (Why < What < Who < When < Where < How < Success < Failure) で決定論的に並べる。

## Self-resolved block 規約

各 Round の AskUserQuestion を発行する際、冒頭に以下形式の block を併記する:

```
以下を自己解決しました:
- Clear: [観点名列挙] — 要求文中の signal により確定 (exact token 引用例: Why 'ズレた' が課題表明 signal に match)
- Assume: [観点名 — <tentative value> because <signal source>] 列挙
- Self-resolve: [観点名 — Step C probe で <value> に確定] or [観点名 — Phase 2 EXPLORE で確定予定] 列挙
```

これにより user は即座に誤判定 (例: "いや What は全体じゃなくて個別 skill 限定") を flag できる。

## Walk 後の plan 本文への記録

**Round 収束時に `## Overview` 直前に以下形式のブロックを記録 (必須)**:

```
Requirement Clarification: Round N で収束 (reason: <trigger 0 / user override / same-trigger escalate / max rounds reached>)
- Round 1: Ask <件数> (確定: <主な決定>)
- Round 2: Ask <件数> (確定: <主な決定>)
- ...
- Clear 項目 exact token 引用: [Why: '...', Where: '...', ...]
```

- **Assume 項目** (How を含む): `## Approach` または該当 section に `Assumption: <observation>: <value> because <signal source>` として必ず記録
- **User override 項目**: `Assumption: <observation>: <value> (user-overridden, flagged for Phase 4 Critic re-validation)` 形式で記録 (Phase 4 Critic が検証する signal)
- **Escalate / max-rounds 未解消項目**: `Assumption (unresolved after N rounds): <observation>: unresolved — requires user confirmation in Phase 4 Step 7 Consolidated Interview` として記録 (Phase 4 Critic が Critical Issue [USER] として surface)
- **Self-resolve 項目**: Round 内 Step C probe で確定した値は該当 section に直接記述。probe 未確定で Phase 2 EXPLORE 委譲した項目は EXPLORE 終了時点で記述
- **Clear 項目**: Round 収束ブロックで exact token を引用する (類推禁止ルールの証跡)

## 既存 Ambiguity Gate との責任分界

本 checklist は **positive walk** (8 観点の逐次確認) を担当する。SKILL.md の既存 "Ambiguity Gate" は、本 checklist で拾えない exception ケース専用:

- 要求文の **restate 自体が失敗** するケース (意味解釈不能 / 矛盾 / 情報量不足で 1 文にまとめられない)
- 要求文が 1 語 / 2 語のみで 8 観点のいずれの signal も得られないケース

Gate 発動時は checklist walk は実行せず、再質問で要求文を取得し直してから **Round 1 walk を開始** (以降は通常の multi-round loop に合流)。
