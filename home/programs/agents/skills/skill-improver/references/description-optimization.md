# Description Optimization

Step 2.5 measures whether a skill's `description` actually fires. A description
is the only part of a skill that runs before the skill is chosen, so it cannot
be reviewed by reading — the competitors it loses to are invisible from inside
the file.

## Procedure

Run from the project root when the target is a project skill: `claude -p` only
sees `.claude/skills/` from there. A personal skill can be measured from
anywhere.

```bash
~/.claude/skills/skill-improver/scripts/measure-trigger.ts \
  --skill=<name> --eval=<eval.json> --runs=3
```

The script writes the eval set's queries through `claude -p`, reads the first
tool call of each run, and counts a fire when that call is `Skill` with the
target's name. It restores the frontmatter afterwards; a leftover
`SKILL.md.measure-trigger.bak` means a previous run died and must be restored by
hand before measuring again.

**Baseline first.** Measure the current description. If every query lands on
its expected side more often than not — the same majority rule the exit code
uses — the description is fine, so stop. Build candidates only for the queries
that failed. The one skill measured so far needed six versions, and that was
because its baseline had a real defect; a healthy skill costs one run.

To compare a candidate, put the replacement text in a file and pass
`--description=<file>`. It is swapped into the real `SKILL.md` for the duration
of the run.

Each query is capped at one turn and cut off at its first tool call, so a query
costs a few seconds rather than a full session. That is a constraint, not a
guarantee: the kill races the tool call it just read, so a query whose first
call is `Bash` can still start one command, and a command that spawns children
of its own outlives the interrupt.

**That one command is not confined to the working directory.** The child is an
ordinary `claude` session and inherits your `permissions.allow` and default
permission mode, so an allow-listed command runs with no approval — including
ones that reach the network or remote state. The exposure scales with
`runs × queries`, so an 18-query set at `--runs=3` is up to 54 first calls.
Choosing a harmless directory bounds the file-system half of that and nothing
else.

Denying the tool outright does not fix it. Passing `--settings` with `Bash` in
`permissions.deny` removes Bash from the tool list, and the model then picks a
different first tool — measured once, a query whose first call was `Bash` moved
to `Grep`, which changes the very distribution the measurement reads. A
pattern-scoped deny such as `Bash(*)` leaves the tool listed, but whether it
preserves the choice distribution has not been measured, and this query class
varies enough run to run that settling it needs a proper comparison.

`--concurrency=10` is the default and measured identical to serial: the same
18-query set returned 7/9 and 0/9 either way, in 22 s against 160 s.

## Designing the eval set

The file is `[{"query": "...", "should_trigger": true}, ...]`. Ten of each is a
reasonable size; start smaller and grow only where versions are close.

**Do not make verbatim trigger phrases the majority.** A description that stops
firing once its own phrases are deleted has memorized vocabulary, not intent.
Paraphrase most queries and keep two or three verbatim ones as canaries.

**Do not put another skill's phrases in bare.** Where two skills own the same
words, no description resolves it — the query only measures which one the model
happened to pick. Write the query so the intent is unambiguous instead.

**Aim at the neighbours.** The should-not-trigger half is worth writing only if
it contains the nearest plausible confusions, not obviously unrelated work.

## Reading the results

Compare raw fire counts, not the exit code. A query counts as passing when it
lands on the expected side more often than not, so at three runs a description
firing about 60% of the time passes roughly two thirds of the time and a
one-query difference disappears into run-to-run noise.

An even split at an even `--runs` counts against a should-trigger query and for
a should-not-trigger one, so a tie never reads as evidence that the skill fires.

**Treat a difference under a tenth of the total runs as a tie, and take the
shorter description.** Re-measure only the borderline queries, with `--runs=5`.

Allow one revision. From the second onwards you are fitting the eval set.

## What the first measured skill showed

These came out of 162 measurements across six versions of one description
(605 characters down to 182). They are worth re-testing, not assuming, but they
are the reason this step exists.

**The scope sentence did nothing.** The description carried a closing sentence
naming what the skill does not cover. Across every version — with the sentence,
without it — no should-not-trigger query ever fired. Boundary prose defends
against a failure that did not occur; delete it and measure rather than keeping
it out of caution.

**One proper noun carried a query.** Removing the word for the tenant concept
dropped its query from 4/5 fires to 1/5, and restoring it brought it back. Nouns
specific to the domain earn their characters; restatements of the same intent do
not.

**Some failures are not the description's.** Two queries never fired in any
version because the model ran `Bash` before choosing a skill. No phrasing
reaches a decision that is made before the description is read. The per-query
`[first: ...]` column names the tool that won; when it is not `Skill`, stop
editing the description and either accept the query or drop it from the set.

## When every query returns zero

Suspect the environment before the description. A uniform zero is what an
expired login, a rate limit, an incompatible `claude` flag, or nested-session
detection looks like; the script reports how many attempts returned no tool
call and prints the child's last stderr lines. After
that, suspect the transcript format — the script reads `tool_use` blocks out of
`assistant` events and `content_block_start` events, and matches the skill name
exactly, so a namespaced name (`plugin:name`) or a changed event shape also
reads as a uniform zero. No description defect produces one.
