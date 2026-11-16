# Web products

Read during recon. Write what the sessions need into `recipe.md`; sessions do not read this file.

- Use the **agent-browser** skill and load its core skill first. Give each charter its own browser with `--session "claude-$PPID-explore-<id>"` instead of the shared `claude-$PPID`, so one charter's cookies and storage do not leak into the next, and `close` it when the charter ends. When the product needs the user's login, do not pass `~/.agent-browser-state/main.json` itself, which holds every site the user is logged in to: write a copy holding only the product's cookies and origins into the evidence directory and pass that as `--state`.
- Start the server inside the sandbox from a clone of the product (`explore-sandbox.ts clone`, then `explore-sandbox.ts exec <sandbox> --timeout <long> --cwd <clone> -- <start command>` in a background Bash call) and point the browser at it. The browser runs outside the sandbox.
- `AGENT_BROWSER_DEFAULT_TIMEOUT` (milliseconds, 25000 by default) bounds every wait; set it in the recipe's commands.
- Wait on conditions (`wait --text`, `--url`, `--fn`, a selector) rather than milliseconds; rendering delay and asynchronous updates are the most common source of false reports from agents.
- Operate from `snapshot -i` and read text from it. A snapshot has no layout, so overlap, clipping and broken alignment only show in a screenshot.
- `screenshot <path>` writes a file and puts nothing in context. `record start <path.webm>` / `record stop` keeps the page's localStorage on 0.38.1 (checked once); an older ban on recording in this environment came from 0.31, where it cleared localStorage.
- `mouse wheel` sends the event at (0, 0) whatever coordinates it is given; scroll a specific element with CDP's `Input.dispatchMouseEvent` instead.
- Read `console` and `network requests` with a filter for what the charter is about; unfiltered output is long.
