# plan-metrics ベースライン記録（2026-10-18）

plan / impl / gate の 7 件の改善（gate レビュアーの再編、critic / adversarial の絞り込み、evidence 機構の再設計、工程不具合の修正、問いの方針）を入れる前の実測。2 週間後に同じコマンドで再測定し、各改善の「この数字が動かなければ戻す」条件と比べる。

## 実行

2026-10-18 02:56（JST）、tree be61fe9 + 本計画の未コミット差分（gate の 3 ラウンドの指摘を反映した後の状態）。

```
./home/programs/claude/scripts/plan-metrics/plan-metrics.ts --from 2026-09-15
```

所要 4.2 秒（2,908 セッション）。

実効の窓: 2026-09-15 16:11Z（最初の /plan 区間）〜 2026-10-17 17:56Z。transcript は mtime 約 30 日で消え、中身のある最古は 2026-09-17。`--from 2026-09-15` でも窓の先頭は保持期間で決まるので、再測定では窓の長さを揃えて読む（先頭が欠けるのはドリフトで、スクリプトの欠陥ではない）。母集団は `-private-tmp-` で始まる project 8 個（テスト用セッション）を除いたもの。gate log 70 件には本計画自身の `.gate.log.md` が 1 件入っている。それは `failLogs` に 1、`failByReviewer` の code-reviewer と typescript-reviewer に 1 ずつ、`blockerByReviewer` の code-reviewer に 1 を足す。blocker に数えるのは Round 3 の返答（`**Type**: INCOMPLETE`）で、Round 1 の返答は spec Issue 3 件を持つのに数えない: 仕様の句「SHOULD_FIX only」を引用していて `SHOULD_ONLY` の除外に当たる。parser について書かれた log にだけ起きる形なので、規則は変えない。

## 出力

```
## window
  from: 2026-09-15T16:11:19.590Z
  to: 2026-10-17T17:56:08.425Z
## population
  listed: 2908
  read: 2908
  skippedTmp: 8
  skippedOld: 1
  missing: 0
  includeTmp: false
  abandonedPlanSegments: 15
## unparsed
  badLines: 138
  sidecars: 0
  subagentFiles: 0
  metaFiles: 0
  untimedSegments: 0
  noEndSegments: 20
  unparsedKind: 6
  gateLogs: 0
  skippedWaves: 2
## warnings
## phases
  small: {"plans":29,"planActiveMin":9.1,"waitMin":2.8,"repliesMedian":1,"implMin":15.9,"noEnd":4}
  medium: {"plans":40,"planActiveMin":16.1,"waitMin":6.2,"repliesMedian":2,"implMin":25.7,"noEnd":11}
  large: {"plans":7,"planActiveMin":19,"waitMin":8.4,"repliesMedian":3,"implMin":159.7,"noEnd":4}
  xl: {"plans":2,"planActiveMin":34.7,"waitMin":222.9,"repliesMedian":3.5,"implMin":156.1,"noEnd":1}
## critics
  runs: 143
  durMin: 4.4
  out: 23055
  cacheRead: 2149115
  withCriticalRate: 83
  items: 410
  classification: {"user":33,"evidence":117,"dim7":77,"behavior":183}
  behaviorShare: 45
## adversarial
  runs: 95
  durMin: 4.9
  out: 24835
  withFalsifiedRate: 69
  falsified: 179
  designQuestions: 440
  designQuestionsPerRun: 4.6
## rounds
  logs: 59
  round2: 28
  round2Rate: 47
  round1Veto: 18
  round2Applied: 18
## gates
  logs: 70
  dispatchMedian: 4
  failLogs: 25
  failRate: 36
  dispatchByReviewer: {"react-reviewer":11,"typescript-reviewer":42,"security-auditor":23,"comment-reviewer":50,"nix-reviewer":14,"code-reviewer":68,"rust-reviewer":6,"cloud-architecture-reviewer":2,"deno-reviewer":12,"a11y-reviewer":13}
  failByReviewer: {"comment-reviewer":9,"nix-reviewer":2,"code-reviewer":21,"security-auditor":4,"deno-reviewer":2,"typescript-reviewer":5,"rust-reviewer":1,"react-reviewer":1,"a11y-reviewer":2}
  blockerByReviewer: {"code-reviewer":7,"security-auditor":2}
  rereviewLogs: 34
## evidence
  implSegments: 79
  planStateShare: 18
  targetChanged: 31
  sidecars: 60
  recordsPerIdMedian: 2
  distinctTargetsMedian: 3
  statusChangedIds: 5
  outputCharsMedian: 8859
## questions
  segments: 79
  turns: 175
  perPlanMedian: 2
  before: {"turns":119,"waitMin":1.5}
  after: {"turns":56,"waitMin":2.3}
  recommendationRate: 98
## friction
  gitCSessions: 58
  sedInPlaceSessions: 27
  repositoryMismatchSessions: 5
  selfResolvedGradeSessions: 23
  targetChangedSessions: 22
  diffOnlyCalls: 7
```

`--include-tmp` を付けると計画 81（small 32）、critic 146、問いターン 176 になる。`--list questions` は 175 行（`questions.turns` と一致）、`--list critical` は 410 行。

## 使い捨てスクリプトとの照合

旧スクリプトは 2026-10-18 02:08〜02:19 JST に、この会話の scratchpad にあった使い捨てスクリプト（`plan-phase.ts`、`scan-critics.ts` → `analyze-critics.ts`、`questions.ts`、`scan-gates.ts`、`scan-logs.ts`）を、`plan-sessions.txt` を作り直してから再実行した値。新は gate の指摘を直すたびに取り直し、最終の値は上の出力（02:56 JST）で、その間にセッションが 4 件増えている（`listed` 2904 → 2908）。旧スクリプトはテスト用セッション（`-private-tmp-`）を含む。

| 項目 | 新 | 旧 | ずれの原因 |
|---|---|---|---|
| 計画数 | 78（small 29 / medium 40 / large 7 / xl 2） | 66（27 / 31 / 5 / 2、他 1） | 新は `/plan` の開始ごとに区間を作り、Skill tool_use 経由の開始（4 件）も数え、同じ区間の最後の handoff を採る。旧は 1 セッション 1 区間で最初の handoff。旧はテスト用 3 件を含む |
| critic 回数 | 143 | 133 | 新は description の "Critique …" / "Falsify …" も判定（+16 / +11 相当のうち窓内）。旧はテスト用 3 件を含む |
| adversarial 回数 | 95 | 95 | 一致 |
| 問いターン | 175 | 133 | 計画数の差に連動。1 計画あたりの中央値は両方 2 |
| gate log 数 | 70 | 69 | 新は本計画自身の gate log を含む。それを除けば一致 |
| Critical あり % | 83 | 86 | 母集団の差 |
| 挙動（behavior）の比 | 45%（183 / 410） | 44%（176 / 398、旧の出力 `critical-items.txt` に同じ順序つき正規表現を当てた値） | 一致 |
| Falsified あり % | 69 | 69 | 一致 |
| Design Questions | 440（4.6 / 回） | 440 | 一致 |
| 2 ラウンド目 | 28 / 59（veto 起点 18） | 28 / 59（18） | 一致。「適用あり」は新 18 / 旧 10 で、旧の数え方（`Applied` 行の正規表現が狭い）の差 |
| FAIL が出た gate | 25 / 70（36%、本計画の gate log を除くと 24 / 69） | 21 / 69（30%） | 旧は見出し形と `- name — FAIL` 行形しか読めず 51 件が未解析だった。新は `VERDICT:` 行を一次情報にし未解析 0 |
| blocker | code-reviewer 7、security-auditor 2 | code-reviewer 4、security-auditor 1 | gate log ごとに突き合わせた（新は `parseGateLog` を log ごとに呼び、旧は `old-gates.txt` の `blocking=[…]`）。code-reviewer の共通 4 件: hermes-claude-task、agentower-free-sessions、bun-agentower、daxial-contract-tests。新のみ 3 件: 本計画自身の gate log（旧の実行時には無かった）、hermes-slack-calendar-create（`### Issues` + `**Type**: EXTRA` の標準形。旧は FAIL と同じ行の `Issue (` / `Issues:` しか読まない）、agent-vocab-ontology（貼り付けた返答の中の `**Type** INCOMPLETE` と Round 2 の `MUST_FIX`。旧は `###` の見出しごとに reviewer を忘れるので返答の中を読めない）。旧のみ 0 件。agentower-free-sessions は根拠が違う: 旧は Round 1 の `VERDICT: FAIL. Issues: None.` が `Issues:` に当たった誤検出（その FAIL は SHOULD_FIX のみ）、新は Round 3 の `Issue (INCOMPLETE)`。security-auditor の共通 1 件は hermes-claude-task、新のみ 1 件は agent-vocab-ontology の `SHOULD_FIX（HIGH 相当）`（`\bHIGH\b`） |
| small の plan 稼働 / impl + gate | 9.1 / 15.9 分 | 8.0 / 11.7 分 | 母集団の差（新は 29 計画、旧 27。Skill 経由と複数 /plan のセッションが入る） |
| medium の plan 稼働 / impl + gate | 16.1 / 25.7 分 | 13.8 / 25.7 分 | 同上 |
| 待ち（critic 前 / 後） | 1.5 / 2.3 分 | 1.3 / 2.2 分 | 母集団の差 |

旧スクリプトに無く照合しないもの: evidence 群（`planStateShare` 18% は `/impl` 区間（開始から最終報告の終端まで）の tool_use 入力に対する比。メモの 7.9% は 1 セッション全体に対する比で分母が違う）、`recordsPerIdMedian`、`statusChangedIds`。

## friction の定義変更

メモ `process-friction-fixes.md` の値（128 / 75 / 44 / 43 / 1 セッション）は、transcript 全文に文字列が現れるセッションを数えたもので、skill 本文やソースを読んだ tool_result も含む。本スクリプトは `is_error: true` の tool_result に限り、subagent の分を親セッションに寄せ、テスト用セッションを除く。その定義での baseline は上の `friction` 群（`git -C` 58、`sed -i ''` 27、`repository mismatch` 5、`self-resolved-grade` 23、`target changed` 22、`/gate --diff-only` 7）。`section-duplicate` は check-plan に規則が入ってから足す。

## 読み方

- 比べる数字は各メモの撤回条件に対応する: critics の `withCriticalRate` と `behaviorShare`（critic の次元を 7 → 4 にして挙動の比が落ちたら戻す）、adversarial の `withFalsifiedRate` と `designQuestionsPerRun`、rounds の `round2Rate`、gates の `failRate` と `blockerByReviewer`（specialist の card 化後に comment-reviewer の FAIL が 0 なら廃止）、evidence の `targetChanged` と `statusChangedIds`（0 のままなら最終再検証は儀式だった証拠）、questions の `after.turns` と `recommendationRate`、friction の各セッション数（直しが届けば 0）
- 窓内の critic が 10 未満なら `warnings` に 1 行出る。そのときは率の判定を保留する
- blocker の判定は `MUST_FIX` / `CRITICAL` / `HIGH` のラベル、空でない `### Must Fix` / `### Issues` 節、`Type: MISSING|EXTRA|MISUNDERSTOOD|INCOMPLETE`、`Issue (` / `Issues:` の行形を読む。節が空かどうかは最初の行が `None` / `(none)` / `Empty if none` / `Not applicable` だけで終わるか、次の見出しかで決めるので、`None — 全要件を満たす` のような書き方は populated と読まれる。`unparsed` と同じく、形が増えたら足してから比べる
- `unparsed` が増えたら、新しい log や報告の形が入った印なので、形を足してから比べる。`badLines` は親と subagent の transcript の JSON として読めない行、`metaFiles` は transcript は読めたが meta.json が無いか壊れている subagent（transcript も読めないものは `subagentFiles` にだけ入る）、`untimedSegments` は開始行に timestamp が無く窓に入れられなかった `/plan` 区間、`noEndSegments` は `/impl` の終端が取れなかった区間。`population.listed` は窓に入った transcript、`read` はそのうち読めたもので、差は `missing` に出る。handoff に至らなかった計画（中断・進行中）は `population.abandonedPlanSegments` で、unparsed ではない
- evidence 群の `planStateShare` と `targetChanged` は `/impl` の開始から最終報告の終端までを数える。終端の後に同じセッションで続けた作業は入らない
