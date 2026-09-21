# instruction-stack 再構築の baseline（2026-09-16）

指示スタック（グローバル CLAUDE.md、output style、plan / impl / gate スキル、契約）を再構築する前の計測値と決定の記録。調査の全文と生データは `.wadackel/instruction-stack-rebuild/`（未追跡）にある。再構築後の比較はこのファイルの表に追記する。

## 決定（2026-09-16）

- 分割せず 1 プロジェクトで再構築する。旧版は `main` に残す。
- 評価タグ（`[Direct]` など）はチャット返答から外す。plan ファイル内の `source:` 契約だけに残す。
- `requirements-interview` は別環境で使用中のため残し、質問書式と判断レンズを `interview.md` に共有化する。
- completion-audit の LLM 自己監査は、Codex の evidence 機構を共有化した script 判定（`plan-state.ts coverage` / `complete`）に置き換える。最終 task の `audit` 記録は必須にしない。
- 数値の長さ制限と anti-formatting 規則は置かない（Anthropic の語数制限は評価 3% 低下で撤回、Fable 5.1 docs は anti-formatting の削除を推奨）。
- reviewer 選択の script 化は見送る（誤選択の計測がない）。

## 文体（Claude 最終返答、2026-08-31 以降、Opus 5 時代の transcript）

| 指標 | Claude 最終返答 | Codex 最終返答 |
|---|---:|---:|
| 件数 | 881 | 179 |
| 文字数 中央値 / p90 | 326 / 1582 | 398 / 1812 |
| 文の平均長（。区切り） | 65.1 字 | 49.5 字 |
| 。で終わらない行の割合 | 31.7% | 17.3% |
| 見出しを含む返答 | 26.3% | 15.6% |
| 表を含む返答 | 6.4% | 30.7% |
| 括弧 / 千字 | 3.65 | 2.81 |

スキル文脈別（Claude 最終返答の中央値）: `/plan` 790 字（見出し率 55%）、`/impl` 451 字、文脈なし 191 字。`## Plan ready` を含む引き渡し 25 件は中央値 1551 字、断片率 49%、文平均 104 字。

fire-rate（`fire-rate.ts --from 2026-08-31`、n=2077 応答、721,709 字）: arrow_chain 0.05、paren_chain 0.15、telegraphic_fragment 0.21 件/千字。

## 工程（2026-08-01 以降、31 セッション）

| 複雑度 | plan の回答回数（中央値 / p90） | plan 所要分 | plan の subagent 数 |
|---|---:|---:|---:|
| trivial | 3 / 3 | 7.5 | 0 |
| small | 3 / 4 | 32 | 3 |
| medium | 4 / 6 | 44 | 3 |
| large | 4 / 6 | 57 | 5.5 |

impl は中央値で回答 0 回、reviewer dispatch 5 本。completion-auditor は 21% で起動。

## 語数

| ファイル | 語数 |
|---|---:|
| home/programs/claude/CLAUDE.md | 2,091 |
| output-styles/concise.md | 236 |
| RTK.md | 138 |
| skills/plan/SKILL.md | 3,545（references 7,821） |
| skills/impl/SKILL.md | 2,411 |
| skills/completion-audit/ | 2,634 |
| skills/subagent-review/ | 7,079 |
| agents/skills/requirements-interview/ | 4,196 |
| codex/skills/plan/SKILL.md | 5,177 |
| codex/skills/impl/SKILL.md | 2,155 |

## テスト

契約テスト `codex-plan-clarification-contract_test.ts` は 20 ケース（`Deno.test` 17 か所、うち 2 か所がループで 2 + 3 件）。`codex-plan-state_test.ts` 14、`codex-plan-evidence_test.ts` 12。

## 旧 config の起動手順

旧版は `main` の worktree `../dotfiles-old` にあり、`~/.claude-old/` から CLAUDE.md、RTK.md、settings.json、skills、agents、output-styles、hooks、scripts をそこへ symlink している。

```
CLAUDE_CONFIG_DIR=$HOME/.claude-old claude -p '<prompt>' --settings '{"outputStyle":"concise"}'
```

認証は config dir 単位なので、初回に `CLAUDE_CONFIG_DIR=$HOME/.claude-old claude` を対話で起動して `/login` する。settings.json の hook は `~/.claude/scripts/...` の絶対パスなので、旧 config で起動しても hook と script は新版が走る。比較できるのは CLAUDE.md、output style、skills の差だけで、`claude -p` の 1 ターン応答ではその差が支配的になる。

## 固定 8 プロンプトの smoke

プロンプトは `fire-rate-baseline.md` の 8 本。生出力は `.wadackel/instruction-stack-rebuild/smoke-old/` と `smoke-new/`。

新 config（2026-09-16、Fable 5.1、`.wadackel/instruction-stack-rebuild/smoke-new/`）:

| # | 文字数 | 文平均長 | ラベル断片率 | 見出し数 |
|---|---:|---:|---:|---:|
| 1 | 1771 | 47.1 | 0% | 3 |
| 2 | 2654 | 45.4 | -% | 11 |
| 3 | 1995 | 50.5 | 0% | 3 |
| 4 | 2004 | 56.7 | -% | 4 |
| 5 | 916 | 49.3 | -% | 0 |
| 6 | 1448 | 34.3 | 0% | 6 |
| 7 | 1090 | 61.3 | 0% | 2 |
| 8 | 872 | 37.4 | 33% | 0 |
| 中央値/合計 | 1609.5 | 47.4 | 3% | 29 |

旧 config（`~/.claude-old`、同日採取）は `/login` 未実施のため未採取。採取したら `smoke-stats.ts smoke-old` の表をここに足し、文字数中央値・文平均長・ラベル断片率で比較する。参考値: 2026-08-30 の旧 concise.md での採取（Opus 5）は合計 35,028 字、今回の新 config は合計 12,750 字。

本 plan ファイルの ACTIVATE digest（headless、新 config）: 1,543 字、設計判断 7 項目 + `## Plan ready`、Files to Change / Task Outline の再掲なし（`digest/new.md`）。旧 config 側は同じく `/login` 待ち。

## 契約の項目 → 固定ファイル

契約の項目 → 固定ファイル（`codex-plan-clarification-contract_test.ts` が固定する。定義元は常に `contract.md`）:

| 項目 | 定義 | ミラー（verbatim） | 参照（`references/contract.md` の文字列） |
|---|---|---|---|
| `[live]` 定義文 | contract.md | — | plan（Claude / Codex）、critic / adversarial prompt |
| Requires User Confirmation の 5 欄テンプレート | contract.md | check-plan.ts（語彙定数） | 同上 |
| `source: [Direct\|Supported\|Inferred] <probe command + file:lines>` | contract.md | plan（Claude / Codex）、check-plan.ts | — |
| `Final Audit + Review` | contract.md | Codex plan（Task 5 で Claude plan を追加） | — |
| `<redacted:` の免除条件 | contract.md | Claude plan、critic prompt | — |
| plan 見出し 7 種、CC タグ 4 種、`Needs:` 語彙 | contract.md | check-plan.ts | — |
| `## Plan ready` ブロック、`PENDING APPROVAL` | contract.md | — | plan（Claude / Codex） |
| reviewer verdict / severity / section 語彙 | contract.md | — | gate（Task 4 で追加） |
| sidecar 名、escalation marker | contract.md | — | gate、impl（Task 4 / 6 で追加） |
| interview の規則文（frontier、ターン終了、質問書式、decide-when-settled） | interview.md | — | plan（Claude / Codex）、requirements-interview |

## CLAUDE.md 規則台帳

旧グローバル CLAUDE.md（149 行、2026-09-16 時点の `main`）の全規則の行き先。「残す」は新 CLAUDE.md、「skill」「output style」「contract」「hook」は移した先、「削除」は理由付き。

| 旧節 | 規則 | 行き先 |
|---|---|---|
| Core Principles | YAGNI / KISS / DRY | 残す（Principles 1） |
| | shim・fallback を足さない | 残す（Principles 1） |
| | parser library over regex | 残す（Principles 1） |
| | 聞く前に調べる、聞くのはユーザーしか知らないこと | 残す（Principles 2） |
| | 選択肢は軸を 1 文で | 残す（Principles 2）、interview.md にも |
| | 「規則どおりに従え、小さいからと飛ばすな」 | 削除。判断を禁じる説教で、公式は「rules → judgement」。/plan が trivial も通す設計に置換 |
| Tooling Defaults | fd / rg / Deno over Bash / 短い chain は Bash | 残す（Tooling） |
| Subagent Dispatch | standing request | 残す（Principles 6） |
| | skill の dispatch も同じ | 削除。重複（各 skill が自分で dispatch を書く） |
| | 「判断は要る」 | 削除。前項に含まれる |
| | name を渡さない / TaskStop | 残す（Principles 6） |
| | idle 通知を無視 | 残す（Principles 6） |
| Workflow Entrypoints | /plan が既定、trivial も | 残す（Entrypoints 1） |
| | /impl、/qa-planner、/agent-browser、/systematic-debugging、/gdocs-to-md、/repo-dive、/codex-review | 残す（Entrypoints、1 行に集約） |
| | /llm-wiki query の条件と除外、save の提案 | 残す（Entrypoints 4） |
| Planning And Execution | 4 条 | 削除。plan / impl skill が所有する内容の重複 |
| Question Triage | 3 条 | interview.md（What to ask の表） |
| Verification | baseline を先に採る、挙動を検証、観測できる方法、テスト更新 | 残す（Principles 3） |
| | Web UI は /agent-browser | 残す（Entrypoints 3） |
| | 証拠 > 分析、検証失敗は観測方法を疑う、委譲は成果物で判断 | 残す（Principles 3） |
| | /impl は completion-audit と subagent-review が通るまで完了と言わない | 削除。impl skill が /gate を最終 task として持つ |
| | 評価タグ 4 条（[Direct] 等、未タグは Inferred、Explore で falsify） | 削除（ユーザー決定）。「検証したこと・していないことを言葉で言う」（Principles 4）に置換。タグは contract.md の plan ファイル契約にだけ残る |
| Bug Fixes | CLAUDE.md が権威、/systematic-debugging は手順 | 削除。skill 側で足りる |
| | 直接観測、仮説を falsify、workaround と root-cause の両方 | 残す（Entrypoints 2） |
| | baseline → implement → re-measure loop | 残す（Principles 3 に統合） |
| Git And Shell | git add -A 前の status 確認、base branch から分岐して diff 確認 | 残す（Gotchas 1） |
| | git -C 禁止 | hook（bash-policy.yaml が既に block） |
| | bash -c、set +H、just の \$var、BSD sed | 残す（Gotchas 2） |
| | background mode、PUA glyph は printf | 残す（Gotchas 3） |
| External Resource Handling | gh、/repo-dive、/gdocs-to-md、/obsidian-cli | 残す（Tooling 2、Entrypoints 3） |
| Language Defaults | 3 条 | 残す（Generated artifacts、1 条に統合） |
| Writing | 返答は次の行動を変えるものだけ、大量出力はファイルへ | output style（Reply 1, 3） |
| | workflow 内部を書かない、workflow 語彙を prose に出さない、severity 等の例外 | output style（Reply 1 に吸収）。語彙禁止と例外表は削除: 禁止語リストは矛盾の温床で、contract.md が語彙を持つ |
| | 訳せる英語は訳す、識別子は原形 | output style（Reply 6）。「訳す」側は削除: Fable 5.1 の判断に任せる |
| | 完全文で書く、断片禁止 | 削除。数値・禁止形の規則を置かない決定。Shape の肯定形に置換 |
| | 用語は初出で定義 | 削除。同上 |
| | 最小の完全な答えから | output style（Reply 1） |
| Design Principles | SRP は文脈依存 | 削除。判断規則で、挙動を変えない |
| | 3 引数以上は object、composition、Rule of Three、命名 | 残す（Code 1） |
| | コメントは Why-not のみ、ラベル禁止、会話の痕跡禁止、Codex ミラー | 残す（Code 2） |
| Coding Conventions | GH Actions SHA pin | 残す（Gotchas 5）。pinact が Sensor |
| | Deno の 4 gotcha | 残す（Gotchas 4） |
| | 依存順に並べる、循環禁止 | 残す（Code 1） |
| concise.md（旧） | outcome first、proposal で締める、workflow を語らない、bulk はファイル、preamble なし | output style（Reply 1〜3） |
| | 箇条書きは並列項目だけ、矢印 2 つ禁止、括弧 1 組まで、skeleton を使い回さない | 削除（矢印・括弧・箇条書き制限）。fire-rate が床に達し、Fable 5.1 docs が anti-formatting の削除を推奨。Shape の肯定形に置換。skeleton は残す |
| | STYLE-CHECK 番兵 | 残す |

## 再構築後の語数（2026-09-16、`wc -w`）

| ファイル | 語数 | 予算 |
|---|---:|---|
| home/programs/claude/CLAUDE.md | 697（40 行） | 1,000 語・80 行 |
| output-styles/concise.md | 241（26 行） | — |
| skills/plan/SKILL.md | 1,053 | 1,500 |
| skills/impl/SKILL.md | 822 | 800（22 語超過） |
| skills/gate/SKILL.md | 937 | 1,200 |
| shared/plan/references/contract.md | 1,142 | — |
| shared/plan/references/interview.md | 657 | 600（57 語超過） |
| plan + interview + contract | 2,852 | 2,800（52 語超過） |

2026-09-22 の完了報告の形の改訂（`impl/SKILL.md` の Final report 節に完成例、`interview.md` に表形のサンプル）で、`impl/SKILL.md` と `interview.md` の超過は広がる。削る候補は次回に回し、この表の値は改訂前のまま。
| impl 単体（contract は語彙の参照先で必読にしない） | 822 | 1,500（contract 込みなら 1,964） |
| gate + contract + security-triggers + domain-reviewer-prompt | 2,999 | 3,000 |

旧版との比較: plan 3,545 + refs 7,821 → 1,053 + 1,799、impl 2,411 → 822、completion-audit 2,634 + subagent-review 7,079 → gate 937 + refs 920、グローバル CLAUDE.md 2,091 → 697、concise 236 → 241。
