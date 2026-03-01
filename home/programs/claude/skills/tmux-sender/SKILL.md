---
name: tmux-sender
description: Sends commands to another tmux pane and executes them. Use when asked to "run in another pane", "send to tmux", "execute in another terminal", "split pane and run", "ペインで実行して", "tmuxで送信", "別ペインで走らせて", "ターミナルでコマンド実行", "隣のペインで", "ペインを分割して実行".
allowed-tools: Bash(tmux:*)
---

# tmux Command Sender

Sends commands to another tmux pane and executes them.

## Workflow

### Step 0: Validate tmux environment

Check that `$TMUX_PANE` is set (this skill requires an active tmux session):

```bash
echo "${TMUX_PANE:-}"
```

If the output is empty, inform the user that this skill requires running inside a tmux session and stop.

### Step 1: Identify own pane

Retrieve the current session, window, and pane from `$TMUX_PANE`:

```bash
TMUX="" tmux display-message -t "$TMUX_PANE" -p "#{session_name}:#{window_index}.#{pane_index}"
```

Use the returned value as `<session>:<window>.<pane>` throughout.

### Step 2: List panes in the same window

```bash
TMUX="" tmux list-panes -t "<session>:<window>" -F "#{pane_index}: #{pane_current_command} (#{pane_current_path})"
```

Check if there are other panes besides your own.

### Step 3: Determine target pane

- **If other panes exist**: Use a pane other than your own as the target
- **If only your own pane exists**: Create a new pane

```bash
# Vertical split (new pane to the right)
TMUX="" tmux split-window -h -t "<session>:<window>.<pane>"

# Horizontal split (new pane below)
TMUX="" tmux split-window -v -t "<session>:<window>.<pane>"
```

After creating, run `list-panes` again to get the new pane's number.

### Step 4: Send the command

```bash
TMUX="" tmux send-keys -t "<session>:<window>.<target_pane>" '<command>' Enter
```

## Special Character Escaping

If the command contains single quotes, use double quotes:

```bash
TMUX="" tmux send-keys -t "<session>:<window>.<target_pane>" "echo 'hello world'" Enter
```

To interrupt a running command before sending a new one:

```bash
TMUX="" tmux send-keys -t "<session>:<window>.<target_pane>" C-c
TMUX="" tmux send-keys -t "<session>:<window>.<target_pane>" '<new-command>' Enter
```

## Notes

- Pane indices start at 1
- To send to a pane in a different window, change the window number: `<session>:<other_window>.<pane>`
- Always prefix tmux commands with `TMUX=""` to avoid nested session issues
