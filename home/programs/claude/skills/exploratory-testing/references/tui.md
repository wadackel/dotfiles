# Terminal UI products

Read during recon. Write what the sessions need into `recipe.md`; sessions do not read this file.

- Run the product in a tmux server inside the sandbox: `explore-sandbox.ts exec <sandbox> -- tmux -f /dev/null new -d -s app -x 120 -y 40 '<command>'`. The sandbox's `TMUX_TMPDIR` puts the socket at `<shortDir>/tmux-<uid>/default` (`explore-sandbox.ts info` shows `shortDir`).
- Drive and read it from outside with that socket named every time: `tmux -S <socket> send-keys -t app ...`, `tmux -S <socket> capture-pane -p -t app`. A bare `tmux` reaches the user's own server; once it killed that server.
- Capture the pane after each state change into a file and compare those files. `capture-pane -p` drops colors; add `-e` when color carries meaning.
- Resize with `tmux -S <socket> resize-window -t app -x <cols> -y <rows>`; very small sizes are where TUIs crash.
- Send keys only after capturing: keys sent while the product is busy interleave with its redraw.
