# Document types

The order each kind of deliverable's reader needs, for drafting one or
restructuring one. These are orders, not templates: a section with nothing to
say is left out, and a repository's own template (`.github/pull_request_template.md`,
an existing design-doc layout) wins over this file. Every kind opens the same
way: the first line or two say what the document is about and what state it is
in, so a reader who stops there still knows whether it concerns them.

## PR description

1. One line on what the change does, then why it is needed: the problem, and
   why this solution over the obvious other one.
2. What changed, at the level a reviewer needs to read the diff: behavior,
   interfaces, data. Not a file-by-file list the diff already shows.
3. What is out of scope, and what the reviewer should look at closely.
4. How it was checked: what was run and what it showed.

The description is the permanent record of the change, read later without the
review thread, so it describes the final state of the change, not how it got
there (Google's engineering practices for change descriptions say the same).

## Issue

- **Bug**: what happens, what was expected, how to reproduce it (the steps,
  the input, the environment), and the evidence (output, a screenshot). Known
  workarounds and suspected causes go last, marked as suspicions.
- **Feature or task**: the problem and who has it, what done looks like from
  the side of the people who use it, what is out of scope, and what is still
  undecided. How to build it stays out unless the decision is part of the ask:
  the implementer reads the code again anyway.

## Design doc

1. Background: the situation and the problem, in terms a reader outside the
   team follows.
2. Goals and non-goals.
3. The design: what is built and how its parts fit, with the decisions and
   their reasons.
4. Alternatives considered, each with why it was not chosen.
5. Open questions and risks.

## Internal document, proposal, or report

Ordered by what the reader must decide or do: the conclusion or the request
first, then the reasons and the evidence, then the details. Separate facts,
assumptions, proposals, and undecided points so the reader can tell which is
which. Sections need not be the same length; the important one gets the room.

## Incident review

Impact (who, from when, and the current state), the timeline of what happened
and what was done, the root cause, and the follow-up actions with owners. It
describes systems and decisions, not people's mistakes.

## README

What it is and who it is for, what it needs, how to install it, and the
shortest example of using it, before configuration and details.
