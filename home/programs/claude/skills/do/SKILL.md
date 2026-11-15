---
name: do
description: Takes a request from understanding to a verified, shipped change in one skill, with verification sized to what can go wrong and a reviewer where the diff calls for one. Asks the user only what they alone can decide, one question at a time, and otherwise proceeds without waiting for approval. On trial alongside /plan and /impl. Use for "/do <request>".
argument-hint: "<request or issue>"
disable-model-invocation: true
---

# /do

The user runs several sessions at once and comes back hours later. Finish the work they would have approved, and involve them only where their judgment changes the result.

## Understand first

Requests are short and lean on context: an issue number, or a continuation of the conversation so far. Read the issue, the conversation, and the code until you can say what changes. Look for what already does part of the work (the repository's helpers, its dependencies, its test fixtures) and build on it; writing your own instead is a decision the report names.

Before the first edit, write `~/.claude/plans/<YYYYMMDDTHHmm>-<slug>.do.md` and keep it current. Each line names its source (a path, an issue, a command):

- Start: the output of `git rev-parse HEAD`, taken before the first edit.
- Why: the problem behind the request, traced upstream until it is no longer a means.
- Binds: what is already decided that the change must follow or knowingly departs from: ADRs, a schema or parser that rejects what it does not know, tests that pin wording.
- Hits: everything that consumes the behavior you change (callers, docs, tests, downstream repositories), counted on real inputs where they exist.
- Routes: where that behavior is met when it runs (the screen of the running product, the built command, the fired hook), one line for each distinct input it receives from its consumers (the type passed in, the hook event and its payload, the subcommand and flags); consumers that pass the same input share a line. How far a line goes follows what can go wrong and what the look costs, and what the request or the repository's instructions say about it comes first, quoted on the line.
  - Open the route before the first edit, and wait for it to show the behavior before editing, when one command runs it (a built CLI, a fired hook, a script), or when the change does one of these: a person or a system meets new or different behavior (a feature, a flow, a layout, an output format, a fixed bug); something many consumers share is restructured, or the diff is large; the diff crosses a boundary in `references/human-review.md`. Open it under the condition the change exists for (a flag turned on, the new caller, the new data) as well as today's, and write `route: <what you opened> → <where its output is saved>, covers: <the consumers that share it>`. A shared component is reached through the screens that render it, not through its story.
  - Write `route: none — <fact>` when none of those holds and the fact is one of these: the diff changes only words a person reads (a label, copy, a comment, a document); the diff repeats one small substitution that keeps behavior (a rename, a moved import, a helper called in place of the expression it wraps); nothing consumes the behavior yet, with the search that showed it. That the code reads as unable to fail is not one of them.
  - Otherwise write `route: not opened — <what it would show, about how long it takes>` and offer it with the first question you ask or, when you ask none, under あなたに決めてほしいこと; it is not a reason to stop.

  How a route opens is the repository's to say: take the command from what it provides for running the product (a skill, `AGENTS.md` or `CLAUDE.md`, a README, a package script) and name that source on the line, or the search that found none. A route has failed to open only when that command failed; the line then keeps the command and its output. A route this machine and dev environments cannot reach (the code does not produce that state yet, the data does not exist, the operation lies outside them) is written `route: not reached` with what would make it reachable.
- Done states: each state with the line that shows it on the final tree. `real: <a route above, opened again> → <output>` for a state an opened route shows. `stand-in: <command> — fakes <the data | the consumer | the environment>` for a unit test, a type check, a component rendered alone (its story included), or reading the code: it supports a `real:` line, and stands alone only where no route was opened. A check the request names is run too; when it is a stand-in it gets a `stand-in:` line and does not replace an opened route.
- Decisions, yours and the user's, each with what it was chosen over.

To find what you do not know to look for, take the nearest existing sibling of what you add and follow it to every place it appears. A question the user can only answer with "investigate first" was asked too early.

## Ask only what the user alone holds

The user decides the outcome they want, the scope, behavior people will see, and the tradeoffs they bear: cost, time limits, which parts are risky to them and how those must be verified. Everything else is yours, including a fork a quick prototype or run can settle: settle it and show the result.

Test every proposal against that file, the request's own included: one that adds something needs evidence that someone needs it now. Without it, recommend not building it yet, and say whether adding it later breaks anything. Compare options by whether they deliver what the request asks, within what it rules out, and recommend the smallest that does; one that goes further is named under 次に進められること, not recommended. A decision of yours that changes what the user gets is the user's: the shape of what others consume when you can name more than one defensible shape, a departure from a line under Binds, a part of the request left undone or for later, a shape kept so that its consumers need not change. Ask before you build on it, with the alternatives side by side and what each leaves undone, because an answer after the build costs the user a second wait. Build the rest at the smallest that delivers what the request asks and put the fork in the report.

Ask one question per turn. The user decides on one read, hours later and between other sessions, and asks back when they cannot follow, so each question:

- opens with the problem in one or two plain sentences and one concrete instance of it (an input, a screen, a call), then the current behavior and the premise the options rest on, so a wrong premise gets corrected rather than asked back; paths and counts support that statement and do not replace it;
- shows what each option produces rather than describing it: for a code design, the few lines in which the options differ (a signature, a call site, before and after); for a rule or a check, cases it catches and cases it misses; for an instruction, the lines as they would read; for behavior, the output or the screen. A table cell or a bullet of words is a description;
- says what each option leaves as it is today where the user could think it changes, and what it departs from when it departs from an existing design;
- uses the repository's names or the user's own words; a label coined during this work (a phase number, a step name, a shorthand for a mechanism, the letter of an option asked earlier) is replaced by what it names, and any other term is defined where it first appears;
- ends with your recommendation and its reason: how it meets the outcome the user asked for, the end state included; being smaller counts only between options that both meet it.

## Proceed

When nothing above remains, proceed without waiting for approval, whatever the size of the change. Stop again only when:

1. a new decision of the kind above appears;
2. an operation would leave this machine and dev environments, and neither the user's words nor the shipping default below covers it;
3. an operation cannot be undone.

When you stop, open with where the work stands, because the user may have been away.

Work that serves no done state is outside the request: name it under 次に進められること instead of doing it.

Progress lives in git. After compaction, read the file above and `git status` before going on.

## Done

The work is done when every opened route has its `real:` line on the final tree, with output newer than the last edit, every other done state has its `stand-in:` line, and every consumer under Hits is changed in the final diff or has its reason to stay written beside it. A baseline needed after editing began, for a route or a stand-in, comes from a worktree at `Start`, never from rewinding this tree. A part the user called risky is verified the way they asked. Run the repository's routine checks (formatter, lint, type check, the tests covering the change) once at the end.

## Review

A reviewer is dispatched only when the diff crosses a boundary in `references/human-review.md`, when the user asked, or when consumers remain that you have not read: you changed only the ones a type error or a failing test flagged, or a search could not list them all. A tool cannot flag a consumer it cannot see, and the checks you wrote share that list. Snapshot the tree with new files included and write the diff from the start, without touching the real index:

```
cp -p "$(git rev-parse --path-format=absolute --git-path index)" <scratchpad>/<slug>.index
GIT_INDEX_FILE=<scratchpad>/<slug>.index git add -A
git diff -D --no-ext-diff --no-textconv --no-color <start> "$(GIT_INDEX_FILE=<scratchpad>/<slug>.index git write-tree)" > <scratchpad>/<slug>.gate.diff
```

Dispatch `code-reviewer` with `references/reviewer-prompt.md`; at a boundary, or when the user asked to break it, also `security-auditor` and, per `references/breaker-prompt.md`, `breaker-reviewer`, all in one message. Fix what blocks, and have the same reviewer check the fix once; a breaker finding counts only after you re-ran its command yourself, and its fix is checked by re-running that command. What stays open goes to the user. Delete the index copy and the breaker worktree when the review ends.

## Ship

Ship as far as the repository's shipping default goes, and leave the change uncommitted where there is none. The default is what the repository's `AGENTS.md` or `CLAUDE.md` states; this skill names no repository. When they state none, ask at the first stop and offer to record the answer there.

## Report

The reader decides on one read whether to accept the change without reading the diff. Open with whether the request is met and how far it shipped. Then these headings, in this order, each only when it has content:

- **使う人から見て変わること**: before and after, for whoever uses the changed surface.
- **変更したファイル**: a tree, one line per file with what changed. Mark `← レビューしてほしい` on each hunk `references/human-review.md` lists, and list those under the tree in the form it gives. An unmarked tree tells the reader the code need not be read.
- **確かめたこと**: each done state with its line: what was observed and on which route, or the stand-in and what it fakes.
- **確かめていないこと**: each route that failed to open, was not reached, or was not opened, with its command and output, what would make it reachable, or what opening it would take, and anything else not established; for each, what happens if it is wrong, and how it could be established.
- **仮置きしたこと**: each line under Decisions that is yours, with what it was chosen over.
- **次に進められること**: the state outside the diff and what can be taken up next.
- **あなたに決めてほしいこと**: the count, then the first one as a question; the rest one per turn.
