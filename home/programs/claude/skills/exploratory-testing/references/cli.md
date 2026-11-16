# Command-line products

Read during recon. Write what the sessions need into `recipe.md`; sessions do not read this file.

- Build once outside the sandbox when the build needs the user's toolchain state, and run the built binary inside it by absolute path: `explore-sandbox.ts exec <sandbox> -- /abs/path/to/bin args`.
- The exit code, stdout and stderr are the evidence. Save them per run (`exec ... > out.txt 2> err.txt; echo $? > code.txt`) in the finding's directory.
- A pipe is not a terminal. To see what the product does on a terminal, run it inside a tmux server in the sandbox, as the TUI reference describes; to see it on a pipe, pipe it.
- Signals: `exec --timeout` sends TERM to the whole group, then KILL after two seconds. For Ctrl-C behavior, start the product in tmux and send `C-c`, or send `kill -INT` to its pid.
- What the product writes through HOME and XDG lands in the sandbox's state (macOS user defaults and the keychain do not: they belong to the uid); list it after a run (`fd . <sandbox>/state -t f --changed-within 10m`) to see where it writes, and add any real-side path to the recipe for the leak check.
- A product that manages git repositories (worktrees, branches, remotes) works on a `clone` inside the sandbox, never on the real repository and never on a worktree of it: a branch made in a worktree is a branch of the real repository.
