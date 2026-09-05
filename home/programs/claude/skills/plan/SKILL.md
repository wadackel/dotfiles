---
name: plan
description: Design-first entrypoint. Conversational planning that agrees on direction before drafting. Seven phases (parse → agree → explore → draft → deepen → decompose → activate) end with a plan file in ~/.claude/plans/ that the user approves by typing /impl.
argument-hint: "[feature description]"
disable-model-invocation: true
---

Do not write code or create files until you have agreed on the design with the user and produced an approved plan. This applies to **every** request regardless of perceived difficulty.

## Anti-Pattern: "This Is Too Simple To Need A Design"

Every request goes through PARSE → AGREE. No exception for typo fixes, single config flips, or one-line copy edits. "Simple" requests are exactly where unverified assumptions cause the most wasted work. For trivial work the design body can be one or two sentences, but **presentation and agreement are mandatory**.

Complexity gates the *depth after agreement* (DEEPEN rounds, plan body size) — never the agreement itself.

## Quick Start

```
/plan <feature description>
/plan "make notifications API async to reduce error rate"
/plan "typo fix in README"               # trivial still goes through AGREE — design body can be one sentence
```

Once `/plan` ends with PENDING APPROVAL, the user types `/impl` as a top-level prompt to approve and execute.

## Phase overview

PARSE → AGREE → EXPLORE → DRAFT → DEEPEN → DECOMPOSE → ACTIVATE.

AGREE is conversational and completely replaces v1's Step A–F clarity loop. DEEPEN keeps the Critic + Adversarial subagents as default safety nets. Deep simplification is opt-in (`/simplify-review plan`).

## PARSE

Form a one-sentence restatement of the request. Do **not** emit it as standalone prose — it is carried into A1's question text, or into A5's preamble when A1 is skipped. Emitting it twice is what makes PARSE and AGREE read as duplicate confirmation.

Estimate complexity with quick keyword + Grep/Glob probes (no Explore subagents yet). The estimate is internal working state, not output. Record which regions you probed: A1's skip rule below consumes that record.

| Level | Signals | Scope |
|---|---|---|
| **trivial** | typo / comment / single config value / 1-line copy edit | 1 file, <10 lines |
| **small** | single module addition along an existing pattern | 1–3 files, <100 lines |
| **medium** | multi-file feature, new component following existing conventions | 3–10 files, 100–500 lines |
| **large** | cross-cutting change, new architectural piece | 10+ files, 500+ lines |
| **xl** | multiple subsystems / architectural shift | propose splitting first |

For `xl`, step out of the normal flow and ask the user whether to decompose into independently-scoped sub-projects before going further.

**Ambiguity Gate**: if the request cannot be restated in one sentence (uninterpretable / contradictory / 1–2 words with no signal), re-elicit with a text question (AGREE's question format) before entering AGREE.

**Trivial short-circuit**: if complexity is trivial, skip DEEPEN and go directly to DRAFT with a minimal plan (Context, Files to Change, Task Outline, Completion Criteria). AGREE is still mandatory — even trivial requests get a one-sentence direction confirmation.

## AGREE

The Direction Agreement Gate. Conversational. Replaces v1's Step A–F clarity loop. Goal: agree on *Purpose* and *Approach* before any plan body is drafted.

**Key principles (apply throughout AGREE and every later interview):**
- **Text questions by default.** Ask in the chat body using the question format below. Reserve the AskUserQuestion tool for simple self-contained confirmations whose option labels need no background and invite no free-form answer — the canonical example is A6's companion consent. Never use emoji in questions.
- **One question at a time.** Each message asks a single question. Do not pack multiple questions into one message just because the format allows it. The question is the last content in the turn; end the turn and do not advance until the answer arrives.
- **Frontier ordering.** Ask only from the frontier: the set of questions whose prerequisites — prior decisions and pending investigations — are all settled. A question that depends on an open answer or an in-flight investigation waits. Among frontier questions, ask the highest-impact one first.
- **Non-blocking fact-finding.** Finding facts is the session's job, never the user's. When a question needs a fact from the codebase or environment, dispatch the lookup as a background subagent and ask the next independent frontier question in the same turn; collect the result at the top of the next turn. A pending investigation only delays its downstream questions.
- **Observe before asking.** If the answer is a fact you could observe by running or reading something (behavior, layout, timing, whether a file or path exists, whether a test passes), probe it or sketch it in a throwaway file and present the result as an option. Reserve questions for preference and product calls no probe can settle.
- **Recommended answer on every question.** Present concrete options and close with the recommended choice plus 1–2 sentences of reasoning. Open-ended only when no recommendation can be formed — and if no recommendation can be formed, push the question back to self-resolve first.
- **State the tradeoff in one sentence.** When listing approaches, name the axis in one sentence (e.g. "existing-asset reuse vs. clean-slate freedom"). Do not pad with pros/cons bullets.
- **No trivial exception.** Even trivial requests go through AGREE. The design body can be one sentence, but agreement is mandatory.

**Question format** (chat body; sample strings stay in the user's conversation language):

```markdown
### <質問文をそのまま見出しにする>

<背景 2〜3 文。必要なときだけコードブロックや file:lines を添える>

- **A. <ラベル>** — <含意 1 行>
- **B. <ラベル>** — <含意 1 行>

> 推奨: A。<理由 1〜2 文>
```

The heading is the question itself. Background stays at 2–3 sentences, with code blocks or `file:lines` only when they help the decision. Each option label carries a one-line implication. The closing blockquote names the recommended answer with brief reasoning (`> Recommendation:` in English conversations).

**Steps A1–A7:**

- **A1 Direction check** (one question): the question text carries the restate (one sentence) **plus** a scope/boundary question with concrete options and a marked recommendation. Never ask a bare "is this right?" yes/no — a question that can be answered with "ok" and nothing else has bought nothing. Wait for the user's response.
  - **Skipping is limited to small and above.** For trivial, A1 is the single mandatory gate: A3–A7 collapse into it, so the one question carries the restate, the one-line design, and proceed/adjust.
  - For small+, A1 may be skipped only when BOTH hold: (1) the request names a closed, explicit scope (a specific file / value / behavior), and (2) the PARSE probes found no adjacent candidate that could plausibly be in scope — sibling configs, other call sites, related tests, same-named assets. If (2) fails, the adjacent candidates you found **are** the scope options; "no options could be formed" cannot be claimed while holding them.
  - When skipping, open A5's preamble with the restate plus a one-line evidence record — `Scope: <X> only (no adjacent candidates; probed <what you searched>)` — and record the same finding in the plan body's `### Self-resolved` as `observation` / `value` / `source: <probe command + file:lines>`.
- **A2 Re-ask**: if the answer is empty or ambiguous, stay in this phase and ask again — still one question per message.
- **A3 List approaches**: 2–3 candidate approaches, each labelled with the tradeoff axis in one sentence.
- **A4 Recommend**: name the AI's recommended approach and give 1–2 sentences of reasoning.
- **A5 Approve approach** (one question): "go with recommended / pick another / modify". Wait for the user's response.
- **A6 Companion consent** (only when upcoming questions are likely visual — UI mockups, layout comparisons, etc.): offer `/agent-browser` in a **standalone message**, once (no other content in that turn). Skip A6 entirely when no visual questions are anticipated. Per-question decision afterwards: visual → browser, conceptual → terminal.
- **A7 Direction statement** (not a gate): emit `Proceeding with: <one-sentence direction>` as prose and advance to EXPLORE immediately. Do not wait. The sentence survives compaction as a durable anchor and keeps EXPLORE/DEEPEN from drifting, but asking for an OK on a direction A5 just approved buys nothing.

AGREE produces three subsections that get written into the plan body (preserving the downstream Critic parse contract):
- `### Assumptions` — values the user explicitly chose, plus AI defaults agreed on
- `### Self-resolved` — answers derived from the codebase, with `file:lines`
- `### Unresolved Items` — `item / reason / next:` triples. User-only blockers stay in AGREE until resolved; codebase-recoverable items may carry forward with a concrete `next:`

If the user changes direction mid-AGREE, go back to A3 and restart the approach list. No penalty for revisiting.

## EXPLORE

Investigate the codebase as needed for the agreed direction. Spawn `Explore` subagents in parallel only when their search regions are clearly disjoint. For a small surface area, the main session reads/searches directly. Do not pass `name` to these dispatches (nor to the AGREE and Consolidated Interview lookups): an unnamed agent completes and vanishes, a named one stays idle until TaskStop.

**Three discoveries** (everything else is noise):

1. **Existing patterns to mirror** — naming, error handling, config style, test layout. Record `file:lines` + a snippet.
2. **Execution path the change flows through** — entry points, data flow, state transitions, interface contracts. List every caller and consumer of the interface being changed, including configuration combinations. Knowing the path is how DRAFT decides what to change vs. leave alone.
3. **Existing behavior + tests** — how the target currently behaves and the existing tests that observe it (`file:lines`). DRAFT's Test Strategy quotes these.

For revisions to existing behavior, also gather empirical signals ("what the spec says" and "what actually happens" are different questions): run the CLI, fire the hook, read effective config.

Consolidate findings into a single **Unified Discovery Table** (`Category | File:Lines | Pattern | Key Snippet`). Skip rows that do not inform a design decision.

## DRAFT

Write the plan to `~/.claude/plans/YYYYMMDDTHHmm-<slug>.md` (slug ≤40 chars, lowercase kebab).

**Language policy** (3 rules):
- Body prose: user's settings language.
- Section headers: English fixed strings (downstream skills locate sections by literal match).
- Machine-consumed lines (`## Completion Criteria` items, Acceptance Criteria): English.

**Plan body section contract** (12 headers, complexity-gated; downstream `/impl` / `/completion-audit` / `/subagent-review` parse by these literal strings):

| Section | trivial | small | medium+ |
|---|---|---|---|
| Context | ✓ | ✓ | ✓ |
| Overview | | ✓ | ✓ |
| Approach (incl. Alternatives Considered) | | ✓ | ✓ |
| NOT Building | | ✓ | ✓ |
| Mandatory Reading (P0/P1/P2 × file:lines × why) | | | ✓ |
| Patterns to Mirror (SOURCE: file:lines + snippet) | | | ✓ |
| Intentional Conventions (when applicable) | | | ✓ |
| Files to Change (CREATE / UPDATE / DELETE) | ✓ | ✓ | ✓ |
| Task Outline | ✓ | ✓ | ✓ |
| Test Strategy (when there is a behavior change) | | ✓ | ✓ |
| Completion Criteria (Autonomous Verification + Requires User Confirmation + Baseline) | ✓ | ✓ | ✓ |
| Risks + Open Questions | | ✓ | ✓ |

The AGREE-derived `### Assumptions` / `### Self-resolved` / `### Unresolved Items` subsections are written into the plan body just before `## Overview`.

**Draft handoff (one-way)**: when the body is written, state the plan path, the section headings, and the key design decisions in at most 3 lines, then proceed directly to DEEPEN. Do not ask whether to proceed — direction agreement happened in AGREE, and drift detection is DEEPEN's job (Critic + Consolidated Interview). For trivial plans (DEEPEN skipped), the ACTIVATE digest and the `/impl` approval gate are the review surface.

Before the handoff, run `~/.agents/scripts/check-plan.ts <plan path>`. Fix every `error` in the plan file first (missing required sections, untagged Autonomous Verification bullets, malformed Requires User Confirmation items). Carry `warn` lines into DEEPEN as rows of the Round 1 triage table; for a trivial plan (no DEEPEN) carry them into the ACTIVATE digest as one `Lint:` line.

Keep the plan body lightweight (target ~120–150 lines, excluding the Deepening Log).

### Completion Criteria item tags

Tag every Autonomous Verification item at every complexity, trivial included (`/completion-audit` consumes these):
- `[file-state]` — verifiable with Read / Grep / Glob
- `[orchestrator-only]` — needs host access the reviewer's sandbox lacks (`nix flake check`, docker, sudo, etc.); the main session runs it and embeds evidence before the final gate
- `[live]` — observed on the real surface with the user's own run method — start command, mode, target URL or PR, network condition, account role — recorded in the task evidence; gating at every complexity, waivable only by explicit user decision (BLOCKED BY USER)
- `[outcome]` — circular by design (e.g. `/subagent-review returns PASS`); derived from the review's own verdict

When unsure, default to `[orchestrator-only]`.

A plan that changes behavior a user can observe (UI, CLI output, hook or config effects, runtime responses) carries at least one `[live]` item under Autonomous Verification. Tests and type checks are not a substitute: they show branch behavior, not that the surface works the way the user runs it. Only when the agent cannot bring up the environment itself does the `[live]` item move under Requires User Confirmation, written in the item format below.

### Requires User Confirmation item format

Every item under `### Requires User Confirmation` — `[live]` or `[orchestrator-only]` — is one logical bullet (no blank lines inside, no code span) with these five fields in this order, labels in English even when the plan body is Japanese, so `/impl`, `/completion-audit`, and the final report copy them verbatim:

```
- [live] Observe: <what the user will see> / Why not autonomous: <one line> / Needs: <sudo | auth | dialog | role switch | dev server | real PR | device | interactive session> / Your steps: <command, URL, role> / Needed by: <task N | final gate | next real run <trigger>>
```

`Needed by: task N` and `final gate` items gate completion until the user reports the result or waives them. `next real run <trigger>` names an external event this session cannot produce (the next real PR, the next deploy); approving the plan with `/impl` is the user's decision to defer that item, and the audit counts it as BLOCKED BY USER only while the trigger is one this session could not have produced. Questions for the user do not belong here — ask them in AGREE or list them under `### Unresolved Items`. `Your steps` must not inline tokens, passwords, or credentialed URLs — name the credential source (1Password item, env var) instead, because the line is copied into chat and the gate sidecar. Write `- None` when there is nothing to confirm. An item missing any field is not a valid item.

## DEEPEN

Iterative critique. Logs go to `<plan>.log.md` (separate from the plan body).

**Critic Subagent** (default, each round fresh):
```
Agent({ subagent_type: "Plan", model: "opus",
        prompt: <critic-prompt template with plan + CLAUDE.md summary + round> })
```
Template: `references/critic-prompt.md`. Max rounds: default 2, cap 5 (adjustable via argument-hint). Stop when verdict `CONVERGED` / max rounds reached / zero Critical Issues.

Process each Critical Issue / Improvement Suggestion as one of: Self-resolvable (apply inline with `-- Why: …`), Needs user input (queue for the single end-of-phase interview), or Reject (in conflict with a previous user decision). CONVERGED does not exempt the round's findings from triage; process every attached finding before leaving DEEPEN.

**Adversarial Falsification** (default, parallel with the first Critic round when feasible):
```
Agent({ subagent_type: "Explore",
        prompt: <adversarial-prompt template with plan + file paths> })
```
Template: `references/adversarial-prompt.md`. Skip only when there are no verifiable technical claims (pure doc / comment-only edits).

Dispatch the Critic and the Adversarial agent unnamed: each round is a fresh dispatch that is never messaged again, and a named agent stays idle until TaskStop.

**Inline over-engineering self-review** (default, main session, after the last Critic round):
Read the plan once with YAGNI/KISS/DRY in mind. **Only flag — do not delete.** Annotate each suspect spot with `<!-- over-eng? -->` and surface them in the end-of-phase interview. Deep simplification subagent dispatch is **opt-in** via `/simplify-review plan`.

**Consolidated Interview** (end of DEEPEN): collect all needs-user-input items, then ask them one per message following AGREE's question format and frontier ordering. When an item needs a fact, dispatch the lookup in the background and ask the next independent item meanwhile. The interview ends when the frontier is empty and no investigation is pending: nothing left to ask, nothing left to collect. When the same uncertainty keeps repeating, have the user explicitly pick one of "choose an assumption / proceed as-is / continue clarifying / scope out" instead of looping. Items already resolved in AGREE do not re-enter unless the Critic surfaces them.

## DECOMPOSE

The main session decomposes — no subagent dispatch.

**Rules:**
1. One task = one verifiable unit.
2. Verification commands + expected output live inside the implementation task; no standalone verification tasks except the final gate.
3. Different concerns → different tasks; files sharing one concern → one task.
4. Task description must carry the three elements: (1) target files, (2) expected behavior after the change, (3) acceptance criteria (commands + expected output).
5. The final-gate task `Run /completion-audit and /subagent-review` has every implementation task in its `blockedBy`.

**Anti-patterns**: splitting verification out of implementation, "confirm X" without a command, missing `blockedBy` for prerequisites, missing the final gate task, missing `## Test Strategy` for behavior changes.

**2-pass TaskCreate**: pass 1 creates every implementation task and collects IDs; pass 2 creates the final-gate task and calls `TaskUpdate(gateId, addBlockedBy: implTaskIds)`. Reason: `blockedBy` needs IDs that don't exist until pass 1 completes.

`/impl` auto-spawns `code-simplifier` when a task's diff is ≥20 files or ≥500 lines — do not create a standalone simplifier task in the plan.

## ACTIVATE

No side effects — do not write any state file. Approval is signalled purely by the user typing `/impl` as a top-level prompt in the next turn; `/impl` resolves this plan from conversation context (the `## Plan ready` File line below).

Re-run `~/.agents/scripts/check-plan.ts <plan path>`. A plan with any `error` cannot be activated — fix the plan file and re-run until it reports `0 errors`.

Emit a design digest — the Approach skeleton (each design decision in one or two sentences), the Files to Change list, and the Task Outline — followed by the plan file path for the full text, then the metadata block. Do not inline the full plan body; the file is the review surface for detail.

```
## Plan ready
- File: <plan path>
- Complexity: <trivial/small/medium/large/xl>
- Tasks: <count> (+ /completion-audit + /subagent-review gate)
- Status: PENDING APPROVAL — type `/impl` to approve and execute
```
