---
name: writing-clarity
description: "Makes a deliverable clear to a reader who never saw the conversation that produced it: first removes conversation residue (prompt echoes like 'as requested', constraint disclosures, revision traces), then makes the prose easier to read (which English words to translate in Japanese text, telegraphic fragments, jargon density). Use when asked to make text readable or finished: '読みやすくして', 'わかりやすく書き直して', '文章を直して', 'AIっぽさを消して', 'もっと簡潔に', '成果物を整えて', '会話の痕跡を消して', 'leave no trace', or when auditing a document or dialogue history. Covers docs, README, PR bodies, code comments. NOT for creating hook rules (hookify:writing-rules), NOT review-time detection (comment-reviewer), NOT a style guide for code, unrelated to Claude Artifacts."
---

# Writing Clarity

Clarity here means: a reader who never saw the conversation that produced the
text reads it once and understands it. For a deliverable (a document, README,
PR body, commit message, or code comment) that reader is outside the
conversation, so a sentence that only makes sense with the conversation in
hand — "implemented in Deno as requested" — is a clarity failure before any
question of wording. For a reply or a dialogue history the reader did see the
conversation, and only the wording matters.

Two passes, in this order: Pass 1 removes what does not belong to the reader,
Pass 2 makes what remains easier to read. Pass 1 goes first so that no effort
is spent polishing a sentence that is about to be deleted.

The binding reply norms live in the `concise` output style
(`~/.claude/output-styles/concise.md`); this skill does not restate them. Load
this skill for deliverables, or when asked to make a text readable. Do not load
it on routine operational output (status reports, test summaries, review
findings) unless asked.

## Modes

What was handed over decides the mode and the output.

- **Revise, file path given** — edit the file in place. Output only a short
  list of the sentences Pass 1 deleted or moved (with the destination, such as
  "→ commit message"). Do not repeat the body.
- **Revise, text pasted** — output the revised text, then the same short list.
- **Revise, the previous reply** ("もっと簡潔に" about what was just said) —
  output the revised reply only. Its reader saw the conversation, so Pass 1 is
  skipped and there is no list.
- **Audit** — a dialogue history, or a request for findings rather than a
  rewrite. Return a short list of rewrite candidates with one example sentence
  each, and do not touch any file.

The list after a revision covers only Pass 1 deletions and moves. A sentence
converted in place into its technical reason stays readable in the deliverable,
and Pass 2 wording changes and cuts for brevity are expression work; neither is
listed. When nothing was deleted or moved, omit the list; after an in-place
file edit, say in one line that the file was revised, so an empty list is not
mistaken for nothing having happened. Do not open with process commentary
("I removed…", "Here is the cleaned version"): the reader asked for the
deliverable, not the work.

## Pass 1: Residue

Applies to deliverables read outside the conversation: docs, README, PR
bodies, commit messages, code comments. Skip it for replies and for
dialogue-history audits, whose readers were part of the conversation.

Judge every conversation-derived statement by one question: **would this read
naturally to someone who never saw the conversation?** Then classify:

1. **Audience content** — information the reader needs. Keep it.
2. **Production guidance** — instructions and constraints that shaped the
   work. Reflect them through structure, tone, scope, and defaults; do not
   state them.
3. **Residue** — echoes of prompts, feedback, or revision history. Remove or
   relocate.

Only the first category appears in the deliverable.

### Conversion, not deletion

Residue usually carries something the reader still needs, so convert it into
design rather than cutting it out:

- Conversion changes where information lives and how it is phrased. It does
  not change technical content or the meaning of any step, because the reader
  relies on those being true.
- Conversation-derived information has three destinations: delete it; move it
  to the commit message or PR body; or, only when it stands as a legitimate
  why-not, rewrite it into the technical reason and keep it in place.
- PR bodies and commit messages are the legitimate home of conversational
  context. There, change rationale, review history, and issue references
  (`closes #123`) are audience content — keep them. Residue in a PR body is
  only the prompt echo ("as requested during the session") and a production
  constraint the reviewer does not need.

Example (document):

> Bad: This script is implemented in Deno as required (Bash is not used).
>
> Good: Running it requires Deno 2.x.

The constraint stops being a disclosure and becomes the prerequisite the reader
needs. Deleting the sentence alone is not enough while the constraint still
governs the content — apply it invisibly, then remove the announcement.

### Code comments

Same test, with one guard: a legitimate why-not comment — a rejected
alternative, a non-obvious invariant, a workaround for a known bug — stays
untouched, because it is the only place that knowledge survives. Words like
"user" or "request" alone do not make a comment residue; judge the content,
not the surface vocabulary.

> Bad: `// Uses the JSON parser instead of regex, as the user requested`
>
> Good: `// Regex matching breaks on escaped quotes inside string literals; rely on the JSON parser for correct token boundaries.`

The conversational attribution converts into the technical reason behind it,
and only when that reason is verifiable from the code at hand. When it is not,
delete the comment: its context belongs in the commit message, and writing that
message is the author's call, not this skill's.

## Pass 2: Readability

What stays is decided by the reply norms in `concise` (what the reader needs
to answer, act, or understand); this pass changes how it is said.

### Vocabulary: translate or keep?

Judge by how the word is USED, not what the word IS.

Keep the original form when the word:

- appears as a heading, table label, or list key that other items cross-reference
- uniquely names an entity: a file, command, config key, task ID, product, skill
- would break traceability if translated (the reader greps for it later)

Translate when the word:

- sits in running Japanese prose as an ordinary noun or verb
- could be replaced by its Japanese equivalent without changing what it refers to

Examples:

- 「Task 3 を実装した」 — keep (`Task 3` is an ID the reader cross-references)
- 「この task は複雑だ」 — translate (ordinary noun → 「このタスクは複雑だ」/「この作業は複雑だ」)
- 「staged 込みの diff」 — translate the frame (→「ステージ済みの変更を含む diff」; `diff` stays — command vocabulary)

When a sentence still reads ambiguous after this test, keep the original. The
cost of an awkward translation is higher than the cost of one English word.

The full protected list lives in [references/protected-terms.md](references/protected-terms.md).

### Fragments: rewrite patterns

Telegraphic fragments compress facts the reader must decompress. Expand them:

- Status fragments — 「3 UF2 exit 0」 → 「3つの UF2 がすべて exit 0 でビルドできた」
- Attribute fragments — 「idx stable (reorder 対応外)」 → 「combo は並べ替えの対象外なので、インデックスは安定している」
- Chained parentheticals — one fact per sentence; a parenthesis may hold one aside, never a second nested one
- Command results — put raw output in a code block; the sentence states only the conclusion

### Jargon density

For each uncommon term, pick one:

1. Replace with the plain word (most cases)
2. Keep it and add a five-to-ten character gloss at first use — 「Goodhart 化 (指標が目的化すること)」
3. Keep it bare — only for terms the reader uses daily

Two undefined terms in one clause multiply the decoding cost; define one or
replace one.

## Auditing

For a document or a dialogue history:

1. Run the lint as the entry point — it detects norm-violation candidates
   (workflow vocabulary, untranslated English in Japanese prose, arrow chains,
   telegraphic fragments, paren chains) with line numbers:

   ```
   ~/.claude/scripts/writing-metrics/lint.ts <file.md> [--json]
   ```

   Input is one Japanese Markdown file per run. Findings are suspicions, not
   orders: exit code is 0 regardless of count (1 only for input errors).
2. Judge each finding against the rules above; only words used as ordinary
   prose nouns are real findings. For a document, also list residue candidates
   by the Pass 1 question; the lint does not detect them. The allow/workflow dictionaries live in
   [references/protected-terms.md](references/protected-terms.md) — extend the
   `Additional allowlist` fence when a false positive names a real entity.
3. For corpus-wide deep dives across the dialogue history (not single files),
   use the measurement scripts in the same directory —
   `baseline-mixing.ts` (mixing density, reply volume percentiles),
   `vocab-inventory.ts` (per-word frequency with origin signals),
   `task-src.ts` / `task-other.ts` (workflow-vocabulary contexts).
4. Report a short list of rewrite candidates with one example sentence each —
   not the full frequency table.

## Guards for both passes

- When in doubt, keep. Destroying a rationale the reader needed is worse than
  leaving one residue phrase or one awkward word.
- Do not invent a reason. A technical reason goes into a comment or a sentence
  only when the code or the document at hand shows it; otherwise delete the
  sentence and leave its context to the commit message.
