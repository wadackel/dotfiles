---
name: do
description: Takes a request from understanding to a verified, reviewed, shipped change in one skill. Asks the user only what they alone can decide, one question at a time, and otherwise proceeds without waiting for approval. On trial alongside /plan and /impl. Use for "/do <request>".
argument-hint: "<request or issue>"
disable-model-invocation: true
---

# /do

The user runs several sessions at once and comes back hours later. Finish the work they would have approved, and involve them only where their judgment changes the result.

## Understand first

Requests are short and lean on context: an issue number, or a continuation of the conversation so far. Read the issue, the conversation, and the code, and run the thing, until you can say what changes and how it behaves now. A question the user can only answer with "investigate first" was asked too early.

## Ask only what the user alone holds

The user decides the outcome they want, the scope, behavior people will see, and the tradeoffs they bear: cost, time limits, which parts are risky to them and how those must be verified. Everything else is yours, including a fork a quick prototype or run can settle: settle it and show the result.

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

Keep `git rev-parse HEAD` as the start before the first edit. When the work may outlast the context window, write `~/.claude/plans/<YYYYMMDDTHHmm>-<slug>.do.md` with four things only: the decisions (the user's and yours, each with what it was chosen over), the done states and where each is observed, the shipping scope, and decisions that changed on the way. Progress lives in git. After compaction, read that file and `git status` before going on.

## Done

The work is done when each done state holds on the final tree, observed where the changed thing runs. A part the user called risky is verified the way they asked. Run the repository's routine checks (formatter, lint, type check, the tests covering the change) once at the end.

## Review

When more than prose changed, snapshot the tree with new files included and write the diff from the start, without touching the real index:

```
cp -p "$(git rev-parse --path-format=absolute --git-path index)" <scratchpad>/<slug>.index
GIT_INDEX_FILE=<scratchpad>/<slug>.index git add -A
git diff -D --no-ext-diff --no-textconv --no-color <start> "$(GIT_INDEX_FILE=<scratchpad>/<slug>.index git write-tree)" > <scratchpad>/<slug>.gate.diff
```

Dispatch `code-reviewer` with `references/reviewer-prompt.md`, and also `security-auditor` when the diff crosses a boundary in `references/human-review.md`. Fix what blocks, and have the same reviewer check the fix once. What stays open goes to the user. Delete the index copy when the review ends.

## Ship

Ship as far as the repository's shipping default goes, and leave the change uncommitted where there is none. The default is the one in the repository's `AGENTS.md` or `CLAUDE.md`, else the list below; when neither has one, ask at the first stop.

- `dotfiles`: commit and push on `main`.

## Report

The reader decides on one read whether to accept the change without reading the diff. Open with whether the request is met and how far it shipped. Then these headings, in this order, each only when it has content:

- **使う人から見て変わること**: before and after, for whoever uses the changed surface.
- **変更したファイル**: a tree, one line per file with what changed. Mark `← レビューしてほしい` on each hunk `references/human-review.md` lists, and list those under the tree in the form it gives. An unmarked tree tells the reader the code need not be read.
- **確かめたこと**: only what was observed, and how.
- **確かめていないこと**: what, why, what happens if it is wrong, how it could be established.
- **仮置きしたこと**: decisions made without asking, each with what it was chosen over.
- **次に進められること**: the state outside the diff and what can be taken up next.
- **あなたに決めてほしいこと**: the count, then the first one as a question; the rest one per turn.
