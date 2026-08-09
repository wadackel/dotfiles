# curiosity — probe neglected notes

`curiosity [--budget N]` picks notes nothing has touched lately, generates questions about them, answers those questions from the vault, and files whatever is worth keeping as a proposal. Default budget is 5 notes.

`ingest` and `save` flow inward from new material and light up whatever the user happens to be reading. `curiosity` runs the other way: it forces attention onto genres that stopped receiving anything.

| | `ingest` / `save` | `curiosity` |
|---|---|---|
| Starts from | New sources, new conversations | Existing notes |
| Reaches | Wherever material is arriving | Wherever it stopped arriving |
| User does | Supplies material | Starts it |
| Reaches the vault | Immediately | Through proposals |

## Phase 0 — pending reminder

Scan `98_Maintenance/proposals/` for pending proposals and offer to review them first, per [proposals.md](proposals.md).

## Phase 1 — sample

### Exclusion set

Notes touched in the last 30 days, from `98_Maintenance/logs/*.md`:

- `Glob "$VAULT/98_Maintenance/logs/*.md"`, read each, and take the `## YYYY-MM-DD` sections within 30 days.
- From `curiosity:` lines, take every `[[note]]` on the line itself.
- From `query:` lines, take the `[[notes]]` under `- 参照:`.
- From `ingest:` / `save:` / `recompile:` lines, take the `[[notes]]` in the child bullets (`- 新規:`, `- 更新:`, `- 分割:`) — **not** the article on the verb line, which is a source, not a note.

### Candidates

Read each genre's MOC for its note list, read the `updated` frontmatter of those notes, drop anything in the exclusion set, and sort oldest first.

**Notes under `05_Private/` have no `updated` field, so an anti-recency sort puts them at the very front of the candidate list.** Reading one fails at the permission layer ([SKILL.md](../SKILL.md) Safety). When that happens, drop the candidate and **record it as a count, never a title** — Phase 6 logs every sampled note, and a private filename in the log is the exposure this rule exists to prevent.

Notes with no `updated` — anything predating this skill, which is most of the 455 — sort as oldest. That is correct: they are exactly what has never been revisited.

### Even coverage

Round-robin across genres, taking each genre's oldest note in turn until the budget is filled. A genre whose notes are all recent drops out for this cycle. Small genres exhaust first, which is fine — a thin genre is often where probing pays.

`updated` is the sort key only. Whether a note was recently touched is decided by the log-based exclusion set. Do not conflate them.

## Phase 2 — generate questions

Per sampled note, one or two questions, mixing three kinds.

**Single-note** — go deeper on what the note says.

```
- 「[[ノートA]] の主張Xは、最近の事例でも成立するか?」
- 「[[ノートA]] が触れていない側面はあるか?」
```

**Refutation** — look for reasons the note is wrong. This is what keeps the vault honest.

```
- 「[[ノートA]] の主張Xが間違っているとしたら、どんな根拠があり得るか?」
- 「[[ノートA]] と矛盾する記述が他のノートにないか?」
```

**Pair-wise** — join two sampled notes, ideally across genres. This is where new connections come from, and this vault needs them: 04_Literature's links into the concept layer concentrate on a handful of hubs.

```
- 「[[ノートA]] と [[ノートB]] は補完関係か対立関係か?」
- 「[[ノートA]] の概念を [[ノートB]] の文脈に持ち込むと何が起きるか?」
```

Budget roughly `budget * 1.5` questions: one single-note question per note, a refutation question where the note makes a strong claim, and one or two pairs overall.

## Phase 3 — answer

Answer each question through [query.md](query.md)'s search flow, with two changes: skip its save decision (Step 6) and its log append (Step 7) — Phase 5 and Phase 6 handle those. The 8-note read budget applies per question.

## Phase 4 — judge

Evaluate each answer against four questions, deliberately from a checking stance rather than a generating one:

1. Is this just a restatement of an existing note?
2. Does it trace to a source — the article's `## Summary`, its `## Memo`, or its external URL?
3. Does it fill a gap the vault actually has?
4. Which parts are inference rather than anything a source says?

Sort into four buckets:

| Bucket | Condition | Proposal |
|---|---|---|
| A | New angle, grounded, not already covered | `new-page` |
| B | Fills a gap in one specific note | `append` |
| C | Contradicts an existing note | `contradiction` |
| D | Restatement or thinly grounded | None (still counted in the log) |

Expect 30–70% to land in A/B/C. At `--budget 5` that is roughly 2–5 proposals.

## Phase 5 — write proposals

Per [proposals.md](proposals.md), named `<YYYY-MM-DD>__<kind>__curiosity-<serial>.md`, always `status: pending`.

Every curiosity-origin proposal carries `hallucination-possible`, because an answer that adds nothing beyond the sources would have been bucket D. Name the specific unsourced claims in `## 信頼度・リスク` — "この提案には幻覚リスクがあります" without saying where is not reviewable.

## Phase 6 — log

Record **every sampled note**, whether or not it produced a proposal. This is the exclusion set for next time and its only home.

```markdown
## YYYY-MM-DD

- curiosity: [[ノートX]], [[ノートY]] を点検
  - 生成質問: <N>件
  - 評価: A=<n>, B=<n>, C=<n>, D=<n>
  - proposals: <パス>
```

Write to each genre's log only the notes belonging to that genre — the exclusion set is computed per genre.

## Phase 7 — review

Run the interactive flow from [proposals.md](proposals.md). `apply-all-safe` normally does nothing here: every curiosity proposal carries a risk flag. It is `lint`'s `link-fix` proposals that make that option worthwhile.

## When sampling comes up empty

If every genre's notes were touched within 30 days, say so and stop:

```
すべてのノートが直近 30 日以内に触れられています。
今 curiosity を回す必要はありません。
特定のノートを点検したい場合は直接 query を実行してください。
```

## Constraints

- **Never writes to a note directly.** Proposals only.
- **Never touches `updated`.** That moves when a proposal is applied.
- **Logs every sampled note**, regardless of bucket or of what the user did with the proposal.
- **Judge with different instructions than you generated with.** Same model, different stance — otherwise the check inherits the generation's errors.

## Cadence

This vault holds 455 concept notes, so monthly at `--budget 10` is the steady state. It is not worth running before backfill has produced a concept layer to probe: with `98_Maintenance/logs/` empty, the exclusion set is empty and every note is a candidate, which makes the sampling meaningless.

`lint` covers structural health — links, contradictions, staleness. `curiosity` covers whether the content still holds up. Run both and they cover each other's blind spots.
