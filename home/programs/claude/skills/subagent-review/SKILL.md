---
name: subagent-review
description: "Two-stage subagent review (spec compliance → code quality) after completing an implementation task. Auto-triggers after each implementation task in plan execution, or when asked to 'subagent review', 'タスクレビュー', 'サブエージェントレビュー'."
---

# Subagent Review

Two-stage review using fresh-context subagents to counter long-context quality degradation. Each stage spawns an independent `code-reviewer` subagent that reads actual code — not the main session's summary.

**Core principle:** Fresh context per review. Do Not Trust the Report.

## When to Use

- **Automatic**: After each implementation task completes during Plan Execution (default mandatory)
- **Manual**: When invoked with `/subagent-review` or equivalent trigger phrases
- **Ad-hoc**: Pass task description as `$ARGUMENTS`, or provide when prompted

## Skip Conditions

Skip when:
- Verification-only tasks (test execution, lint, `nix flake check` — no code changes)
- Plan explicitly marks a task as review-exempt
- User says "no subagent review"
- Task creation was skipped (single-file, few-line changes like typo fixes)

## Workflow

### Step 1: Context Collection

1. **Task spec**: Retrieve from `TaskGet` description. For ad-hoc invocation, use `$ARGUMENTS` or ask the user
2. **Plan section**: Locate the relevant section by matching the task subject against plan headings. If no clear match, include the full plan. Embed directly in the prompt
3. **Diff baseline**:
   - At task start, record `{"baseline_sha": "<HEAD SHA>"}` in `TaskUpdate` metadata
   - At review time: `git diff <baseline_sha>..HEAD`
   - If baseline_sha unavailable (compaction): fallback to `git diff HEAD~1`
4. **Changed files**: Extract with `git diff --name-only`

### Step 2: Spec Compliance Review

Spawn a **fresh** `code-reviewer` subagent.

**Prompt construction** — load `references/spec-reviewer-prompt.md` and fill placeholders:
- `{task_description}` — task spec from Step 1
- `{plan_section}` — plan file section from Step 1
- `{git_diff}` — diff output from Step 1
- `{file_paths}` — changed file list from Step 1

**What NOT to pass**: Any summary, status report, or interpretation from the main session. The reviewer must form its own judgment from spec + diff + actual code.

**Expected output**: Structured issues list + `VERDICT: PASS` or `VERDICT: FAIL` as the final line.

### Step 3: Handle Spec Review Result

| Result | Action |
|--------|--------|
| `VERDICT: PASS` | Proceed to Step 4 |
| `VERDICT: FAIL` | Main session fixes issues → re-review with fresh subagent |
| No VERDICT line | Treat as FAIL; present summary of subagent output + note VERDICT absence to user |
| 3 consecutive FAILs | Update task description with `[BLOCKED: subagent-review spec 3x failed]`, report issues to user for decision |

### Step 4: Code Quality Review

Spawn a **fresh** `code-reviewer` subagent. Only after Spec Compliance passes.

**Prompt construction** — load `references/code-quality-reviewer-prompt.md` and fill placeholders:
- `{file_paths}` — changed file list
- `{claude_md_path}` — `~/.claude/CLAUDE.md`

**Expected output**: Issues categorized by severity (MUST_FIX / SHOULD_FIX / NIT) + `VERDICT: PASS` or `VERDICT: FAIL`.

FAIL only if MUST_FIX issues exist. SHOULD_FIX and NIT do not block.

### Step 5: Handle Code Quality Result

Same handling as Step 3:

| Result | Action |
|--------|--------|
| `VERDICT: PASS` | Task review complete |
| `VERDICT: FAIL` | Fix MUST_FIX issues → re-review with fresh subagent |
| 3 consecutive FAILs | Update task description with `[BLOCKED: subagent-review quality 3x failed]`, report to user |

### Step 6: Domain-Specific Reviewer Dispatch (NEW)

Only after Code Quality passes. Dispatch language / domain specialist agents in **parallel** (same-message tool calls) based on diff content.

#### Dispatch table

| Trigger | Agent |
|---|---|
| Diff contains `.ts`, `.tsx`, `.mts`, `.cts` files | `typescript-reviewer` |
| `deno.jsonc`/`deno.json` in repo root OR diff contains `Deno.` API | `deno-reviewer` |
| Diff contains `.jsx`/`.tsx` OR `from "react"` / `from "react-dom"` | `react-reviewer` |
| Diff contains `.css`/`.scss`/`.html` OR JSX markup in `.tsx`/`.jsx` | `a11y-reviewer` |
| Diff contains `.sql`, `migrations/*`, `schema.*` (sql/prisma/Drizzle), or `INSERT INTO`/`CREATE TABLE`/`SELECT.*FROM` in app code | `database-reviewer` |
| Diff contains `.tf`, `*.tfvars`, k8s yaml, Helm chart, `Dockerfile`, `docker-compose.yml`, `serverless.yml`, `.github/workflows/*.yml` | `cloud-architecture-reviewer` |
| Diff contains `.go` files | `go-reviewer` |
| Diff contains `.rs` files | `rust-reviewer` |
| Diff contains `.dart` files | `dart-reviewer` |
| Diff contains `.nix` files | `nix-reviewer` |

Multiple agents may be dispatched for a single task (e.g., `.tsx` triggers typescript-reviewer + react-reviewer + a11y-reviewer simultaneously). Launch them all in the SAME message to maximize parallelism.

#### Detection implementation

```bash
DIFF_FILES=$(git diff --name-only "${BASELINE_SHA}..HEAD")
DIFF_HUNKS=$(git diff "${BASELINE_SHA}..HEAD")

declare -a AGENTS=()
printf '%s\n' "$DIFF_FILES" | rg -q '\.(ts|tsx|mts|cts)$' && AGENTS+=(typescript-reviewer)
{ test -f deno.jsonc -o -f deno.json; } || printf '%s' "$DIFF_HUNKS" | rg -q '\bDeno\.' && AGENTS+=(deno-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.(jsx|tsx)$' || printf '%s' "$DIFF_HUNKS" | rg -q 'from "react(-dom)?"' && AGENTS+=(react-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.(css|scss|html)$|\.(jsx|tsx)$' && AGENTS+=(a11y-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.sql$|migrations/|schema\.(sql|prisma|ts)$' || printf '%s' "$DIFF_HUNKS" | rg -qi '(INSERT INTO|UPDATE .* SET|DELETE FROM|SELECT .* FROM|CREATE TABLE)' && AGENTS+=(database-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.tf$|\.tfvars$|Dockerfile|docker-compose\.ya?ml$|serverless\.ya?ml$|\.github/workflows/.*\.ya?ml$' && AGENTS+=(cloud-architecture-reviewer)
# k8s yaml heuristic: rg for apiVersion + kind in same file — omitted here, match by path pattern or directory convention locally
printf '%s\n' "$DIFF_FILES" | rg -q '\.go$' && AGENTS+=(go-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.rs$' && AGENTS+=(rust-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.dart$' && AGENTS+=(dart-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.nix$' && AGENTS+=(nix-reviewer)

# Dedupe and launch each via the Agent tool in the SAME message
```

#### Handling results

Each specialist returns MUST_FIX / SHOULD_FIX / NIT + VERDICT. Merge findings from all specialists:
- Dedupe by first-80-chars normalized issue text to avoid double-reporting
- FAIL if ANY specialist returns `VERDICT: FAIL` on a MUST_FIX issue
- On FAIL: fix the MUST_FIX items, then re-dispatch ONLY the failing specialist(s) with fresh agent instances (max 3 rounds)

### Step 7: Security Dispatch Heuristic (NEW)

Only after Step 6 passes. Runs a heuristic check to decide whether the security-auditor agent should be dispatched. See [references/security-trigger-heuristic.md](references/security-trigger-heuristic.md) for the full trigger conditions.

#### Summary of triggers

- **Path**: `scripts/`, `hooks/`, `auth`, `session`, `credential`, `secret`, `token`, `api/`, `webhook`, `oauth`, `sso`, `crypto`
- **Content**: `child_process`, `exec`, `eval`, `new Function`, SQL DML, `password`, `process.env.XXX`, `os/exec`, `exec.Command`, template-literal `fetch()`, string-concat HTTP
- **Config**: `settings.json`, `.claude/**`, `.env*`, `permissions.allow*`, `secrets*.{yml,yaml,json,toml}`

When any trigger fires, dispatch `security-auditor` (existing agent). Same MUST_FIX / SHOULD_FIX handling + max 3 rounds as Step 6.

#### Implementation

```bash
source "$HOME/.claude/skills/subagent-review/references/security-trigger-heuristic.md"  # conceptual — actual check is inline
DISPATCH_SECURITY=0
printf '%s\n' "$DIFF_FILES" | rg -qi 'scripts/|hooks/|auth|session|cookie|credential|secret|token|api/|webhook|oauth|sso|crypto|encrypt|decrypt' && DISPATCH_SECURITY=1
printf '%s' "$DIFF_HUNKS" | rg -q 'child_process|spawn|execFile|exec\(|eval\(|new Function\(|SELECT .* FROM|INSERT INTO|UPDATE .* SET|DELETE FROM|password|process\.env\.[A-Z_]+|api[_-]?key|secret[_-]?key|access[_-]?token|os/exec|exec\.Command' && DISPATCH_SECURITY=1
printf '%s\n' "$DIFF_FILES" | rg -q '^settings\.json$|^\.claude/|^\.env|permissions\.allow|secrets?\.(yml|yaml|json|toml)$' && DISPATCH_SECURITY=1

if [ "$DISPATCH_SECURITY" = "1" ]; then
  # Launch security-auditor via Agent tool
  : # See references/security-trigger-heuristic.md for full rationale
fi
```

## Loop Limits

- **Max 3 attempts per stage** (Spec Compliance and Code Quality independently)
- On 3rd failure: stop, mark task as blocked, escalate to user
- Never retry with the same subagent — always spawn fresh

## Red Flags

- Skipping Spec Compliance and jumping to Code Quality (order is mandatory)
- Passing main session's "what I implemented" summary to the reviewer
- Accepting SHOULD_FIX as a blocker (only MUST_FIX blocks)
- Retrying the same subagent instead of spawning fresh
- Proceeding to next task while review has open MUST_FIX issues

## Relationship with codex-review

| Aspect | simplify-review | subagent-review | codex-review |
|--------|----------------|----------------|--------------|
| Scope | Plan or per-task code | Per-task incremental | Full implementation |
| Trigger | After /plan / large diffs / manual | Auto after each task (default) | User explicitly requests |
| Reviewer | Claude subagent (fresh context) | Claude subagent (fresh context) | Codex CLI (external tool) |
| Purpose | Over-engineering detection, YAGNI | Spec compliance, code quality | Holistic quality, security |

Normal flow: `task → simplify-review (large diffs) → subagent-review → next task → ... → done`
With codex-review: `... → all tasks done → codex-review (additional)`
