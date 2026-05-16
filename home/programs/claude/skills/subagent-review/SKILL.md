---
name: subagent-review
description: "Final-gate review skill for /impl — runs Spec Compliance → Code Quality → parallel orthogonal Domain specialists → Security heuristic against the aggregated diff after /completion-audit returns VERIFIED PASS. Also fires on manual invocation / 'subagent review', 'タスクレビュー', 'サブエージェントレビュー'."
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

## Language Policy

All reviewer subagents dispatched by `/subagent-review` MUST follow this policy. The directive text below is the **canonical source** — Step 2 / Step 4 / Step 6 / Step 7 each inline the same block into their dispatch prompt so the reviewer reads it inside its own context.

```
## Language

Write all user-facing prose (issue descriptions, suggestions, expected behavior, notes, summary) in **Japanese**.

Keep the following fields in **English** so downstream parsing works:

- `VERDICT: PASS|FAIL` line
- Severity labels: `MUST_FIX`, `SHOULD_FIX`, `NIT`, `MEDIUM`, `LOW`, `CRITICAL`, `HIGH`
- Type labels: `MISSING`, `EXTRA`, `MISUNDERSTOOD`, `INCOMPLETE`
- Category labels: `READABILITY`, `CONSISTENCY`, `MAINTAINABILITY`, `ROBUSTNESS`, `SIMPLICITY`
- Section headers: `### Must Fix`, `### Should Fix`, `### Nits`, `### Issues`, `### Notes`, `## Findings`, `## Summary`
- Empty-section sentinels: `None`, `Empty if none`, `(none)` — used by aggregation to detect populated sections; do not translate
- Field labels: `File:Line`, `Type`, `Severity`, `Category`, `Description`, `Suggestion`, `Expected`
- File paths, line numbers, code snippets, command output: as-is

Domain reviewers may use either the Must Fix / Should Fix / Nits schema or the CRITICAL / HIGH / MEDIUM / LOW schema — keep whichever schema your output uses in English.

Example (correct):

  ### Should Fix
  - **Severity**: SHOULD_FIX
  - **Category**: READABILITY
  - **File:Line**: home/programs/claude/scripts/foo.ts:42
  - **Description**: 変数名 `x` が用途を示しておらず可読性が低い
  - **Suggestion**: `userCount` に改名

Do NOT translate the section headers, severity tags, empty-section sentinels, or field labels.
```

**Sub-rule from CLAUDE.md "Language Defaults For Generated Artifacts":** Machine-contract fields (parsed by downstream tooling) are not part of the generated-artifact language scope. The reviewer's output language is the configured artifact language (Japanese for this user), but the fields listed above retain their canonical English form.

## Workflow

> **Cross-cutting invariant**: All non-blocker findings (`SHOULD_FIX` / `NIT` / Security `MEDIUM`/`LOW` / Spec populated `### Issues` and `### Notes`) from every stage MUST be aggregated and reported via the [Mandatory Final Output](#mandatory-final-output) section below, regardless of stage `VERDICT` (including `PASS`). Per-stage handling tables only govern flow control; they do not exempt findings from final emission.

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

### Step 6: Domain-Specific Reviewer Dispatch (parallel, orthogonal triggers)

Only after Code Quality passes. Evaluate each specialist's trigger condition independently against the diff, and dispatch **all matches in parallel** in the same assistant turn (multiple Agent tool calls in a single message).

Each reviewer agent already declares its own Out of Scope delegation in frontmatter (e.g., `typescript-reviewer` delegates React concerns to `react-reviewer` and a11y concerns to `a11y-reviewer`). Because the scopes are orthogonal by design, parallel dispatch does not duplicate findings — it restores coverage that single-match dispatch was losing for stacks like `.tsx` (which legitimately needs typescript + react + a11y observations). The earlier "max 1 agent" design traded accuracy for subagent cost; this version reverses that trade-off because missed React/a11y findings were resurfacing as manual user review burden.

#### Reviewer triggers (independent, all matches fire)

| Agent | Trigger |
|---|---|
| `rust-reviewer` | `.rs` file in diff |
| `go-reviewer` | `.go` file in diff |
| `dart-reviewer` | `.dart` file in diff |
| `nix-reviewer` | `.nix` file in diff |
| `typescript-reviewer` | `.ts` / `.tsx` / `.mts` / `.cts` file in diff |
| `react-reviewer` | `.jsx` / `.tsx` file in diff OR diff contains `from "react"` / `from "react-dom"` |
| `a11y-reviewer` | `.css` / `.scss` / `.html` file in diff OR `.jsx` / `.tsx` file in diff (reviewer self-no-ops if no JSX markup present) |
| `database-reviewer` | `.sql` / `migrations/` / `schema.(sql|prisma|ts)` in diff, OR `INSERT INTO` / `UPDATE … SET` / `DELETE FROM` / `CREATE TABLE` in app code |
| `deno-reviewer` | `Deno.` API reference in diff OR `jsr:` / `npm:` specifier added in diff OR `deno.jsonc` / `deno.json` itself modified |
| `cloud-architecture-reviewer` | `.tf` / `*.tfvars` / k8s yaml / Helm chart / `Dockerfile` / `docker-compose.yml` / `serverless.yml` / `.github/workflows/*.yml` |

All matches dispatch. No priority cutoff, no mutual exclusion.

#### Detection implementation

```bash
DIFF_FILES=$(git diff --name-only "${BASELINE_SHA}..HEAD")
DIFF_HUNKS=$(git diff "${BASELINE_SHA}..HEAD")

AGENTS=()
printf '%s\n' "$DIFF_FILES" | rg -q '\.rs$'   && AGENTS+=(rust-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.go$'   && AGENTS+=(go-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.dart$' && AGENTS+=(dart-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.nix$'  && AGENTS+=(nix-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.(ts|tsx|mts|cts)$' && AGENTS+=(typescript-reviewer)
{ printf '%s\n' "$DIFF_FILES" | rg -q '\.(jsx|tsx)$' \
  || printf '%s' "$DIFF_HUNKS" | rg -q 'from ["'\'']react(-dom)?["'\'']'; } && AGENTS+=(react-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.(css|scss|html|jsx|tsx)$' && AGENTS+=(a11y-reviewer)
{ printf '%s\n' "$DIFF_FILES" | rg -q '\.sql$|migrations/|schema\.(sql|prisma|ts)$' \
  || printf '%s' "$DIFF_HUNKS" | rg -qi '(INSERT INTO|UPDATE .* SET|DELETE FROM|CREATE TABLE)'; } && AGENTS+=(database-reviewer)
{ printf '%s' "$DIFF_HUNKS" | rg -q '^\+.*(\bDeno\.|["'\'']jsr:|["'\'']npm:)' \
  || printf '%s\n' "$DIFF_FILES" | rg -q 'deno\.(json|jsonc)$'; } && AGENTS+=(deno-reviewer)
printf '%s\n' "$DIFF_FILES" | rg -q '\.tf$|\.tfvars$|Dockerfile|docker-compose\.ya?ml$|serverless\.ya?ml$|\.github/workflows/.*\.ya?ml$' && AGENTS+=(cloud-architecture-reviewer)

# For each agent in AGENTS, launch via the Agent tool in the SAME assistant turn (parallel tool calls in a single message).
```

When constructing each Agent prompt, prepend the `## Language Policy` directive block from this SKILL.md verbatim so the reviewer follows the language directive.

#### Handling results

Each specialist returns MUST_FIX / SHOULD_FIX / NIT + VERDICT independently:
- A specialist is FAIL when its `VERDICT: FAIL` covers at least one MUST_FIX issue.
- On FAIL: fix the MUST_FIX items, then re-dispatch **only the FAILed specialist(s)** with a fresh agent instance (max 3 rounds per specialist). Specialists that already returned PASS are not re-dispatched.
- Step 6 as a whole is PASS only when every dispatched specialist returns PASS (or NIT-only) within its 3-round budget.

### Step 7: Security Dispatch Heuristic

Evaluated after Code Quality / Domain steps complete. Replaces the former separate Security Sweep step in `/impl`'s final gate by absorbing the heuristic directly into this skill. See [references/security-trigger-heuristic.md](references/security-trigger-heuristic.md) for the full trigger conditions.

#### Summary of triggers

- **Path**: `scripts/`, `hooks/`, `auth`, `session`, `credential`, `secret`, `token`, `api/`, `webhook`, `oauth`, `sso`, `crypto`
- **Content**: `child_process`, `exec`, `eval`, `new Function`, SQL DML, `password`, `process.env.XXX`, `os/exec`, `exec.Command`, template-literal `fetch()`, string-concat HTTP
- **Config**: `settings.json`, `.claude/**`, `.env*`, `permissions.allow*`, `secrets*.{yml,yaml,json,toml}`

When any trigger fires, dispatch `security-auditor` (existing agent). Same MUST_FIX / SHOULD_FIX handling + max 3 rounds as Step 6.

#### Implementation

```bash
DISPATCH_SECURITY=0
printf '%s\n' "$DIFF_FILES" | rg -qi 'scripts/|hooks/|auth|session|cookie|credential|secret|token|api/|webhook|oauth|sso|crypto|encrypt|decrypt' && DISPATCH_SECURITY=1
printf '%s' "$DIFF_HUNKS" | rg -q 'child_process|spawn|execFile|exec\(|eval\(|new Function\(|SELECT .* FROM|INSERT INTO|UPDATE .* SET|DELETE FROM|password|process\.env\.[A-Z_]+|api[_-]?key|secret[_-]?key|access[_-]?token|os/exec|exec\.Command' && DISPATCH_SECURITY=1
printf '%s\n' "$DIFF_FILES" | rg -q '^settings\.json$|^\.claude/|^\.env|permissions\.allow|secrets?\.(yml|yaml|json|toml)$' && DISPATCH_SECURITY=1

if [ "$DISPATCH_SECURITY" = "1" ]; then
  # Launch security-auditor via Agent tool
  : # See references/security-trigger-heuristic.md for full rationale
fi
```

When constructing the Agent prompt, prepend the `## Language Policy` directive block from this SKILL.md verbatim so the reviewer follows the language directive.

## Mandatory Final Output

After all stages (Spec / Code Quality / Domain / Security) complete — regardless of overall verdict — `/subagent-review` MUST emit a single aggregated findings block as the last thing in its output. This is a non-skippable invariant: a `PASS` verdict on every stage does NOT exempt this emission.

### Extraction rule

For each stage that ran, take its **last** subagent response (the final round's output, including the `PASS` round when the stage looped through `FAIL` → fix → re-review) and extract every populated section that did not cause that subagent's `FAIL` verdict:

- Code Quality / Domain reviewers: populated `### SHOULD_FIX` and `### NIT` sections.
- Security: populated `MEDIUM` and `LOW` items (severity names preserved verbatim — do NOT translate to MUST/SHOULD/NIT).
- Spec Compliance: populated `### Issues` (when stage `VERDICT: PASS`) and `### Notes`.
- Any other populated non-blocker section emitted by a future reviewer — this rule is intentionally generalized.

Copy each section **verbatim** (file:line, description, suggested fix). Do not paraphrase, summarize, or re-rank.

### Multi-round aggregation rule

When a stage looped through multiple rounds (e.g. Round 1 `FAIL` with `MUST_FIX: A` + `SHOULD_FIX: B,C,D` → fix → Round 2 `PASS` with no SHOULD_FIX listed because the reviewer only re-checked the diff after the fix), take the **union of non-blocker findings across all rounds for that stage, deduped** (by file:line + description). This prevents structural loss of earlier-round SHOULD_FIX items that the final-round reviewer did not re-list.

### Zero-finding shortcut

If every stage has zero non-blocker findings after the union+dedupe pass, emit exactly one line:

```
Non-blocker findings: none across all stages
```

Do NOT emit per-stage `(none)` boilerplate.

### Output template (when at least one finding exists)

```
## Final Findings Report

### Spec — Issues (PASS verdict)
- <verbatim items, or omit this subsection when empty>

### Spec — Notes
- <verbatim items, or omit this subsection when empty>

### Code Quality — SHOULD_FIX
- <verbatim items>

### Code Quality — NIT
- <verbatim items, 1 line per item, may be condensed for readability>

### Domain (<reviewer-name>) — SHOULD_FIX
- <verbatim items>

### Domain (<reviewer-name>) — NIT
- <verbatim items>

### Security — MEDIUM
- <verbatim items>

### Security — LOW
- <verbatim items>
```

Only include subsections for stages/severities that produced findings. Stage-skipped reviewers (e.g. Domain reviewer not triggered because no matching file extension was in the diff) are simply absent from the block — do NOT add `(skipped)` rows.

This block is the canonical hand-off to `/impl`'s final report and MUST be transcribed verbatim downstream.

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
- Suppressing or summarizing SHOULD_FIX / NIT / Spec Notes / Security MEDIUM/LOW findings in the user-facing report when overall verdict is PASS — these MUST flow through the [Mandatory Final Output](#mandatory-final-output) block verbatim

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
