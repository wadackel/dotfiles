---
name: subagent-review
description: "Final-gate review skill for /impl — runs Spec Compliance → Code Quality → priority-ordered single Domain specialist → Security heuristic against the aggregated diff after /completion-audit returns VERIFIED PASS. Also fires on manual invocation / 'subagent review', 'タスクレビュー', 'サブエージェントレビュー'."
---

# Subagent Review

Fresh-context subagent review that adjudicates spec compliance and code quality at the `/impl` final gate. Each stage spawns an independent `code-reviewer` subagent that reads actual code — not the main session's summary.

**Core principle:** Fresh context per review. Do Not Trust the Report.

## When to Use

- **Final gate (default)**: `/impl` invokes this skill automatically after `/completion-audit` returns VERIFIED PASS. The aggregated diff from the first task's `baseline_sha` to `HEAD` is the review target.
- **Manual invocation**: User invokes `/subagent-review` or uses trigger phrases ('subagent review', 'タスクレビュー', 'サブエージェントレビュー') — for example to re-run the review after fixing findings, or to review a branch outside the `/impl` flow.
- **Ad-hoc**: Pass task description or scope as `$ARGUMENTS`, or provide when prompted.

## Skip Conditions

Skip when:
- No code changed (aggregated diff is empty).
- Invocation target is docs-only (`.md` / `.txt` only).
- User explicitly says "no subagent review".

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

### Step 6: Domain-Specific Reviewer Dispatch (priority-ordered, max 1 agent)

Only after Code Quality passes. Dispatch **at most one** language / domain specialist. Earlier designs ran multiple specialists in parallel (e.g., `.tsx` → typescript + react + a11y); that multiplied subagent cost without clearly compounding value. This skill dispatches the highest-priority single match to keep cost bounded.

#### Priority (first match wins)

| Priority | Match | Agent |
|---|---|---|
| 1 | `.rs` file in diff | `rust-reviewer` |
| 2 | `.go` file in diff | `go-reviewer` |
| 3 | `.dart` file in diff | `dart-reviewer` |
| 4 | `.nix` file in diff | `nix-reviewer` |
| 5 | `.tsx` / `.jsx` file in diff | `typescript-reviewer` (React / a11y covered at `/santa-loop` Layer 3) |
| 6 | `.ts` / `.mts` / `.cts` file in diff | `typescript-reviewer` |
| 7 | `.sql` / `migrations/` / `schema.*` (sql / prisma / Drizzle) in diff, or `INSERT INTO` / `UPDATE … SET` / `DELETE FROM` / `CREATE TABLE` in app code | `database-reviewer` (migration safety reinforced at `/santa-loop` Layer 3) |
| 8 | `Deno.` API reference in diff OR `jsr:` / `npm:` specifier added in diff OR `deno.jsonc` / `deno.json` itself modified in diff | `deno-reviewer` |
| 9 | `.tf` / `*.tfvars` / k8s yaml / Helm chart / `Dockerfile` / `docker-compose.yml` / `serverless.yml` / `.github/workflows/*.yml` | `cloud-architecture-reviewer` |
| 10 | `.css` / `.scss` / `.html` in diff AND no higher-priority match | `a11y-reviewer` |

Only the **first** matching agent runs. No multi-dispatch.

#### Detection implementation

```bash
DIFF_FILES=$(git diff --name-only "${BASELINE_SHA}..HEAD")
DIFF_HUNKS=$(git diff "${BASELINE_SHA}..HEAD")

AGENT=""
if   printf '%s\n' "$DIFF_FILES" | rg -q '\.rs$';   then AGENT=rust-reviewer
elif printf '%s\n' "$DIFF_FILES" | rg -q '\.go$';   then AGENT=go-reviewer
elif printf '%s\n' "$DIFF_FILES" | rg -q '\.dart$'; then AGENT=dart-reviewer
elif printf '%s\n' "$DIFF_FILES" | rg -q '\.nix$';  then AGENT=nix-reviewer
elif printf '%s\n' "$DIFF_FILES" | rg -q '\.(jsx|tsx)$'; then AGENT=typescript-reviewer
elif printf '%s\n' "$DIFF_FILES" | rg -q '\.(ts|mts|cts)$'; then AGENT=typescript-reviewer
elif printf '%s\n' "$DIFF_FILES" | rg -q '\.sql$|migrations/|schema\.(sql|prisma|ts)$' \
     || printf '%s' "$DIFF_HUNKS" | rg -qi '(INSERT INTO|UPDATE .* SET|DELETE FROM|CREATE TABLE)'; then AGENT=database-reviewer
elif printf '%s' "$DIFF_HUNKS" | rg -q '^\+.*(\bDeno\.|["'\'']jsr:|["'\'']npm:)' \
     || printf '%s\n' "$DIFF_FILES" | rg -q 'deno\.(json|jsonc)$'; then AGENT=deno-reviewer
elif printf '%s\n' "$DIFF_FILES" | rg -q '\.tf$|\.tfvars$|Dockerfile|docker-compose\.ya?ml$|serverless\.ya?ml$|\.github/workflows/.*\.ya?ml$'; then AGENT=cloud-architecture-reviewer
elif printf '%s\n' "$DIFF_FILES" | rg -q '\.(css|scss|html)$'; then AGENT=a11y-reviewer
fi

# If AGENT is set, launch it once via the Agent tool
```

#### Handling results

The specialist returns MUST_FIX / SHOULD_FIX / NIT + VERDICT:
- FAIL if `VERDICT: FAIL` on a MUST_FIX issue
- On FAIL: fix the MUST_FIX items, then re-dispatch the same specialist with a fresh agent instance (max 3 rounds)

### Step 7: Security Dispatch Heuristic

Evaluated after Code Quality / Domain steps complete. Replaces the former separate Security Sweep step in `/impl`'s final gate by absorbing the heuristic directly into this skill. See [references/security-trigger-heuristic.md](references/security-trigger-heuristic.md) for the full trigger conditions.

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
| Scope | Plan or per-task code | Aggregated diff at final gate | Full implementation |
| Trigger | After /plan / large diffs / manual | `/impl` final gate (after /completion-audit) or manual invoke | User explicitly requests |
| Reviewer | Claude subagent (fresh context) | Claude subagent (fresh context) | Codex CLI (external tool) |
| Purpose | Over-engineering detection, YAGNI | Spec compliance, code quality, domain, security | Holistic quality, security |

Normal flow: `task → acceptance verification → next task → ... → final gate (/completion-audit → /subagent-review) → done`

Optional opt-in: `/santa-loop` (user-invoked dual Claude + Codex convergence) after the gate passes, for high-assurance reviews.

With codex-review: `... → gate passes → codex-review (additional user-invoked step)`
