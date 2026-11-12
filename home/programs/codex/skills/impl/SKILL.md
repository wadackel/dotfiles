---
name: impl
description: Executes a plan created by `$plan`, establishes each completion criterion by observing its state, observes again on the final tree what later edits could have changed, and runs risk-selected Review. Emits REVIEW_VERDICT. Runs only when explicitly invoked with `$impl`.
---

# $impl

Execute the agreed outcome task by task, preserving constraints and verifying against the actual artifacts. Keep user-facing output in the user's configured language.

## Quick Start

```
$impl
$impl /absolute/path/to/plan.md
```

## Resolve and recover

Use the explicit plan path, or the path already pinned in this conversation. Only when neither exists, resolve the cwd's display marker. Never select the newest plan by directory scan.

```bash
rtk proxy ~/.codex/scripts/codex-plan-marker.ts resolve - "$PWD"
```

Replace `-` with the known absolute plan path when resuming. Expired markers are acceptable for resolution; the 24-hour TTL controls Agentower display only. An absent or ambiguous pointer needs a plan selection, not automatic re-planning. Keep the returned path and repository root in the session's recovery summary. An explicit path must not replace another session's display pointer.

Read the plan; `<slug>` below is its basename without `.md`. Words after `$impl` that name how far to ship (`PR まで`, `stack`, `draft`, `merge まで`, `commit まで`) replace the matching lines of `## Delivery` before the first task, and `merge まで` also raises `Level` to at least `pr` and sets `Draft: no`, since a draft cannot merge; a raised `Level` whose `Via` is `none` takes the repository's PR skill, else `$create-pr` (`$gh-stack` for `stack`); `commit まで` and `draft` set `Merge: no`; a plan raised to `stack` with no `Layer:` lines takes one layer per task; say the replaced lines in one message. A plan without `## Delivery` ships as `Level: none`. Invoking `$impl` approves the Delivery and the Verification Grants: the pushes, PRs, and merges they name are not asked again. If `update_plan` is available, mirror the tasks there; otherwise report progress directly. Never invent successful tool calls.

With `Level: pr` on the default branch, create a feature branch before the first edit; with `Level: stack`, create each task's `Layer:` branch as `~/.agents/skills/gh-stack/SKILL.md` says (`gh stack init` for the bottom, `gh stack add` above it) before that task's first edit, and commit the layer's tasks before adding the next layer. With `Level` `commit` or above, commit before the final gate, staging only the files the plan's tasks changed, never one that was uncommitted before the plan. Before the first edit, run `git update-ref refs/impl-base/<slug> HEAD` in the plan's repository; a ref of the same name left by an earlier run is overwritten. When the sandbox keeps `.git` read-only and the ref cannot be written, state the `git rev-parse HEAD` sha in the conversation and use it wherever the ref is named, on resumption too, and skip the deletion at Finish. Review diffs from it, and it survives compaction. On resumption, use the pinned path, then read the state from `git status`, `git diff --stat refs/impl-base/<slug>` and the task list before choosing work; when the ref is missing, say so and use `HEAD`. Inspect the artifacts before reimplementing: a later legitimate edit may only require re-verification. Never discard partial work or roll it back merely because a check has to run again.

## Task loop

1. Read the original purpose, constraints, non-goals, acceptance criteria, and implementation discretion alongside the plan. Preserve pre-existing user edits. Capture the initial dirty file list so an aggregate diff does not imply ownership of unrelated changes. When changing review or approval instructions, preserve the governing review rules before editing; the edited rules cannot reduce this run's required verification.
2. Identify every required check, including `[live]` and items under Requires User Confirmation. Try each Requires User Confirmation item yourself when its `Needed by` comes, and tell the user only about those whose attempt failed, with the command and its output; continue independent work. A required observation stays blocked until the observation or an explicit waiver arrives.
3. Each implementation task needs target files, expected behavior, and a verification method. If the approved plan assigns deployment or integration checks to the final task, they stay required there; completing local implementation does not complete the overall outcome. Recover missing technical detail from the repository; ask only if the missing information changes the agreed outcome.
4. Before writing, read every review card in `~/.agents/skills/plan/references/review-cards/` whose `Trigger:` line matches a path or the content of the task's target files; they are the checks the combined reviewer applies. When the task adds or fixes behavior a test can observe, write new or updated regression tests before changing the source they cover. Run each test and require a failure caused by the missing behavior: a test that already passes does not observe the change, and a setup or environment failure is not a regression signal. Correct the test or its setup before proceeding, and keep the `red (expected FAIL)` output in the conversation. Implement the behavior, then keep the `green (expected PASS)` output; only the green result establishes acceptance. Do not introduce redundant tests for a low-impact edit. A config value, skill or document text, or a refactor the existing tests already cover gets no new test: run the changed thing instead.
5. Establish each Autonomous Verification criterion of the task: choose how to observe the stated state, run it, and read the output, not a summary of it. A `live` criterion is observed by the means its `観測:` line names; when that means cannot work here, use another and keep why and what it leaves weaker for the report. For a `live` check, observe the real surface and report the observation method and the raw result. Bring the surface up yourself: a server or watcher in the background, a TUI in a tmux pane read with `capture-pane`, a page through `$agent-browser` (`abr` for a signed-in session), test data in dev, an operation listed under `## Verification Grants`. For a rendered change, take the screenshots, view each image, and compare it with the one taken before the task's first edit. A failing `live` check is a defect: fix it and run it again until it passes. An operation outside local and dev that no grant lists is asked as in Implementation discretion. Redact credentials from displayed output.
6. A task is complete once all required checks succeed or the user explicitly waives an eligible check. A blocked check is not success. Repeat for the remaining implementation tasks, then run the final gate.

For external artifacts, `[live]` evidence must identify what was actually observed: deployed binary digest, applied configuration, current PR head and checked CI head, or runtime URL/version and role. Compare the expected and observed artifact identities before reporting PASS. Local fingerprint equality alone proves nothing about deployment or CI freshness. Require a fresh external observation at the final gate even if repository contents are unchanged.

## Implementation discretion

Proceed with reversible changes to internal paths, naming, or implementation mechanics when they preserve the agreed behavior, compatibility, dependency choices, and operating conditions. Name the adjustment and reason in the final report; keep the plan's technical instructions accurate.

Ask before changing the purpose, public behavior, scope, acceptance criteria, dependencies with operational consequences, cost, or destructive operations outside existing authorization. Show the concrete decision and its consequence, one question per turn, in the format and with the facts `~/.agents/skills/plan/references/interview.md` requires. Wait for the answer while continuing independent work; elapsed time is not approval. Do not ask again for a decision already made in the conversation or an accepted Issue.

When the user explicitly requests re-planning, preserve the prior plan as history. Create a new plan and carry applicable completed work over to revalidate. Do not add a second confirmation just to begin requested re-planning.

## Final gate: built-in Audit and Review

The trailing task is `Final Audit + Review`. Start it after implementation tasks complete. Work on a stable target with one writer. First observe again any criterion a later edit could have changed, take each `[live]` observation again when the tree changed since it was made, and run the suite-style checks once on the final tree. If any artifact or the plan changes during this gate, run them again and rerun the selected reviews. A previous specialist PASS cannot survive a later review fix without re-review.

### Aggregate simplification

Use `refs/impl-base/<slug>` as the aggregate review baseline, never as a per-task change counter. Include untracked additions, deletions, and mode changes. Review simplification in the main session before the gate. Diff size alone does not select an agent. Use `code-simplifier` only for an explicitly requested independent simplification review. Apply only behavior-preserving, high-confidence simplifications. Reverify after edits. Do not create automatic per-task commits to work around cumulative diffs.

### Built-in Audit

The audit establishes the criteria on the final tree, not a verdict you write. Every acceptance item on its owning task stays required; deployment/integration checks explicitly assigned to the final task remain required there. Requirements are additive. Before review:

- Run the routine checks named by the repository's `AGENTS.md` or `CLAUDE.md` (formatter, lint, type check), even when the plan omitted them; read their output and fix failures before Review. When a routine check also establishes an Autonomous Verification criterion, the same final run satisfies both. These checks follow the final gate's rerun rule after later edits, including review fixes.
- `[file-state]`, `[orchestrator-only]`, and `[live]` all gate completion. Requires User Confirmation items also gate completion unless explicitly waived; quote the user's authorization with the waiver.
- Every Autonomous Verification bullet other than `[outcome]` has, in the conversation, an observation of the final tree or the reason it was not established. Repeat external observations at the final gate.
- `[outcome]` verdicts are circular: evaluate them after Review, never as substitutes for acceptance checks. A waiver cannot replace Review.

### Built-in Review

Construct the review inputs using `git diff refs/impl-base/<slug>` and `git ls-files --others --exclude-standard`. Include untracked files in both the scope and trigger analysis. Do not use a committed-only `<sha>..HEAD` diff. Inspect paths and regular files locally; do not follow untracked symlinks outside the repository or insert raw sensitive contents into prompts.

Select review from the actual change and the original acceptance criteria. File extensions, line counts, and automatically loaded specialist skills do not independently select more agents.

- Empty scope: report an empty-scope review; no agent is needed.
- Low-risk scope: the main session reviews mechanical prose, comments, formatting, and other changes with no behavioral or safety effect. Report it as a `main-review` result with `Review executor: main session`; inspect the original acceptance criteria and diff, and write the canonical MUST_FIX/verdict format below. Do not describe this as independent review.
- Behavior changes or non-local correctness questions: select one `code-reviewer` for combined Spec Compliance, Code Quality, and relevant domain concerns. Agent instructions, permissions, and review/approval rules change behavior even when written as one-line Markdown; they require independent review.
- Additional specialists (`database-reviewer`, `cloud-architecture-reviewer`): select only for a concrete concern the combined review cannot adequately cover, or an explicit user request. State each extra role's distinct question. Language concerns never select a specialist; they go to the combined reviewer through its review cards. Apply the security criteria below separately.

Run selected independent reviewers against the same frozen target, at most three concurrently; collect every result before editing. Start initial independent reviews with a fresh context (`fork_turns: "none"` when supported). Give them the original purpose, constraints, acceptance criteria, plan or its path, aggregate diff, changed file paths, necessary source references, and applicable AGENTS paths. Omit the implementer's conclusions and other reviewers' findings before the initial pass. If fresh context is unavailable, disclose the limitation and leave required independent review incomplete rather than substituting main-session Review.

#### Combined Generic Review

When independent review is selected, use one `code-reviewer` for Spec Compliance and Code Quality plus the relevant domain concerns below. Findings include `Area: SPEC|QUALITY`, `MUST_FIX`, `SHOULD_FIX`, `NIT`, and a standalone final `VERDICT: PASS|FAIL`.

Selectively full-read changed files when the diff cannot establish correctness; do not eagerly read every file in full. The Codex adapter's reading policy takes precedence over its Claude source. Review the original acceptance criteria as well as the implementation plan.

#### Domain-Specific Reviewer Dispatch

Language and surface concerns are review cards in `~/.agents/skills/plan/references/review-cards/<name>.md` (`typescript`, `react`, `a11y`, `nix`, `rust`, `go`, `dart`, `deno`), 20–30 lines each. Paste every card whose `Trigger:` line (line 2 of the card) matches the aggregate diff into the combined `code-reviewer` prompt verbatim; the card is the only place its trigger is written. An extension match selects a card, never an agent.

Two separate agents remain for a blast radius the combined review cannot cover; add one only when a distinct, concrete risk needs separate investigation, and state that risk before dispatch.

| Agent | Trigger | Review concerns |
|---|---|---|
| `database-reviewer` | `.sql`, `migrations/`, schema files: a change to a persisted format | Schema changes, migrations, transactions and data integrity |
| `cloud-architecture-reviewer` | `.tf` `.tfvars`, k8s / Helm, `Dockerfile`, `docker-compose`, `.github/workflows` | Infrastructure changes, workflow permissions, deployment and service boundaries |

#### Comment Review Card

Before selecting reviewers, read `~/.claude/skills/impl/references/comments-card.md` when its `Trigger:` matches the aggregate diff. Follow its scope and exclusions: apply the card in `main-review`, or paste it verbatim into the selected `code-reviewer` prompt for independent review. Do not dispatch `comment-reviewer` just because the card matches. The card supplies checks, not a different verdict policy: MUST_FIX remains blocking; SHOULD_FIX and NIT remain non-blocking under the Codex review contract.

#### Security Dispatch Heuristic

Add `security-auditor` when changes alter permission or trust boundaries, secret/credential handling, authentication/authorization, or the handling of untrusted input reaching commands, SQL, evaluation, paths, or external requests. Inspect the actual data flow and changed behavior; a path such as `scripts/` or a word such as `spawn` alone is not a security trigger.

**Reviewer self-modification**: changes to agent review or approval instructions require security review. This includes meaningful changes to AGENTS.md, the source that generates it, Codex/Claude reviewer definitions, delegation policy, and skills controlling review or approval. Treat them as prompt/control-plane changes even when the diff is small or Markdown-only. Preserve this run's governing review requirements when those instructions are edited; do not use the new rules to reduce the current gate.

#### Review lifecycle budget

Keep a list in the conversation of executor, agent ID when applicable, role, target, attempt, and result. Collect every result before fixing. Reuse the same reviewers for rechecks; give them the updated artifact and relevant changes. Close them only when the review is finished and the runtime supports it; absence of that operation is not a failed review. Do not spawn nested agents. If capacity is exhausted, collect outstanding results and retry dispatch once. Unavailable required review remains blocked; do not substitute an invented PASS or local self-review.

A successful review output, including main-session review, needs exactly one `### MUST_FIX` section containing `- None` and a final `VERDICT: PASS`. A malformed or missing verdict, non-empty MUST_FIX, or `VERDICT: FAIL` fails the review. Confirm each finding against the artifact and requirements; resolve actual blockers, and give the reason for each rejected false positive. Report non-blocking suggestions without treating them as mandatory scope expansion.

Use at most three review waves. A fix changes the target, so the next wave reruns all selected reviewers and required verification, including earlier PASS results; reuse the existing agents rather than creating fresh IDs. Never remove already-declared review requirements to accept fewer results. If only a response format was invalid and the target stayed identical, repeat only that response. After the limit, preserve the in-progress gate and report unresolved blockers.

Report each review result separately, distinguishing main-session checks from independent reviewer checks. Emit per-section `SECTION_VERDICT: PASS|FAIL`, then exactly one final `REVIEW_VERDICT: PASS` or `REVIEW_VERDICT: FAIL`. All required review checks must pass on the current target before closing the gate.

## Delivery

After the final gate's `REVIEW_VERDICT: PASS`, ship as `## Delivery` says; while the gate is left in progress, nothing is pushed. Codex cannot invoke one skill from another, so read the named skill's SKILL.md under `~/.agents/skills/` and follow it. With `Level` `commit` or above, first commit what the gate changed after the pre-gate commit, under the same staging rule; in a stack, commit each fix on the layer whose files it touches and run `gh stack rebase --upstack`.

- `none`: leave the change uncommitted. `commit`: the commit stands. `push`: push the current branch.
- `pr`: follow `Via` (`$create-pr` with `no-watch`, since the next step watches CI, or the repository's PR skill), as a draft when `Draft: yes`. `stack`: follow `$gh-stack` to submit the stack (`gh stack submit --auto` opens drafts; `--open` when `Draft: no`).
- Then follow `$iterate-pr` on each PR until CI passes, fixing failures and pushing again; with `Draft: yes` the PR stays a draft, so skip its step that marks the PR ready. A layer above the bottom that reports no checks waits until it becomes the bottom.
- Merge only with `Merge: yes` and when no hunk meets `~/.agents/skills/plan/references/human-review.md`: in its own tool call; with an `ALL_PASS` whose head, recorded with `gh pr view --json headRefOid`, still matches right before merging; with no review comment triaged `ask` left open; a stack one layer at a time from the bottom with `gh stack merge <PR> --yes`, each followed by `gh stack sync` and `$iterate-pr` on the new bottom. When a hunk meets it, the PRs stay open and the merge goes to the user.
- After a merge that a Verification Grant covers, wait for the deploy and run the `live` items that observe production; a failure there is fixed through a new PR that sets a new start ref and goes through the final gate and these steps again.

## Finish

After current Audit and Review PASS, check deferred `[outcome]` criteria, then delete the start ref with `git update-ref -d refs/impl-base/<slug>`; while a gate is left in progress it stays. Clear only this plan's display pointer with `codex-plan-marker.ts clear-matching <pinned-plan-path> "$PWD"`.

Report in the conversation, in the conversation's language; nothing is written to a file. The reader decides three things from it: whether to accept the change without reading the diff, what to decide now, and what to take up next. Write it from the side of the request, not of the work: answer what was asked, state conclusions as conclusions, and keep a reason wherever the reader needs it to trust or decide. The test of length is whether the reader can decide on one read; leave out process narration, hashes, and raw output, and translate a severity or a check id into what it means. Open with a few lines: whether the request is met, with an answer to each concern the user raised while planning; how many things were not established, when any were; how far it shipped (uncommitted, committed, pushed, the PR URLs with CI state, merged); and the review verdict in words. Then these sections, with these headings in this order, each only when it has content:

- **使う人から見て変わること**: the behavior before and after for whoever uses the changed surface; an example, pseudo-code, or a diagram when words alone would not build the picture.
- **変更したファイル**: a tree in a code block, one line per file with a few words on what changed; fold a directory with `(N)` when the tree runs long. Mark `← レビューしてほしい` for a hunk `~/.agents/skills/plan/references/human-review.md` lists (applied to the same range Built-in Review read), `（計画外）` for a file the plan did not name, and `（削除あり）` where existing content was removed; a file the plan did not name, or a path, name, or mechanism changed from the plan, says why on its line. Below the tree, `レビューしてほしい N か所` with one line per marked hunk, in the line form that file gives.
- **確かめたこと**: each completion criterion established and how; a `[live]` one observed by other means than its `観測:` line says which and what that leaves weaker. The routine checks in one line.
- **確かめていないこと**: each criterion or risk not established: what, why, what happens if it is wrong, and how it could be established. A `[live]` item waived or handed to the user goes here with their steps.
- **次に進められること**: the state outside the diff (whether the issue can close, PR and CI state, links) and what can be taken up next.
- **あなたに決めてほしいこと**: the count, then the first one as a question in the format `~/.agents/skills/plan/references/interview.md` gives; the rest are asked one per turn. They are: a finding deferred on purpose, an open security finding, a resurfaced dismissed finding, an assumption implemented as `user-overridden: default` (its value, marked 仮置き), and each open blocker when the gate is left in progress.

If a required observation, review, or user decision remains unresolved, state that implementation is ready but verification is incomplete and leave the gate in progress. Never declare completion from the absence of further ideas.
