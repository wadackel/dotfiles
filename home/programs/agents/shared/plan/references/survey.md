# Survey

What `/plan` and `$plan` run before the first question about direction on small and larger work: one subagent with the brief below, then directions written from its report before the main agent reads further. Directions written after the agent's own reading anchored on what it happened to read and on experiments it had just run; the same facts handed to a fresh context produced the direction the user later had to supply.

## Brief

Fill the two placeholders and send the block as the subagent's whole prompt. It carries no direction, no option, and no guess of the agent's, so the report is not bent toward one.

```
You survey a codebase for a change someone is about to plan. Do not propose a direction, an option, or a fix: report what exists. Read-only: do not create, modify, or delete files, and run nothing that writes or reaches the network beyond reading.

Request: <the request verbatim, with the body of any issue or PR it names>
Repository: <the working directory>

Search by what the change does (its effect, its mechanism, the data it reads or writes, what a user sees), not only by the words of the request, and write down the other words you searched with. For each angle below, list what you found, each as a path and one line on what it is and how it bears on the request, and what you searched for and did not find, with the searches you ran.

1. Why the target exists: the issue, ADR, commit, or callers that explain it.
2. Things that play the same role: features, commands, or modules that already do the same or a neighbouring job, overlap with the change, could be reused, would be replaced, or would interact with it.
3. Shared mechanisms and conventions the change would have to follow: naming, placement, error handling, configuration, test layout.
4. Behavior and vocabulary a user sees today in the affected area: run it or read its output when that is cheap and safe.
5. Past decisions: ADRs, AGENTS.md or CLAUDE.md rules, and plans or PRs in flight that touch the area.
6. Counterparts elsewhere: the same concern in another tool, agent, or mirrored file.

End with the facts that most constrain the change, at most five, each with its path.
```

## Using the report

- Before reading further yourself, write from the report alone: the goal in one sentence with its source (the user's words, or the fact it was inferred from), the criteria and the axis (`interview.md`, Criteria and axis before options), the directions along the axis, and where the mechanism could live (instructions, a hook, a script, CI, a data format, a UI) with the places no direction occupies and why. That list reaches the first question as its one line on where the mechanism could live (`interview.md`, Criteria and axis before options). Then read what the first question needs.
- A found item the options touch or resemble becomes a premise line marked follow or depart (`interview.md`, Show what the options rest on), and later an entry of the plan with its path.
- A searched-but-not-found line is a fact about the search, never a question to the user: a search that found nothing does not show the thing is absent.
- A constraint only the user could know is asked only when the recommended option departs from something (`interview.md`, Show a departure as a departure), never as a general question about their premises.
