# Requirement Clarification Lens

Decision aid referenced by the `plan` skill's AGREE Requirement Clarification. **Use it as a lens to prevent oversight, not as a classification table.** The eight observations form a "network of questions"; they are NOT a structure where a fixed default triage is mechanically applied per observation.

## Role and purpose

- Scope: `/plan` AGREE (the main agent performs the walk directly; Claude through A1–A7 cadence with AskUserQuestion, Codex through the Blocking Interview Protocol with `$plan --answer`)
- Trigger: complexity is one of `small` / `medium` / `large` (trivial and xl are out of scope)
- Purpose: solidify user intent to the level where implementation will not go wrong. Not protocol checklist completion.
- Process control (the clarity loop, convergence judgment, and rules for issuing the user-confirmation turn) is owned by SKILL.md AGREE as source of truth. This lens owns **the decision aid (oversight prevention for observations and the axes for triage judgment)**.

## Clarity gate: no fixed confirmation cap

For `small` / `medium` / `large`, keep confirming as needed until the requirement is clear. Progression is judged not by count but by whether plan-breaking uncertainty remains.

- **Definition of Ask**: an interaction that waits for the user's next answer. Restating, prose for understanding-check, or recording under `### Requires User Confirmation` is NOT a substitute for an Ask.
- **Keep asking**: when high-cost uncertainty that would make the whole plan worthless if left wrong remains — Scope / Success / Failure, or a user-only / subjective central spec — keep Asking until it is clear.
- **Allow progression**: when uncertainty is codebase-recoverable and can be written down as a concrete `next:` describing where and how to resolve it in EXPLORE / DEEPEN Critic / implementation, delegate to Self-resolve or Unresolved Items and proceed.
- **Progress by explicit choice**: when the same uncertainty keeps repeating, do not auto-advance by exhausting tries; have the user explicitly pick one of "choose an assumption / proceed as-is / continue clarifying / scope out".

## Interview gate — separating observed facts from user intent

Before handling unresolved ambiguity in AGREE, always classify it into one of the buckets below. Cost-based triage is used AFTER this gate. The existence of a reasonable default is NOT grounds for converting a user decision into a draft assumption.

| Bucket | Meaning | Action |
|---|---|---|
| **Observed fact** | A fact that can be observed from the codebase, related logs, docs, existing issues, or the current conversation | Investigate first. When using logs, read the minimum necessary and do not leave secret / token / credential / unrelated personal data in artifacts or logs |
| **User decision** | A judgment that depends on desired behavior, priority, scope boundary, audience, risk tolerance, success criteria, or trade-off acceptance | Ask. Do not turn it into an Assumption except when the user has explicitly chosen the assumption |
| **Technical deferral** | Codebase-recoverable technical discovery that is too heavy for an AGREE lightweight probe | Write `item` / `reason` / a concrete `next` under `### Unresolved Items` |
| **Draft assumption** | A user explicitly permitted proceeding under an assumption, OR a non-blocking technical/default detail | Write the value and reason under `### Assumptions`. If derived from user judgment, add `user-overridden: true` |

Facts can be inferred from observation; user intent cannot.

Desired behavior, scope boundaries, success criteria, priority, audience, risk tolerance, and trade-off acceptance are NOT draft assumptions unless the user explicitly permits it. When they remain unresolved, Ask before creating the artifact.

## Eight-observation lens

Each observation is a checkpoint: "if you leave this observation behind, it can break the plan." **The list of explicit-token signals is anchors** (a guide for reducing oversight, not a rule that fixes the verdict).

### 1. Why — motivation

- **Lens intent**: what does this change resolve, and why now
- **Anchor signals** (in Japanese requests): intent verbs (`〜したい`), reason markers (`ので` / `理由は`), problem statements (`困って` / `問題` / `Issue #\d+`), a complete reason clause with causal conjunctions. Also recognize English equivalents: "I want to", "because", "the reason is", "we're having trouble with", "the issue is".
- **Cost of being left behind**: without Why, both Scope and Success judgments lose grounding → ripples across every observation
- **Typical probe**: "What does this change resolve? What is the root problem?"

### 2. What — deliverable

- **Lens intent**: what gets built, what changes
- **Anchor signals**: deliverable nouns (`command` / `function` / `config` / `UI` / `skill` / `agent` / `hook` / `script` / `option`), concrete file/path names
- **Cost of being left behind**: if What is ambiguous, EXPLORE's exploration target is unsettled and DRAFT's Files to Change cannot be written
- **Typical probe**: "Concretely, what gets built? (command / function / config / UI etc.)"

### 3. Who — actor

- **Lens intent**: who uses it (a single user / a team / others)
- **Anchor signals**: `自分` / `自分用` / `チーム` / `ユーザー`; English equivalents like "for myself", "personal use", "team", "users"; role nouns (reviewer / contributor / etc.)
- **Cost of being left behind**: UX mismatch. In a dotfiles context a single user is the safe default, but a design intended for sharing changes the considerations
- **Typical probe**: "Who uses this? One person? A team? Anyone besides you?"

### 4. When — trigger/context

- **Lens intent**: when / in what context it runs
- **Anchor signals**: `手動` / `自動` / `hook` / `CI` / `起動時` / `PreToolUse` / `PostToolUse` / `on-<event>` form; English equivalents like "manual", "automatic", "on startup", "on save"
- **Cost of being left behind**: trigger-design errors. Whether it is a hook or a command completely changes the implementation structure
- **Typical probe**: "When / in what context does it run? Manual? Automatic? What is the trigger?"

### 5. Where — scope boundary

- **Lens intent**: how far to include, what to exclude
- **Anchor signals**: concrete path / skill / agent names; `特定の〜だけ` / `〜全体` / `以外の〜は除く`; English equivalents like "only X", "all of Y", "except Z"
- **Cost of being left behind**: extra implementation or under-delivery, silent scope creep. Scope errors are hard to recover from downstream
- **Typical probe**: "How far should we include? What should we exclude?"

### 6. How — approach preference

- **Lens intent**: whether the user has a preference or constraint on the implementation approach
- **Anchor signals**: concrete library / framework / pattern names; explicit references like "follow the existing X" / "same approach as Y"
- **Cost of being left behind**: low-cost in most cases (EXPLORE finds existing patterns and DEEPEN Critic catches inconsistencies). However, missing an explicit user preference causes rework
- **Typical probe**: "Any preference on the approach? Follow an existing pattern? New design?"

### 7. Success — observable

- **Lens intent**: by what criteria do we judge success, what are the observable conditions
- **Anchor signals**: `〜できたら OK` / `〜すれば成功`; English equivalents like "it's done when X" / "successful if Y"; measurement words (`時間` / `回数` / `率` / `size` / `latency`, "time" / "count" / "rate"); test words (`テスト` / `verify`)
- **Cost of being left behind**: Completion Criteria cannot be written and `/completion-audit` does not function. "It works" does not define Success
- **Typical probe**: "By what criteria is it a success? What are the observable conditions?"

### 8. Failure — anti-req

- **Lens intent**: what must absolutely not happen, what side effects to avoid
- **Anchor signals**: `〜はダメ` / `避けたい` / `must not` / `禁止`; English equivalents like "must not", "avoid", "forbidden"; safety / regression / side-effect framing
- **Cost of being left behind**: silently stepping over user design constraints. Failure-side constraints have weak signals and are easy to miss
- **Typical probe**: "What must absolutely not happen? Any side effects to avoid?"

## Evidence rule — judging Clear / NotClear

The classification criterion is NOT "does a signal token literally match the request" — it is **"can the meaning be restated from context, or does it require a leap of interpretation"**.

- **Quote the explicit word when present**: if an anchor signal literally matches in the request, you may cite it as evidence, e.g. `Why: Clear (matched 'ズレた' in the request)`
- **Even without an explicit word, Clear if it can be reasonably restated from full context**: e.g. "I want to add an option to the tmux config in dotfiles" has no explicit Where word, but the full context fixes Where = dotfiles/tmux, so it can be treated as Clear
- **Only NotClear → Ask / Assume / Self-resolve when there is a leap of interpretation**: enter the triage when multiple interpretations stand, or when user-only knowledge is judged necessary

**The exact-token-required rule is retired**: avoid the brittle "context is clear enough but no token, therefore NotClear" behavior.

## Ambiguous qualifier — treat as a calibration signal

Subjective adjectives / degree adverbs / vague technical words (e.g. `野暮ったい` / `わかりづらい` / `見づらい` / `モダンじゃない` / `大幅に` / `しっかり` / `リアルタイム` / `なめらか` / `軽量`; English equivalents like "clunky" / "hard to read" / "modern" / "substantially" / "real-time" / "smooth" / "lightweight") **are NOT auto-downgraded**. Handling branches by **whether the word is a central spec of the design decision or a supportive qualifier**.

- **Example of central spec**: "the pointer feels clunky; I want to do something about it" → `clunky` is at the core of What / Success. Without calibrating concrete imagery (Unicode change / color emphasis / removal + line inversion), the implementation is not settled → Calibration Probe candidate
- **Example of supportive qualifier**: "add a tmux option so it animates smoothly" → `smoothly` is secondary modification. The central spec `add a tmux option` is otherwise explicit and implementation is settled as an option addition → proceed under normal interpretation
- **Decision axis**: "Without settling this word, can DRAFT's Files to Change / Approach be written?" YES → central; NO → supportive

**Calibration Probe (triggered only if judged central spec)**:
- Present 3 concrete candidates as user-confirmation options (observable conditions or threshold values; tag one (Recommended) at the top and include Other at the end)
- Counts toward the confirmation-batch Ask quota like a normal Ask (consumes slot 1)
- If 3 candidates cannot be defensibly researched, abandon Calibration Probe and downgrade to a free-text Ask
- When the user's subjectivity itself is the central spec and candidate-ization would distort the meaning, either Ask to calibrate before artifact creation, or record an explicitly user-selected assumption and proceed. `### Unresolved Items` downstream `next:` deferral is only for codebase-recoverable uncertainty.

## Cost-based triage — choosing Ask / Assume / Self-resolve

Triage for NotClear items is decided NOT by per-observation fixed defaults but by **the simultaneous judgment of the two axes below**:

- **Axis A — cost of being wrong**: how badly the plan breaks if this observation is misread
  - **High** (Outcome / Boundary layer): Why / Where / Success / Failure. The plan's grounding or boundaries collapse
  - **Medium** (Context layer): Who / When. UX or trigger-design mismatch
  - **Low** (Definition layer): What / How. Relatively recoverable in EXPLORE / DEEPEN Critic
- **Axis B — recoverability in subsequent phases / implementation**: can it be overturned in EXPLORE's codebase search or DEEPEN Critic's adversarial verification?
  - **High**: signal types that remain in the codebase (existing implementation patterns, call-site context, existing tests)
  - **Low**: user's subjectivity / preferences / undisclosed domain knowledge

### Triage conclusions

| Cost × Recoverability | Choice |
|---|---|
| High cost, low recoverability | **Ask** — user confirmation is required |
| Low cost, low recoverability | **Draft assumption only for non-blocking details** — limited to values that do not depend on user intent, or assumptions explicitly permitted by the user |
| Low cost, high recoverability | **Self-resolve** (AGREE lightweight probe) or **Draft assumption** (only for non-blocking technical/default detail) |
| High cost, high recoverability | Prefer **Self-resolve**; if probing is impossible, **Ask** |

**Handling of How**: do not adopt the "unconditionally assume" hard default. How is judged on the same two axes as every other observation. It typically lands in "low cost × high recoverability" and becomes a Draft assumption as a non-blocking technical/default detail, but when there is a signal that the user has an explicit preference, Ask is also a valid call.

**Restrictions on Assumptions**: `Assume` / `Draft assumption` are only for non-blocking technical/default detail, or for assumptions the user has explicitly chosen. Desired behavior, scope boundaries, success criteria, priority, audience, risk tolerance, and trade-off acceptance are treated as user decisions even when they look light.

**Recording the judgment**: the chosen triage is recorded in the plan body as an entry under `### Assumptions` / `### Self-resolved` / `### Unresolved Items` as appropriate (format described below).

## AGREE output subsections (plan-internal convention)

At AGREE clarity-gate convergence, output the following subsections immediately before `## Overview`. The DEEPEN Critic **parses subsection structure, not canonical phrases**, and carries forward unresolved items.

```markdown
### Requirement Clarification

- Interview status: clear enough to plan (reason: <all user-only high-cost uncertainty resolved / user chose explicit assumption / codebase-recoverable with concrete next>)
- One-line restate: <user request compressed to one sentence. The user can override in the next prompt> (grill-me P3)
- Scope fact: dotfiles/home/programs/claude/skills/plan/ (source: contextually restatable from the request 'redesign the plan skill')

### Assumptions

- observation: How
  value: edit the reference files via existing markdown edits
  reason: user explicitly selected this assumption after the AI recommended it
  user-overridden: true   # optional. Only added when the entry came from a user override

### Self-resolved

- observation: What
  value: edit SKILL.md and three reference files
  source: confirmed by an AGREE Grep probe

### Unresolved Items

- item: the minimal command to run the existing test harness
  reason: codebase-recoverable technical discovery, but not settled by an AGREE lightweight probe alone
  next: investigate the related test layout and existing run examples in EXPLORE

- item: detailed call path for the trigger context
  reason: codebase-recoverable technical discovery, but not settled by an AGREE lightweight probe alone
  next: investigate entry point / hook / command invocation in EXPLORE
```

### Subsection semantics

- `### Requirement Clarification` — clarity-gate summary. Human-readable is fine (Critic does not parse)
- `### Assumptions` — non-blocking technical/default detail, OR an assumption the user has explicitly chosen. Each entry must state `observation` / `value` / `reason`. Entries derived from user judgment must carry the `user-overridden: true` flag (DEEPEN Critic walks `### Assumptions` and picks up `user-overridden`). Do NOT place a user decision here just because a reasonable default exists
- `### Self-resolved` — items settled by an AGREE probe or by deferral to EXPLORE. Each entry must state `observation` / `value` / `source`
- `### Unresolved Items` — at clarity-loop termination, write only codebase-recoverable / technical-discovery items that could not be settled. Do NOT surface user-only / subjective blockers here; Ask before artifact creation, or record them as explicit user-selected assumptions in `### Assumptions`. Each entry requires **three fields**:
  - `item`: what is unsettled
  - `reason`: why it cannot be settled now (codebase-recoverable technical discovery / AGREE probe scope exceeded / information-gathering cost too high / etc.)
  - `next`: where to handle it next (`continue exploration in EXPLORE` / `technical validation in DEEPEN Critic` / `verify against repo state at implementation` / etc.)

**Subsection absence = zero entries**: when `### Unresolved Items` is not written, the DEEPEN Critic interprets unresolved as zero. To assert zero explicitly, write the subsection with the body `(none)`.

**Self-resolved companion block**: when issuing an Ask, prepend a human-readable summary `Self-resolved earlier:` so misjudgments can be flagged immediately (the exact-token quotation requirement is retired; restating is fine). In a text-only runtime, end the turn after posting the questions and wait for the user's next reply before continuing.

## Ask issuance batch rules

Issuance rules for items classified as Ask. The process-control source of truth is SKILL.md AGREE / Blocking Interview Protocol Step E. Only the decision axes are here:

- Ask count 0: if there are also zero additional-confirmation triggers, skip the user-confirmation turn itself
- Ask count 1–4: bundle all into a single AskUserQuestion call (slot cap 4 = AskUserQuestion API hard cap; do not use an override slot)
- Ask count 5+: by cost priority (Outcome > Boundary > Context > Definition; within a tier, ascending observation number), take the top 4; carry the rest into the head of the next clarification iteration's confirmation candidates
- Every real question must carry an AI-recommended answer with a short rationale. If you cannot recommend, the state is one of insufficient investigation / question granularity too broad / user-only decision candidates not organized — narrow the question or do more research, and only ask once a recommendation and rationale can be attached

When the same uncertainty keeps remaining, do NOT auto-advance by count; have the user explicitly pick one of "choose an assumption / proceed as-is / continue clarifying / scope out". Only codebase-recoverable remainders may be delegated under `### Unresolved Items` with a concrete `next:` (do not use the legacy canonical-phrase form).

## Divergence Probing — conditional invocation

Active proposal of unmentioned derivative features is **default-off**. Activate only when one of the following applies:

- **Condition A**: A reference-implementation URL is given, and checking deltas against that implementation provides essential value (when the user cites a reference implementation, asking about delta is an implicit requirement)
- **Condition B**: The user request explicitly asks for "consideration of design gaps" or "what else is needed", etc.

In normal feature planning that does not match either, **do not activate**. Reason: in normal planning, solidifying the user's primary request comes first, and proposing extended features is alternatively captured by the DEEPEN Critic's Scope Appropriateness axis.

Behavior when activated:

- Candidate-extraction sources: keywords in the request, the feature set of the reference-implementation URL, user-request context
- Number extracted → user-confirmation form:
  - 0 candidates: skip
  - 1 candidate: single-select, options = `[include in this scope / track in a separate plan / out of scope / Other]`
  - 2–4 candidates: multiSelect; for 2–3 candidates use `each candidate + Other`; for 4 candidates use `each candidate` only (strict Option cap 4)
- When a reference-implementation URL is given, require delta analysis for 2–4 candidates
- Selected candidates are "included in this scope"; non-selected candidates are **implicitly out of scope**. An `Other` selection is recorded as free-text

Activation limits:
- Activates only in the first clarification pass
- Derivative-feature consideration in subsequent passes is delegated to the DEEPEN Critic's Scope Appropriateness axis

## Impact priority — reordering on Ask overflow

Used both to pick the top items when the Ask count exceeds the slots in a confirmation batch (normally 4 = AskUserQuestion API limit), and to determine the question order within a batch:

1. **Outcome layer** — Why / Success
2. **Boundary layer** — Where / Failure
3. **Context layer** — Who / When
4. **Definition layer** — What / How

**Tiebreaker**: within a tier, ascending observation number (Why < What < Who < When < Where < How < Success < Failure).

## Responsibility boundary with the Ambiguity Gate

This lens is responsible for the positive walk over the eight observations. The SKILL.md Ambiguity Gate is dedicated to exceptions the lens cannot handle (restating the request itself fails, only 1–2-word input with no signal, etc.). When the Gate fires, skip the lens walk and start by re-eliciting the request (from there, rejoin the normal clarity loop).
