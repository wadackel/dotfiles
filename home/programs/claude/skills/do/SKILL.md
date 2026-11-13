---
name: do
description: Takes a request from understanding to a verified, reviewed, shipped change in one skill. Asks the user only what they alone can decide, one question at a time, and otherwise proceeds without waiting for approval. On trial alongside /plan and /impl. Use for "/do <request>".
argument-hint: "<request or issue>"
disable-model-invocation: true
---

# /do

The user runs several sessions at once and comes back hours later. Finish the work they would have approved, and involve them only where their judgment changes the result.

## Understand first

Requests are short and lean on context: an issue number, or a continuation of the conversation so far. Read the issue, the conversation, and the code until you can say what changes. Look for what already does part of the work (the repository's helpers, its dependencies, its test fixtures) and build on it; writing your own instead is a decision the report names.

Before the first edit, write `~/.claude/plans/<YYYYMMDDTHHmm>-<slug>.do.md` and keep it current. Each line names its source (a path, an issue, a command):

- Why: the problem behind the request, traced upstream until it is no longer a means.
- Binds: what is already decided that the change must follow or knowingly departs from: ADRs, a schema or parser that rejects what it does not know, tests that pin wording.
- Hits: everything that consumes the behavior you change (callers, docs, tests, downstream repositories), counted on real inputs where they exist.
- Done states, each with the command that observes it where the changed thing runs: the built CLI, the fired hook, the page, a headless agent run. Run it once now, for the baseline.
- Decisions, yours and the user's, each with what it was chosen over.

To find what you do not know to look for, take the nearest existing sibling of what you add and follow it to every place it appears. A question the user can only answer with "investigate first" was asked too early.

## Ask only what the user alone holds

The user decides the outcome they want, the scope, behavior people will see, and the tradeoffs they bear: cost, time limits, which parts are risky to them and how those must be verified. Everything else is yours, including a fork a quick prototype or run can settle: settle it and show the result.

Test every proposal against that file, the request's own included: one that adds something needs evidence that someone needs it now. Without it, recommend not building it yet, and say whether adding it later breaks anything. Ask before building only a decision whose answer would make you redo what you build; build the rest at their smallest and put the fork in the report.

Ask one question per turn. The user decides on one read and asks back when they cannot follow, so each question:

- states the current behavior and the premise the options rest on, so a wrong premise gets corrected rather than asked back;
- shows each option concretely: pseudo-code, before and after output, or a sample;
- says what an option departs from when it departs from an existing design;
- uses the repository's names or the user's own words, and defines any other term where it first appears;
- ends with your recommendation and its reason.

## Proceed

When nothing above remains, proceed without waiting for approval, whatever the size of the change. Stop again only when:

1. a new decision of the kind above appears;
2. an operation would leave this machine and dev environments, and neither the user's words nor the shipping default below covers it;
3. an operation cannot be undone.

When you stop, open with where the work stands, because the user may have been away.

Work that serves no done state is outside the request: name it under 次に進められること instead of doing it.

Keep `git rev-parse HEAD` as the start before the first edit. Progress lives in git. After compaction, read the file above and `git status` before going on.

## Done

The work is done when every done state was observed on the final tree where the changed thing runs, or is listed under 確かめていないこと with the attempt that failed. A test, a type check, or reading the code supports that observation and does not replace it. A part the user called risky is verified the way they asked. Run the repository's routine checks (formatter, lint, type check, the tests covering the change) once at the end.

## Review

When more than prose changed, snapshot the tree with new files included and write the diff from the start, without touching the real index:

```
cp -p "$(git rev-parse --path-format=absolute --git-path index)" <scratchpad>/<slug>.index
GIT_INDEX_FILE=<scratchpad>/<slug>.index git add -A
git diff -D --no-ext-diff --no-textconv --no-color <start> "$(GIT_INDEX_FILE=<scratchpad>/<slug>.index git write-tree)" > <scratchpad>/<slug>.gate.diff
```

Dispatch `code-reviewer` with `references/reviewer-prompt.md`. When the diff crosses a boundary in `references/human-review.md`, or the user asked to break it, also dispatch `security-auditor` and, per `references/breaker-prompt.md`, `breaker-reviewer`, all in one message. Fix what blocks, and have the same reviewer check the fix once; a breaker finding counts only after you re-ran its command yourself, and its fix is checked by re-running that command. What stays open goes to the user. Delete the index copy and the breaker worktree when the review ends.

## Ship

Ship as far as the repository's shipping default goes, and leave the change uncommitted where there is none. The default is what the repository's `AGENTS.md` or `CLAUDE.md` states; this skill names no repository. When they state none, ask at the first stop and offer to record the answer there.

## Report

The reader decides on one read whether to accept the change without reading the diff. Open with whether the request is met and how far it shipped. Then these headings, in this order, each only when it has content:

- **使う人から見て変わること**: before and after, for whoever uses the changed surface.
- **変更したファイル**: a tree, one line per file with what changed. Mark `← レビューしてほしい` on each hunk `references/human-review.md` lists, and list those under the tree in the form it gives. An unmarked tree tells the reader the code need not be read.
- **確かめたこと**: only what was observed, and how.
- **確かめていないこと**: what, why, what happens if it is wrong, how it could be established.
- **仮置きしたこと**: decisions made without asking, each with what it was chosen over.
- **次に進められること**: the state outside the diff and what can be taken up next.
- **あなたに決めてほしいこと**: the count, then the first one as a question; the rest one per turn.
