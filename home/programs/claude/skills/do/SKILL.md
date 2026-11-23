---
name: do
description: Takes a request from understanding to a verified, shipped change in one skill, with verification sized to what can go wrong and a reviewer where the diff calls for one. Asks the user only what they alone can decide, one question at a time, and otherwise proceeds without waiting for approval. Use for "/do <request>".
argument-hint: "<request or issue>"
disable-model-invocation: true
---

# /do

The user runs several sessions at once and usually answers a question within minutes. Finish what evidence settles, and bring them the choices it leaves open before you build on them.

## Understand first

Requests are short and lean on context: an issue number, or a continuation of the conversation so far. Read the issue, the conversation, and the code until you can say what changes. Look for what already does part of the work (the repository's helpers, its dependencies, its test fixtures) and build on it; writing your own instead is a decision the report names. When the change fixes a mistake, read the history of what it touches as well: if an earlier fix or revert, the same fix elsewhere, a rule already against it, or the user correcting it again shows the mistake has happened before, use the correct skill for it. Its fix is asked before building when later work will have to follow it (an architecture change, a new lint or CI check, a rule an agent reads); a fix inside what the change touches, such as a regression test, goes in the report.

Before the first edit, write `~/.claude/plans/<YYYYMMDDTHHmm>-<slug>.do.md` and keep it current. Each line names its source (a path, an issue, a command):

- Start: the output of `git rev-parse HEAD`, taken before the first edit.
- Why: what the user asked, in their own words, replaced when they restate it; then the problem behind it, traced upstream until it is no longer a means.
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

A choice is yours when something you can cite settles it: what the user said, what is already decided, what the repository already does, what a prototype or a run shows. Look for that first and follow it, and settle with a quick run what a run can settle; this is why how to build is usually yours.

A choice only your own reasoning settles is still open, however strong the reasoning, and so is one where your reasoning goes against the evidence. The user may hold a purpose, an earlier decision, or a preference no file records, and your confidence cannot tell you. When such a choice changes what the user gets or bears, or later work will have to follow it, ask before you build on it: the question costs them minutes, an answer after the build costs the build and a second wait. The other choices are yours, and the report names them.

Test every proposal against that file, the request's own included: one that adds something needs evidence that someone needs it now. Without it, recommend not building it yet, and say whether adding it later breaks anything. Compare options by whether they deliver what the request asks, within what it rules out, and recommend the smallest that does; one that goes further is named under 次に進められること, not recommended.

Ask one question per turn. The user decides on one read, between other sessions, and asks back when they cannot follow, so each question:

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

Dispatch `code-reviewer` with `references/reviewer-prompt.md`; at a boundary, or when the user asked to break it, also `security-auditor` and, per `references/breaker-prompt.md`, `breaker-reviewer`, all in one message. Fix what blocks, and have `code-reviewer` check the fixes once, `security-auditor` only a fix to its own MUST_FIX; a breaker finding counts only after you re-ran its command yourself, and its fix is checked by re-running that command. What stays open goes to the user. Delete the index copy and the breaker worktree when the review ends.

## Ship

Ship as far as the repository's shipping default goes, and leave the change uncommitted where there is none. The default is what the repository's `AGENTS.md` or `CLAUDE.md` states; this skill names no repository. When they state none, ask at the first stop and offer to record the answer there.

## Report

The reader decides on one read whether to accept the change without reading the diff. Open with whether the request is met and how far it shipped, in one or two short sentences. Then these headings, in this order, each only when it has content:

- **使う人から見て変わること**: before and after, for whoever uses the changed surface.
- **変更したファイル**: a tree, one line per file with what changed. Mark `← レビューしてほしい` on each hunk `references/human-review.md` lists, and list those under the tree in the form it gives. An unmarked tree tells the reader the code need not be read.
- **確認したこと**: each done state with its line: what was observed and on which route, or the stand-in and what it fakes.
- **確認していないこと**: each route that failed to open, was not reached, or was not opened, with its command and output, what would make it reachable, or what opening it would take, and anything else not established; for each, what happens if it is wrong, and how it could be established.
- **仮に決めたこと**: a choice your own reasoning settled that the reader might want reversed, with what it was chosen over, however sure you were. A choice evidence settled stays under Decisions in the work file.
- **次に進められること**: the state outside the diff and what can be taken up next.
- **あなたに決めてほしいこと**: the count, then the first one as a question; the rest one per turn.

Under a heading, each item is a bullet whose first line gives its subject and its point in a few words, so that the first lines alone give the section; what supports or follows from it (the reason, the effect if it is wrong, how to establish it, what it was chosen over) goes on indented lines under it, one fact each. Lines under a heading read as labels and values, without です／ます; the opening and a question to the user stay ordinary sentences. Write nothing the heading already says: under 確認していないこと no line says that something was not checked or is unknown, under 確認したこと none says that something was checked or seen, and under 仮に決めたこと none says that something was chosen.

```
**確認していないこと**
- **Linux での動作**：macOS の zsh だけ
  - 外れていたら：`sed -i` の書き方の違いで置換が失敗する
  - 確かめ方：Linux のコンテナでスクリプトを走らせる
```
