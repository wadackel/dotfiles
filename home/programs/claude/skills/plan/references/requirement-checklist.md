# Requirement Clarification Lens

`/plan` Phase 1 PARSE の Requirement Clarification で参照する判断補助。**分類テーブルではなく、見落とし防止の lens として使う**。8 観点は「network of questions」であって、各観点に対して fixed default triage を機械的に当てはめる位置付けではない。

## 位置付けと目的

- 対象: `/plan` Phase 1 PARSE（main agent が直接 walk を実行）
- 発動条件: complexity が `small` / `medium` / `large` のいずれか（trivial と xl は対象外）
- 目的: 実装を誤らないレベルまで user intent を固めること。protocol 消化ではない
- 進行管理（Round loop の Step A–F、収束判定、AskUserQuestion 発行ルール）は SKILL.md Phase 1 が source of truth。本 lens は **判断補助（observation の見落とし防止と triage の判断軸）** を owns する

## Round budget: default operating limit

`small` / `medium` / `large` の default 上限は 3 round。これは **protocol ではなく operating limit** であって、次の場合は例外扱いが許される:

- **追加確認を許容する**: Scope / Success のような「そのまま進むと plan 全体が無価値化する」高コスト不確定が残っている場合、3 round 超の追加確認を許容する（例: 4 round 目で Scope を確定させてから Phase 2 へ）
- **早期前進を許容する**: 残っているのが低コストな Definition 層不確定だけなら、3 round 待たずに Assumption に落として Phase 2 へ進む

つまり「round 数そのもの」ではなく「中核不確定が残っているかどうか」で進行判断する。

## 8 観点 lens

各観点は「この観点を置き去りにすると plan を壊す可能性がある」というチェックポイントの並び。**明示語 signal のリストは anchor**（判定を固定化するルールではなく、見落としを減らすための目安）として扱う。

### 1. Why — motivation

- **lens の狙い**: この変更で何を解消するのか、なぜ今なのか
- **Anchor signals**: 意図動詞（`〜したい`）、理由マーカー（`ので` / `理由は`）、課題表明（`困って` / `問題` / `Issue #\d+`）、因果接続詞を含む完結した reason clause
- **置き去りの代償**: Why がないと Scope 判断も Success 判断も根拠を失う → 全観点に波及
- **典型 probe**: 「この変更で何を解消したい？根本的な課題は？」

### 2. What — deliverable

- **lens の狙い**: 何が作られ、何が変わるのか
- **Anchor signals**: 成果物 noun（`command` / `function` / `config` / `UI` / `skill` / `agent` / `hook` / `script` / `option`）、具体的 file/path 名
- **置き去りの代償**: What が曖昧だと、Phase 2 の探索対象が定まらず Phase 3 の Files to Change も書けない
- **典型 probe**: 「具体的に何が作られる？ (command / function / config / UI 等)」

### 3. Who — actor

- **lens の狙い**: 誰が使うのか（単独 user / チーム / 他人）
- **Anchor signals**: `自分` / `自分用` / `チーム` / `ユーザー`、role 名詞（reviewer / contributor 等）
- **置き去りの代償**: UX 齟齬。dotfiles 文脈では単一 user が安全 default だが、他人に共有する設計なら検討が変わる
- **典型 probe**: 「誰がこれを使う？一人？チーム？自分以外の想定は？」

### 4. When — trigger/context

- **lens の狙い**: いつ / どの文脈で動作するのか
- **Anchor signals**: `手動` / `自動` / `hook` / `CI` / `起動時` / `PreToolUse` / `PostToolUse` / `on-<event>` 形式
- **置き去りの代償**: 起動設計ミス。hook なのかコマンドなのかで実装構造がまるで変わる
- **典型 probe**: 「いつ / どの文脈で起動する？手動？自動？ trigger は？」

### 5. Where — scope boundary

- **lens の狙い**: どこまで含め、何を含めないのか
- **Anchor signals**: 具体的 path / skill / agent 名、`特定の〜だけ` / `〜全体` / `以外の〜は除く`
- **置き去りの代償**: 余計な実装 or 不足、silent scope creep。Scope の誤りは下流で回収しにくい
- **典型 probe**: 「どこまで含める？逆に含めないものは？」

### 6. How — approach preference

- **lens の狙い**: 実装方針に user の好み/制約があるか
- **Anchor signals**: 具体的 library / framework / pattern 名、「既存の X を踏襲」「Y と同じ方式」等の明示的参照
- **置き去りの代償**: 多くのケースで low-cost（Phase 2 EXPLORE で既存 pattern が得られ、Phase 4 Critic が不整合を拾う）。ただし user が明示的好みを持っている場合を取りこぼすと再作業
- **典型 probe**: 「実装方針の好みは？既存 pattern 踏襲？新規設計？」

### 7. Success — observable

- **lens の狙い**: 何をもって成功とするのか、観測可能な条件は
- **Anchor signals**: `〜できたら OK` / `〜すれば成功`、測定語（`時間` / `回数` / `率` / `size` / `latency`）、test 語（`テスト` / `verify`）
- **置き去りの代償**: Completion Criteria が書けず、`/completion-audit` が機能しない。「動けば OK」は Success を定義していない
- **典型 probe**: 「何をもって成功？観測可能な条件は？」

### 8. Failure — anti-req

- **lens の狙い**: 絶対してはいけないこと、避けたい副作用は
- **Anchor signals**: `〜はダメ` / `避けたい` / `must not` / `禁止`、safety / regression / 副作用
- **置き去りの代償**: user の設計制約を silent に踏み越える。Failure 側の制約は signal が弱く見逃しやすい
- **典型 probe**: 「絶対してはいけないこと / 避けたい副作用は？」

## Evidence rule — Clear/NotClear の判断

分類の基準は「signal token が要求文に literal match しているか」ではなく **「文脈から restate できるか、解釈に飛躍が必要か」**。

- **明示語があれば引用する**: 要求文中に anchor signal が literal match していれば、`Why: Clear (要求文の 'ズレた' に match)` のように引用して証跡にしてよい
- **明示語がなくても、文脈全体から合理的に restate できれば Clear**: 例えば `dotfiles の tmux 設定で option を追加してほしい` に Where 明示語はなくても、文脈全体で Where = dotfiles/tmux に確定するなら Clear 扱い可
- **解釈に飛躍がある場合のみ NotClear → Ask / Assume / Self-resolve**: 複数の解釈が並立する、または user 独自知識が必要と判断される場合に triage 対象に入れる

**exact token 必須ルールは廃止**: 「文脈では十分明確なのに token がないから NotClear」という brittle な挙動を避ける。

## Ambiguous qualifier — calibration signal として扱う

主観形容詞 / 程度副詞 / 曖昧技術語（例: `野暮ったい` / `わかりづらい` / `見づらい` / `モダンじゃない` / `大幅に` / `しっかり` / `リアルタイム` / `なめらか` / `軽量`）は **強制降格しない**。扱いは **その語が設計判断の中心仕様か補助修飾か** で分岐する。

- **中心仕様の例**: 「pointer が野暮ったいので何とかしたい」→ `野暮ったい` が What / Success の核。具体像（Unicode 変更 / 色強調 / 削除 + 行反転）を calibrate しないと実装が定まらない → Calibration Probe 候補
- **補助修飾の例**: 「なめらかに動くように tmux option を追加」→ `なめらか` は副次的修飾。`tmux option を追加` という中心仕様は別に明示されており、実装は option 追加で確定 → 通常解釈で進める
- **判断軸**: 「この語を確定させないと Phase 3 DRAFT の Files to Change / Approach が書けないか？」YES なら中心、NO なら補助

**Calibration Probe（中心仕様と判断した場合のみ起動）**:
- 3 個の concrete candidate を AskUserQuestion の options に提示（観測可能な condition または threshold value、1 つに (Recommended) tag を付けて top、末尾に Other を含める）
- 通常 Ask と同じく Round 内 Ask 件数にカウント（slot 1 消費）
- 候補 3 個を defensible に研究できない場合は Calibration Probe 化を諦め、自由記述の Ask に降格

## Cost-based triage — Ask / Assume / Self-resolve の選択

NotClear 項目に対する triage は、観点ごとの fixed default ではなく **以下 2 軸の同時判断** で決める:

- **軸 A — 誤ったときの波及コスト**: この観点を取り違えると plan 全体がどれだけ壊れるか
  - **高**（Outcome / Boundary 層）: Why / Where / Success / Failure。plan の根拠や境界が崩れる
  - **中**（Context 層）: Who / When。UX や起動設計のズレ
  - **低**（Definition 層）: What / How。Phase 2 EXPLORE / Phase 4 Critic で比較的拾える
- **軸 B — 後続 Phase / 実装での回収可能性**: Phase 2 EXPLORE の codebase 探索や Phase 4 Critic の adversarial 検証で覆せるか
  - **高**: codebase に signal が残っているタイプ（既存実装パターン、呼び出し文脈、既存 test）
  - **低**: user の主観 / 好み / 未開示の domain 知識

### Triage の結論

| コスト × 回収可能性 | 選択 |
|---|---|
| 高コスト、低回収可能性 | **Ask** — user 確認が必要 |
| 低コスト、高回収可能性 | **Self-resolve**（Round 内軽量 probe）または **Assume**（safe default） |
| 低コスト、低回収可能性 | **Assume**（tentative、Phase 4 で再評価） |
| 高コスト、高回収可能性 | **Self-resolve** 優先、probe 不能なら **Ask** |

**How の扱い**: 「問答無用で assume」の hard default は採用しない。How も他の観点と同様に上記 2 軸で判断する。典型的には「低コスト × 高回収可能性」に落ち着くため結果として Assume になることが多いが、user が明示的好みを示している signal があれば Ask 判断もありうる。

**判断の記録**: 採用した triage は plan 本文の `### Assumptions` または `### Self-resolved` に該当エントリとして記録する（形式は後述）。

## Phase 1 出力 subsection（plan 内部 convention）

Phase 1 Round 収束時、`## Overview` の直前に下記 3 subsection を出力する。Phase 4 Critic は **canonical phrase ではなく subsection の構造を parse** して未確定項目を引き継ぐ。

```markdown
### Requirement Clarification

- Rounds: N（converged at round N、reason: <trigger 0 / user override / additional confirmation / operating limit reached>）

### Assumptions

- observation: Where
  value: dotfiles/home/programs/claude/skills/plan/
  reason: 要求文 'plan skill を再設計' から文脈的に restate 可能

- observation: How
  value: 既存 markdown edit で reference file を書き換え
  reason: codebase signal — 既存 skill 群が同じ pattern を踏襲
  user-overridden: true   # optional. user override 由来の場合のみ付ける

### Self-resolved

- observation: What
  value: SKILL.md と references 3 ファイルを編集
  source: Phase 1 Round 内 Grep probe で確定

- observation: When
  value: Phase 2 EXPLORE で確定予定
  source: probe 不能、Phase 2 に委譲

### Unresolved Items

- item: Success の観測指標（line 減少量の閾値）
  reason: user 主観判断、3 round で候補を絞れず
  next: Phase 4 Step 7 Consolidated Interview で確定
```

### Subsection semantics

- `### Requirement Clarification` — Round 進行の要約。人間可読で OK（Critic は parse しない）
- `### Assumptions` — tentative / user-overridden / codebase-default 由来の仮定。各エントリに `observation` / `value` / `reason` を明記。user override 由来は `user-overridden: true` フラグを付ける（Phase 4 Critic が `### Assumptions` を走査して `user-overridden` を拾う）
- `### Self-resolved` — Round 内 probe または Phase 2 EXPLORE 委譲で確定する項目。各エントリに `observation` / `value` / `source` を明記
- `### Unresolved Items` — Round loop 終了時点で確定できなかった項目。各エントリに **3 フィールド必須**:
  - `item`: 何が未確定か
  - `reason`: なぜ今は確定できないか（same-trigger escalate / operating limit reached / information-gathering cost too high など）
  - `next`: 次にどこで扱うか（`Phase 4 Step 7 Consolidated Interview` / `Phase 2 EXPLORE で追加探索` / `implementation 時に user 判断` など）

**subsection が非存在 = 0 件を意味する**: `### Unresolved Items` を書かない場合、Phase 4 Critic は unresolved が 0 件と解釈する。0 件であることを明示したい場合は subsection を書いて body に `(none)` と記す。

**Self-resolved block 併記**: AskUserQuestion 発行時、冒頭に `以下を自己解決しました:` の human-readable 要約を示して誤判定の即時 flag を促す（exact token 引用必須ルールは廃止、restate で OK）。

## Ask 発行の batch 規則

Round 内で Ask 分類になった項目の発行ルール。進行管理の source of truth は SKILL.md Phase 1 Step E。以下は判断軸のみ:

- Ask 件数 0: override 質問のみ（User 脱出口を残す）、または Round 2+ で trigger も 0 件なら AskUserQuestion 自体 skip
- Ask 件数 1–3: 全件 + override で 1 回にまとめる（合計 max 4）
- Ask 件数 4 以上: cost 優先順（Outcome > Boundary > Context > Definition、同 tier 内は observation 番号昇順）で上位 3 件 + override、残りは次 round 候補先頭に繰り越し

Round budget を使い切っても残った項目は `### Unresolved Items` に `next: Phase 4 Step 7 Consolidated Interview` として記録する（legacy canonical phrase 形式は使わない）。

## Divergence Probing — conditional 発動

未言及派生機能の能動提案は **default-off**。以下のいずれかに該当するときのみ起動する:

- **条件 A**: 参考実装 URL が与えられており、その実装との差分確認が本質的な価値になるケース（user が参考実装を挙げた時点で、delta を問うことが暗黙の要求）
- **条件 B**: user request が「設計の抜け漏れ検討」「他に必要なことは？」などを明示的に求めているケース

いずれにも該当しない通常の feature planning では **起動しない**。理由: 通常 planning では user の主要求を固めることが先で、延長機能の提案は Phase 4 Critic の Scope Appropriateness 軸で代替的に捕捉される。

起動する場合の挙動:

- 候補抽出 source: 要求文中 keyword、参考実装 URL の機能群、user request context
- 抽出数 → AskUserQuestion 形式:
  - 0 candidates: skip
  - 1 candidate: single-select、options = `[今回 scope に含める / 別 plan で追跡 / 対象外 / Other]`
  - 2–4 candidates: multiSelect、2–3 candidates なら `各 candidate + Other`、4 candidates なら `各 candidate` のみ（Option cap 4 厳守）
- 参考実装 URL given 時は 2–4 candidates の delta 分析を必須化
- 選択された candidate は「今回 scope に含める」、非選択 candidate は **暗黙的に「対象外」**。`Other` 選択は free-text として記録

Round 制限:
- 起動するのは Round 1 のみ
- Round 2+ での派生機能検討は Phase 4 Critic の Scope Appropriateness 軸に委譲

## Impact priority — Ask overflow 時の並び替え

Round 内 Ask 件数が slot（通常 3）を超えるときの上位選定、および batch 内の質問順決定に使う:

1. **Outcome 層** — Why / Success
2. **Boundary 層** — Where / Failure
3. **Context 層** — Who / When
4. **Definition 層** — What / How

**Tiebreaker**: 同 tier 内は observation 番号昇順（Why < What < Who < When < Where < How < Success < Failure）。

## Ambiguity Gate との責任分界

本 lens は 8 観点の positive walk を担当する。SKILL.md の Ambiguity Gate は本 lens で拾えない exception（要求文の restate 自体が失敗、1–2 語の単語のみで signal 無しなど）専用。Gate 発動時は lens walk をスキップして要求文の再取得から始める（以降は通常の Round loop に合流）。
