---
name: plan
description: Design-first entrypoint. Conversational planning that agrees on direction before drafting. Seven phases (parse → agree → explore → draft → deepen → decompose → activate) end with a plan file in ~/.claude/plans/ and a session-hash gate marker that unlocks Edit/Write for the session.
argument-hint: "[feature description]"
disable-model-invocation: true
---

Do not write code or create files until you have agreed on the design with the user and produced an approved plan. This applies to **every** request regardless of perceived difficulty.

## Anti-Pattern: "This Is Too Simple To Need A Design"

Every request goes through PARSE → AGREE. No exception for typo fixes, single config flips, or one-line copy edits. "Simple" requests are exactly where unverified assumptions cause the most wasted work. For trivial work the design body can be one or two sentences, but **presentation and agreement are mandatory**.

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

Restate the user's request in one sentence. This is a summary, not a substitute for AGREE.

Estimate complexity with quick keyword + Grep/Glob probes (no Explore subagents yet):

| Level | Signals | Scope |
|---|---|---|
| **trivial** | typo / comment / single config value / 1-line copy edit | 1 file, <10 lines |
| **small** | single module addition along an existing pattern | 1–3 files, <100 lines |
| **medium** | multi-file feature, new component following existing conventions | 3–10 files, 100–500 lines |
| **large** | cross-cutting change, new architectural piece | 10+ files, 500+ lines |
| **xl** | multiple subsystems / architectural shift | propose splitting first |

For `xl`, step out of the normal flow and ask the user whether to decompose into independently-scoped sub-projects before going further.

**Ambiguity Gate**: if the request cannot be restated in one sentence (uninterpretable / contradictory / 1–2 words with no signal), re-elicit through AskUserQuestion before entering AGREE.

## AGREE

The Direction Agreement Gate. Conversational. Replaces v1's Step A–F clarity loop. Goal: agree on *Purpose* and *Approach* before any plan body is drafted.

**Key principles (apply throughout AGREE):**
- **One question at a time.** Each AskUserQuestion call asks a single question. Do not pack multiple questions into one message just because the API allows it.
- **Multiple-choice preferred.** Present concrete options with the AI's recommended choice marked. Open-ended only when no recommendation can be formed — and if no recommendation can be formed, push the question back to self-resolve first.
- **State the tradeoff in one sentence.** When listing approaches, name the axis in one sentence (e.g. "existing-asset reuse vs. clean-slate freedom"). Do not pad with pros/cons bullets.
- **No trivial exception.** Even trivial requests go through AGREE. The design body can be one sentence, but agreement is mandatory.

**Steps A1–A7:**

- **A1 Purpose check** (one question): present the restate; ask "is this right + anything to add?". Wait for the user's response.
- **A2 Re-ask**: if the answer is empty or ambiguous, stay in this phase and ask again — still one question per message.
- **A3 List approaches**: 2–3 candidate approaches, each labelled with the tradeoff axis in one sentence.
- **A4 Recommend**: name the AI's recommended approach and give 1–2 sentences of reasoning.
- **A5 Approve approach** (one question): "go with recommended / pick another / modify". Wait for the user's response.
- **A6 Companion consent** (only when upcoming questions are likely visual — UI mockups, layout comparisons, etc.): offer `/agent-browser` in a **standalone message**, once (no other content in that turn). Skip A6 entirely when no visual questions are anticipated. Per-question decision afterwards: visual → browser, conceptual → terminal.
- **A7 Summarise**: one-sentence summary of the agreed direction. Wait for the user's OK; on OK, advance to EXPLORE.

AGREE produces three subsections that get written into the plan body (preserving the downstream Critic parse contract):
- `### Assumptions` — values the user explicitly chose, plus AI defaults agreed on
- `### Self-resolved` — answers derived from the codebase, with `file:lines`
- `### Unresolved Items` — `item / reason / next:` triples. User-only blockers stay in AGREE until resolved; codebase-recoverable items may carry forward with a concrete `next:`

If the user changes direction mid-AGREE, go back to A3 and restart the approach list. No penalty for revisiting.

## EXPLORE

Investigate the codebase as needed for the agreed direction. Spawn `Explore` subagents in parallel only when their search regions are clearly disjoint. For a small surface area, the main session reads/searches directly.

**Three discoveries** (everything else is noise):

1. **Existing patterns to mirror** — naming, error handling, config style, test layout. Record `file:lines` + a snippet.
2. **Execution path the change flows through** — entry points, data flow, state transitions, interface contracts. Knowing the path is how DRAFT decides what to change vs. leave alone.
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

**Section-by-section confirmation**: after writing each non-trivial section, briefly ask "looks good so far?". For trivial / small plans, the whole body can be confirmed at once at the end. The goal is to catch direction drift before DEEPEN.

Keep the plan body lightweight (target ~120–150 lines, excluding the Deepening Log).

### Completion Criteria item tags (medium+)

Tag every Autonomous Verification item (`/completion-audit` consumes these):
- `[file-state]` — verifiable with Read / Grep / Glob
- `[orchestrator-only]` — needs host access the reviewer's sandbox lacks (`nix flake check`, docker, sudo, etc.); the main session runs it and embeds evidence before the final gate
- `[outcome]` — circular by design (e.g. `/subagent-review returns PASS`); derived from the review's own verdict

When unsure, default to `[orchestrator-only]`.

## DEEPEN

Iterative critique. Logs go to `<plan>.log.md` (separate from the plan body).

**Critic Subagent** (default, each round fresh):
```
Agent({ subagent_type: "Plan", model: "opus",
        prompt: <critic-prompt template with plan + CLAUDE.md summary + round> })
```
Template: `references/critic-prompt.md`. Max rounds: default 2, cap 5 (adjustable via argument-hint). Stop when verdict `CONVERGED` / max rounds reached / zero Critical Issues.

Process each Critical Issue / Improvement Suggestion as one of: Self-resolvable (apply inline with `-- Why: …`), Needs user input (queue for the single end-of-phase interview), or Reject (in conflict with a previous user decision).

**Adversarial Falsification** (default, parallel with the first Critic round when feasible):
```
Agent({ subagent_type: "Explore",
        prompt: <adversarial-prompt template with plan + file paths> })
```
Template: `references/adversarial-prompt.md`. Skip only when there are no verifiable technical claims (pure doc / comment-only edits).

**Inline over-engineering self-review** (default, main session, after the last Critic round):
Read the plan once with YAGNI/KISS/DRY in mind. **Only flag — do not delete.** Annotate each suspect spot with `<!-- over-eng? -->` and surface them in the end-of-phase interview. Deep simplification subagent dispatch is **opt-in** via `/simplify-review plan`.

**Consolidated Interview** (end of DEEPEN): collect all needs-user-input items, then ask them one per message in sequence (following AGREE's Key Principle). Items already resolved in AGREE do not re-enter unless the Critic surfaces them.

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

Write the session-scoped **pending** marker. The active marker is created only when the user types `/impl` as a top-level prompt (the UserPromptSubmit hook promotes `.pending-` → `.active-`). See `~/.claude/scripts/plan-marker.ts` source for the two-marker rationale and session-hash derivation.

```bash
~/.claude/scripts/plan-marker.ts activate-pending '<PLAN_FILE_PATH from DRAFT, agent-substituted>' "$CLAUDE_CODE_SESSION_ID"
```

Emit the full plan body inline so the user can approve without opening the file, then the metadata block:

```
## Plan ready
- File: <plan path>
- Complexity: <trivial/small/medium/large/xl>
- Tasks: <count> (+ /completion-audit + /subagent-review gate)
- Status: PENDING APPROVAL — type `/impl` to approve and execute
```

xl fallback (plan body >~600 lines): replace the inline body with a TOC of `##` headers + the plan path.
