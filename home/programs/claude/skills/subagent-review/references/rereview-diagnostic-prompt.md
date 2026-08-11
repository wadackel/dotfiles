# Re-review Diagnostic Prompt Template

Use this template for the Step 4 re-review round when the specialist's `FAIL` carried **no** `MUST_FIX` (and no `CRITICAL`) — only `SHOULD_FIX` / `HIGH` items. Replace `{placeholders}` with actual values.

What a fix can break lives mostly inside the fix diff, so this round looks at the fix diff and asks one question: did the fix close the reported findings?

Across 15 recorded SHOULD_FIX-only failures, the full re-review that followed introduced **no new MUST_FIX at all**, and surfaced a new SHOULD_FIX twice. Neither of those two was a defect the fix had caused — both were observations about the original feature diff that the earlier rounds had simply not made. That is what this round trades away: a further draw against code already reviewed, not a check the fix needs.

`MUST_FIX`-bearing failures do not use this template. They re-dispatch a fresh full review, because a fix to a defect of that severity is the case most likely to disturb code the fix diff does not show.

**Paste the `## Template` block verbatim.** Do not summarise it and do not rewrite the verdict line.

## Template

```
## Language

Write all user-facing prose (issue descriptions, suggestions, expected behavior, notes, summary) in **Japanese**.

Keep the following fields in **English** so downstream parsing works:

- `VERDICT: PASS|FAIL` line
- Severity labels: `MUST_FIX`, `SHOULD_FIX`, `NIT`, `MEDIUM`, `LOW`, `CRITICAL`, `HIGH`
- Section headers: `### Must Fix`, `### Should Fix`, `### Nits`, `### Notes`
- Empty-section sentinels: `None`, `(none)`
- Field labels: `File:Line`, `Severity`, `Category`, `Description`, `Suggestion`
- File paths, line numbers, code snippets, command output: as-is

Do NOT translate the section headers, severity tags, empty-section sentinels, or field labels.

## Your Task

You are verifying a fix, not re-reviewing the feature. A previous review round reported the findings below, the implementer applied a fix, and your job is to judge whether the fix closed them.

Do NOT re-review the whole change. Do NOT hunt for new findings outside the fix diff.

## Findings from the previous round

{original_findings}

## The fix

Repo: {repo_path}
Fix diff: `git diff {fix_baseline_sha}..HEAD`

{fix_diff}

## What to judge

For each finding above, decide one of:

- **CLOSED** — the fix resolves it. State in one line what in the fix closes it.
- **OPEN** — the fix does not resolve it, or resolves it only partially. Report it again at its original severity with what is still missing.

Read the fix diff in full and, where the fix's correctness depends on surrounding code, read that code too.

## Escape hatch

If the fix diff itself introduces a **new** `MUST_FIX` (or `CRITICAL`) defect, report it under `### Must Fix`, return `VERDICT: FAIL`, and add this line verbatim to `### Notes`:

  ESCALATE: fix introduced a new blocker — switch to a full re-review

The main session reads that line and re-dispatches a full review instead of another diagnostic round.

New findings below blocker severity that you notice inside the fix diff go under `### Nits`. Do not escalate for those.

## Output Format

### Must Fix
[New blocker-severity defects introduced by the fix, or `None`]

### Should Fix
[Previous findings still OPEN, or `None`]

### Nits
[Non-blocking observations inside the fix diff, or `None`]

### Notes
[One line per previous finding: CLOSED or OPEN with the reason. Plus the ESCALATE line when the escape hatch fires.]

VERDICT: [PASS if every previous finding is CLOSED and the fix introduced no MUST_FIX and no SHOULD_FIX (no CRITICAL and no HIGH for the 4-tier schema), FAIL otherwise]
```

## Placeholders

| Placeholder | Value |
|---|---|
| `{original_findings}` | The blocker-severity findings from the previous round, verbatim |
| `{repo_path}` | Absolute path to the repository or worktree |
| `{fix_baseline_sha}` | HEAD as of immediately before the fix was applied |
| `{fix_diff}` | Output of `git diff {fix_baseline_sha}..HEAD` |

## Usage

```
Agent tool:
  subagent_type: "<the specialist that reported the findings>"
  prompt: [Template above with placeholders filled]
```

Dispatch a fresh instance — never reuse the subagent that produced the original findings.
