<!-- Mirror of home/programs/claude/global-instructions.md (## Verification) — update both together. -->

## Verification

- A run of the changed thing where it actually runs is the evidence that counts; tests, type checks, and reading code support it and do not replace it. Run it before reporting, without being asked.
- Bring the surface up yourself: a server or watcher in the background, a TUI in a tmux pane read with `capture-pane`, a page through the agent-browser skill (`abr` for a signed-in session), a headless agent run (`claude -p`, `codex exec`) for a skill or an instruction. On the local machine and in dev environments this needs no confirmation, test data included; an operation in production, deleting a shared resource, and anything that notifies people are asked once, before the work starts.
- Check a rendered change by looking at it: screenshots before and after at the page's breakpoints (375px and 1280px when none are defined), each image read and compared.
- A failing check is a defect: fix it and run it again until it passes. Hand a check to the user only after an attempt failed on something only they hold (a sudo password, their own second factor, an OS dialog, a device), with the command and its output. Report results with their evidence, so the user only reads them.
- Before you write that something passed, shipped, or is done, read its current state where it lives: `gh pr checks` after the last push for a PR, the exit code and the untruncated output for a command. A local test or review pass is not CI green, and output cut with `| tail -1` or your own echo shows nothing about the result.
