# Decision rules

When to create a note, update one, split one, and when to save nothing at all.

## Create a new concept note — all three must hold

1. **Not yet independent** — no note for this concept exists in `02_Notes/`.
2. **Enough substance** — the material does not fit as a section of an existing note.
3. **Reusable** — other notes will plausibly link to it.

Fail any one and the answer is "update an existing note" or "save nothing". `02_Notes/` already holds nearly 500 notes, and roughly a quarter of them have no outgoing links at all; adding more isolated notes makes the vault worse, not better.

## Update an existing note

Update when the new material does any of:

- Adds detail directly related to what the note already says
- Reinforces, corrects, or contradicts an existing claim
- Fills a section the note is missing

Then: move `updated` to today, add the source to `sources`, and — when the material contradicts what is there — add a `## 異論・補足` section rather than overwriting. Both positions stay.

## Split a note — all three must hold

1. One section has grown past roughly 500–1000 characters on its own.
2. That section stands as an independent topic other notes could link to.
3. Splitting makes the material easier to follow, not merely shorter.

How to split: create the new note from the conventions template, then replace the original section with a one-line summary and `[[新ノート]]`. Never delete it outright. Add the new note to the original's `related`, and record `分割: [[元ノート]] → [[新ノート]]` in the log.

## Create a synthesis note

`type: synthesis` notes are where this system earns its cost — a catalog of articles cannot produce them. Reach for one when:

- Several sources cover the same theme from different angles
- Three or more notes in a genre circle the same problem with no note tying them together
- A `query` asked for a comparison, a trade-off, or the overall picture

The vault currently has almost none of these. During backfill, watch for them actively: a genre with 100+ articles and no synthesis note has an obvious gap.

## Whether to save a `query` result

**Save as a new note** when the answer produced a genuinely new angle, introduced a concept the vault lacks, is a reusable analysis or comparison, or integrated several sources into something none of them stated. Save it as `type: synthesis`.

**Append to an existing note** when the material is a supplement or example that belongs on a note that already exists.

**Save nothing** when the answer merely recombined what the vault already holds, is too situation-specific to be reused, or is a record of a decision rather than knowledge.

## When to park a source

`type: parked` is the second terminal state ([conventions.md](conventions.md)). Reach for it when a source cannot produce or strengthen any concept note — not because the subject is uninteresting, but because **there is no claim in it to trace back to**. A chapter-heading skeleton with no body, a link plus a publisher's blurb, a clipping whose `## Summary` never arrived.

The test is the same one create/update already use, run to exhaustion: if no note can be created and no note can be updated, and re-reading the source would not change that, park it.

Write it the way `type: source` is written — **last**, after deciding, and with the reason in the operation log rather than in frontmatter. The reason is a sentence, not a field. A parked source stays parked until someone removes the `type` by hand, which is exactly how a book gets picked back up after its notes grow.

Do not park to clear a backlog. A source parked to make a run finish is indistinguishable afterwards from one that was genuinely empty, and nothing will ever revisit it.

## When torn

- Torn between saving and not saving → do not save. It can be ingested later; a wrong note is harder to remove than a missing one is to add.
- Torn between a new note and an update → update. Split later if it grows.
- Torn about a claim's accuracy → leave it out. The vault's value is that it can be trusted.
