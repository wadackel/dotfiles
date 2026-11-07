# Unit brief

The controller fills the template below for one unit and dispatches it as the prompt of an `Agent` call with `subagent_type: "autopilot-unit"` (Opus with a one-hour cache, so the waits on reviewers, CI, and approval do not rewrite its context; pass no `model`, which would override the definition), `isolation: "worktree"`, and `run_in_background: true`, and no `name`: in an interactive session a named agent becomes a teammate, and the reviewers its `/gate` dispatches then hand back to the controller instead of to the unit. Later messages go to the agent id the dispatch returns. The protocol every unit follows (the phases, the messages the controller sends, the park rule, the report form) is the body of `~/.claude/agents/autopilot-unit.md`, which the unit loads as its system prompt; the template carries only this unit's fields. Paste the `## Template` block verbatim with the placeholders filled; add nothing else but the line the Resuming section of `SKILL.md` names, and never paste earlier units' reports or the conversation's history: the unit reads what it needs from the files the brief names.

## Template

```
You are unit <n> of an autopilot run.

Goal of the run: <goal in one line>
This unit: <what it delivers, and the done criterion it serves>
Depends on: <unit numbers with their merged PR or branch, or none>
Start: <base branch and sha; for a stack layer, the parent layer's branch>
Lane: <k>
Setup: you run in a fresh worktree with nothing installed; first run <the repository's dependency install command, or "nothing to install">, then <a command that points this worktree's build output at lane k's cache, which units of lane k reuse one after another (for Cargo, only when `git check-ignore -q target` succeeds, so the link stays out of commits and `git worktree remove`: mkdir -p ~/.cache/autopilot/<repo>/lane-<k>/target && ln -s ~/.cache/autopilot/<repo>/lane-<k>/target target), or "no build cache">
Ledger (read only, never edit; read it only for the units you depend on): <ledger path>
<only for a PR on a branch the agent did not create: Foreign PR: <url>; read ~/.claude/skills/autopilot/references/foreign-prs.md first>

Delivery:
- Level: <pr | stack>
- Draft: no
- Merge: no
- Via: <the repository's PR skill, /create-pr, or /gh-stack>
- Basis: autopilot contract

Verification Grants:
<one line each, or - None>
```

## Reading a report

A report missing a label of the `## Report` form in `~/.claude/agents/autopilot-unit.md`, or claiming `DONE` without a PR, without an `ALL_PASS head`, or without `Gate: PASS`, is a gap, not a pass. Ask the unit once with SendMessage for the missing lines; a second miss parks the unit with what is missing.
