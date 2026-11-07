# Foreign PRs and stack fallbacks

Read by an autopilot unit whose brief names a PR on a branch the agent did not create, and by the controller when `/gh-stack` cannot build a stack. Everything else about a unit is in `~/.claude/agents/autopilot-unit.md` and `unit-brief.md`.

## A PR on a branch the agent did not create

Renovate, Dependabot, another person's: never push to that branch. Review the bot's change with `/gate --diff-only <merge base>` (`git merge-base origin/<base> HEAD` after `gh pr checkout`), since the agent has no commit of its own to start from. `/iterate-pr` reports the verdict there and stops before pushing, because the PR's author is not the user.

When the PR needs a change, commit it on the agent's own branch cut from the bot's branch, open that PR with `gh pr create --base <bot's branch>`, and run `/iterate-pr` on it; not `/auto-pr`, whose `/create-pr` always targets the default branch and rebases onto it, which would replace the bot's PR. The controller merges it only once the bot's branch is current, because a branch carrying the agent's commit is one the bot no longer rebases. When that PR gets no checks (`NO_CHECKS`, CI limited to PRs against the trunk), it merges on the gate's PASS: it lands only on the bot's branch, and the bot's PR still needs its own `ALL_PASS` on the combined change before anything reaches the trunk.

The bot rebases its own branch, so for an out-of-date bot branch wait until the bot's next run (its schedule window, when the repository sets one); if the branch has not moved by then, park the unit with the bash-policy message's other alternative, the `stop-updating` label plus a push by the user. Do not replace the bot's PR with a new one against the base: the bot's PR is where its changelog and its later updates live.

Such a PR is never put in a stack, and neither is a PR that targets such a branch, because `gh stack` pushes, syncs, and rebases every branch of the stack with force.

## Stack fallbacks

- **Stacked PRs unavailable** (`/gh-stack` exits 9): run `gh stack unstack --local`, change the ledger's PR shape to own PRs, and dispatch each dependent unit only after the unit it depends on is merged, with its branch moved onto the base by `git rebase --onto origin/<base> <parent branch>`. If that merge is not granted, the dependent unit waits behind the parked merge.
- **Parent merged before the layer exists**: `gh stack` cannot extend a fully merged stack. Start the dependent unit on the trunk instead, as a new stack when another unit will stack on it and as its own PR otherwise, and update the ledger's PR shape.
- **`NO_CHECKS` above the bottom**: a layer above the bottom whose `/iterate-pr` returns `NO_CHECKS` waits until it becomes the bottom instead of being parked, because some repositories run CI only on PRs against the trunk.
