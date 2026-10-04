# Output examples

Read before writing the `/plan` handoff or the `/impl` final report. The examples show how a shape follows from the material; none of them is a template. They differ from each other because their material differs: a change that fits in a sentence gets a sentence, parts that act on each other get a diagram, a change spread over many files gets a tree. Copy neither the subjects nor the wording, and build the shape again from the plan in front of you.

What stays the same across them is what approval and the gate read: the closing order of the handoff, the heading names, the `## Plan ready` block, and the `Sidecar:` line. The block is written with its placeholders here so that it is never taken for a real plan.

## Handoff: a small change

Two files and one behavior, so sentences carry it. No diagram, no tree, no table.

````
`greet` に `--version` フラグを足し、指定されたらバージョン文字列を出して終了するようにします。触るのは `src/cli.ts` の引数処理と、そのテスト `src/cli_test.ts` の 2 ファイルです。

## 完了の条件

- [live] `greet --version` が `greet 1.4.0` を出して exit 0 で終わる(ビルドした `dist/greet` を実行して確かめる)
- `--version` をほかの引数と一緒に渡しても、バージョンだけを出して終わる(`cli_test.ts` の新しいテスト)
- 既存のテストがすべて通る(`deno test`)

## 人が読む変更

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

ほかの前提 2 件は計画ファイルにあります。

## 完了の条件

**動かして確かめる**

- [live] `notify.slack` を on にしてビルドを失敗させると、テスト用の Webhook に失敗したターゲット名が届く(手元の受信サーバーのログを読む)
- [live] off のままなら、Webhook へのリクエストは 1 件も出ない(同じ受信サーバーのログ)

**自動で確かめる**

- Webhook が 500 を返しても、端末の通知は出て、終了コードはビルドの結果のまま(`notifier_test.ts`)
- 環境変数がないまま on にすると、起動時に設定エラーで止まる(`config_test.ts`)
- 既存のテストがすべて通る(`deno test`)

**あなたが確かめる**

- [live] 実際のチャンネルに通知が 1 件届き、文面が読める
    - 本物の Webhook の URL を `NOTIFY_SLACK_URL` に入れ、`build --fail-fixture` を 1 回実行して、届いた文面を知らせる。gate の前に必要

## 人が読む変更

- 外部への書き込み・送信 — ビルド失敗時に Slack の Webhook へ POST する処理を足す(`src/slack_sender.ts`)

人が読む変更を確かめたうえで、上の条件が通れば、diff を読まずに受け入れられる状態です。条件を足すなら直す点を伝えてください。

`<plan path>`

## Plan ready
- File: <plan path>
- Complexity: <trivial/small/medium/large/xl>
- Tasks: <count> (+ Final Audit + Review)
- Status: PENDING APPROVAL — type `/impl` to approve and execute
````

## Final report: a small change

One behavior and two checks, so two sentences and two lines carry it. No table, no tree.

````
`greet --version` が動くようになりました。gate は PASS で、変更は未 commit です。`dist/greet --version` で確かめられます。

## 変わったこと

`--version` を渡すと `greet 1.4.0` を出して終了します。ほかの引数と一緒に渡した場合も、バージョンだけを出します。

## 確かめたこと

- `dist/greet --version` が `greet 1.4.0` を出して exit 0 で終わる(ビルドして実行した)
- 新しいテスト 2 件を含む全テストが通る(`deno test`)

## 決めてほしいこと

なし

Sidecar: ~/.claude/plans/<basename>.gate.log.md
````

## Final report: a change across many files

The behavior changed in three respects, so before and after sit side by side. Eight files moved, one of them outside the plan, so a tree shows where. The checks that ran the real binary each keep their line; the routine ones share one.

````
設定の読み込みを `src/config/` に集めるところまで到達し、gate は PASS で、変更は未 commit です。`build --print-config` で、読み込まれた設定と出どころを確かめられます。

## 変わったこと

| 観点 | 前 | 後 |
|---|---|---|
| 設定を読む場所 | 各コマンドが環境変数と設定ファイルを自分で読む | `loadConfig()` が 1 回読み、各コマンドは結果を受け取る |
| 優先順位 | コマンドごとに違った | 引数、環境変数、設定ファイル、既定値の順で共通 |
| 不正な値 | 使う時点で落ちる | 起動時に、キーと出どころを示して止まる |

```
src/
├── config/
│   ├── load.ts            + 読み込みと優先順位
│   ├── schema.ts          + キーと型、既定値
│   └── load_test.ts       + 優先順位と不正値のテスト
├── commands/
│   ├── build.ts           ~ 自前の読み込みを削り、設定を受け取る
│   ├── watch.ts           ~ 同上
│   └── clean.ts           ~ 同上
├── cli.ts                 ~ 起動時に loadConfig() を呼ぶ。--print-config を追加
└── notifier.ts            ~ 計画外。環境変数を直接読んでいたので同じ形に直した
```

## 確かめたこと

- `build --print-config` が、引数・環境変数・設定ファイルの 3 か所に同じキーを置いたとき、引数の値と出どころを表示する(ビルドした `dist/build` で実行した)
- 設定ファイルに不正な値を入れると、起動時にキー名とファイルの行を示して exit 2 で止まる(同じバイナリ)
- `watch` と `clean` が、変更前と同じ設定で同じ出力を返す(変更前に採った出力と `diff` で比べた)
- 型検査、lint、全テスト 214 件が通る(`deno check`、`deno lint`、`deno test`)

確かめていないこと: Windows のパス区切りでの設定ファイルの探索。

## 決めてほしいこと

1. 計画になかった `src/notifier.ts` を同じ形に直した(`src/notifier.ts:18`)
    - 戻すなら、この 1 ファイルの変更だけを revert する。戻すと、通知だけが古い優先順位で環境変数を読む
2. レビューが、設定ファイルが 2 つ見つかったときに警告を出さない点を SHOULD_FIX にした(`src/config/load.ts:52`)
    - 残す限り、近いほうのファイルが黙って使われる。計画の範囲外なので触っていない
3. CI での確認は次の main への push で
    - Observe: CI の build ジョブが、設定エラーなしで通る
    - Your steps: push の後に CI の結果を見て、落ちていたらログの最初のエラーを知らせる

Sidecar: ~/.claude/plans/<basename>.gate.log.md
````
