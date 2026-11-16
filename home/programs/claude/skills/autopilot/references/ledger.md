# Ledger format

One Markdown file per run at `~/.claude/plans/YYYYMMDDTHHmm-<slug>.autopilot.md`, prose in the user's language, headings as below. It is the run's state: after compaction it is read before the conversation summary is trusted. Edit it with the Edit tool or by rewriting it whole.

```markdown
# Autopilot: <goal in one line>

Status: running | finished | parked
Goal: <the goal text as the user wrote it>
Advisor: <agent id>

## Contract

### Done criteria
- <observable fact, in the goal's words> — evidence: <PR, command, URL, or "pending">
    - user, YYYY-MM-DD: 「<the user's message that relaxes it, quoted>」

### Allowed side effects
- <side effect> — granted by: <goal text | answer on YYYY-MM-DD>
- <side effect> — not granted: <the step that needs it is parked>

### PR shape
- <unit #s> — stack on <unit #> | own PR — why: <the dependency, or the goal or repository asking for stacks>

### Parallel lanes
- <unit #s that may run at once> — why disjoint: <files and resources>; cap: <3, or the count the goal gave>

## Units

| # | Unit | Agent | Branch | Start sha | Do file | Review | Check | PR | ALL_PASS head | Verified by | State |
|---|------|-------|--------|-----------|---------|--------|-------|----|---------------|-------------|-------|
| 1 | <unit> | <agent id> | <branch> | <sha> | <do file path> | PASS at <Review head> | CLEAR (check 2) | <url> | <sha from the unit's report, checked with gh pr view> | <how> | done / in progress / parked / todo |

## Run rules

- <unit # that found it>: <a fact every unit must follow> — source: <file:line, command, or the parked item it answers for now>

## Parked

1. <question the user can answer in one line>
    - Why the user: <cannot be undone, an ungranted side effect, a classifier denial, the advisor's PARK, or a person's observation>
    - Recommendation: <option> — <why>
    - On each answer: <what proceeds>

## Review hunks

- <unit #> <PR>: <the hunk line as the unit reported it> — <merged, to read afterwards | parked>

## Decisions

- <unit #>: <(goal) when it loosens, replaces, or leaves undone what the goal asked> <what was chosen> over <the alternative> (<unit | advisor | user>) — reverse with: <the words the user would say>

## Notes

- <unit #>: <a closing-check finding left after the second check, a worktree that could not be removed, or something found outside the units>

## Advisor log

- <unit #>: <what was asked> → <verdict or advice> → <followed | overridden: reason>
```

`Status` stays `running` while any work remains, so a resumed session finds the run. When the run ends it becomes `finished` if nothing is parked and every done criterion has evidence, and `parked` otherwise; a parked run goes back to `running` when the user answers. Only the controller writes this file; units read its Run rules before their review and their report, and the rows of the units they depend on. A done criterion's words never change after the contract: only its evidence and the user's quoted answers under it do. Decisions come from each unit's report, which carries each advisor `ANSWER`. The advisor log keeps only the line per consultation; the full exchange stays in the conversation.
