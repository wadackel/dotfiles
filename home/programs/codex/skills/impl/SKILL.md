---
name: impl
description: Executes a plan created by `$plan`, verifies the final working tree, and runs main-session Audit with risk-selected Review. Emits AUDIT_VERDICT / REVIEW_VERDICT. Runs only when explicitly invoked with `$impl`.
---

# $impl

Execute the agreed outcome task by task, preserving constraints and recording verification against the actual artifacts. Keep user-facing output in the user's configured language.

## Quick Start

```
$impl
$impl /absolute/path/to/plan.md
```

## Resolve and recover

Use the explicit plan path, or the path already pinned in this conversation. Only when neither exists, resolve the cwd's display marker. Never select the newest plan by directory scan.

```bash
rtk proxy deno run --allow-env=HOME --allow-read --allow-write --no-prompt ~/.codex/scripts/codex-plan-marker.ts resolve - "$PWD"
```

Replace `-` with the known absolute plan path when resuming. Expired markers are acceptable for resolution; the 24-hour TTL controls picker display only. An absent or ambiguous pointer needs a plan selection, not automatic re-planning. Keep the returned path and repository root in the session's recovery summary. An explicit path must not replace another session's display pointer.

Read the plan and normalize its `.evidence.json` using the helper described in [Evidence commands](references/evidence.md). JSON is the task-state source of truth. If `update_plan` is available, mirror it there; otherwise report progress directly. Never invent successful tool calls.

At the first task, `start` binds the canonical repository. On resumption, use the pinned path and run `reconcile` before choosing work. For legacy sidecars without a repository, validate the plan's paths against the current checkout, then bind with `start`; declare their acceptance checks and reverify. Old evidence stays in history but does not establish current completion.

`reconcile` reopens completed tasks whose checks are missing or stale. Inspect the artifacts before reimplementing: a later legitimate edit may only require re-verification. Never discard partial work or roll it back merely because evidence expired. Stop on repository mismatch, invalid paths, or corrupt evidence rather than silently resetting state.

## Task loop

1. Read the original purpose, constraints, non-goals, acceptance criteria, and implementation discretion alongside the plan. Preserve pre-existing user edits. Capture the initial dirty file list so an aggregate diff does not imply ownership of unrelated changes. When changing review or approval instructions, preserve the governing review rules before editing; the edited rules cannot reduce this run's required verification.
2. Identify every required check, including `[live]` and items under Requires User Confirmation. Tell the user early about observations requiring their participation; continue independent work. A required observation stays blocked until evidence or explicit waiver arrives.
3. For each implementation task, call `start` from the repository root and declare its acceptance checks with `require`. Each task needs target files, expected behavior, and a verification method. If the approved plan assigns deployment or integration checks to the final task, declare them there from the outset; completing local implementation does not complete the overall outcome. Recover missing technical detail from the repository; ask only if the missing information changes the agreed outcome.
4. Implement the behavior. For test-first work, keep `red (expected FAIL)` and `green (expected PASS)` outputs in the evidence; only the green result establishes acceptance. Do not introduce redundant tests for a low-impact edit.
5. Before each acceptance check, obtain a `snapshot` token. Run the verification and `record` its raw output, command or observation method, status, and that token. Redact credentials from stored or displayed output. If verification changes the artifact or gate generation, rerun against the stable artifact; do not attach old output to a new token.
6. Call `complete` only after all required checks succeed or the user explicitly waives an eligible check. A `blocked` result is not success. Repeat for the remaining implementation tasks, then run the final gate.

For external artifacts, `[live]` evidence must identify what was actually observed: deployed binary digest, applied configuration, current PR head and checked CI head, or runtime URL/version and role. Compare the expected and observed artifact identities before recording PASS. Local fingerprint equality alone proves nothing about deployment or CI freshness. Require a fresh external observation at the final gate even if repository contents are unchanged.

## Implementation discretion

Proceed with reversible changes to internal paths, naming, or implementation mechanics when they preserve the agreed behavior, compatibility, dependency choices, and operating conditions. Record the adjustment and reason with `append-evidence`; keep the plan's technical instructions accurate. Updating the plan invalidates older check targets.

Ask before changing the purpose, public behavior, scope, acceptance criteria, dependencies with operational consequences, cost, or destructive operations outside existing authorization. Show the concrete decision and its consequence. Wait for the answer while continuing independent work; elapsed time is not approval. Do not ask again for a decision already made in the conversation or an accepted Issue.

When the user explicitly requests re-planning, preserve the prior plan and evidence as history. Create a new plan and transfer applicable completed work as evidence to revalidate, without deleting the old task records. Do not add a second confirmation just to begin requested re-planning.

## Final gate: built-in Audit and Review

The trailing task is `Final Audit + Review`. Start it after implementation tasks complete. Work on a stable target with one writer. If any artifact or the plan changes during this gate, invalidate all gate results, repeat required acceptance checks, and rerun the selected reviews. A previous specialist PASS cannot survive a later review fix without re-review.

### Aggregate simplification

Use the first implementation task's `baseline_sha` as the aggregate review baseline, never as a per-task change counter. Include untracked additions, deletions, and mode changes. Review simplification in the main session before the gate. Diff size alone does not select an agent. Use `code-simplifier` only for an explicitly requested independent simplification review. Apply only behavior-preserving, high-confidence simplifications. Reverify after edits. Do not create automatic per-task commits to work around cumulative diffs.

### Built-in Audit

Declare checks for every acceptance item on its owning task; deployment/integration checks explicitly assigned to the final task remain required there. Declare `audit` plus every selected review on the final task. Requirements are additive. Audit the plan against the actual implementation and complete verification evidence:

- `[file-state]`, `[orchestrator-only]`, and `[live]` all gate completion.
- Requires User Confirmation items also gate completion unless explicitly waived. Preserve the user's authorization with the waiver.
- Reuse a local check only if `reconcile` confirms its stored artifact hash is current; rerun stale checks. Repeat external observations at the final gate.
- `[outcome]` verdicts are circular: evaluate them after Review, never as substitutes for acceptance evidence.
- Confirm all implementation tasks have current evidence before recording the audit result.

Emit `AUDIT_VERDICT: PASS` or `AUDIT_VERDICT: FAIL <reason>`. Record the audit check against the current target. On failure, investigate and fix the evidence gap before review. A waiver cannot replace Audit or Review.

### Built-in Review

Construct the review inputs using `git diff <first-task baseline_sha>` and `git ls-files --others --exclude-standard`. Include untracked files in both the scope and trigger analysis. Do not use a committed-only `<sha>..HEAD` diff. Inspect paths and regular files locally; do not follow untracked symlinks outside the repository or insert raw sensitive contents into prompts.

Select review from the actual change and the original acceptance criteria. File extensions, line counts, and automatically loaded specialist skills do not independently select more agents.

- Empty scope: record an empty-scope review; no agent is needed.
- Low-risk scope: the main session reviews mechanical prose, comments, formatting, and other changes with no behavioral or safety effect. Use a `main-review` check and `Review executor: main session`; inspect the original acceptance criteria and diff, and record the canonical MUST_FIX/verdict format below. Do not describe this as independent review.
- Behavior changes or non-local correctness questions: select one `code-reviewer` for combined Spec Compliance, Code Quality, and relevant domain concerns. Agent instructions, permissions, and review/approval rules change behavior even when written as one-line Markdown; they require independent review.
- Additional specialists: select only for a concrete concern the combined review cannot adequately cover, or an explicit user request. Record each extra role's distinct question. Apply the security criteria below separately.

Run selected independent reviewers against the same frozen target, at most three concurrently; collect every result before editing. Start initial independent reviews with a fresh context (`fork_turns: "none"` when supported). Give them the original purpose, constraints, acceptance criteria, plan or its path, aggregate diff, changed file paths, necessary source references, and applicable AGENTS paths. Omit the implementer's conclusions and other reviewers' findings before the initial pass. If fresh context is unavailable, disclose the limitation and leave required independent review incomplete rather than substituting main-session Review.

#### Combined Generic Review

When independent review is selected, use one `code-reviewer` for Spec Compliance and Code Quality plus the relevant domain concerns below. Findings include `Area: SPEC|QUALITY`, `MUST_FIX`, `SHOULD_FIX`, `NIT`, and a standalone final `VERDICT: PASS|FAIL`.

Selectively full-read changed files when the diff cannot establish correctness; do not eagerly read every file in full. The Codex adapter's reading policy takes precedence over its Claude source. Review the original acceptance criteria as well as the implementation plan.

#### Domain-Specific Reviewer Dispatch

Use this table as a checklist for the main session and combined reviewer. An extension or framework match identifies review concerns, not an instruction to spawn. Add the named specialist only when a distinct, concrete risk needs separate investigation; record that risk before dispatch.

| Agent | Review concerns |
|---|---|
| `rust-reviewer` | Ownership, unsafe code, Send/Sync, error flow, async behavior |
| `go-reviewer` | Goroutines, context propagation, locking, interfaces, nil values |
| `dart-reviewer` | Null safety, widget state, async cleanup, streams, platform channels |
| `nix-reviewer` | Evaluation, package/module integration, activation and deployed configuration |
| `typescript-reviewer` | Type safety, async correctness, module and runtime boundaries |
| `react-reviewer` | Hooks, effects, rendering and state behavior |
| `a11y-reviewer` | Semantics, keyboard flow, ARIA, contrast, screen reader behavior |
| `database-reviewer` | Queries, schema changes, migrations, transactions and data integrity |
| `deno-reviewer` | Runtime permissions, Deno APIs, module specifiers and configuration |
| `cloud-architecture-reviewer` | Infrastructure changes, workflow permissions, deployment and service boundaries |

#### Security Dispatch Heuristic

Add `security-auditor` when changes alter permission or trust boundaries, secret/credential handling, authentication/authorization, or the handling of untrusted input reaching commands, SQL, evaluation, paths, or external requests. Inspect the actual data flow and changed behavior; a path such as `scripts/` or a word such as `spawn` alone is not a security trigger.

**Reviewer self-modification**: changes to agent review or approval instructions require security review. This includes meaningful changes to AGENTS.md, the source that generates it, Codex/Claude reviewer definitions, delegation policy, and skills controlling review or approval. Treat them as prompt/control-plane changes even when the diff is small or Markdown-only. Preserve this run's governing review requirements when those instructions are edited; do not use the new rules to reduce the current gate.

#### Review lifecycle budget

Keep a ledger of executor, agent ID when applicable, role, target, attempt, and result. Collect every result before fixing. Reuse the same reviewers for rechecks; give them the updated artifact and relevant changes. Close them only when the review is finished and the runtime supports it; absence of that operation is not a failed review. Do not spawn nested agents. If capacity is exhausted, collect outstanding results and retry dispatch once. Unavailable required review remains blocked; do not substitute an invented PASS or local self-review.

A successful review output, including main-session review, needs exactly one `### MUST_FIX` section containing `- None` and a final `VERDICT: PASS`. A malformed or missing verdict, non-empty MUST_FIX, or `VERDICT: FAIL` fails the review. Confirm each finding against the artifact and requirements; resolve actual blockers, and record rejected false positives with evidence. Report non-blocking suggestions without treating them as mandatory scope expansion.

Use at most three review waves. A fix changes the target, so the next wave reruns all selected reviewers and required verification, including earlier PASS results; reuse the existing agents rather than creating fresh IDs. Never remove already-declared review requirements to accept fewer results. If only a response format was invalid and the target stayed identical, repeat only that response. After the limit, preserve the in-progress gate and report unresolved blockers.

Record each review result separately, distinguishing main-session checks from independent reviewer checks. Emit per-section `SECTION_VERDICT: PASS|FAIL`, then exactly one final `REVIEW_VERDICT: PASS` or `REVIEW_VERDICT: FAIL`. All required review checks must pass on the current target before closing the gate.

## Finish

After current Audit and Review PASS, check deferred `[outcome]` criteria and call `complete` for the final task. The helper checks the implementation evidence again, so a stale task result cannot be hidden by a newer audit. Clear only this plan's display pointer with `codex-plan-marker.ts clear-matching <pinned-plan-path> "$PWD"`.

Report the resulting behavior, relevant verification, and remaining limitations concisely. Keep raw outputs and full review findings in the evidence artifact; link it and summarize non-blockers. If a required observation, review, or user decision remains unresolved, state that implementation is ready but verification is incomplete and leave the gate in progress. Never declare completion from the absence of further ideas.
