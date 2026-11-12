# Interview

How `/plan` AGREE, `$plan`, and `requirements-interview` ask the user, and how `/impl` and `$impl` ask before deviating from a plan. Read it before the first question.

## Cadence

- **Text questions by default**, in the format below. A structured question tool is for a self-contained confirmation whose options need no background. No emoji.
- **One question per turn.** Ask the single highest-impact question on the frontier; the other questions wait for later turns even when they are independent of it, because a bundled question tends to need its own context or investigation before it can be answered. Bundle only when the user asks to see the remaining questions together. The question is the last content in the turn; end the turn and do not advance until the answer arrives. An empty or ambiguous answer is asked again; an answer that changes another question's premise sends that question back through fact-finding before it is asked.
- **Read the reply before moving on.** A choice with a reservation (「A、ただ…」) approves the choice, not the reservation: keep the reservation open as the next question, or settle it before `Proceeding with:`. A reply that rejects every option or hesitates gets a new set built on axes not offered yet, not a refinement of the last set. A corrected premise, a new constraint, or a fact found later that contradicts one is stated in one line: what changed, and which decisions, options, and plan sections rested on it; that range goes back through fact-finding and its options are rebuilt, not pruned.
- **Frontier ordering.** Ask only from the frontier: the set of questions whose prerequisites — prior decisions and pending investigations — are all settled. A question that depends on an open answer or an in-flight investigation waits. Ask the highest-impact one first: outcome, then boundary, then context, then definition.
- **Facts before the question.** Before asking, collect what the user needs in order to choose, and observe each item in this session instead of inferring it:
    - the current behavior the question is about, read or run;
    - what each option changes and how far it reaches (callers, files, users, a count), from a search;
    - a concrete example of each option (output, pseudo-code, the shape before and after);
    - the behavior of an external tool or service, from its official documentation or an experiment in a throwaway environment;
    - what each term in the question refers to, when the user has not used that name;
    - how the mechanism the options change works, in the structure the reader follows (data flow, module boundaries and their inputs and outputs, naming, product behavior), as a diagram or pseudo-code when words alone would not build the picture.

  A fact that needs a heavy investigation (a subagent, an experiment) is investigated before the question is asked, not after; an experiment with an effect outside the machine becomes the question itself. A fact that could not be observed is written as a guess (推測) with what was tried. A question the user could answer only after asking for an explanation, an example, or an investigation is not ready.
- **Show what the options rest on.** Every question that compares designs or behaviors carries, between its background and its options, the premises its options were built on; a later question lists only the lines that changed since the last one and the lines it rests on. Keep two to four lines, only those that would change the set of options if they were wrong. A line names an existing thing or constraint the survey or the reading found (a feature, a convention, a past decision, current behavior, an operational limit) with its path, and marks whether the options follow it or depart from it. Mark each line 事実 with its source, 過去の決定 with where it was made, or 推測 with what it was guessed from. No line guesses what the user expects or cares about: that is a question about their premises in another form, and the reader corrects facts, not a portrait of themselves. Memory, earlier decisions, and the means the repository uses now are listed here as premises, never applied silently as limits. The user corrects a line instead of writing their criteria out, and a corrected line sends the options back to be rebuilt.
- **Show a departure as a departure.** An option that departs from an existing design, behavior, or operational constraint says on a nested line what it departs from, with the path. When the recommended option departs, the question's heading asks whether departing is acceptable, so the reader decides the departure itself rather than an option that carries it unnamed. A departure is never only in a cost column or a background line: the reader scanning the heading and the options must see it, written as 「<what> から外れる」 in Japanese conversations. An extremely large implementation cost is shown the same way, as something the option departs from.
- **Non-blocking fact-finding.** While the user answers the current question, collect the facts for the next ones in the background. The interview ends when the frontier is empty and no investigation is pending: nothing left to ask, nothing left to collect.
- **Observe before asking.** If the answer is a fact you could observe by running or reading something (behavior, layout, timing, whether a file or path exists, whether a test passes), probe it or sketch it in a throwaway file and present the result as an option. Reserve questions for preference and product calls no probe can settle.
- **Recommended answer on every question**, with one or two sentences of reasoning. No recommendation means investigate more or narrow the question.
- **Decide when settled.** When the recommended answer is settled by a CLAUDE.md rule, a decision already made in this conversation, or the dominant convention in the code being changed, and the choice can be reversed later, do not ask: adopt it and record it under `### Assumptions` with `observation` / `value` / `reason`. Desired behavior, design decisions, priority, success criteria, and risk tolerance never fall under this rule — they are asked. A design decision shown in the handoff's decisions table next to its rejected alternative counts as the user's explicit choice once `/impl` has accepted it (`user-overridden: true` with that reason; before that it is asked); `user-overridden: default` is never used for it. Outside `/plan` and `$plan`, a scope boundary is asked as well. In `/plan` and `$plan`, a scope boundary takes the recommendation as a `user-overridden: default` assumption shown in the handoff marked 仮置き, and is asked only when including it makes a different deliverable; process, procedure and environment (whether to commit, where to verify, who ships) are never asked there: take the conservative default and name a missing rule under the handoff's decisions. How far to ship is inferred into `## Delivery` instead (each plan skill's SKILL.md), and the Verification Grants that verification outside local and dev needs are asked once.
- **Criteria and axis before options.** Before building options, write the criteria from the user's goal and the axis along which the options differ, walk the axis from one end to the other, and offer the positions that hold up when checked; a position considered and dropped gets one line with its reason, so the reader sees what was not offered. A question about direction also carries one line that names where the mechanism could live (instructions, a hook, a script, CI, a data format, a UI) and which of those the options occupy; each place no option occupies gets its reason or 「検討していない」. Options come out of that consideration, never from a quota. Name the tradeoff axis in one sentence when comparing approaches. Neither an axis nor the reason for a recommendation is the agent's own effort: implementation cost, implementation time, diff size, or verification effort. What the product or its operation bears (CI time, runtime cost, tokens) stays a criterion.

## Question format

```markdown
### <質問文をそのまま見出しにする>

<判断材料を 1 行 1 事実で、各行に出典（file:lines、コマンド、文書）。見せられる選択肢はサンプルを fenced block で>

前提にしたこと（違えば選択肢が変わります）
- <既存のもの>（<path>）に従う …… 事実（<出典>）
- <制約>（<path>）に B が外れる …… 過去の決定（<どこで決めたか>）

- **A. <ラベル>** — <含意 1 文>
- **B. <ラベル>** — <含意 1 文>
  - <what> から外れる（<path>）

置き場所: <案が占める場所>。<占めない場所> は <理由 または 検討していない>

> 推奨: A。<理由 1〜2 文>
```

In a turn that asks, nothing that reads as a report comes before the question's heading; findings the choice needs are background lines under it. The premise block appears on every question that **Show what the options rest on** names, whichever shape the options take; there the background's premise line moves into the block instead of appearing twice. The heading is the question itself. Background lists the facts the choice rests on, one per line, each with its source (`file:lines`, the command, or the document), and one of them states the premise the question rests on — current behavior, the file's role, a prior decision — so a wrong premise gets corrected instead of questioned back. A fact that does not bear on the choice stays out. When an option's shape can be shown (output sample, layout, wording), the body carries a sample of each option as a fenced block; a question the user can only answer by first asking to see it is not ready. When the options differ in arrangement or look (position, balance, density, how a screen reads at another width), the samples stay text or ASCII and one more option offers to compare them in a rendered mock, a standalone HTML page shown the way this runtime shows a page. The mock, or any other rendered prototype of the options, is built only when the user picks that option; a choice between behaviors gets no such option. An option line carries one sentence. A cost, a constraint, or a second consequence goes on a nested bullet under it, or in its own column when the options are a table, never into the option line. The options take the shape their material asks for: a table when every option has the same fields and none needs a sample (columns 案 / すること / 代償, or Option / What / Cost in English; the 代償 column holds what the user or the product gives up), prose that leads with the recommendation and its reason when one answer is clearly right and the others are fallbacks, and the bullet list above otherwise. Every shape keeps each line short enough for a narrow screen and ends with the recommendation blockquote (`> 推奨`, or `> Recommendation:` in English conversations).

When the options are a table:

```markdown
### <質問文をそのまま見出しにする>

<判断材料を 1 行 1 事実で、出典付き>

前提にしたこと（違えば選択肢が変わります）
- <既存のもの>（<path>）に従う …… 過去の決定（<どこで決めたか>）
- <前提> …… 推測（<何から推測したか>）

| 案 | すること | 代償 |
|---|---|---|
| A. <ラベル> | <1 句> | <1 句> |
| B. <ラベル> | <1 句> | <1 句> |

B は <what> から外れる（<path>）。
置き場所: <案が占める場所>。<占めない場所> は <理由 または 検討していない>

> 推奨: A。<理由 1〜2 文>
```

## Questions about look

When the options differ in arrangement or look, these hold on top of the format above.

- **Spread, don't climb.** The first set of options, and the set after a reply that rejects every option ("どれも違う", "しっくりこない"), are each spread across different axes of the screen (placement, density, grouping, emphasis, what is shown at all), one option per axis, instead of refining the axis of the last pick. Every later set keeps one or two earlier options the user did not reject.
- **Name the measure.** When a recommendation rests on a count you chose (truncated rows, lines used, items that fit), say that the count is its basis, so the user can replace it with what they care about.
- **Keep what is fixed.** What the user has settled ("最大 2 段", "経過時間は要らない") is listed at the top of the samples or the mock and holds in every later set.
- **Widen how the user answers, on a signal.** After the first reply that rejects every option, ask which axes are off before building the next set, as a question answered by picking several (位置・密度・強調・情報量・段数, or the axes of that screen), and spread the next set across the axes the user picked. After a second such reply, or when the choice is a combination of where several elements go, build the mock so that the user can mark each part good or bad and switch the placements directly; where the runtime can store the page's data, read that state back instead of asking for it in words. A two-way choice of a color or a wording stays with text samples.

## What to ask

Classify every unresolved point before asking:

| Bucket | Meaning | Action |
|---|---|---|
| Observed fact | Answerable from code, logs, docs, issues, or this conversation | Probe it; keep secrets out of artifacts |
| User decision | Desired behavior, design decision, priority, audience, risk tolerance, success criteria, trade-off acceptance; scope boundary in `requirements-interview` | Ask |
| Scope boundary (plan skills) | A boundary of what the change covers, in `/plan` and `$plan` | `user-overridden: default` with `scope: <the boundary: what is in or out>` under `### Assumptions`, marked 仮置き in the handoff; ask only when including it makes a different deliverable. A value that is not a boundary has no scope to name and is asked |
| Process / procedure / environment (plan skills) | Whether to commit, where to verify, who ships | Never asked; CLAUDE.md and the skill decide, and a missing rule is named under the handoff's decisions. The plan skills infer shipping into `## Delivery`; an operation outside local and dev that verification needs is a user decision (Verification Grants) |
| Technical deferral | Codebase-recoverable but too heavy for a quick probe, and no question rests on it | `### Unresolved Items` with a concrete `next:`; a fact a question rests on is investigated before that question instead |
| Draft assumption | User-permitted assumption, or a non-blocking technical default | `### Assumptions` (`user-overridden: true` when the user chose it) |

Facts can be inferred from observation; user intent cannot. A vague qualifier ("clunky", "smooth") is a user decision when the design cannot be written without settling it: offer three concrete candidates and recommend one. When the same uncertainty keeps returning, have the user pick one of "choose an assumption / proceed as-is / continue clarifying / scope out" instead of advancing on a round count.
