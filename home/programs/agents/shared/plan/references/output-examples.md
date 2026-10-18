# Output examples

Read before writing the `/plan` handoff or the `/impl` final report. The handoff examples show how a shape follows from the material: a change that fits in a sentence gets a sentence, parts that act on each other get a diagram. The report examples share one fixed skeleton (the result line and the four bold groups of `impl/SKILL.md`) and differ in what the material puts inside it: a diagram or none, a tree of files or one folded by directory, zero to three groups under `**あなたがすること**`. Copy neither the subjects nor the wording, and build the content again from the plan in front of you.

What stays the same across them is what approval and the gate read: the closing order of the handoff, its two heading names, the `## Plan ready` block, the report's group names, its sub-group `レビューしてほしい N か所`, `仮置き` for a provisional assumption, and its last line `Sidecar:`. The block is written with its placeholders here so that it is never taken for a real plan.

## Handoff: a small change

Two files and one behavior, so sentences carry it. No diagram, no tree, no table.

````
`greet` に `--version` フラグを足し、指定されたらバージョン文字列を出して終了するようにします。触るのは `src/cli.ts` の引数処理と、そのテスト `src/cli_test.ts` の 2 ファイルです。

## 完了の条件

- [live] `greet --version` が `greet 1.4.0` を出して exit 0 で終わる(ビルドした `dist/greet` を実行して確かめる)
- `--version` をほかの引数と一緒に渡しても、バージョンだけを出して終わる(`cli_test.ts` の新しいテスト)
- 既存のテストがすべて通る(`bun test`)

## レビューしてほしい変更

なし

上の条件が通れば、diff を読まずに受け入れられる状態です。条件を足すなら直す点を伝えてください。

`<plan path>`

## Plan ready
- File: <plan path>
- Complexity: <trivial/small/medium/large/xl>
- Tasks: <count> (+ Final Audit + Review)
- Status: PENDING APPROVAL — type `/impl` to approve and execute
````

## Handoff: a change in how parts connect

A new path between parts, so a diagram shows it. Three files fit in a sentence. The two choices that could have gone the other way sit next to what they were chosen over, and the conditions are grouped by who establishes them and how.

````
ビルドが失敗したとき、端末の通知に加えて Slack にも知らせる設定 `notify.slack` を足します。既定はオフで、オフなら今と同じ動きです。

```
build 失敗 ──▶ notifier ──┬──▶ 端末の通知(今までどおり)
                           └──▶ slack sender   notify.slack が on のときだけ
                                     │
                                     ▼
                               Webhook へ POST(URL は環境変数 NOTIFY_SLACK_URL)
```

触るのは `src/notifier.ts`(送り先の分岐)、新しい `src/slack_sender.ts`、設定の読み込み `src/config.ts` の 3 ファイルと、それぞれのテストです。

| 決めたこと | 採らなかった案 | 理由 |
|---|---|---|
| Slack への送信が失敗しても、端末の通知は出す | 失敗したら全体をエラーにする | 通知の失敗でビルドの結果を見失わない |
| Webhook の URL は環境変数から読む | 設定ファイルに書く | 設定ファイルはリポジトリに入る |
| （仮置き）通知の宛先は Slack の既定チャンネル | 設定で選べるようにする | 1 チャンネルで足りる間は設定を増やさない。`/impl` の前に覆せる |

ほかの前提 2 件は計画ファイルにあります。

## 完了の条件

**動かして確かめる**

- [live] `notify.slack` を on にしてビルドを失敗させると、テスト用の Webhook に失敗したターゲット名が届く(手元の受信サーバーのログを読む)
- [live] off のままなら、Webhook へのリクエストは 1 件も出ない(同じ受信サーバーのログ)

**自動で確かめる**

- Webhook が 500 を返しても、端末の通知は出て、終了コードはビルドの結果のまま(`notifier_test.ts`)
- 環境変数がないまま on にすると、起動時に設定エラーで止まる(`config_test.ts`)
- 既存のテストがすべて通る(`bun test`)

**あなたが確かめる**

- [live] 実際のチャンネルに通知が 1 件届き、文面が読める
    - 本物の Webhook の URL を `NOTIFY_SLACK_URL` に入れ、`build --fail-fixture` を 1 回実行して、届いた文面を知らせる。gate の前に必要

## レビューしてほしい変更

- 外部への書き込み・送信 — ビルド失敗時に Slack の Webhook へ POST する処理を足す(`src/slack_sender.ts`)

レビューしてほしい変更を確かめたうえで、上の条件が通れば、diff を読まずに受け入れられる状態です。条件を足すなら直す点を伝えてください。

`<plan path>`

## Plan ready
- File: <plan path>
- Complexity: <trivial/small/medium/large/xl>
- Tasks: <count> (+ Final Audit + Review)
- Status: PENDING APPROVAL — type `/impl` to approve and execute
````

## Final report: a small change

One behavior, two files, nothing for the reader to do. The groups are short lines, the tree has two files, and `**あなたがすること**` is `なし` on the same line. No diagram.

````
`greet --version` が動くようになった。レビュー通過、未 commit

**何が起きたか**
- `src/cli.ts` の引数処理が、ほかの引数より先に `--version` を判定する
- 前は `--version` を未知の引数として拒んだ。今は `greet 1.4.0` を出して exit 0
- コマンドの利用者は、入っているバージョンを確かめられる

**どこまで確かめたか**
- 実機: ビルドした `dist/greet` に `--version` を渡し、`greet 1.4.0` と exit 0
- 定型: 全テスト（新しいテストを含む）
- 未確認: なし

**触ったファイル**
```
src/
├── cli.ts        --version の判定
└── cli_test.ts   2 件追加
```

**あなたがすること** なし

Sidecar: ~/.claude/plans/<basename>.gate.log.md
````

## Final report: a refactor

A behavior-preserving split and rename. The structure after the change is one line, the shape before and after is two lines, the kept old name is one line, and the equivalence check is the first line of `**どこまで確かめたか**`. One decision for the reader, written as what was chosen and the words that reverse it.

````
書き出しを `writer.ts` に分け、`dump` を `export` に改名。挙動は不変。レビュー通過、未 push（`refactor/writer-module`）

**何が起きたか**
- `scan.ts` はスキャンと `Entry` 型、`writer.ts` は書き出し、`api.ts` が両方を呼ぶ
- `scan.ts` は 181 行から約 50 行。`exportOne` / `exportAll` と補助関数は `writer.ts` へ
- JSON のキー `counts.dumped` だけ旧名のまま（外から読む側がいる形）
- 利用者に見える動きは不変。次に `scan.ts` を読む人はスキャンだけ読めばよい

**どこまで確かめたか**
- 本計画: 移動前に同じ改名を当てて比べ、差分は `export` 2 つ、空行 1 つ、フィクスチャの複製 1 つ
- 定型: 型検査、lint、テスト 281 件（件数は作業前と同じ）
- 未確認: 書き出しの速さ。関数の中身が同じなので測っていない

**触ったファイル**
```
src/
├── scan.ts          書き出しを抜いてスキャンだけに
├── writer.ts        新規。exportOne / exportAll と補助関数
├── writer.test.ts   新規。書き出しのテストを移動
└── api.ts           counts.dumped への詰め替え
```

**あなたがすること**

決める 1 つ
- `counts.dumped` は旧名のまま詰め替えで残した → 読む側がいないなら「API のキーも変える」

Sidecar: ~/.claude/plans/<basename>.gate.log.md
````

## Final report: parts that act on each other

A new path between parts, so `**何が起きたか**` opens with a diagram. The tree folds the three test files into one line. All three groups appear under `**あなたがすること**`: one human-review line that also carries the security finding on the same hunk, three decisions (the finding, a 仮置き default, a file the plan did not name), and the real-channel check the reader runs.

````
ビルド失敗を Slack にも知らせる `notify.slack` が動くようになった。既定はオフ。レビュー通過、未 commit

**何が起きたか**

```
build 失敗 ──▶ notifier ──┬──▶ 端末の通知（今までどおり）
                           └──▶ slack sender ──▶ Webhook へ POST（on のときだけ）
```

- 前は失敗の通知は端末だけ。今は on にすると Slack にも 1 件届く
- 送信に失敗しても端末の通知は出る
- ビルドを回す人は離席中でも失敗に気づける。`notifier.ts` の次の読者は分岐が 1 つ増える

**どこまで確かめたか**
- 実機: 手元の受信先で、on なら失敗したターゲット名を含む本文が 1 件届き、off なら届かない
- 本計画: 受信先が 500 を返しても端末の通知が出て、終了コードはビルドの結果のまま
- 定型: 型検査と全テスト
- 未確認: 本物のチャンネルへの送信（手元に本物の URL がない）

**触ったファイル**
```
src/
├── notifier.ts        送り先の分岐
├── slack_sender.ts    新規。Webhook へ POST
├── config.ts          notify.slack と NOTIFY_SLACK_URL
├── cli.ts             --fail-fixture の終了コード（計画外）
└── *_test.ts (3)
```

**あなたがすること**

レビューしてほしい 1 か所
- `slack_sender.ts:12-40` — 外部送信。Webhook へ POST。残すと失敗ごとに送信。戻すなら分岐ごと消す。URL ログ（31 行目）は「直すべき」

決める 3 つ
- URL のログは直していない →「URL のログを消す」
- 宛先は Slack の既定チャンネル（仮置き）→「宛先を設定で選べるようにする」
- 計画外の `src/cli.ts:88` に了承を得て 1 行追加 →「この 1 行を戻す」

確かめてほしい 1 つ
- 本物の URL を `NOTIFY_SLACK_URL` に入れて `build --fail-fixture` を走らせ、届いた文面か status code を知らせる

Sidecar: ~/.claude/plans/<basename>.gate.log.md
````
