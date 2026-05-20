---
name: impl
description: Plan implementation skill. It executes the plan created by `$plan` task by task, then runs built-in Audit and Codex subagent Review phases that emit AUDIT_VERDICT / REVIEW_VERDICT. It runs only when explicitly invoked with `$impl`; auto-loading is disabled by agents/openai.yaml. Because Codex has no skill-to-skill invocation API, the final gate is implemented inside this skill.
---

# $impl

Executes the plan created by `$plan` in task order, then determines completion with built-in Audit and Codex subagent Review.

User-facing progress and final reports should remain in the user's configured language. This English rewrite changes only the skill instruction prose.

## Approval gate (first startup check)

First require an active marker through the deterministic helper. The agent must not assemble cwd hashes or marker paths inline in shell:

```bash
~/.codex/scripts/codex-plan-marker.ts require-active "$PWD"
```

The helper stdout is the plan path. Continue to Step 1 only when the helper exits 0.

| State | Action |
|---|---|
| helper exits 0 | Read stdout as the plan path and continue to Step 1 |
| `.active` expired | Show helper stderr `.active marker expired. Run `$plan <request>` again.` and stop |
| pending only | Show helper stderr `Plan exists but is not approved. Type `$impl` as a top-level prompt to approve.` and stop |
| pending expired | Show helper stderr `.pending marker expired. Run `$plan <request>` again.` and stop |
| absent | Show helper stderr `Run `$plan <request>` first. No active plan for this cwd.` and stop |

The only approval route is the UserPromptSubmit hook (`codex-impl-approval-tracker.ts`). Only when the user types `$impl` as a top-level prompt does the helper promote `.pending-` to `.active-`. AI self-chaining an `$impl`-equivalent action inside the same skill body does not fire that hook.

## Step 1: Load plan and validate sidecar JSON consistency

1. Keep the Approval gate `require-active` stdout as the plan file path. Do not assemble `.active-<hash>` paths in the agent.
2. Read the full plan file so later steps can consult Files to Change, Patterns to Mirror, and Completion Criteria.
3. Normalize and read sidecar JSON `~/.codex/plans/<plan-basename>.evidence.json` through the helper.
4. Compare Codex `update_plan` state with JSON `tasks[].status`.
   - If drift exists, treat JSON as the source of truth and rebuild `update_plan` in one call.
   - If JSON itself has a parse error, stop and warn the user that the sidecar is corrupted.

Always use this exact permissioned helper command shape. Do not depend on execute bits:

```bash
deno run --allow-env=HOME --allow-read --allow-write --allow-run=git --no-prompt ~/.codex/scripts/codex-plan-state.ts normalize "$HOME/.codex/plans/<basename>.evidence.json"
```

Normalization is a compatibility layer for legacy artifacts. It canonicalizes `subject ?? name`, missing `id` (`task-N` by array order), string/object/null evidence, and missing `status` (`pending`) into canonical v1 (`tasks[]` plus trailing `Final Audit + Review`). Every mutating command must pass through this legacy normalizer before atomic write.

## Step 2: Task loop

Process JSON `tasks` in ascending ID order, starting at `task-1`. Skip the final `Final Audit + Review` entry in Step 2; Steps 3-4 execute it.

For each implementation task, run the following sequence.

### Step 2a: Mark in_progress and record baseline_sha

```bash
deno run --allow-env=HOME --allow-read --allow-write --allow-run=git --no-prompt ~/.codex/scripts/codex-plan-state.ts start "$HOME/.codex/plans/<basename>.evidence.json" task-N
```

Run `start` from the repository root. The helper exits 1 if `git rev-parse --show-toplevel` fails. It records the current `git rev-parse HEAD` only when `baseline_sha` is empty.

Also transition the matching `update_plan` task to `in_progress` by resending the full task list in one `update_plan` call.

### Step 2b: Implement

Follow the plan's **Files to Change** and **Patterns to Mirror** exactly. Match naming, error handling, and conventions captured during Phase 2 EXPLORE.

When using Codex `apply_patch`, the `codex-plan-gate.ts` PreToolUse hook checks for `.active-<hash>` and allows or blocks the edit. If Step 0 passed, Step 2b edits should pass the gate.

### Step 2c: Verification and evidence recording

Run the verification commands from the task description and save stdout/stderr as evidence. Before running each verification command, confirm it is non-destructive and will not print, persist, or transmit secrets. If output contains a secret, token, or credential, replace the value with `[REDACTED]` before saving evidence or showing it in conversation.

```bash
deno run --allow-env=HOME --allow-read --allow-write --allow-run=git --no-prompt ~/.codex/scripts/codex-plan-state.ts append-evidence "$HOME/.codex/plans/<basename>.evidence.json" task-N
```

`append-evidence` reads evidence from stdin. Pass verification stdout/stderr as multiline text. If evidence already exists, append with `\n---\n`. Secret redaction is the `$impl` agent's responsibility before calling the helper; the helper treats evidence as opaque text.

If verification does not match EXPECTED output, do not proceed to Step 2d. Investigate and continue fixing within the same task rather than moving the task back to `pending`.

### Step 2d: Mark completed

```bash
deno run --allow-env=HOME --allow-read --allow-write --allow-run=git --no-prompt ~/.codex/scripts/codex-plan-state.ts complete "$HOME/.codex/plans/<basename>.evidence.json" task-N
```

Also mark the matching `update_plan` task `completed`, then continue to the next task.

### Atomic write guarantee

The helper writes sidecar JSON by writing a tmpfile and then replacing the target with `Deno.rename`. If the process crashes while writing, the previous JSON stays intact. `Deno.rename` is POSIX atomic on the same filesystem.

### Three elements check

Every task description must contain (1) target files, (2) expected behavior, and (3) verification commands plus EXPECTED output. If any element is missing, stop and report that the plan task description is incomplete and `$plan` should be rerun for decomposition. Do not improvise.

## Step 3 Audit

After all implementation tasks are completed, run Audit.

### Evaluation targets

Read `## Completion Criteria` from the plan file and evaluate these subsections in order:

- `### Autonomous Verification`: for each `[file-state]` / `[orchestrator-only]` item, find matching verification evidence in sidecar JSON `tasks[].evidence` and check it against EXPECTED output.
- `[outcome]` items are circular and must be excluded from the Audit verdict. They are checked only after Review emits its final `REVIEW_VERDICT`.
- `### Requires User Confirmation`: if present, note that manual user confirmation is required. This is informational and not part of PASS evaluation.
- `### Baseline`: confirm each task ran verification and recorded evidence.

Verdict parsing considers only standalone lines matching `^(AUDIT|SECTION|REVIEW)_VERDICT: (PASS|FAIL)(\s|$)`. If one evidence block contains multiple matching verdict lines, the last matching verdict wins. Reviewer subagent output is judged by a standalone final line matching `^VERDICT: (PASS|FAIL)$`.

### Output

If all checks pass, output exactly one line:

```text
AUDIT_VERDICT: PASS
```

If any check fails, output one line in this format and skip Step 4:

```text
AUDIT_VERDICT: FAIL <reason>
```

The verdict format must match `^AUDIT_VERDICT: (PASS|FAIL)(\s|$)`. It may be consumed by `$plan` Phase 4 self-review and external grep-based tooling.

Examples:

```text
AUDIT_VERDICT: PASS
AUDIT_VERDICT: FAIL evidence missing for [orchestrator-only] nix flake check
```

## Step 4 Review (only when Step 3 PASS)

Run final-gate review with fresh Codex subagents. Do not pass the main session's implementation report or summary to reviewers. Give them the plan, diff, changed files, and actual files.

Use `git diff <first-task baseline_sha>` for the aggregated diff. Do not use `git diff <sha>..HEAD`, because uncommitted `$impl` changes must be reviewed. `first-task baseline_sha` is `tasks[0].baseline_sha` from sidecar JSON.

Review scope is not only tracked diff. At the beginning of Step 4, construct:

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

### Step 4 lifecycle budget

Track every reviewer subagent in a ledger: `agent_id / role / stage / attempt / status / closed`. After extracting verdict and blockers from a reviewer output, mark that reviewer result-integrated and close it with `close_agent` before moving to the next stage or retry. Use `close_agent` only for result-integrated or terminal/known completed reviewers, not to interrupt running reviewers.

If reviewer spawn fails with `agent thread limit reached`, close known completed / terminal reviewers and retry exactly once. If retry still fails, do not keep spawning; treat that section as FAIL.

### Step 4a: Combined Generic Review

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

### Step 4b: Domain-Specific Reviewer Dispatch

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

### Step 4c: Security Dispatch Heuristic

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

### Review failure handling

Each review stage has max 3 attempts. On FAIL, fix MUST_FIX or malformed output causes, then review again with a fresh subagent. Do not reuse the same subagent instance. After 3 consecutive FAIL attempts, leave the sidecar JSON `Final Audit + Review` task `in_progress`, show unresolved blockers to the user, and stop.

### Final verdict

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

Verdict format must match `^(SECTION|REVIEW)_VERDICT: (PASS|FAIL)(\s|$)`, and the final review line must be exactly `REVIEW_VERDICT: PASS` or `REVIEW_VERDICT: FAIL`.

## Step 5 Finish

| State | Action |
|---|---|
| `AUDIT_VERDICT: PASS` + `REVIEW_VERDICT: PASS` | Run helper `complete` for the trailing sidecar task `Final Audit + Review`, update `update_plan` to completed, run `~/.codex/scripts/codex-plan-marker.ts clear-active "$PWD"` to delete the active marker, then show the final report: changed files, tests added, and diff summary |
| `AUDIT_VERDICT: FAIL` | Step 4 was skipped. Ask whether to re-decompose with `$plan` or let the user manually fix and rerun `$impl` |
| `AUDIT_VERDICT: PASS` + `REVIEW_VERDICT: FAIL` | Show failed sections to the user and return to Step 2 to fix them, or fix in the same turn when minor and rerun Step 3 |

## Recovery after compaction / re-invocation

If `$impl` is restarted after context compaction or interruption:

1. Re-evaluate Step 0 Approval gate.
2. Re-read sidecar JSON in Step 1.
3. Resume from the lowest `pending` or `in_progress` task in `tasks[].status`.
4. For partial `in_progress` work, inspect `git diff <baseline_sha>` and decide case-by-case whether to continue or revert and restart.

## Re-plan (plan revision during implementation)

If the plan must be revised during implementation:

1. Ask the user whether to rerun `$plan`; completed task evidence will be preserved.
2. After approval, delete non-completed tasks from sidecar JSON and rebuild `update_plan`.
3. Restart `$plan`. It creates a new `.pending-`; the user's next `$impl` approval promotes it.
4. Keep the completed task list as context for the new Phase 5 DECOMPOSE input.
