# Output examples

Read before writing the `/plan` handoff or the `/impl` final report. The handoff examples show how a shape follows from the material: a change that fits in a sentence gets a sentence, parts that act on each other get a diagram. The report example shows the fixed headings and their order from `impl/SKILL.md`; a report keeps only the sections that have content, and what goes in each comes from the request in front of you. Copy neither the subjects nor the wording, and build the content again from the plan.

What stays the same is what approval and the review read: the closing order of the handoff, its two heading names, the `## Plan ready` block, the report's headings and their order, the marks in its tree, `レビューしてほしい N か所`, and `仮置き` for a provisional assumption. The block is written with its placeholders here so that it is never taken for a real plan.

## Handoff: a small change

Two files and one behavior, so sentences carry it. No diagram, no tree, no table.

````
`greet` に `--version` フラグを足し、指定されたらバージョン文字列を出して終了するようにします。触るのは `src/cli.ts` の引数処理と、そのテスト `src/cli_test.ts` の 2 ファイルです。出荷は手がかりがないので commit しないまま終えます（仮置き。`/impl PR まで` で PR も出します）。

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
| 出荷: draft PR を 1 本、CI 通過まで。merge しない | commit で止める | 依頼文の「PR まで出して」。`/impl merge まで` で merge も行う |

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
    - 本物の Webhook の URL を `NOTIFY_SLACK_URL` に入れ、`build --fail-fixture` を 1 回実行して、届いた文面を知らせる。レビューの前に必要

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

## Final report

A change a user can see, one hunk the reader must read, one thing not established, and two decisions. The opening answers the request and the concern raised while planning, and says that something was not established. The tree carries the marks, so the reader sees where to look without reading code. The first decision is asked as a question; the second waits for the next turn.

````
#157479 の「共有設定の未指定」を「共有しない」に揃えた。依頼どおりで、
気にしていた service.ts の既存の記述は残した。確かめていないことが 1 つある。
draft PR #160301、CI 通過

**使う人から見て変わること**
- 共有ダイアログで未指定のまま保存すると、これまではエラー → 今は「共有しない」で保存
- API の sharing は null を返さなくなる。呼び出し側 3 か所は対応済み

**変更したファイル**
```
backend/
├── sharing/
│   ├── normalize.ts        未指定を「共有しない」に変換
│   └── normalize_test.ts   変換のテスト
└── migrations/
    └── 0042_sharing.sql    既存の null を書き換え ← レビューしてほしい
frontend/share/Dialog.tsx   保存時のエラー表示を削除（削除あり）
```

レビューしてほしい 1 か所
- `migrations/0042_sharing.sql` — 取り消せない操作。既存の null を「共有しない」に書き換える。残すと元の未指定は区別できない。戻すなら down migration で null に戻す

**確かめたこと**
- dev のブラウザで、未指定のまま保存して一覧に「共有しない」と出た（375px / 1280px）
- 型検査、lint、全テスト

**確かめていないこと**
- 本番の既存データに null が何件あるか
  - なぜ: 本番の DB を読む権限がこのセッションに無い
  - 外れていたら: 件数が多いと、migration の実行に時間がかかる
  - 確かめ方: 本番の読み取りを許可してもらえれば、件数を数えて報告できる

**次に進められること**
- #157479 は、この PR の merge で close できる（受け入れ条件 3 つすべて満たした）
- 次に着手できる: #157480（この PR に依存しない）

**あなたに決めてほしいこと**（2 つ。1 つずつ聞きます）

### 既存の null を、一括で「共有しない」に書き換えますか

<判断材料・前提・選択肢・推奨。`interview.md` の形式>
````
