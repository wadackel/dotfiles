# Interview

How `/plan` AGREE, `$plan`, and `requirements-interview` ask the user. Read it before the first question.

## Cadence

- **Text questions by default**, in the format below. A structured question tool is for a self-contained confirmation whose options need no background. No emoji.
- **One question at a time.** Do not pack multiple questions into one message just because the format allows it. The question is the last content in the turn; end the turn and do not advance until the answer arrives. A runtime whose question tool supports batching may batch independent questions; dependent ones stay sequential.
- **Frontier ordering.** Ask only from the frontier: the set of questions whose prerequisites — prior decisions and pending investigations — are all settled. A question that depends on an open answer or an in-flight investigation waits. Ask the highest-impact one first: outcome, then boundary, then context, then definition.
- **Non-blocking fact-finding.** Dispatch a needed lookup in the background and ask the next independent question meanwhile. The interview ends when the frontier is empty and no investigation is pending: nothing left to ask, nothing left to collect.
- **Observe before asking.** If the answer is a fact you could observe by running or reading something (behavior, layout, timing, whether a file or path exists, whether a test passes), probe it or sketch it in a throwaway file and present the result as an option. Reserve questions for preference and product calls no probe can settle.
- **Recommended answer on every question**, with one or two sentences of reasoning. No recommendation means investigate more or narrow the question.
- **Decide when settled.** When the recommended answer is settled by a CLAUDE.md rule, a decision already made in this conversation, or the dominant convention in the code being changed, and the choice can be reversed later, do not ask: adopt it and record it under `### Assumptions` with `observation` / `value` / `reason`. Desired behavior, priority, scope, success criteria, and risk tolerance never fall under this rule — they are asked.
- **Name the tradeoff axis in one sentence** when comparing approaches.

## Question format

```markdown
### <質問文をそのまま見出しにする>

<背景 2〜3 文。前提を file:lines 付きで 1 文、見せられる選択肢はサンプルを fenced block で>

- **A. <ラベル>** — <含意 1 文>
- **B. <ラベル>** — <含意 1 文>

> 推奨: A。<理由 1〜2 文>
```

The heading is the question itself. Background stays at 2–3 sentences, and one of them states the premise the question rests on — current behavior, the file's role, a prior decision — with `file:lines`, so a wrong premise gets corrected instead of questioned back. When an option's shape can be shown (output sample, layout, wording), the body carries a sample of each option as a fenced block; a question the user can only answer by first asking to see it is not ready. The closing blockquote names the recommended answer (`> Recommendation:` in English conversations). An option line carries one sentence. A cost, a constraint, or a second consequence goes on a nested bullet under it, not into the same line.

## What to ask

Classify every unresolved point before asking:

| Bucket | Meaning | Action |
|---|---|---|
| Observed fact | Answerable from code, logs, docs, issues, or this conversation | Probe it; keep secrets out of artifacts |
| User decision | Desired behavior, priority, scope boundary, audience, risk tolerance, success criteria, trade-off acceptance | Ask. A reasonable default does not turn it into an assumption |
| Technical deferral | Codebase-recoverable but too heavy for a quick probe | `### Unresolved Items` with a concrete `next:` |
| Draft assumption | User-permitted assumption, or a non-blocking technical default | `### Assumptions` (`user-overridden: true` when the user chose it) |

Facts can be inferred from observation; user intent cannot. A vague qualifier ("clunky", "smooth") is a user decision when the design cannot be written without settling it: offer three concrete candidates and recommend one. When the same uncertainty keeps returning, have the user pick one of "choose an assumption / proceed as-is / continue clarifying / scope out" instead of advancing on a round count.
