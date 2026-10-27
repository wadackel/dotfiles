# Interview

How `/plan` AGREE, `$plan`, and `requirements-interview` ask the user. Read it before the first question.

## Cadence

- **Text questions by default**, in the format below. A structured question tool is for a self-contained confirmation whose options need no background. No emoji.
- **One turn per dependency level.** In `/plan` and `$plan`, independent questions whose prerequisites are all settled go in one message, numbered `### 1. <質問文>`, each with its own recommendation; the answer is `1a 2b`. `requirements-interview` keeps one question per turn. A question that depends on an open answer waits. The question is the last content in the turn; end the turn and do not advance until the answer arrives. An unanswered item, or an answer that changes another question's premise, is asked again next turn; nothing that depends on it advances.
- **Frontier ordering.** Ask only from the frontier: the set of questions whose prerequisites — prior decisions and pending investigations — are all settled. A question that depends on an open answer or an in-flight investigation waits. Ask the highest-impact one first: outcome, then boundary, then context, then definition.
- **Non-blocking fact-finding.** Dispatch a needed lookup in the background and ask the next independent question meanwhile. The interview ends when the frontier is empty and no investigation is pending: nothing left to ask, nothing left to collect.
- **Observe before asking.** If the answer is a fact you could observe by running or reading something (behavior, layout, timing, whether a file or path exists, whether a test passes), probe it or sketch it in a throwaway file and present the result as an option. Reserve questions for preference and product calls no probe can settle.
- **Recommended answer on every question**, with one or two sentences of reasoning. No recommendation means investigate more or narrow the question.
- **Decide when settled.** When the recommended answer is settled by a CLAUDE.md rule, a decision already made in this conversation, or the dominant convention in the code being changed, and the choice can be reversed later, do not ask: adopt it and record it under `### Assumptions` with `observation` / `value` / `reason`. Desired behavior, design decisions, priority, success criteria, and risk tolerance never fall under this rule — they are asked. A design decision shown in the handoff's decisions table next to its rejected alternative counts as the user's explicit choice once `/impl` has accepted it (`user-overridden: true` with that reason; before that it is asked); `user-overridden: default` is never used for it. Outside `/plan` and `$plan`, a scope boundary is asked as well. In `/plan` and `$plan`, a scope boundary takes the recommendation as a `user-overridden: default` assumption shown in the handoff marked 仮置き, and is asked only when including it makes a different deliverable; process, procedure and environment (whether to commit, where to verify, who ships) are never asked there: take the conservative default and name a missing rule under the handoff's decisions.
- **Name the tradeoff axis in one sentence** when comparing approaches.

## Question format

When questions are bundled (`/plan` and `$plan`), each heading is numbered: `### 1. <質問文>`.

```markdown
### <質問文をそのまま見出しにする>

<背景 2〜3 文。前提を file:lines 付きで 1 文、見せられる選択肢はサンプルを fenced block で>

- **A. <ラベル>** — <含意 1 文>
- **B. <ラベル>** — <含意 1 文>

> 推奨: A。<理由 1〜2 文>
```

The heading is the question itself. Background stays at 2–3 sentences, and one of them states the premise the question rests on — current behavior, the file's role, a prior decision — with `file:lines`, so a wrong premise gets corrected instead of questioned back. When an option's shape can be shown (output sample, layout, wording), the body carries a sample of each option as a fenced block; a question the user can only answer by first asking to see it is not ready. An option line carries one sentence. A cost, a constraint, or a second consequence goes on a nested bullet under it, or in its own column when the options are a table, never into the option line. The options take the shape their material asks for: a table when every option has the same fields and none needs a sample (columns 案 / すること / 代償, or Option / What / Cost in English), prose that leads with the recommendation and its reason when one answer is clearly right and the others are fallbacks, and the bullet list above otherwise. Every shape keeps each line short enough for a narrow screen and ends with the recommendation blockquote (`> 推奨`, or `> Recommendation:` in English conversations).

When the options are a table:

```markdown
### <質問文をそのまま見出しにする>

<前提 1 文、file:lines 付き>

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
| Technical deferral | Codebase-recoverable but too heavy for a quick probe | `### Unresolved Items` with a concrete `next:` |
| Draft assumption | User-permitted assumption, or a non-blocking technical default | `### Assumptions` (`user-overridden: true` when the user chose it) |

Facts can be inferred from observation; user intent cannot. A vague qualifier ("clunky", "smooth") is a user decision when the design cannot be written without settling it: offer three concrete candidates and recommend one. When the same uncertainty keeps returning, have the user pick one of "choose an assumption / proceed as-is / continue clarifying / scope out" instead of advancing on a round count.
