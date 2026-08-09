---
name: writing-clarity
description: "Judgment rules for readable prose — vocabulary choice (which English words to translate in Japanese text), rewriting telegraphic fragments, defusing jargon density, and reducing reply volume. Use when asked to make text easier to read: '読みやすくして', 'わかりやすく書き直して', '文章を直して', 'AIっぽさを消して', 'もっと簡潔に', or when auditing dialogue/document readability. NOT for creating hook rules (that is hookify:writing-rules) and NOT a style guide for code."
---

# Writing Clarity

Judgment material for making prose easier to read. The binding norms live in
`~/.claude/CLAUDE.md` (`### Writing`) — this skill does not restate them; it
supplies the decision procedures those norms need.

## Vocabulary: translate or keep?

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

## Fragments: rewrite patterns

Telegraphic fragments compress facts the reader must decompress. Expand them:

- Status fragments — 「3 UF2 exit 0」 → 「3つの UF2 がすべて exit 0 でビルドできた」
- Attribute fragments — 「idx stable (reorder 対応外)」 → 「combo は並べ替えの対象外なので、インデックスは安定している」
- Chained parentheticals — one fact per sentence; a parenthesis may hold one aside, never a second nested one
- Command results — put raw output in a code block; the sentence states only the conclusion

## Jargon density

For each uncommon term, pick one:

1. Replace with the plain word (most cases)
2. Keep it and add a five-to-ten character gloss at first use — 「Goodhart 化 (指標が目的化すること)」
3. Keep it bare — only for terms the reader uses daily

Never stack two undefined terms in one clause; that multiplies decoding cost.

## Auditing a document or dialogue history

1. Run the measurement scripts in `~/.claude/scripts/writing-metrics/` —
   `baseline-mixing.ts` (mixing density, reply volume percentiles),
   `vocab-inventory.ts` (per-word frequency with origin signals),
   `task-src.ts` / `task-other.ts` (workflow-vocabulary contexts).
2. Read the flagged words against the vocabulary test above; only words used as
   ordinary prose nouns are findings.
3. Report a short list of rewrite candidates with one example sentence each —
   not the full frequency table.
