---
name: impl
description: Plan implementation skill. Executes the plan created by `$plan` task by task, then runs built-in Audit and Codex subagent Review phases that emit AUDIT_VERDICT / REVIEW_VERDICT. Runs only when explicitly invoked with `$impl`; auto-loading is disabled by agents/openai.yaml. Because Codex has no skill-to-skill invocation API, the final gate is implemented inside this skill.
---

# $impl

Executes the plan created by `$plan` in task order, then determines completion with built-in Audit and Codex subagent Review. Sole source of truth for the per-task loop, deviation handling, code-simplifier thresholds, built-in Audit + Review orchestration, plan-adherence checking, and recovery after context compaction.

User-facing progress and final reports remain in the user's configured language. This English rewrite changes only the skill instruction prose.

## Quick Start

```
$impl              # Process every pending task in update_plan order
```

## Approval gate

`$impl` reads the active plan from a cwd-hash marker that `$plan`'s ACTIVATE created **and that the user explicitly approved**.

```
ACTIVE  = ~/.codex/plans/.active-<cwd-hash>
PENDING = ~/.codex/plans/.pending-<cwd-hash>
```

Markers are cwd-scoped: each repository checkout has a unique `<cwd-hash>` derived from `$PWD`. A marker held by a different cwd does not grant edit rights to the current cwd, so `$plan` must be re-run per checkout. The `codex-plan-gate.ts` PreToolUse hook blocks `apply_patch` under cwd when `.active-<hash>` is absent or expired.

Approval gate — confirm with the deterministic marker helper before starting work. The agent must not assemble cwd-hash or marker paths inline in shell:

```bash
~/.codex/scripts/codex-plan-marker.ts require-active "$PWD"
```

The helper's stdout is the active plan path. Proceed only on exit 0.

| State | Action |
|---|---|
| helper exits 0 | Read stdout as the plan path and proceed to Workflow |
| `.active` expired | Show helper stderr `.active marker expired. Run $plan <request> again.` and stop |
| pending only | Show helper stderr `Plan exists but is not approved. Type $impl as a top-level prompt to approve.` and stop |
| pending expired | Show helper stderr `.pending marker expired. Run $plan <request> again.` and stop |
| absent | Show helper stderr `Run $plan <request> first. No active plan for this cwd.` and stop |

The only approval route is the UserPromptSubmit hook (`codex-impl-approval-tracker.ts`). Only when the user types `$impl` as a top-level prompt does the helper promote `.pending-` to `.active-`. AI self-chaining an `$impl`-equivalent action inside the same skill body does not fire that hook, so self-promotion is impossible.

## Workflow

1. Use the `require-active` stdout from the approval gate as the plan file path
2. `Read` the plan file in full so subsequent tasks can follow **Files to Change** and **Patterns to Mirror** faithfully
3. Normalize and read sidecar JSON `~/.codex/plans/<plan-basename>.evidence.json` through the helper. Compare Codex `update_plan` state with JSON `tasks[].status`. If drift exists, treat JSON as the source of truth and rebuild `update_plan` in one call. If JSON itself has a parse error, stop and warn the user that the sidecar is corrupted
4. Process JSON `tasks` in ascending ID order, starting at `task-1`. Skip the final `Final Audit + Review` entry in this loop; the Final gate section executes it
5. For each implementation task:
   1. Mark `in_progress` and record `baseline_sha` via `codex-plan-state.ts start`
   2. Transition the matching `update_plan` task to `in_progress` by resending the full task list in one `update_plan` call
   3. **Implement** — follow the plan's **Files to Change** and **Patterns to Mirror** exactly. Match the naming, error handling, and conventions captured during EXPLORE. When Codex `apply_patch` runs, `codex-plan-gate.ts` checks for `.active-<hash>` and allows or blocks the edit; if the Approval gate passed, edits should pass the gate
   4. **Run the acceptance-criteria verification commands**. Capture the **raw output verbatim** as evidence. Before running each command, confirm it is non-destructive and will not print, persist, or transmit secrets. If output contains a secret, token, or credential, replace the value with `[REDACTED]` before saving evidence or showing it in conversation. The final gate (built-in Audit + Review) consumes this evidence
   5. **Diff size check** via `git diff --stat <baseline_sha>`. If the diff is ≥ 20 files or ≥ 500 lines, dispatch the `code-simplifier` subagent (defined in `~/.codex/agents/code-simplifier.toml`). Inline the changed files + `git diff <baseline_sha>` + the project's `~/.codex/AGENTS.md` and repository `AGENTS.md` paths into the spawn message. Apply HIGH-confidence simplifications; present MEDIUM/LOW to the user
   6. Append evidence via `codex-plan-state.ts append-evidence` (reads from stdin, appends with `\n---\n` if evidence already exists)
   7. If verification does not match EXPECTED output, do not mark completed. Investigate and continue fixing within the same task rather than moving the task back to `pending`
   8. Once all acceptance-criteria verifications succeed, mark `completed` via `codex-plan-state.ts complete` and update the matching `update_plan` task. There is no per-task review gate — quality and security are judged at the final gate
6. After all implementation tasks complete, run the **Final gate: built-in Audit → Review**

Helper command shapes (always use this exact permissioned form; do not depend on execute bits):

```bash
deno run --allow-env=HOME --allow-read --allow-write --allow-run=git --no-prompt ~/.codex/scripts/codex-plan-state.ts normalize "$HOME/.codex/plans/<basename>.evidence.json"
deno run --allow-env=HOME --allow-read --allow-write --allow-run=git --no-prompt ~/.codex/scripts/codex-plan-state.ts start "$HOME/.codex/plans/<basename>.evidence.json" task-N
deno run --allow-env=HOME --allow-read --allow-write --allow-run=git --no-prompt ~/.codex/scripts/codex-plan-state.ts append-evidence "$HOME/.codex/plans/<basename>.evidence.json" task-N
deno run --allow-env=HOME --allow-read --allow-write --allow-run=git --no-prompt ~/.codex/scripts/codex-plan-state.ts complete "$HOME/.codex/plans/<basename>.evidence.json" task-N
```

Run `start` from the repository root. The helper exits 1 if `git rev-parse --show-toplevel` fails. It records the current `git rev-parse HEAD` only when `baseline_sha` is empty. Sidecar writes are atomic via tmpfile + `Deno.rename`. Normalization is a compatibility layer for legacy artifacts; every mutating command passes through it before atomic write.

## Three-element rule (enforced per task description)

Every task description must contain:

1. **Target file(s)** — the exact absolute path(s) to create or modify
2. **Expected behavior after change** — concrete observable outcome
3. **Verification method** — verification commands + EXPECTED output

If any element is missing, stop and report that the plan task description is incomplete and `$plan` should be rerun for decomposition. No improvisation.

## When to dispatch the code-simplifier subagent

| Condition | Action |
|---|---|
| Current task diff is ≥ 20 files or ≥ 500 lines | Spawn `code-simplifier` (`~/.codex/agents/code-simplifier.toml`) |
| Diff is small | Skip — built-in Review covers basic simplification |
| User explicitly said "skip simplify" | Skip with a note |

Apply HIGH-confidence simplifications automatically (subtractive only, behavior-preserving). Present MEDIUM/LOW before changing.

## Deviation handling

If a task cannot be implemented as described (the plan is wrong, the environment differs, a missing dependency surfaces, etc.):

1. **Stop** before applying any deviation
2. Tell the user: (a) that the plan cannot be followed as-is, (b) why, (c) the alternative
3. Wait for explicit user approval (or correction)
4. No implicit plan changes — do not silently switch approach "because it's better"
5. After approval, proceed with the corrected approach. Record the deviation in the task's evidence (via `append-evidence`) for an audit trail

## Re-planning (revising the plan mid-execution)

If the user wants to revise the plan during `$impl`:

1. Confirm: "Re-plan? (re-run `$plan`) — completed task evidence will be preserved"
2. On approval:
   - **Preserve** all `completed` tasks (including their evidence in the sidecar JSON)
   - **Delete** all `pending` and `in_progress` tasks from sidecar JSON and rebuild `update_plan`
3. Re-run `$plan`. The new session creates a new `.pending-`; the user's next `$impl` keystroke promotes it. The main session uses a summary list of existing completed tasks as context so the new decomposition does not duplicate finished work
4. After new tasks are created, resume `$impl`

## Recovery after compaction

If context compaction occurs mid-`$impl`:

1. Re-evaluate the Approval gate (`codex-plan-marker.ts require-active`)
2. Re-read sidecar JSON via the `normalize` helper
3. Re-`Read` the plan file
4. Resume from the lowest-ID `pending` (or stalled `in_progress`) task in `tasks[].status`
5. For an `in_progress` task with partial work, inspect `git diff <baseline_sha>` to decide whether to continue or roll back and restart

## Plan-adherence check at completion

The plan-vs-implementation comparison is the built-in Audit's Evidence Collection responsibility — `$impl` does not run a separate adherence check. Adherence gaps (items present in the plan but not implemented, items implemented but not in the plan, misinterpreted items) surface from the auditor's verdict.

## Final gate: built-in Audit → Review

The trailing `Final Audit + Review` sidecar task unblocks automatically once all implementation tasks complete. Because Codex has no skill-to-skill invocation API, both Audit and Review are implemented inside this skill body.

**Execution order is mandatory**:

1. **Built-in Audit** first — evidence-sufficiency audit (no re-execution; reads per-task evidence in sidecar JSON against the plan's Completion Criteria). Must emit `AUDIT_VERDICT: PASS` before continuing. On 3 consecutive `AUDIT_VERDICT: FAIL` rounds, leave the sidecar `Final Audit + Review` task `in_progress` and present the unresolved gap analysis to the user
2. **Built-in Review** second — runs against the aggregated diff (`git diff <first-task baseline_sha>`, not `git diff <sha>..HEAD`, because uncommitted `$impl` changes must be reviewed). `first-task baseline_sha` is `tasks[0].baseline_sha` from sidecar JSON. Internally runs **Combined Generic Review** → **Domain-Specific Reviewer Dispatch** → **Security Dispatch Heuristic**. Must emit `REVIEW_VERDICT: PASS` (no open MUST_FIX) to close the gate

Verdict format must match `^(AUDIT|SECTION|REVIEW)_VERDICT: (PASS|FAIL)(\s|$)`. The final review line must be exactly `REVIEW_VERDICT: PASS` or `REVIEW_VERDICT: FAIL`. Reviewer subagent output is judged by a standalone final line matching `^VERDICT: (PASS|FAIL)$`. If one evidence block contains multiple matching verdict lines, the last matching verdict wins.

### Built-in Audit

Evaluation targets — read `## Completion Criteria` from the plan file and evaluate these subsections in order:

- `### Autonomous Verification`: for each `[file-state]` / `[orchestrator-only]` item, find matching verification evidence in sidecar JSON `tasks[].evidence` and check it against EXPECTED output.
- `[outcome]` items are circular and must be excluded from the Audit verdict. They are checked only after Review emits its final `REVIEW_VERDICT`.
- `### Requires User Confirmation`: if present, note that manual user confirmation is required. This is informational and not part of PASS evaluation.
- `### Baseline`: confirm each task ran verification and recorded evidence.

If all checks pass, output exactly one line:

```text
AUDIT_VERDICT: PASS
```

If any check fails, output one line in this format and skip Built-in Review:

```text
AUDIT_VERDICT: FAIL <reason>
```

Examples:

```text
AUDIT_VERDICT: PASS
AUDIT_VERDICT: FAIL evidence missing for [orchestrator-only] nix flake check
```

### Built-in Review

Run final-gate review with **fresh** Codex subagents. Do not pass the main session's implementation report or summary to reviewers. Give them the plan, diff, changed files, and actual files.

Review scope is not only the tracked diff. At the beginning of Review, construct:

```bash
BASELINE_SHA=<first-task baseline_sha>
TRACKED_DIFF=$(git diff "${BASELINE_SHA}")
TRACKED_FILES=$(git diff --name-only "${BASELINE_SHA}")
UNTRACKED_FILES=$(git ls-files --others --exclude-standard)
REVIEW_FILES=$(printf '%s\n%s\n' "$TRACKED_FILES" "$UNTRACKED_FILES" | sed '/^$/d' | sort -u)
```

If both `TRACKED_DIFF` and `UNTRACKED_FILES` are empty, do not spawn a reviewer. Audit already confirmed Completion Criteria and there is no review target. Output:

```text
SECTION_VERDICT: PASS (no diff and no untracked files)
REVIEW_VERDICT: PASS
```

#### Review lifecycle budget

Track every reviewer subagent in a ledger: `agent_id / role / stage / attempt / status / closed`. After extracting verdict and blockers from a reviewer output, mark that reviewer result-integrated and close it with `close_agent` before moving to the next stage or retry. Use `close_agent` only for result-integrated or terminal/known completed reviewers, not to interrupt running reviewers.

If reviewer spawn fails with `agent thread limit reached`, close known completed / terminal reviewers and retry exactly once. If retry still fails, do not keep spawning; treat that section as FAIL.

#### Combined Generic Review

When a review target exists, spawn one fresh `code-reviewer` subagent and ask it to check Spec Compliance and Code Quality in the same pass. Input only:

- task spec / plan sections: `## Files to Change`, `## Approach`, relevant `## Task Outline`, and `## Intentional Conventions`
- aggregated diff: `git diff <first-task baseline_sha>`
- changed file list: `git diff --name-only <first-task baseline_sha>`
- untracked file list: `git ls-files --others --exclude-standard`
- review file list: `REVIEW_FILES`
- `~/.codex/AGENTS.md`
- combined focus:
  - Spec Compliance: missing / extra / misunderstood / incomplete implementation against the task spec and plan
  - Code Quality: YAGNI / KISS / DRY, naming, responsibility boundaries, error handling, unnecessary fallback or compatibility shim, excessive comments

Instruct the reviewer to selectively full-read changed files before issuing any `MUST_FIX` that cannot be judged from the diff alone. It does not need to eagerly full-read every changed file.

Expected output contains `MUST_FIX`, `SHOULD_FIX`, `NIT`, and a final `VERDICT: PASS|FAIL` line. Each finding includes `Area: SPEC|QUALITY`. Treat `VERDICT: FAIL`, non-empty `MUST_FIX`, No VERDICT, or malformed output as section FAIL. Report SHOULD_FIX / NIT, but they are not blockers.

Combined Generic Review has max 3 attempts. On FAIL, fix MUST_FIX or malformed output causes, then spawn a fresh `code-reviewer` for the next attempt. Do not reuse the same subagent instance.

Always close each attempt's `code-reviewer` after processing its verdict. If retrying, close the prior reviewer before spawning a fresh one.

At completion, output one line:

```text
SECTION_VERDICT: PASS
SECTION_VERDICT: FAIL <short reason>
```

#### Domain-Specific Reviewer Dispatch

After Combined Generic Review PASS, choose every specialist reviewer whose trigger matches `REVIEW_FILES` and local scans of diff / untracked file contents. Do not use single-choice or priority cutoff. Dispatch in bounded batch form with max 3 concurrent reviewers.

Trigger table:

| Agent | Trigger |
|---|---|
| `rust-reviewer` | `.rs` file in `REVIEW_FILES` |
| `go-reviewer` | `.go` file in `REVIEW_FILES` |
| `dart-reviewer` | `.dart` file in `REVIEW_FILES` |
| `nix-reviewer` | `.nix` file in `REVIEW_FILES` |
| `typescript-reviewer` | `.ts` / `.tsx` / `.mts` / `.cts` file in `REVIEW_FILES` |
| `react-reviewer` | `.jsx` / `.tsx` file in `REVIEW_FILES` OR tracked diff / untracked file contents contains `from "react"` / `from "react-dom"` |
| `a11y-reviewer` | `.css` / `.scss` / `.html` file in `REVIEW_FILES` OR `.jsx` / `.tsx` file in `REVIEW_FILES` |
| `database-reviewer` | `.sql` / `migrations/` / `schema.(sql|prisma|ts)` in `REVIEW_FILES`, OR SQL DML/DDL in tracked diff / untracked file contents |
| `deno-reviewer` | `Deno.` API reference in tracked diff / untracked file contents OR `jsr:` / `npm:` specifier added in tracked diff / untracked file contents OR `deno.jsonc` / `deno.json` modified OR `deno.jsonc` / `deno.json` exists in the repo |
| `cloud-architecture-reviewer` | `.tf` / `*.tfvars` / k8s yaml / Helm chart / `Dockerfile` / `docker-compose.yml` / `serverless.yml` / `.github/workflows/*.yml` in `REVIEW_FILES` |

Detection command shape:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
TRACKED_FILES=$(git diff --name-only "${BASELINE_SHA}")
UNTRACKED_FILES=$(git ls-files --others --exclude-standard)
REVIEW_FILES=$(printf '%s\n%s\n' "$TRACKED_FILES" "$UNTRACKED_FILES" | sed '/^$/d' | sort -u)
DIFF_HUNKS=$(git diff "${BASELINE_SHA}")
UNTRACKED_TRIGGER_FLAGS=$(
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    [ ! -L "$file" ] || continue
    abs=$(realpath "$file" 2>/dev/null) || continue
    case "$abs" in "$REPO_ROOT"/*) ;; *) continue ;; esac
    [ -f "$abs" ] || continue
    sample=$(head -c 131072 "$abs")
    printf '%s' "$sample" | rg -q 'from ["'\'']react(-dom)?["'\'']' && printf '%s\n' REACT_IMPORT
    printf '%s' "$sample" | rg -qi '(INSERT INTO|UPDATE .* SET|DELETE FROM|CREATE TABLE|ALTER TABLE)' && printf '%s\n' SQL_DML
    printf '%s' "$sample" | rg -q 'Deno\.' && printf '%s\n' DENO_API
    printf '%s' "$sample" | rg -q '["'\'']jsr:|["'\'']npm:' && printf '%s\n' DENO_SPECIFIER
    printf '%s' "$sample" | rg -qi '(child_process|execFile|execSync|eval\(|new Function\(|password|passwd|passphrase|api[_-]?key|secret|token|credential)' && printf '%s\n' SECURITY_CONTENT
  done <<< "$UNTRACKED_FILES" | sort -u
)
REVIEW_CONTENTS=$(printf '%s\n%s\n' "$DIFF_HUNKS" "$UNTRACKED_TRIGGER_FLAGS")

AGENTS=()
printf '%s\n' "$REVIEW_FILES" | rg -q '\.rs$' && AGENTS+=(rust-reviewer)
printf '%s\n' "$REVIEW_FILES" | rg -q '\.go$' && AGENTS+=(go-reviewer)
printf '%s\n' "$REVIEW_FILES" | rg -q '\.dart$' && AGENTS+=(dart-reviewer)
printf '%s\n' "$REVIEW_FILES" | rg -q '\.nix$' && AGENTS+=(nix-reviewer)
printf '%s\n' "$REVIEW_FILES" | rg -q '\.(ts|tsx|mts|cts)$' && AGENTS+=(typescript-reviewer)
{ printf '%s\n' "$REVIEW_FILES" | rg -q '\.(jsx|tsx)$' || printf '%s' "$REVIEW_CONTENTS" | rg -q 'from ["'\'']react(-dom)?["'\'']|REACT_IMPORT'; } && AGENTS+=(react-reviewer)
printf '%s\n' "$REVIEW_FILES" | rg -q '\.(css|scss|html|jsx|tsx)$' && AGENTS+=(a11y-reviewer)
{ printf '%s\n' "$REVIEW_FILES" | rg -q '\.sql$|migrations/|schema\.(sql|prisma|ts)$' || printf '%s' "$REVIEW_CONTENTS" | rg -qi '(INSERT INTO|UPDATE .* SET|DELETE FROM|CREATE TABLE|ALTER TABLE|SQL_DML)'; } && AGENTS+=(database-reviewer)
{ printf '%s' "$DIFF_HUNKS" | rg -q '\bDeno\.' || printf '%s' "$DIFF_HUNKS" | rg -q '^\+.*(["'\'']jsr:|["'\'']npm:)' || printf '%s' "$UNTRACKED_TRIGGER_FLAGS" | rg -q 'DENO_API|DENO_SPECIFIER' || printf '%s\n' "$REVIEW_FILES" | rg -q 'deno\.(json|jsonc)$' || test -f deno.json || test -f deno.jsonc; } && AGENTS+=(deno-reviewer)
printf '%s\n' "$REVIEW_FILES" | rg -q '\.tf$|\.tfvars$|Dockerfile|docker-compose\.ya?ml$|serverless\.ya?ml$|\.github/workflows/.*\.ya?ml$' && AGENTS+=(cloud-architecture-reviewer)
```

Pass each specialist `REVIEW_FILES`, tracked aggregated diff, untracked file list, and trigger labels from local trigger scan when relevant. Do not pass raw untracked file contents or body excerpts in the subagent prompt. Treat `VERDICT: FAIL`, non-empty `MUST_FIX`, No VERDICT, or malformed output as Domain section FAIL.

Split Domain dispatch into batches of max 3 concurrent reviewers while preserving `AGENTS` order. After processing each batch, close all result-integrated reviewers before the next batch. On Domain retry, rerun only failed specialists with fresh instances; do not rerun reviewers that already passed. If no reviewers match, output `SECTION_VERDICT: PASS (no domain trigger)`.

```text
SECTION_VERDICT: PASS
SECTION_VERDICT: FAIL <short reason>
```

#### Security Dispatch Heuristic

After Domain PASS, evaluate the same security heuristic shape as Claude `/subagent-review`. If any trigger fires, spawn a fresh `security-auditor` subagent. If none fires, security PASS.

Security triggers cover tracked diff plus `REVIEW_FILES` and safe local scans of untracked file contents trigger flags. Untracked control-plane files, hooks, scripts, and secret/config changes must still trigger security review. Do not pass raw untracked file contents, excerpts, symlinks, non-regular files, or paths resolving outside the repo to subagent prompts.

Summary of triggers:

- Path: `scripts/`, `hooks/`, `auth`, `session`, `cookie`, `credential`, `secret`, `token`, `api/`, `webhook`, `oauth`, `sso`, `crypto`, `encrypt`, `decrypt`
- Content: `child_process`, `spawn`, `execFile`, `execFileSync`, `exec(`, `execSync`, `eval(`, `new Function(`, SQL DML, `.query(`, `.exec(`, `.run(`, `password`, `passwd`, `passphrase`, `process.env.XXX`, API key / secret key / access token, `os/exec`, `exec.Command`, Rust `unsafe`, `.unwrap()`, template-literal `fetch`, string-concat HTTP calls
- Config / control plane: `settings.json`, `.claude/**`, `.codex/**`, `.env*`, `permissions.allow*`, `secrets*.{yml,yaml,json,toml}`, `auth*.config*`, `cors*.config*`, `home/programs/codex/hooks.json`, `home/programs/codex/default.nix`, `home/programs/codex/RTK.md`, `home/programs/claude/agents/**`, `home/programs/codex/agents/**`, `home/programs/agents/**`, `home/programs/claude/skills/**`, `home/programs/codex/skills/**`
- Reviewer self-modification: if `REVIEW_FILES` touches a Claude reviewer Markdown file referenced by a Codex reviewer TOML, a Codex reviewer TOML, or a Codex/Claude skill that controls review or approval flow, security review MUST fire and treat the change as prompt/control-plane modification. If this path is not reviewed, Security section is FAIL.

If `security-auditor` output has `VERDICT: FAIL`, non-empty `MUST_FIX`, No VERDICT, or malformed output, Security section FAIL. SHOULD_FIX / NIT are reported but not blockers.

Before spawning `security-auditor`, confirm all Domain reviewer ledger entries are closed. After processing Security verdict, close `security-auditor` whether PASS or FAIL.

```text
SECTION_VERDICT: PASS
SECTION_VERDICT: FAIL <short reason>
```

#### Review failure handling

Each review stage has max 3 attempts. On FAIL, fix MUST_FIX or malformed output causes, then review again with a fresh subagent. Do not reuse the same subagent instance. After 3 consecutive FAIL attempts, leave the sidecar JSON `Final Audit + Review` task `in_progress`, show unresolved blockers to the user, and stop.

#### Final verdict

Aggregate all SECTION_VERDICT lines and output exactly one final line:

```text
REVIEW_VERDICT: PASS
```

For FAIL, list failed sections and reasons first, then make the final line `REVIEW_VERDICT: FAIL`:

```text
- Combined Generic Review: <reason>
- Security: <reason>
REVIEW_VERDICT: FAIL
```

## Finish

| State | Action |
|---|---|
| `AUDIT_VERDICT: PASS` + `REVIEW_VERDICT: PASS` | Run helper `complete` for the trailing sidecar task `Final Audit + Review`, update `update_plan` to completed, run `~/.codex/scripts/codex-plan-marker.ts clear-active "$PWD"` to delete the active marker, then show the final report: changed files, tests added, diff summary, and a verbatim transcription of any Combined Generic Review / Domain / Security non-blocker findings (SHOULD_FIX / NIT). Do not paraphrase or omit non-blocker findings on a clean PASS |
| `AUDIT_VERDICT: FAIL` | Built-in Review was skipped. Ask whether to re-decompose with `$plan` or let the user manually fix and rerun `$impl` |
| `AUDIT_VERDICT: PASS` + `REVIEW_VERDICT: FAIL` | Show failed sections to the user and return to the Workflow Step 5 loop to fix them, or fix in the same turn when minor and rerun Built-in Audit |

`$santa-loop` is NOT part of the default final gate. Invoke it manually when additional dual-reviewer (Claude + Codex) convergence is wanted before opening a PR.
