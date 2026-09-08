# Implementation readiness (detail level `implementation` only)

An `implementation`-level deliverable promises that an engineer can implement it without further questions. Interviewing the user closes intent gaps; it does not close the gaps between the draft's claims about code and what the code actually does. Those gaps surface only when someone reads the draft as an implementer, so this reference adds that reading as a step.

The failure classes below were all observed in real deliverables. Each check exists because its absence produced a MUST_FIX after the draft was "done".

## Part 1 — Surface inventory (before drafting)

Phase 1 research describes how the system works today. A draft that proposes changes needs a second kind of research: everything the change touches. Build this inventory before writing the draft, using Explore agents, `rg`, or LSP `findReferences`.

| Inventory | Question to answer | Typical miss |
|---|---|---|
| Call sites | For every function, type, or signature the draft changes: who calls it? Include tests and secondary CLI commands | A subcommand or test helper that calls the changed function was never listed, so the implementer discovers it at compile time |
| Entry points and modes | For code the draft moves or reorders: which CLI flags, subcommands, dry-run / deferred / offline modes traverse it? | A `--dry-run` or `--rev` override that now runs a network call or aborts where it used to be a no-op |
| Existing statements of current behavior | Which README sections, doc tables, ADR clauses, docstrings, and skill files assert the behavior being changed? | A doc table row that now contradicts the new section |
| Fixtures and golden values | Which test fixtures stop parsing or stop matching once the schema or output changes? | A required field added to a config makes every existing fixture invalid |
| Type shapes on the data path | For every value the draft says is "available" at some point: what does the type actually carry there? | The draft assumes a parsed structure is reachable in an error state whose type carries only a string |

Record the inventory in the deliverable (usually under an implementation-notes section). Listing the files is the point — the implementer should not have to rediscover them.

For a deliverable that changes nothing (a premise correction that closes with an Open question), the inventory shrinks to the docs, consumers, and entry points a follow-up would touch; list those under the follow-up's scope and skip the rest.

## Part 2 — Drafting rules

**Do not assert a mechanism at finer granularity than what was read.** "The same mechanism applies" or "X already prints Y" is a claim about specific code. Before writing it, read that code. If the research was an overview, either read the specific path or phrase the claim as something to verify — never as a fact.

**Verify every `file:line` at draft time.** Line numbers drift; a wrong reference costs the implementer more than no reference. Prefer `file:function` when the function name is stable.

**No undecided alternatives in the body.** A sentence of the form "do A, or alternatively B" is not a specification. Decide (and say why), or move it to Open questions with who decides and when. Design-doc review practice treats undecided items as first-class content precisely because they hide rework.

**Every acceptance criterion names its observation.** "Behaves as before" and "byte-identical output" are not observable unless the draft says by which test, fixture, or command. If a criterion cannot be observed with the code as written, the draft must also ask for the refactor that makes it observable (e.g., extract the step into a unit-testable function) and list that refactor as work.

**State the failure path for every new precondition.** When the draft adds a check (existence, validation, network resolution), say what happens on failure in each entry point that reaches it, not only the primary one.

## Part 3 — Implementer review (after drafting)

Dispatch one fresh-context, read-only agent (the `Plan` type is suitable) with the draft path and the prompt below. Fresh context matters: the author of the draft shares the interview's assumptions and reads past its own gaps.

Do not run this review for `decision` or `stakeholder` deliverables — their reader is not an implementer.

### Prompt template

Fill the bracketed fields. Keep the numbered checks; add repo-specific ones when the inventory suggests them.

```text
Repository: [absolute path]. Read the deliverable draft at [draft path].
It specifies: [one-sentence summary].

Act as the engineer who will implement this from the draft alone. Report
every place where you would have to stop and ask a question, or where the
draft contradicts the code. Verify against the actual code. Do not propose
a redesign; only find ambiguities, contradictions, missing decisions, and
wrong references.

Check specifically:
1. Every file:line or file:function reference — accurate?
2. Every claim of the form "X already does Y" or "the same mechanism
   applies" — true at the granularity the draft relies on?
3. Every function whose signature changes — are all callers listed,
   including tests and secondary commands?
4. Every relocated or reordered step — which CLI flags, modes, or early
   returns now traverse it, and does the draft say what happens there?
5. Every type the draft treats as carrying data — does it carry that data
   in the state the draft assumes (error variants, Option fields)?
6. Every sentence offering two alternatives — flag as undecided.
7. Every acceptance criterion — observable by a test or command as the
   code is written? If not, does the draft ask for the refactor?
8. Every doc, README table row, ADR clause, or docstring that states the
   current behavior — listed for update?

Output a numbered list. Each finding: severity (MUST_FIX = implementer
would be blocked or would build the wrong thing; SHOULD_FIX = ambiguity
likely to cause rework; NIT), the draft sentence it concerns (brief
quote), the code evidence (file:line), and a one-line resolution.
No general praise.
```

### Handling the findings

1. Fix every MUST_FIX and SHOULD_FIX in the draft. A SHOULD_FIX may instead become an Assumption only when the reviewer's evidence shows the default is safe; cite that evidence in the Assumptions table.
2. Re-dispatch once more if any MUST_FIX was found. Stop after the second round regardless — remaining items go to Open questions with the reviewer's evidence attached.
3. Report to the user what the review changed, grouped by failure class (unverified claim, missing surface, undecided choice, unobservable criterion). This is the signal for whether Part 1 and Part 2 were followed.

Confirm the fixes from the draft itself, not from the reviewer's report: re-read each corrected sentence against the cited code.
