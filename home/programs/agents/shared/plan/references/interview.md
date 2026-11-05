# Interview

How `/plan` AGREE, `$plan`, and `requirements-interview` ask the user, and how `/impl` and `$impl` ask before deviating from a plan. Read it before the first question.

## Cadence

- **Text questions by default**, in the format below. A structured question tool is for a self-contained confirmation whose options need no background. No emoji.
- **One question per turn.** Ask the single highest-impact question on the frontier; the other questions wait for later turns even when they are independent of it, because a bundled question tends to need its own context or investigation before it can be answered. Bundle only when the user asks to see the remaining questions together. The question is the last content in the turn; end the turn and do not advance until the answer arrives. An empty or ambiguous answer is asked again; an answer that changes another question's premise sends that question back through fact-finding before it is asked.
- **Frontier ordering.** Ask only from the frontier: the set of questions whose prerequisites — prior decisions and pending investigations — are all settled. A question that depends on an open answer or an in-flight investigation waits. Ask the highest-impact one first: outcome, then boundary, then context, then definition.
- **Facts before the question.** Before asking, collect what the user needs in order to choose, and observe each item in this session instead of inferring it:
    - the current behavior the question is about, read or run;
    - what each option changes and how far it reaches (callers, files, users, a count), from a search;
    - a concrete example of each option (output, pseudo-code, the shape before and after);
    - the behavior of an external tool or service, from its official documentation or an experiment in a throwaway environment;
    - what each term in the question refers to, when the user has not used that name.

  A fact that needs a heavy investigation (a subagent, an experiment) is investigated before the question is asked, not after; an experiment with an effect outside the machine becomes the question itself. A fact that could not be observed is written as a guess (推測) with what was tried. A question the user could answer only after asking for an explanation, an example, or an investigation is not ready.
- **Non-blocking fact-finding.** While the user answers the current question, collect the facts for the next ones in the background. The interview ends when the frontier is empty and no investigation is pending: nothing left to ask, nothing left to collect.
- **Observe before asking.** If the answer is a fact you could observe by running or reading something (behavior, layout, timing, whether a file or path exists, whether a test passes), probe it or sketch it in a throwaway file and present the result as an option. Reserve questions for preference and product calls no probe can settle.
- **Recommended answer on every question**, with one or two sentences of reasoning. No recommendation means investigate more or narrow the question.
- **Decide when settled.** When the recommended answer is settled by a CLAUDE.md rule, a decision already made in this conversation, or the dominant convention in the code being changed, and the choice can be reversed later, do not ask: adopt it and record it under `### Assumptions` with `observation` / `value` / `reason`. Desired behavior, design decisions, priority, success criteria, and risk tolerance never fall under this rule — they are asked. A design decision shown in the handoff's decisions table next to its rejected alternative counts as the user's explicit choice once `/impl` has accepted it (`user-overridden: true` with that reason; before that it is asked); `user-overridden: default` is never used for it. Outside `/plan` and `$plan`, a scope boundary is asked as well. In `/plan` and `$plan`, a scope boundary takes the recommendation as a `user-overridden: default` assumption shown in the handoff marked 仮置き, and is asked only when including it makes a different deliverable; process, procedure and environment (whether to commit, where to verify, who ships) are never asked there: take the conservative default and name a missing rule under the handoff's decisions.
- **Name the tradeoff axis in one sentence** when comparing approaches.

## Question format

```markdown
### <質問文をそのまま見出しにする>

<判断材料を 1 行 1 事実で、各行に出典（file:lines、コマンド、文書）。見せられる選択肢はサンプルを fenced block で>

- **A. <ラベル>** — <含意 1 文>
- **B. <ラベル>** — <含意 1 文>

> 推奨: A。<理由 1〜2 文>
```

The heading is the question itself. Background lists the facts the choice rests on, one per line, each with its source (`file:lines`, the command, or the document), and one of them states the premise the question rests on — current behavior, the file's role, a prior decision — so a wrong premise gets corrected instead of questioned back. A fact that does not bear on the choice stays out. When an option's shape can be shown (output sample, layout, wording), the body carries a sample of each option as a fenced block; a question the user can only answer by first asking to see it is not ready. An option line carries one sentence. A cost, a constraint, or a second consequence goes on a nested bullet under it, or in its own column when the options are a table, never into the option line. The options take the shape their material asks for: a table when every option has the same fields and none needs a sample (columns 案 / すること / 代償, or Option / What / Cost in English), prose that leads with the recommendation and its reason when one answer is clearly right and the others are fallbacks, and the bullet list above otherwise. Every shape keeps each line short enough for a narrow screen and ends with the recommendation blockquote (`> 推奨`, or `> Recommendation:` in English conversations).

When the options are a table:

```markdown
### <質問文をそのまま見出しにする>

<判断材料を 1 行 1 事実で、出典付き>

| 案 | すること | 代償 |
|---|---|---|
| A. <ラベル> | <1 句> | <1 句> |
| B. <ラベル> | <1 句> | <1 句> |

> 推奨: A。<理由 1〜2 文>
```

## What to ask

Classify every unresolved point before asking:

| Bucket | Meaning | Action |
|---|---|---|
| Observed fact | Answerable from code, logs, docs, issues, or this conversation | Probe it; keep secrets out of artifacts |
| User decision | Desired behavior, design decision, priority, audience, risk tolerance, success criteria, trade-off acceptance; scope boundary in `requirements-interview` | Ask |
| Scope boundary (plan skills) | A boundary of what the change covers, in `/plan` and `$plan` | `user-overridden: default` with `scope: <the boundary: what is in or out>` under `### Assumptions`, marked 仮置き in the handoff; ask only when including it makes a different deliverable. A value that is not a boundary has no scope to name and is asked |
| Process / procedure / environment (plan skills) | Whether to commit, where to verify, who ships | Never asked; CLAUDE.md and the skill decide, and a missing rule is named under the handoff's decisions |
| Technical deferral | Codebase-recoverable but too heavy for a quick probe, and no question rests on it | `### Unresolved Items` with a concrete `next:`; a fact a question rests on is investigated before that question instead |
| Draft assumption | User-permitted assumption, or a non-blocking technical default | `### Assumptions` (`user-overridden: true` when the user chose it) |

Facts can be inferred from observation; user intent cannot. A vague qualifier ("clunky", "smooth") is a user decision when the design cannot be written without settling it: offer three concrete candidates and recommend one. When the same uncertainty keeps returning, have the user pick one of "choose an assumption / proceed as-is / continue clarifying / scope out" instead of advancing on a round count.
