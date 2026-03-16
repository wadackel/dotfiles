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

| Aspect | subagent-review | codex-review |
|--------|----------------|--------------|
| Scope | Per-task incremental | Full implementation |
| Trigger | Auto after each task (default) | User explicitly requests |
| Reviewer | Claude subagent (fresh context) | Codex CLI (external tool) |
| Purpose | Long-context quality correction | Holistic quality, security |

Normal flow: `task → subagent-review → next task → subagent-review → ... → done`
With codex-review: `... → all tasks done → codex-review (additional)`
