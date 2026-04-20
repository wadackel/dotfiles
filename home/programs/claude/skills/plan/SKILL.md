---
name: plan
description: Plan creation skill that replaces CC builtin plan mode. Runs the full plan lifecycle — parse, explore, draft, adversarial deepen, task decompose — in a single command. Writes the plan to ~/.claude/plans/ and creates a task list plus a cwd-hash gate marker that unlocks Edit/Write/MultiEdit for the session. Use when the user asks to implement a new feature, fix a bug with design decisions, refactor, or make multi-file changes. Triggers include 実装して / 対応して / 修正して / plan / implement / develop / build / design.
argument-hint: "[feature description]"
---

# /plan

Single fused entry point for feature planning. Replaces the CC builtin plan mode workflow. Runs 6 phases in one skill body: PARSE → EXPLORE → DRAFT → DEEPEN → DECOMPOSE → ACTIVATE.

After `/plan` completes, invoke `/impl` to execute the task list.

## Quick Start

```
/plan <feature description>
/plan "notifications API を非同期化してエラー率を下げたい"
/plan "typo fix in README"               # → trivial path, Phase 2-4 skip
```

## Why this skill

The native plan mode had three structural problems:
1. `task-planner` decomposition only fired via an `ExitPlanMode` hook, not reliably for every plan.
2. CC plan mode occasionally fails to engage, letting edits slip through.
3. `/subagent-review` / `/completion-audit` integration was weak inside plan mode.

`/plan` fuses research, draft, adversarial deepening, and task decomposition into one artifact-producing command and is independent of CC plan mode. A companion PreToolUse hook (`plan-gate.ts`) blocks cwd-scoped Edit/Write/MultiEdit until `/plan` produces a marker, enforcing design-first without relying on plan mode's own gating.

## Phase 1 — PARSE

Restate the user's request back to them: "あなたが実装したいのは X ですね？" (confirm understanding).

Estimate complexity via keyword heuristic + lightweight codebase probe (Grep/Glob, no Explore subagent yet):

| Level | Signals | Scope |
|---|---|---|
| **trivial** | typo / comment / single config value / 1-line copy edit | 1 file, <10 lines, no design decision |
| **small** | single module addition, follows an obvious pattern | 1-3 files, <100 lines |
| **medium** | multi-file feature, new component, follows existing conventions | 3-10 files, 100-500 lines |
| **large** | cross-cutting change, new architectural piece | 10+ files, 500+ lines |
| **xl** | multiple subsystems / architectural shift | propose splitting to user |

**Trivial short-circuit**: when complexity is `trivial`, skip Phases 2–4 and jump directly to Phase 5 with a minimal plan body (Context + Files to Change + Verification only, 1 task). Requirement Clarification and Ambiguity Gate are also skipped.

### Requirement Clarification (small+)

**Invariant (auto mode regardless)**: `/plan` operates identically under auto mode and plan mode. The skill does NOT detect auto mode or reduce Ask frequency. The auto-mode "minimize interruptions" directive does not apply here — invoking `/plan` is the explicit user opt-in to the Ask flow, and Phase 1 Requirement Clarification is the primary value of that opt-in.

For non-trivial requests (`small` / `medium` / `large`; `xl` is exempt because Phase 1 proposes splitting), systematically detect ambiguity with the **8-observation walk** before entering Phase 2. Detailed spec: `references/requirement-checklist.md`.

**Multi-round walk overview**: runs as a Round loop (fixed max 3 rounds for all non-trivial complexity; `trivial` and `xl` remain exempt). Each round executes Steps A–F below, then either converges or advances to Round N+1.

**Round 上限**:

| complexity | Round 上限 | 備考 |
|---|---|---|
| trivial | 0 (RC skip) | 現状維持 |
| small / medium / large | 3 | 全 non-trivial で固定 (User override で早期脱出可) |
| xl | 0 (Phase 1 で split 提案) | 現状維持 |

**Round N (1..3) の Step A–F** (Round loop / Escalate / 収束判定の source of truth は本 SKILL.md。`references/requirement-checklist.md` は 8 観察 walk の signals / Step 2 Triage / Calibration Probe 詳細を owns):

- **Step A Walk**: Round 1 は 8 観察 walk (Why / What / Who / When / Where / How / Success / Failure)、Round 2+ は前 round 回答を反映した再 walk。要求文中に ambiguous qualifier が含まれる場合、該当観察 (主に What / Success) は Clear signal 併存でも NotClear に強制降格
- **Step B Triage**: Clear/NotClear 判定 → Ask / Assume / Self-resolve (3-category rule、`How` は Always Assume)。Clear 判定には要求文中の exact token 引用必須 (類推ベースは NotClear 扱い)
- **Step C Self-resolve probe**: 軽量 Grep/Read のみで probe (Explore subagent は Phase 2 へ)。不能時は観察依存で fallback — Self-resolve default (What / When) は Phase 2 EXPLORE へ委譲、Ask default (Why / Where / Success / Failure) は Ask 昇格。ambiguous qualifier 由来の NotClear は通常 Ask ではなく Calibration Probe (3 candidates + Other)
- **Step D 再 Ask trigger 検出** (Round 2+): (i) 前 round Other の疑問文型、(ii) 曖昧語 / 空文字、(iii) tentative Assumption が再 walk で still NotClear、(iv) 前 round deferred Ask 残存。**2 種の Escalate 経路**: (a) 同 trigger の連続検出 → 短形式 `unresolved after N rounds: <item>` 記録 → Phase 2 遷移、(b) Ask overflow / 3-call budget overflow → 長形式 `Assumption (unresolved after N rounds): <observation>: unresolved — requires user confirmation in Phase 4 Step 7 Consolidated Interview` 記録 → Phase 4 Critic / Step 7 委任。trigger 0 件 → 収束
- **Step E Ask 発行**: 通常質問 max 3 + override 質問 1 (「このまま Phase 2 へ進む」/「追加確認が必要」)、4 件以上は次 round 繰り越し。Round 1 のみ Divergence Probing を別 AskUserQuestion call で発行 (0 candidates skip / 1 candidate single-select / 2-4 multiSelect、参考実装 URL 与えられている場合は必須)
- **Step F 回答処理**: override="Phase 2 へ進む" → 他回答を最終決定として記録 (曖昧語混在時も `Assumption: ... (user-overridden, flagged for Phase 4 Critic re-validation)`)、override="追加確認" かつ Round<3 → Round N+1、Round==3 → 強制 Phase 2 (`max rounds reached` 記録)、Ask 回答空文字 → trigger (ii) で次 round 候補 (override 優先時は user-overridden Assumption)

**Round 収束条件** (Phase 4 Step 4 Convergence check と同型):
- User override "Phase 2 へ進む"
- 再 Ask trigger 0 件
- 同じ trigger が連続 round で repeat → Escalate (Ask 発行せず Phase 2 へ、`unresolved after N rounds` 記録)
- Max rounds (3) reached

**Ask-item batch rules** (各 Round 内で適用):
- Ask = 0: Step E で override 質問のみ発行 (User override による脱出口を必ず残す)、または Round 2+ の trigger 判定が 0 件なら AskUserQuestion 自体 skip して収束
- Ask 1-3: 全件 + override で 1 回の AskUserQuestion call (合計 max 4 questions)
- Ask ≥ 4: Impact priority (cost-if-wrong: Outcome > Boundary > Context > Definition) で上位 3 件 + override、残りは次 round 先頭に繰り越し (3 round 超で残ったら Step D(b) の **長形式 `Assumption (unresolved after N rounds): <observation>: unresolved — requires user confirmation in Phase 4 Step 7 Consolidated Interview`** で記録し Phase 4 Step 7 委任 — overflow は長形式が canonical)

### Ambiguity Gate (exception outside the checklist)

This gate is a complementary safety net **only for cases the checklist cannot catch**:
- The request statement itself cannot be restated (uninterpretable / contradictory / insufficient information to summarize in one sentence)
- The request is only 1–2 words and yields no signal across any of the 8 observations

When the gate fires, do not run the checklist walk; first re-acquire the request statement via AskUserQuestion, then start the walk. Follow the Question triage rule (`~/.claude/CLAUDE.md`).

## Phase 2 — EXPLORE (non-trivial only)

Launch up to 3 Explore subagents in parallel, one message. Each agent's mandate should be distinct — don't duplicate searches across them.

Cover these **8 categories** across the scope:
1. Similar Implementations
2. Naming Conventions
3. Error Handling
4. Logging
5. Type Definitions
6. Test Patterns
7. Configuration
8. Dependencies

And trace **5 execution paths**:
1. Entry Points
2. Data Flow
3. State Changes
4. Contracts (APIs / interfaces)
5. Patterns (architectural)

### Empirical analysis (existing-behavior revisions)

When the plan modifies existing behavior, codebase-only exploration is insufficient — "specified to do X" and "actually useful as X in practice" are different questions. Augment Phase 2 with empirical evidence of how the target currently behaves.

- **Trigger (OR)**: `## Files to Change` has an UPDATE on a behavior-bearing target (source / executable / runtime config / skill/hook logic), OR the task contains existing-behavior-revision keywords (bug-fix / refactor / 仕様変更 / perf / CLI 出力 / semantics change)
- **Exempt** (unconditional, overrides triggers): (a) CREATE-only with no dependency on existing runtime behavior, OR (b) all UPDATEs target docs / comments / metadata only (no runtime behavior to observe), OR (c) complexity is `trivial`
- **Action** — when triggered, **repurpose one of the existing "up to 3 Explore subagents" slots** for an empirical mandate (total still 3 agents; no user-resource increase). The empirical subagent's mandate MUST instruct it to collect behavioral evidence using a two-tier strategy:
  - **Tier 1 — historical signals** from codebase-external records (use only those relevant to the target; full enumeration is not required):
    - `~/.claude/plans/*.md` and `~/.claude/plans/*.log.md` (past plan bodies + Deepening Logs — evolution of similar decisions)
    - `~/.claude/projects/**/subagents/*.jsonl` (past subagent transcripts — grep for the target skill/command name)
    - `~/.claude/retrospective-ledger.jsonl` (cross-session rule/instinct ledger)
    - `git log` / `git log -p` / `git log -- <target-file>` (commit history of the target)
  - **Tier 2 — direct current-behavior observation** (required when Tier 1 is absent or inconclusive for the target): actually run / invoke / exercise the target and capture real output. Examples: execute the CLI and record stdout/stderr/exit, trigger the hook manually and observe the intervention, read the current config and record its effective values. This is the fallback when no historical record exists, and also the ground truth that validates or contradicts Tier 1 findings.
  - After gathering, the subagent contrasts "what the spec says" vs "what actually happens" (frequency / effect / failure mode), explicitly noting whether each claim is backed by Tier 1 history, Tier 2 observation, or both.
- **Output** — the empirical subagent contributes one row to the Unified Discovery Table with `Category = Empirical Behavior` (existing `Category | File:Lines | Pattern | Key Snippet` schema unchanged). Details that do not fit in a single row go into Risks / Open Questions in Phase 3.

Why this matters: relying on codebase-only exploration is how plans anchor on "the rule fires as documented" and miss "…but catches 0 issues in practice". Empirical analysis surfaces that gap before Phase 3 DRAFT commits to a design.

Consolidate findings into a **Unified Discovery Table** (`Category | File:Lines | Pattern | Key Snippet`) consumed by Phase 3.

## Phase 3 — DRAFT (non-trivial only)

Write the initial plan to `~/.claude/plans/YYYYMMDDTHHmm-<slug>.md` (slug from request, max 40 chars, lowercase kebab).

### Language policy

- **Body prose** (Context / Approach / Risks / Open Questions / `-- Why: ...` rationales / any natural-language narrative): write in the **user's configured language** (from `~/.claude/settings.json`'s `language` field, injected by Claude Code CLI into the session's system prompt as the `# Language` section). For `language: japanese` write in Japanese; for `language: english` write in English; etc. Matches review-time reading language to reduce cognitive load.
- **Section headers** (`## Context`, `## Approach`, `## Files to Change`, `## Task Outline`, `## Verification Commands`, `## Definition of Done`, `## Completion Criteria`, etc.): keep in **English**. `completion-audit` and `/plan` Phase 5 locate sections by these literal strings.
- **Machine-consumed contents**:
  - `## Completion Criteria` body (Autonomous Verification / Requires User Confirmation / Baseline): English (consumed by `/plan` Phase 5 and `completion-audit`)
  - Acceptance criteria lines in Task Outline (`verification command + expected output`): English
  - File paths, commands, code snippets, `EXPECT:` values: as-is (no translation)
- **Mandatory Reading / Patterns to Mirror**: keep code snippets verbatim; prose around them follows the body-prose rule (user's language).

Log file `<plan>.log.md` (Deepening Log) follows the same policy.

### Required sections (complexity-gated)

| Section | trivial | small | medium+ |
|---|---|---|---|
| Context | ✓ | ✓ | ✓ |
| **Overview** (review decision helper, see below) | | ✓ | ✓ |
| Approach (incl. Alternatives Considered) | | ✓ | ✓ |
| **NOT Building** (out-of-scope) | | ✓ | ✓ |
| Mandatory Reading (P0/P1/P2 × file:lines × why) | | | ✓ |
| Patterns to Mirror (SOURCE: file:lines + snippet) | | | ✓ |
| **Intentional Conventions** (user-decided style / naming that diverges from canonical) | | | ✓ (when applicable) |
| Files to Change (CREATE / UPDATE) | ✓ | ✓ | ✓ |
| Task Outline | ✓ | ✓ | ✓ |
| Verification Commands (static / unit / build / integration / edge, with `EXPECT:`) | ✓ | ✓ | ✓ |
| Definition of Done | ✓ | ✓ | ✓ |
| Risks + Open Questions | | ✓ | ✓ |

### Overview section spec

Place Overview **immediately after Context, before Approach**. It is the first thing the user sees when `/plan` inlines the body — it must answer "what changes and where" in 30 seconds.

Pick whichever sub-elements are useful for THIS task. Do not pad — empty visualizations hurt more than help.

| Sub-element | When to include | Format |
|---|---|---|
| **Change at a glance** | always (when Overview is present) | 1-2 sentence elevator pitch of what changes and the user-visible outcome |
| **Workflow / Data flow** | tasks where execution order, data passing, state transitions, event chains, or hook pipelines are central to the change | ASCII diagram. For behavioral changes show **Before → After**; for new flows show **After** only |
| **File layout** | multi-file changes (3+ files) or new directory structure | Tree showing affected paths only (omit unchanged siblings) |
| **Per-file change matrix** | multi-file changes (3+ files) | Table: `path \| action (CREATE/UPDATE/DELETE) \| one-line WHAT changes` |
| **Key decisions** | small+ when there are non-obvious design choices | 3-5 bullets: `<decision> — <why>` (one line each) |

For `small` complexity: include "Change at a glance" + Per-file change matrix only.
For `medium+`: include all sub-elements that apply.

#### Overview template hints

- **Workflow**: ASCII `Before:` / `After:` blocks showing arrows + branch points (e.g. `user → A → [new gate] → B` with `↓ (block) → error` branch)
- **File layout**: ASCII tree of affected paths with inline `# UPDATE:` / `# CREATE:` annotations, omit unchanged siblings
- **Per-file matrix**: 3-column markdown table `Path | Action | What changes` with action ∈ {CREATE, UPDATE, DELETE}
- **Key decisions**: 3-5 bullets in `<decision> — <why>` one-line form

### Intentional Conventions section spec

Add this section when the plan touches conventions (naming, formatting, file layout) a fresh reviewer might flag as inconsistent without knowing they are deliberate. Surfaces user-decided style choices so `/santa-loop` reviewers don't waste rounds re-flagging them.

Each convention entry needs 3 minimal fields under `### <Convention name>`: `- **Convention**: <rule>`, `- **Scope**: <paths/sections>`, `- **Do not flag**: <explicit reviewer guidance>`. Free-form prose is allowed but not required. Abuse (burying bugs as "convention") is caught by Phase 4 Critic / Adversarial / Simplify passes.

**When to include**: rename / naming changes where the new name appears alongside siblings using a different convention, user-chosen non-canonical form, or any style a fresh reviewer might reasonably flag. **When to skip**: pure internal-logic changes, 100% canonical conventions, no style disputes. Do not pad.

`/santa-loop` reviewers are instructed (via `~/.claude/skills/santa-loop/references/reviewer-prompt.md`) to read this section and not flag documented items. Single defense layer — if a reviewer flags a documented item anyway, it surfaces as a normal NAUGHTY finding for the user to dismiss / accept / amend.

Keep the plan body lean (target ~120-150 lines, excluding Deepening Log). Move per-round critique history to `<plan>.log.md`.

### Apply ECC-derived structure

From the ECC `/prp-plan` research:
- **"NOT Building"** stops scope creep. Enumerate what is out-of-scope.
- **Patterns to Mirror** with `SOURCE: file:lines` snippets makes the plan self-contained. Golden rule: "If you would need to search the codebase during implementation, capture that knowledge NOW."
- **No Prior Knowledge Test** (self-check at end of Phase 4): "Can a developer unfamiliar with this codebase implement the feature using ONLY this plan?" If not, add the missing context.

## Phase 4 — DEEPEN (non-trivial only)

Embeds an iterative adversarial-critique flow. Prompts live at `references/critic-prompt.md` and `references/adversarial-prompt.md`.

### Step 1 — Context collection
Gather: the plan just written, project CLAUDE.md, parsed `argument-hint` (max-rounds, default 2, cap 5).

### Step 2 — Critic Subagent (each round, fresh)
Spawn a fresh `subagent_type: "Plan"` each round with `model: "opus"`.

Inputs to the Critic: full plan text, CLAUDE.md summary, round number, prior rounds' log (if any). Prompt template: `references/critic-prompt.md`.

### Step 3 — Process critique + classify
Triage each Critical Issue and Improvement Suggestion:
- **Self-resolvable**: main agent resolves via code investigation
- **Needs user input**: unverified assumption, scope ambiguity, trade-off requiring domain knowledge
- **Reject**: irrelevant or contradicts earlier user decision

Apply self-resolved changes inline with a `-- Why: ...` one-line rationale. Accumulate needs-user-input items into the **Consolidated Interview Queue** (see Step 7 below) — **do not interview mid-phase**.

Append a Round N entry to the log file (`<plan>.log.md`), link from the plan body.

### Step 4 — Convergence check
Stop Round loop when any condition holds:
- Critic verdict `CONVERGED`
- Max rounds reached
- Same issues repeat from prior round (escalate)
- Zero Critical Issues

Otherwise go back to Step 2 with a fresh subagent.

### Step 5 — Adversarial Falsification
After convergence, spawn one `subagent_type: "Explore"` with `references/adversarial-prompt.md`. Mandate: try to BREAK the plan by finding concrete code-level evidence that specific factual claims are false.

Skip only if the plan has no verifiable technical claims (pure doc change).

Classify findings: Falsified (fix plan, -- Why rationale) / Unverified (add to Edge Cases/Risks) / Verified (record 1 line "All claims verified") / Design Questions (add to Consolidated Interview Queue).

### Step 6 — Simplify Review (parallel with Step 5)
Spawn a fresh `plan-simplifier` subagent **via the Agent tool** in the SAME assistant turn as Step 5's Explore adversarial spawn. Both are true parallel tool calls — orthogonal mandates (Step 5: factual falsification; Step 6: structural simplification). The reviewer is context-isolated and spots defensive complexity accumulated across rounds.

```
Agent({
  subagent_type: "plan-simplifier",
  description: "Simplify review for plan",
  prompt: `## Original User Request\n\n<the user's original request>\n\n## Plan to Review\n\n<full plan text>\n\n## Project Design Principles\n\n<CLAUDE.md summary of YAGNI / KISS / DRY and relevant conventions>`
})
```

**Why direct Agent dispatch (not skill loading)**: Earlier designs invoked the simplification-review entry point via the skill-load path, which only loads the skill definition into context and does not spawn a subagent. In a single assistant turn where Step 5 also spawns an Explore subagent, that load call degrades to no-op — the simplifier effectively never runs. Direct Agent dispatch — `Agent({subagent_type: "plan-simplifier", ...})` — against the agent defined in `~/.claude/agents/plan-simplifier.md` is the only way to guarantee true parallel execution.

HIGH confidence simplifications auto-apply (subtractive only, no behavior change). MEDIUM/LOW proposals go to the Consolidated Interview Queue.

### Step 7 — Consolidated Interview (one call at the end of Phase 4)
**All needs-user-input items from Phase 2 Explore unknowns and Phase 4 Steps 3/5/6 are combined into a single `AskUserQuestion` call** (max 4 questions per call; if more, split into the minimum number of calls needed but never interview within a single Step). Phase 1 Requirement Clarification and the Ambiguity Gate run AskUserQuestion as a multi-round cycle at Phase 1 (up to 3 AskUserQuestion calls per cycle, fixed 3 for non-trivial), so they do not enter the Step 7 queue (at most 2 interview cycles per plan: Phase 1 cycle + Phase 4 Step 7 single call; worst case 4 blocking AskUserQuestion calls, or 5 if the Ambiguity Gate fires its own request-reacquisition Ask before Round 1).

This eliminates the 3-4 sequential blocking waits the older design caused. Present a `以下を自己解決しました:` block before the questions so the user can flag any disagreement.

### Step 8 — Definition of Done pipeline
Design observable Completion Criteria:
- **Autonomous Verification**: commands + EXPECT outputs. Tag each item (required for medium+):
  - `[file-state]` — verifiable by Read / Grep / Glob (frontmatter, rg residue, test -f)
  - `[orchestrator-only]` — needs host access a reviewer may lack (nix flake check, docker, sudo). `/santa-loop` Step 3 pre-runs and embeds evidence
  - `[outcome]` — circular (e.g. "/santa-loop returns NICE"), derived from this review's verdict
  - When unclear, default to `[orchestrator-only]` (over-running is cheaper than a false FAIL)
  - **Fail-fast**: untagged items in `### Autonomous Verification` reject the plan — `/santa-loop` Step 3 has no safety net. Exemption: trivial / small plans (tagging overhead unjustified for <3 items); medium/large/xl must tag every item
- **Requires User Confirmation**: items with a genuine blocking capability (fresh GUI login, subjective judgment, etc.) — format: `- <condition> — 理由: <blocker>` (the `理由:` token follows the plan body language; English plan bodies use `Reason:` instead)
- **Baseline**: tests / lint per task, `/completion-audit` + `/santa-loop` once at final gate (`/verification-loop` opt-in when deterministic re-execution is required)

Example tagged Completion Criteria:

```markdown
## Completion Criteria

### Autonomous Verification

- [file-state] `rg -l 'old-name' src/` returns empty
- [file-state] `src/new-file.ts` exists with frontmatter `kind: X`
- [orchestrator-only] `nix flake check` passes with exit 0
- [orchestrator-only] `docker build .` completes without error
- [outcome] `/santa-loop` returns NICE
```

Append `## Completion Criteria` section to the plan body (English, consumed by `/plan` Phase 5, `/completion-audit` (default final gate), and `/santa-loop` (via `Audit Verdict Input` from `/completion-audit`)).

## Phase 5 — DECOMPOSE

Main session decomposes the plan directly — no subagent dispatch. The main session already has the plan content in context from Phase 3/4, so a fresh subagent read would be redundant.

### Decomposition Rules

1. **1 task = 1 verifiable unit**: Granularity where completion can be confirmed independently.
2. **Verification within implementation tasks**: Each implementation task includes its own acceptance criteria with verification commands. Do not split verification out into standalone tasks — the only verification-only task allowed is the mandatory final gate in rule 5.
3. **Separation of concerns**: Different concerns go in separate tasks. Files sharing the same concern go in one task.
4. **Three elements of task descriptions**: Every task description must contain (1) target files to modify, (2) expected behavior after change, (3) acceptance criteria (verification commands + expected output).
5. **Final gate task**: Always include a final gate task titled `Run /completion-audit and /santa-loop`, `blockedBy` all implementation tasks. `/completion-audit` runs first (evidence-sufficiency audit reading per-task `metadata.evidence` against the plan's Completion Criteria — no re-execution), then `/santa-loop` runs (dual-reviewer, receives the audit verdict as `Audit Verdict Input`). `/verification-loop` is opt-in and invoked manually when deterministic re-execution is genuinely required.

### Acceptance Criteria by Change Type

Analyze the changes in the plan and embed appropriate acceptance criteria within each implementation task description:

| Change Type | Acceptance criteria to include |
|---|---|
| CLI script | Execute the script and confirm output matches expected values |
| Hook script | Reproduce the hook trigger condition and confirm intervention works |
| Web UI | Open the page with `/agent-browser`, take screenshots; check layout, console errors, responsiveness |
| Nix config | Confirm settings applied after `darwin-rebuild` |
| Skill/agent addition | Verify with skill-tester trigger test or manual invocation |
| Improvement task | Record a Before baseline and compare with After numerically |

`code-simplifier` dispatch is NOT a decomposition concern — `/impl` auto-spawns it per implementation task when that task's diff ≥ 20 files OR ≥ 500 lines. Do not create a standalone simplifier task here.

See `~/.claude/skills/completion-audit/references/behavioral-verification.md` for the detailed per-change-type verification template.

### Anti-patterns

- Creating separate verification tasks among implementation tasks (per-task verification is embedded in that task's acceptance criteria). The one exception is the final gate task required by rule 5.
- Verification tasks that only say "confirm" without specific commands.
- Missing `blockedBy` declarations for prerequisite dependencies.
- Missing final gate task.

### 2-pass TaskCreate (required)

Pass 1 — create all implementation tasks and collect their IDs:
```
for each implementation task in the decomposition:
    id = TaskCreate(subject, description, ...)
    implTaskIds.push(id)
```

Pass 2 — create the final completion-audit + santa-loop gate task with blockers:
```
gateId = TaskCreate(
    subject: "Run /completion-audit and /santa-loop",
    description: "Final gate. Execute in order:
      1. Invoke /completion-audit — must return VERIFIED PASS (fix evidence gaps + re-run on VERIFIED FAIL, max 3 tries by its internal loop).
      2. Invoke /santa-loop with plan file path and the audit verdict embedded as Audit Verdict Input — must return NICE (dual-reviewer verdict). /santa-loop does NOT re-judge completeness.
      Target: no additional files; verification-only.
      Expected behavior: /santa-loop emits 'SANTA VERDICT: NICE' and Reviewer A + Reviewer B both PASS.
      Verification: verbatim output captured in metadata.evidence.",
    ...)
TaskUpdate(gateId, addBlockedBy: implTaskIds)
```

-- Why: Before Pass 1, the impl task IDs are not yet assigned, so `blockedBy` cannot be set. The TaskCreate → TaskUpdate 2-pass resolves this.

Each task description must contain the **three elements**:
1. **target files** (exact paths)
2. **expected behavior after change**
3. **verification method** (command + expected output)

### Re-plan during /impl

If `/impl` needs a re-plan mid-execution:
- Keep `completed` tasks (evidence intact)
- Delete `pending` / `in_progress` tasks only
- Re-invoke `/plan`; main session decomposes with the completed-task summaries already in its context (avoid duplicate decomposition)

## Phase 6 — ACTIVATE

Touch the cwd-hash marker so `plan-gate.ts` unblocks Edit/Write/MultiEdit for the session.

**Important**: the `PLAN_FILE_PATH` value below is **template-substituted by the agent at invocation time** using the path decided in Phase 3. This is not a bash variable expansion — the agent writes the literal plan path into the bash command string.

```bash
REAL_PWD=$(realpath "$PWD")
CWD_HASH=$(printf '%s' "$REAL_PWD" | shasum -a 256 | cut -c1-16)
mkdir -p "$HOME/.claude/plans"
printf '%s\n' '<PLAN_FILE_PATH from Phase 3, agent-substituted>' > "$HOME/.claude/plans/.active-${CWD_HASH}"
```

-- Why: cwd-hash is computed from the realpath `$PWD` on both sides (bash `realpath` and TS `Deno.realPath`) so symlink-heavy cwd like `~/dotfiles` hash-match.

-- Why: 24h TTL is checked by `plan-gate.ts` only. The marker has no explicit cleanup — each `/plan` invocation refreshes mtime. If the user abandons a feature and starts another a day later, the marker naturally expires and `/plan` must be re-run.

### Output to user

Emit the **full plan body inline** so the user can approve without opening the file, followed by a metadata block:

```
## Plan
<full plan body, verbatim>

---

## Plan ready
- File: <plan path>
- Complexity: <trivial/small/medium/large/xl>
- Tasks: <count> (+ /completion-audit + /santa-loop gate)
- Gate: active until <24h from now>

Run `/impl` when you approve.
```

**xl fallback** (plan > ~600 lines): replace the full-body block with a TOC of `##`-level section headings + plan path, keep the metadata block. Inlining xl plans hurts more than helps; everything smaller benefits from single-screen review.

## Integration with existing skills

- `plan-simplifier` subagent: dispatched in Phase 4 Step 6 (details there). `/simplify-review plan` exposes the same reviewer for manual ad-hoc use.
- `/qa-planner`, `/agent-browser` load-before-planning rules from CLAUDE.md still apply — load them in Phase 1 or Phase 2 if the task requires.
- `/obsidian-cli` applies when the plan involves vault work.

## Design decisions

**Why fused instead of chained**: multi-command chaining (`/design → /deepen → /decompose`) was rejected. A single command eliminates hand-off overhead and guarantees decomposition always happens (prior hook-based dispatch was unreliable; Phase 5 is now inlined).

**Why PreToolUse gate instead of UserPromptSubmit redirect**: a blocking hook on `Edit|Write|MultiEdit` enforces design-first even when CC plan mode fails. Bootstrap risk (editing the gate itself) is handled by the infra-path allowlist in `plan-gate.ts`.

**Why complexity-gated plan sections**: trivial changes don't need 10 sections; forcing them produces empty template fields.

**Why consolidated interview**: interviewing inside each Step would block the user 3-4 times per plan. One queue, one call.
