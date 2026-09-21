# Agentower bench baseline

`agentower-bench.ts` の実測値。絶対値はマシンの状態で動くので、**改善前後の比**で読む。

- 測定日: 2026-09-21
- マシン: wadackels-MacBook-Air (Darwin 25.6.0, arm64)
- `deno --version`: 2.9.5
- repeats: 5（phase 系は中央値）

```
agentower-bench.ts \
  --after  ~/.local/share/agentower/agentower \
  --before <base commit 85a700b の agentower.tsx を、同じ trace マーク入りで deno compile したもの> \
  --pretty
```

`before` は base commit の実装を当時の build（`deno compile` 直行）で作り、位相が測れるよう
`trace.ts` のマークだけを足したもの。`after` は activation が作った出荷物そのもの
（`deno bundle` → `bundle-postprocess.ts` → `deno compile --no-check`）。

## 起動フェーズ

| 指標 | before | after | 変化 |
|---|---|---|---|
| `raw_on_ms` | なし（ink の mount 時、初回 commit と同時） | 21 | 入力の死に窓が 178ms → 21ms |
| `module_eval_ms` | 99 | 77 | −22ms（bundle 化） |
| `io_done_ms` | 120 | 98 | −22ms |
| `first_commit_ms` | 178 | 144 | −34ms |

`first_commit_ms` は `initialTaskProgress` の逐次読み（実測 6 ペインで 0.1〜0.3ms）を含んだうえで
短くなっている。

## 入力

| 指標 | before | after |
|---|---|---|
| `pre_frame_key.moves` | 0 | 1 |
| `pre_frame_key.latency_ms` | null（届かない） | 4 |
| `burst_jjj_moves` | 0 | 3 |
| `arrow_twice_moves` | 1 | 2 |
| `wheel_thrice_moves` | 1 | 3 |
| `ctrl_c_during_load_exits` | true | true |

`pre_frame_key` は、プロセスが exec される前にペインの tty へ届いたキーの扱い。`latency_ms` は
初回 commit から `useInput` に届くまでの時間で、before は次のキーを押すまで届かないので null。

`ctrl_c_during_load_exits` は両方 true で、判別力のない回帰ガード。cbreak が守るのは
「`main()` が ink の mount 前に固まった場合」で、それは外から再現できない。

## exec コスト

| 指標 | before | after |
|---|---|---|
| `fresh_first_exec_s` | 1.469 | 1.371 |
| `fresh_after_warmup_s` | 0.108 | 0.085 |

新規に書かれた Mach-O の初回 exec に macOS が課すコスト。activation が `mv` 直後に 1 回
空打ちするので、`darwin-rebuild` 直後の `prefix+w` はこの 1.3 秒を払わない。その空打ちの
終了コード（2 = `main()` の TMUX ガード）は、出荷バイナリが起動すること自体の唯一の検査でもある。

## 測れなかったもの

`commits_per_tick` は before / after とも 2 で、tick の 3 commit → 2 commit は
サンドボックスでは示せない。`setTaskProgressMap` と `setUsages` がここでは同じマクロタスクで
解決するため、改善前でも React が偶発的にバッチする。3 回になるのは実 tmux のように
タスクディレクトリと usage ファイルの I/O が遅い環境だけ。変更後は 2 つの set を 1 つの同期ブロックにまとめてあるので、偶発ではなく確実に 1 commit になる。

この節は下の「ランタイム」で訂正している: `commits_per_tick` は App の commit しか数えず、
`Preview` だけが起こしたフレームを見落とす。実フレーム数は `frames_per_tick` で測る。

なお「壊れた usage ファイルがタスク進捗を道連れにしない」ことは、`readAgentUsage`
（`home/programs/tmux/shared/agent-usage.ts`）が元から全例外を握って `null` を返す設計なので
この変更の前後で変わらない。S55 が固定しているのは「壊れた usage ファイルがあっても一覧と
進捗が出る」ことであって、追加した `.catch` の効果ではない。

---

# ランタイム（2026-09-21、2 回目）

tick とフレームの計測を足し（`render-us` / `tick-us`、`frames_per_tick` / `render_us_p50` /
`tick_us_p50`）、それを使って 3 つの変更を 1 つずつ入れた。各行は**その変更だけを切り出した**
比較で、同一セッション内の 3 回の実行を並べてある。

| 変更 | 指標 | 変更前 → 変更後（3 回） |
|---|---|---|
| `git symbolic-ref` の spawn を `$GIT_DIR/HEAD` の読み取りに置換 | `tick_us_p50` | 59.5 → 42.5ms（1 回、非バンドル同士） |
| `deno bundle --minify`（production React） | `module_eval_ms` | 96→62 / 83→64 / 76→67 |
| 〃 | `first_commit_ms` | 182→112 / 149→114 / 140→125 |
| tick の 3 つの set を 1 commit に | `frames_per_tick` | 4→3 / 4→3 / 4→3 |
| 〃 | `tick_us_p50` | 31.9→18.7 / 37.5→22.5 / 32.3→19.6ms |

前回の出荷物との比較（3 回の中央値。前回のバイナリは `render-us` / `tick-us` を出さないので
tick 系は今回分のみ）:

| 指標 | 前回 | 今回 |
|---|---|---|
| `module_eval_ms` | 73 | 64 |
| `io_done_ms` | 91 | 78 |
| `first_commit_ms` | 136 | 113 |
| `commits_per_tick` | 2 | 1 |
| `frames_per_tick` | — | 3 |
| `tick_us_p50` | — | 25.2ms |
| `pre_frame_key.latency_ms` | 4 / 4 / 4 | 5 / 5 / 5 |
| `burst_jjj_moves` | 3 / 3 / 3 | 3 / 3 / 3 |

`render_us_p50` は minify でも tick の畳み込みでも動かない。production React が効くのは
React の reconciliation で、`render-us` が測る ink の出力構築（ツリー全走査と `cols × rows`
のセル生成）ではない。

## フレーム単価と preview の寄与

サンドボックスのペインは寝ているスタブで preview がほぼ空なので、フレーム単価は実セッションで
測った。200×50 の同じジオメトリのまま、ホストの実エージェントペイン 5 枚を順に選択して 3 周し、
選択ごとに書かれた `render-us` を振り分けた（preview は 4.9〜11.3KB、SGR を含む行 24〜53）。

```
frames=83  p10=4.3ms  p50=6.7ms  p90=11.0ms  max=23.6ms
```

**preview の内容はフレーム単価を決めていない。** 同じペインが周回ごとに 2〜3 倍ぶれ
（例: `Main` 5.9 → 13.5 → 5.2ms）、ペイン間の順位は毎回入れ替わる。preview 本文が最大の
ペイン（11.3KB）が最安だった周もある。Agentower は capture を preview 列の幅と高さに切り詰めて
から描くので、元の大きさはフレームに届かない。ぶれの主因は GC・JIT とホスト上の他セッション。

この結果、`string-width` を自前の幅関数に差し替えてもフレーム単価の改善はノイズに埋もれる。
残る利得は起動時のモジュール評価だけで、それには ANSI 除去・絵文字・ZWJ・結合文字を扱う
幅モデルの新規実装と、今は 1 本も無い絵文字・CJK・preview 本文の e2e が要る。
