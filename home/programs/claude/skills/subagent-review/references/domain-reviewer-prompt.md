# Domain Reviewer Prompt Template

Use this template when dispatching a Step 4 domain specialist (`rust-reviewer`, `typescript-reviewer`, `react-reviewer`, `a11y-reviewer`, `go-reviewer`, `nix-reviewer`, `deno-reviewer`, `dart-reviewer`, `database-reviewer`, `cloud-architecture-reviewer`, `comment-reviewer`) or the Step 5 `security-auditor`. Replace `{placeholders}` with actual values.

One template covers both steps. The verdict line is schema-neutral, so the 3-tier (MUST_FIX / SHOULD_FIX / NIT) and 4-tier (CRITICAL / HIGH / MEDIUM / LOW) reviewers both read a rule that applies to them — `security-auditor` carries its own severity table in its agent definition.

**Paste the `## Template` block verbatim.** Do not summarise it, do not rewrite the verdict line, and do not turn the verdict line into a placeholder. Dropping the verdict rule is the single failure mode this template exists to prevent: reviewers that are not told the rule return `PASS` while listing blocker-severity findings, and the gate then advances without those findings being fixed.

## Template

```
## Language

Write all user-facing prose (issue descriptions, suggestions, expected behavior, notes, summary) in **Japanese**.

Keep the following fields in **English** so downstream parsing works:

- `VERDICT: PASS|FAIL` line
- Severity labels: `MUST_FIX`, `SHOULD_FIX`, `NIT`, `MEDIUM`, `LOW`, `CRITICAL`, `HIGH`
- Category labels
- Section headers: `### Must Fix`, `### Should Fix`, `### Nits`, `### Notes`, `## Findings`, `## Summary`
- Empty-section sentinels: `None`, `(none)` — used by aggregation to detect populated sections; do not translate
- Field labels: `File:Line`, `Severity`, `Category`, `Description`, `Suggestion`
- File paths, line numbers, code snippets, command output: as-is

Use either the Must Fix / Should Fix / Nits schema or the CRITICAL / HIGH / MEDIUM / LOW schema — keep whichever schema you use in English.

Do NOT translate the section headers, severity tags, empty-section sentinels, or field labels.

## Review target

Repo: {repo_path} (branch {branch})
Diff: `git diff {baseline_sha}..HEAD`

{review_focus}

## Severity Boundary

Assign `SHOULD_FIX` (or `HIGH`) only to findings that carry a concrete risk to behavior, correctness, security, or maintainability and that warrant a fix before merge. Style preferences, best-practice deviations, naming, and suggestions that carry no behavioral risk are `NIT` (or `LOW`) — no matter how confident you are that the change would be an improvement.

When you are torn between `SHOULD_FIX` and `NIT`, choose `NIT`.

## Scope Discipline

Findings on code **outside the changed lines** — pre-existing issues, adjacent refactor opportunities, improvements to untouched code — MUST be reported as `NIT` (or `LOW`), never `SHOULD_FIX`/`HIGH`. Only defects introduced or directly touched by this diff may block.

One exception: an exploitable security defect keeps its real severity even when it is pre-existing. Report it at the severity it warrants and say in the finding that it predates this diff.

## Output Budget

Write full detail (Description + Suggestion) for at most 8 findings, chosen in descending severity order.

Beyond that budget:

- Every remaining blocker-severity finding (`MUST_FIX`/`SHOULD_FIX`, or `CRITICAL`/`HIGH`) MUST still be listed as a single line: `file:line — one-line title`. Never drop a blocker.
- Remaining `NIT`/`LOW` findings are reported as a count only.

Do not pad the output. Skip preamble, skip narration of what you did, skip a list of things that are fine.

## Output Format

### Must Fix
[Findings that block, or `None`]

### Should Fix
[Findings that block, or `None`]

### Nits
[Non-blocking findings, or `None`]

### Notes
[Observations worth recording that are not findings, or `None`]

VERDICT: [PASS if there are no MUST_FIX and no SHOULD_FIX items (no CRITICAL and no HIGH items for the 4-tier schema), FAIL otherwise]
```

## Placeholders

| Placeholder | Value |
|---|---|
| `{repo_path}` | Absolute path to the repository or worktree under review |
| `{branch}` | Branch name, or `detached at <sha>` |
| `{baseline_sha}` | The first task's `baseline_sha` from `TaskUpdate` metadata |
| `{review_focus}` | What this specialist should look at, in one or two sentences — the reviewer's domain and any scope the earlier stages already covered |

## Usage

```
Agent tool:
  subagent_type: "<specialist name>"
  prompt: [Template above with placeholders filled]
```

Pass only factual data (repo path, diff range, focus). Never pass the main session's summary of what was implemented — the reviewer must judge independently.
