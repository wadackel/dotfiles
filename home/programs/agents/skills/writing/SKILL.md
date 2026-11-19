---
name: writing
description: Makes a document meant for other people (a PR description, an Issue, a design doc, an internal document, a README, a commit message or a code comment) clear and concise for a reader who never saw the conversation. Use when writing or revising one, when asked to make text readable, shorter, or less AI-sounding, or to audit writing.
---

# Writing

Clarity here means: a reader who never saw the conversation that produced the
text reads it once, understands it, and can act on it. For a deliverable (a PR
description, an Issue, a design doc, an internal document, a README, a commit
message, a code comment) that reader is outside the conversation, so a sentence
that only makes sense with the conversation in hand — "implemented in Deno as
requested" — is a clarity failure before any question of wording. Japanese
deliverables are written in the plain technical and business register a
Japanese engineer would use, as short as the content allows.

The work has three parts, in this order: Pass 1 removes what does not belong
to the reader, Pass 2 makes what remains easier to read, and the source check
confirms that the result still says what the source says. Pass 1 goes first so
that no effort is spent polishing a sentence that is about to be deleted; the
source check goes last because shortening is where meaning gets lost.

The binding reply norms live in the `concise` output style
(`~/.claude/output-styles/concise.md`); this skill does not restate them. Load
this skill for deliverables, or when asked to make a text readable. Do not load
it on routine operational output (status reports, test summaries, review
findings) unless asked.

## Modes

What was handed over decides the mode and the output.

- **Draft** — a deliverable to write from the work (a PR body, an Issue, a
  design doc). Read [references/document-types.md](references/document-types.md)
  for the order its reader needs, write it with both passes in mind, then run
  the source check. Output only the deliverable, or write it where it goes.
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
bodies, Issues, commit messages, code comments. Skip it for replies and for
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

The agent's own workflow vocabulary is residue too: names and numbers that
existed only while the work ran (an option letter, a step or decision number, a
check id, a unit, the name of the skill or reviewer that produced a result, a
gate). The reader of a PR or an Issue has never seen them. Say what was done or
decided instead: 「案 B で実装」 becomes 「設定ファイルを分けずに 1 つのまま読む形で実装」,
「gate を通過」 becomes 「レビューで指摘はなかった」.

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

### Vocabulary: use the word the field writes

Choose each word by whether the reader already uses it, following the order of
文化審議会「公用文作成の考え方」(2022): a loanword that is established stays as
it is; only an unfamiliar one is replaced, by a plain word that covers the same
range, or kept with a short gloss; and when a one-word swap reads oddly, the
whole phrase is rewritten. Translating every English word is the trap: in a
month of Claude's Japanese replies (`fire-rate.ts`, 2026-11), 「版」 for a
software version appeared about four times as often as 「バージョン」, and coined
words like that cost the reader more than the loanword they replace.

- **Keep as written**: code identifiers, commands, paths, product and skill
  names, and IDs the reader will search for. The list is in
  [references/protected-terms.md](references/protected-terms.md).
- **English in running Japanese prose**: an ordinary English noun or verb
  becomes the established katakana form or the usual Japanese term, whichever
  engineers write: 「この task は複雑だ」 → 「このタスクは複雑だ」, 「新しい version」 →
  「新しいバージョン」. A heading, a table label, or a key that other items refer
  to keeps its original form.
- **No coined renderings**: the Sino-Japanese verbs of technical and business
  documents stay (確認する, 使用する, 停止する, 修正する). Do not replace them, or
  an established loanword, with a native-word noun (確かめ, 直し, 置き場, 持ち主)
  or a one-character calque (版 for version, 印 for a stamp or mark, 頭 for head).
- **No inflated nouns**: a word that gives an ordinary thing more authority
  than it has (正本, 台帳, 関門, 契約 for a rule) becomes the word for its role
  (基準にするファイル, 一覧, 最後のレビュー, 決まり), unless it is the official term.
- **No metaphor verbs**: a verb that describes a system by a body or a person
  becomes the operation it stands for, so the reader can tell who does what.

Illustrative pairs, not a replacement table: pick the word the sentence needs.

| Before | After |
|---|---|
| 電話と Mac で違う版が話すことになる | 電話と Mac で異なるバージョンが通信することになる |
| commit の刻印（stamp）を APK に入れる | APK のバージョン名に commit のハッシュを入れる |
| 持ち主の端末に入れる前に尋ねる | 利用者の端末にインストールする前に確認する |
| アプリが 47800 番を握っていた | アプリが 47800 番ポートを使用していた |
| 判断に迷う項目は残さない側に倒す | 判断に迷う項目は除外する |
| データが静かに壊れる | エラーを出さずにデータが不整合になる |

When a sentence still reads ambiguous after these tests, keep the original
word. An awkward rendering costs more than one English word.

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

### Register of internal documents

Design docs, proposals, reports, and other internal documents use the written
register, held consistent through the document (です・ます or である, as the
repository or the team already writes). Spoken forms become written ones
(〜けど → 〜が, 〜なので → 〜ため, 〜みたいな → 〜のような, 〜とか → 〜など),
without climbing into officialese: 〜において, 〜に関して, and chains of 〜を実施する
become 〜で, 〜について, 〜する. A PR or an Issue follows the repository's existing
ones.

### Titles

A PR or Issue title says the one change or problem in plain words. Details,
conditions, and how it was checked go to the body: a title that carries
parenthetical notes (「（中身は変えずに移すだけ。スクリーンショットの差は 0）」) is
two sentences of the body in the wrong place.

## Source check

Run it after drafting or revising, before the deliverable is published.

- **Claims against the change.** In a PR body, each change the text states is in
  the diff, and nothing the diff does is left out of a summary that claims to
  be complete. When the scope changed during review, describe the final state,
  not the history. In a study of 23,247 agent-written PRs (arXiv 2601.04886),
  bodies that disagreed with their diff were accepted 28.3% of the time against
  80.0%, and the most common disagreement was describing a change that was not
  made.
- **Meaning after shortening.** Compare the result with the original, sentence
  by sentence, on: negation, exceptions, and conditions; certainty (予定,
  〜と考えられる, 〜の可能性がある); numbers, units, and scope (すべて, 一部,
  〜まで); who does what; and any claim that disappeared. Where one changed,
  restore the original wording. Rewrites raise certainty 1.5 to 2 times as often
  as they lower it (arXiv 2606.07951), so when unsure, keep the hedge.

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
   prose nouns are real findings, and the fix for one is the established
   katakana form or the usual term, never a coined rendering. For a document,
   also list residue candidates by the Pass 1 question; the lint does not detect
   them. The allow/workflow dictionaries live in
   [references/protected-terms.md](references/protected-terms.md) — extend the
   `Additional allowlist` fence when a false positive names a real entity.
3. For corpus-wide deep dives across the dialogue history (not single files),
   use the measurement scripts in the same directory —
   `fire-rate.ts` (violation density, word choice such as 版 / バージョン,
   reply length by skill context), `reask-rate.ts` (how often the user asked
   back), `baseline-mixing.ts` (mixing density, reply volume percentiles),
   `vocab-inventory.ts` (per-word frequency with origin signals),
   `task-src.ts` / `task-other.ts` (workflow-vocabulary contexts).
4. Report a short list of rewrite candidates with one example sentence each —
   not the full frequency table.

## Guards for every part

- When in doubt, keep. Destroying a rationale the reader needed is worse than
  leaving one residue phrase or one awkward word.
- Do not invent a reason. A technical reason goes into a comment or a sentence
  only when the code or the document at hand shows it; otherwise delete the
  sentence and leave its context to the commit message.
- Do not add facts to make a sentence concrete. When the source does not say
  which file, which value, or who, keep the general wording or ask.
