---
name: tmux-sender
description: tmux の別ペインにコマンドを送信・実行する。「ペインで実行して」「tmuxで送信」「別ペインで走らせて」「ターミナルでコマンド実行」「隣のペインで」「ペインを分割して実行」などのリクエストで使用。
allowed-tools: Bash(tmux:*)
---

# tmux コマンド送信スキル

tmux の別ペインにコマンドを送信して実行する。

## 手順

### 1. 自分のペインを特定する

`$TMUX_PANE` から Claude Code が動作しているセッション・ウィンドウ・ペインを取得する。

```bash
tmux display-message -t "$TMUX_PANE" -p "#{session_name}:#{window_index}.#{pane_index}"
```

以降、この値を `<session>:<window>.<pane>` として使う。

### 2. 同一ウィンドウのペイン一覧を確認する

```bash
tmux list-panes -t "<session>:<window>" -F "#{pane_index}: #{pane_current_command} (#{pane_current_path})"
```

自分のペイン番号以外に送信先候補があるか確認する。

### 3. 送信先ペインを決定する

- **既存ペインがある場合**: 自分以外のペイン番号を送信先にする
- **自分しかいない場合**: 新しいペインを作成する

```bash
# 垂直分割（右に新ペイン）
tmux split-window -h -t "<session>:<window>.<pane>"

# 水平分割（下に新ペイン）
tmux split-window -v -t "<session>:<window>.<pane>"
```

作成後、再度 `list-panes` で新ペインの番号を確認する。

### 4. コマンドを送信する

```bash
tmux send-keys -t "<session>:<window>.<target_pane>" '<コマンド>' Enter
```

## 特殊文字のエスケープ

`send-keys` に渡すコマンドにシングルクォートが含まれる場合：

```bash
tmux send-keys -t "<session>:<window>.<target_pane>" "echo 'hello world'" Enter
```

実行中のコマンドを中断してから送信する場合：

```bash
tmux send-keys -t "<session>:<window>.<target_pane>" C-c
tmux send-keys -t "<session>:<window>.<target_pane>" '<新しいコマンド>' Enter
```

## 注意事項

- ペイン番号は 1 始まり
- 別ウィンドウのペインに送る場合はウィンドウ番号を変える: `<session>:<other_window>.<pane>`
