---
name: requirements-interview
description: |
  Structured requirements elicitation through iterative interviews. Transforms vague user requests into well-defined specifications and deliverables (GitHub Issues, Markdown specs, PRDs, etc.).
  Use this skill when the user asks to "要件を整理して", "Issueにまとめて", "仕様を書いて", "PRDを書いて", "要求を明確にして", "ヒアリングして", "spec-writer", "requirements-interview", or when producing any specification document, feature request, bug report, or design document from ambiguous input.
  Also use proactively when the user provides a vague feature request or bug description that needs clarification before action — even if they don't explicitly ask for an interview.
---

# Requirements Interview

A structured process for turning ambiguous user requests into clear, actionable deliverables through iterative questioning.

## Why this skill exists

Users often know *what they want* but express it incompletely. The gap between what's said and what's needed causes rework, misunderstandings, and wasted effort. This skill closes that gap by systematically identifying and resolving ambiguities before producing a deliverable.

The core principle: **a good deliverable is one that a third party — another person, another Claude session, a future you — can understand and act on without needing to ask follow-up questions.**

## Process overview

The workflow has five phases. Each phase builds on the previous one, but the process is adaptive — skip or compress phases when the context is already clear.

### Phase 0: Setup

Run immediately when the skill activates — **before the user provides any requirements.** Even if `$ARGUMENTS` contains requirements, hold them for Phase 1 and resolve Setup first.

Setup has two dimensions. For each one, **triage before blocking-asking** — the goal is at most **one** `AskUserQuestion` call in Phase 0, and often zero.

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

1. If BOTH dimensions are inferable → **skip `AskUserQuestion`**. Record the inferred values as an "Assumptions (Setup)" note at the top of the Phase 4 deliverable, so the user can override on review.
2. If ONE dimension is inferable → ask only the other in a single `AskUserQuestion` call.
3. If NEITHER is inferable → ask both in a single `AskUserQuestion` call (two questions, one call).

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

Use `AskUserQuestion` to resolve ambiguities. Follow these principles:

**Ask with options, not open-ended questions.** Concrete choices are faster to evaluate than blank prompts. Each option should include a short description of its implications. Use `preview` for visual/structural comparisons.

**Batch related questions.** Group 2-3 related questions per turn (max 4 per AskUserQuestion call). Don't ask everything at once — it's overwhelming. Don't ask one at a time — it's tedious.

**Research before asking.** The main domain research happens in Phase 1. If a new question arises during the interview that can be answered by reading code or documentation, investigate before asking the user.

**Offer your informed opinion.** When research reveals a clear best practice or common pattern, present it as the recommended option. The user can override, but a good default saves time.

**Know when to stop.** After each round of answers, re-evaluate: are there remaining ambiguities that would block a third party from acting on the deliverable? If not, move to output. If yes, ask the next batch.

**Handle "I don't know" gracefully.** If the user is unsure about something, suggest a reasonable default and note it as an assumption in the deliverable (see the Assumptions / Open questions distinction in Phase 4 below).

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
| **Assumptions** | A value is missing, and a reasonable default / inference was chosen. The deliverable proceeds as if this value is correct. | Reader (reviewer / implementer) is asked to confirm or override. | "Correct me if wrong" — silent acceptance = accepted. |
| **Open questions** | A value is missing, and no reasonable default exists. The deliverable **cannot** proceed until someone answers (data, stakeholder, measurement). | Specific human / team / observation. | Explicit answer must be supplied before the next phase. |

Heuristic: if you filled in a value and flagged it as "please confirm", it is an **Assumption**. If you left the value blank because filling it in would be a guess that could mislead, it is an **Open question**. Setup inferences (deliverable type, detail level) are always Assumptions — never Open questions — because Phase 0's triage rule chose them deterministically.

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

Skip or compress the interview when:
- The user provides a fully specified request with clear acceptance criteria
- The task is a simple, well-understood operation (typo fix, config change)
- The user explicitly says "just do it" or "details are up to you"

In these cases, proceed directly to the deliverable but still apply the self-check: would a third party understand this?
