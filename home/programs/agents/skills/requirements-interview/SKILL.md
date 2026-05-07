---
name: requirements-interview
description: |
  Structured requirements elicitation through iterative interviews. Transforms vague user requests into well-defined specifications and deliverables (GitHub Issues, Markdown specs, PRDs, etc.).
  Use this skill when the user asks to "要件を整理して", "Issueにまとめて", "仕様を書いて", "PRDを書いて", "要求を明確にして", "ヒアリングして", "spec-writer", "requirements-interview", or when producing any specification document, feature request, bug report, or design document from ambiguous input.
  Also use proactively when the user provides a vague feature request or bug description that needs clarification before action — even if they don't explicitly ask for an interview.
argument-hint: "[rough requirement, target artifact, or issue/spec/PRD context]"
---

# Requirements Interview

A structured process for turning ambiguous user requests into clear, actionable deliverables through iterative questioning.

## Why this skill exists

Users often know *what they want* but express it incompletely. The gap between what's said and what's needed causes rework, misunderstandings, and wasted effort. This skill closes that gap by systematically identifying and resolving ambiguities before producing a deliverable.

The core principle: **a good deliverable is one that a third party — another person, another Claude session, a future you — can understand and act on without needing to ask follow-up questions.**

## Core behavior

Interview the user until the requirements are clear enough that a third party can act without follow-up questions.

Do not produce the final Issue, Markdown spec, PRD, ADR, bug report, or design document while user-intent decisions remain unresolved.

Walk the decision tree one branch at a time. Ask the next question or tight question batch that resolves the highest-impact branch, then end the turn and wait for the user's answer.

For every real question, provide your recommended answer and briefly explain why. The user can override it, but you must not delegate judgment with an unsupported open question.

If a question can be answered by exploring the codebase, relevant logs, docs, existing issues, or the current conversation, explore first instead of asking the user. When using logs, inspect only what is needed and never copy secrets, tokens, credentials, or unrelated personal data into the deliverable.

Facts can be inferred from observation; user intent cannot.

## Process overview

The workflow has five phases. Each phase builds on the previous one, but the process is adaptive. Compress only mechanics that are already clear; do not compress away required user-intent clarification for ambiguous requirements.

### Phase 0: Setup

Run immediately when the skill activates — **before the user provides any requirements.** Even if `$ARGUMENTS` contains requirements, hold them for Phase 1 and resolve Setup first.

Setup has two dimensions. For each one, **triage before blocking-asking** -- the goal is at most **one** user-confirmation turn in Phase 0, and often zero.

**Dimension 1 — Deliverable type.** What form should the output take? (GitHub Issue, Markdown spec, PRD, ADR, etc.)

- **Infer** when the user utterance / `$ARGUMENTS` names it explicitly ("Issueにまとめて" → GitHub Issue, "PRDを書いて" → PRD, "ADRにして" → ADR, "仕様書を書いて" → Markdown spec, "バグレポートを書いて" → Bug Issue).
- **Ask** only if the utterance is genuinely silent on format (e.g., "要件を整理して" alone).

**Dimension 2 — Detail level.**

| Preset | Description | Typical use |
|--------|-------------|-------------|
| `implementation` | Enough for an engineer (or Claude) to implement without further questions. Includes root cause analysis, code references, acceptance criteria | GitHub Issues, bug reports, implementation tasks |
| `decision` | Enough to evaluate trade-offs and make a go/no-go decision. Focuses on options, pros/cons, constraints | ADRs, design proposals, RFC |
| `stakeholder` | Enough for a non-technical stakeholder to understand scope, motivation, and impact | PRDs, project briefs, executive summaries |
| `custom` | User defines their own criteria | Anything else |

- **Infer** via convention mapping from Dimension 1:
  - Issue / bug report → `implementation`
  - ADR / design proposal / RFC → `decision`
  - PRD / project brief → `stakeholder`
  - Markdown spec / generic spec / unnamed → `implementation`
  - Override when the utterance contradicts the default, e.g., "ざっくり方針だけ" → `decision`.
- **Ask** only when Dimension 1 was also ambiguous, or when the utterance explicitly signals a non-default depth.

**Decision rule.**

1. If BOTH dimensions are inferable -> **skip user confirmation**. Record the inferred values as an "Assumptions (Setup)" note at the top of the Phase 4 deliverable, so the user can override on review.
2. If ONE dimension is inferable -> ask only the other in a single user-confirmation turn.
3. If NEITHER is inferable -> ask both in a single user-confirmation turn (two questions, one turn).

Skipping Phase 0 confirmation only skips confirmation of deliverable type and detail level. It does not skip the requirements interview.

Never split Setup across multiple turns. When asking, phrase it in a way that lets the user also override the inferred value: "Deliverable = GitHub Issue と推定しました。違えば選択してください。Detail level はどうしますか？"

### Phase 1: Establish context

With deliverable type and detail level decided, gather the requirements and understand the landscape.

1. **Receive requirements.** Ask the user to describe what they need, framed by the Setup results. If `$ARGUMENTS` was provided, treat it as the requirements input — assess whether it's sufficient or needs clarification before proceeding.

2. **Research the domain.** If the requirements involve a codebase, existing system, or technical domain, research it **before moving to Phase 2.** This is not optional for code-related requests — it must happen before identifying ambiguities or interviewing.

   - Use Explore agents, Grep, Glob, Read to understand current behavior, relevant code paths, configurations, and existing patterns
   - Resolve questions that become self-evident from reading the code — **do not ask the user what the code can tell you**
   - Feed research findings into Phase 2: ambiguities that were resolved by research should be excluded from the ambiguity list

   If the request is purely conceptual (e.g., writing a PRD for a new product), skip code research.

### Phase 2: Identify ambiguities

Read the user's request carefully and list every point where:
- A term could mean multiple things
- A behavior isn't specified for edge cases
- The scope boundary is unclear
- Implementation could reasonably go multiple ways
- Success criteria are implicit rather than explicit

Group related ambiguities and prioritize — resolve the ones that affect scope and direction first, details later.

### Phase 3: Interview

Use the current agent's user-confirmation mechanism to resolve ambiguities. In text-only runtimes, ask concise questions, end the turn, and wait for the user's next response before continuing. Follow these principles:

**Ask with options, not open-ended questions.** Concrete choices are faster to evaluate than blank prompts. Each option should include a short description of its implications. Use `preview` for visual/structural comparisons.

**Batch related questions carefully.** Group 2-3 tightly related low-friction questions per turn (max 4 questions per confirmation turn). Ask a single high-impact question by itself when that answer changes which branch of the decision tree should be explored next. Don't ask everything at once — it's overwhelming.

**Research before asking.** The main domain research happens in Phase 1. If a new question arises during the interview that can be answered by reading code or documentation, investigate before asking the user.

**Always provide a recommended answer.** Every real question in a confirmation turn must include the AI's own recommended answer (grill-me P5). If no recommendation is defensible, the question is malformed — investigate the codebase, narrow the question, or treat it as an Open question in a user-authorized draft. The user can override, but the AI never delegates judgment by asking with no recommendation.

**Interview gate.** Before producing the deliverable, classify every unresolved ambiguity into exactly one bucket:

| Bucket | Meaning | Action |
|---|---|---|
| **Observed fact** | Can be verified from code, relevant logs, docs, existing issues, or the current conversation | Research it; do not ask the user; redact sensitive log data |
| **User decision** | Depends on desired behavior, priority, scope, audience, risk tolerance, success criteria, or acceptance of trade-offs | Ask the user |
| **Draft assumption** | User explicitly allowed drafting with assumptions, or the detail is a non-blocking setup/detail-level inference | State it as an assumption in the deliverable |

If any **User decision** remains, ask an interview question before drafting. Do not convert a User decision into a Draft assumption merely because a reasonable default exists. Desired behavior, scope boundaries, success criteria, priority, audience, and risk tolerance are never Draft assumptions unless the user explicitly authorizes drafting with assumptions.

**Know when to stop.** After each round of answers, re-evaluate: are there remaining ambiguities that would block a third party from acting on the deliverable? If not, move to output. If yes, ask the next batch. Before stopping, restate the user's intent in one sentence so they can confirm or redirect (silent acceptance pattern).

**Handle "I don't know" gracefully.** If the user is unsure about something, suggest a reasonable default and ask whether to proceed with that default. Record it as an Assumption only when the user accepts the default or explicitly authorizes drafting with assumptions.

### Phase 4: Produce the deliverable

With all ambiguities resolved, create the deliverable in the agreed format.

**The deliverable is a standalone artifact.** Do not expose internal process labels (Phase 1, Phase 2, etc.), interview structure, or skill mechanics in the output. The reader should see only the final specification — clean, self-contained, and free of meta-commentary about how it was produced.

**Structure for clarity:**
- Lead with a summary/overview
- Separate facts from decisions from open questions
- Include the "why" behind decisions — it helps future readers judge if the decision still applies
- Reference specific code, files, or systems when relevant
- Link related items (other Issues, docs, etc.)

**Assumptions vs Open questions (use both, but distinguish).** Every unresolved detail falls into exactly one of these buckets:

| Bucket | When to use | Owner of next action | Resolution path |
|---|---|---|---|
| **Assumptions** | A non-blocking value is missing, and the user explicitly allowed an assumption or Phase 0 produced a deterministic setup inference. The deliverable proceeds as if this value is correct. | Reader (reviewer / implementer) is asked to confirm or override. | "Correct me if wrong" — silent acceptance = accepted. |
| **Open questions** | A value is missing, and no reasonable default exists. The deliverable **cannot** proceed until someone answers (data, stakeholder, measurement). | Specific human / team / observation. | Explicit answer must be supplied before the next phase. |

Heuristic: if you filled in a value and flagged it as "please confirm", it is an **Assumption**. If you left the value blank because filling it in would be a guess that could mislead, it is an **Open question**. Setup inferences (deliverable type, detail level) are always Assumptions — never Open questions — because Phase 0's triage rule chose them deterministically.

This Assumptions table does not override the Phase 3 Interview gate. A user-intent decision cannot become an Assumption only because the agent has a reasonable default. Put that default in the recommended answer to the user instead.

**Self-check before output:** Re-read the deliverable and ask: "Could someone unfamiliar with this conversation understand and act on this?" If any part relies on context only present in the conversation, make it explicit in the deliverable.

## Handling multiple items

When the user has several items to process (like multiple Issues):

1. Process them sequentially — one complete cycle per item
2. Apply learnings from earlier items (e.g., if the user corrected your approach on item 1, adapt for item 2)
3. After the first item, offer to review whether the depth and style match expectations before continuing

## Adapting to the user

Pay attention to how the user communicates:
- **Terse answers** → keep questions focused, minimize options
- **Detailed answers with context** → the user thinks deeply about this; ask deeper follow-ups
- **"I don't know" or uncertainty** → provide more research and stronger recommendations
- **Corrections to your framing** → you misunderstood something; re-examine your assumptions

## When NOT to interview

Skip the interview only when one of these is true:
- The user explicitly asks for a draft with assumptions, says to proceed without further questions, or says the agent may choose the missing requirements
- The request already includes concrete scope, target audience, success criteria, acceptance criteria, and relevant constraints
- The task is a mechanical rewrite of already-specified content

In these cases, proceed directly to the deliverable but still apply the self-check: would a third party understand this?

A vague request to create an Issue, Markdown spec, PRD, feature request, bug report, or design document is never fully specified merely because a reasonable implementation path exists.
