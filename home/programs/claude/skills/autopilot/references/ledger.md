# Ledger format

One Markdown file per run at `~/.claude/plans/YYYYMMDDTHHmm-<slug>.autopilot.md`, prose in the user's language, headings as below. It is the run's state: after compaction it is read before the conversation summary is trusted. Edit it with the Edit tool or by rewriting it whole.

```markdown
# Autopilot: <goal in one line>

Status: running | finished | parked
Goal: <the goal text as the user wrote it>

## Contract

### Done criteria
- <observable fact> — evidence: <PR, command, URL, or "pending">

### Allowed side effects
- <side effect> — granted by: <goal text | answer on YYYY-MM-DD>
- <side effect> — not granted: <the step that needs it is parked>

### PR shape
- <unit #s> — stack on <unit #> | own PR — why: <the dependency, or the goal or repository asking for stacks>

### Parallel groups
- <unit #s run at once> — why disjoint: <files and resources> (or "none: sequential")

## Units

| # | Unit | Branch | Start sha | Plan | Verdict | PR / commit | Verified by | State |
|---|------|--------|-----------|------|---------|-------------|-------------|-------|
| 1 | <unit> | <branch> | <sha> | <plan path or "trivial"> | APPROVE (round 2) | <url or sha> | <how> | done / in progress / parked / todo |

## Parked

1. <question the user can answer in one line>
    - Why the user: <irreversible, drops what the goal asked, a contract term, an ungranted side effect, or a person's observation>
    - Recommendation: <option> — <why>
    - On each answer: <what proceeds>

## Decisions

- <unit #>: <what was chosen> over <the alternative> — reverse with: <the words the user would say>

## Advisor log

- <unit #>: <what was asked> → <verdict or advice> → <followed | overridden: reason>
```

`Status` stays `running` while any work remains, so a resumed session finds the run. When the run ends it becomes `finished` if nothing is parked and every done criterion has evidence, and `parked` otherwise; a parked run goes back to `running` when the user answers. The advisor log keeps only the line per consultation; the full exchange stays in the conversation.
