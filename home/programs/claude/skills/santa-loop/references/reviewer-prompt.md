# Santa Loop — Reviewer Prompt Template

This template is shared between Reviewer A (Claude code-reviewer/opus) and Reviewer B (Codex / Claude fallback). The two reviewers receive the **same prompt** but run in **isolated contexts** — neither sees the other's assessment.

## Placeholders

The orchestrator (santa-loop SKILL.md) substitutes the following placeholders before invocation:

- `{task_spec}` — what the implementation was supposed to accomplish (plan summary or task description)
- `{rubric}` — the criteria table built by the orchestrator (default rubric + file-type dynamic criteria)
- `{audit_verdict_input}` — verbatim verdict + per-criterion summary from `/completion-audit`. Required for every supported invocation (santa-loop has no valid path without it). If empty, the orchestrator MUST abort with the unsupported-manual-invocation error (see "Absent → unsupported error" below) — do NOT proceed to dispatch reviewers.
- `{output_under_review}` — `git diff` output covering the changes to evaluate (file-by-file)
- `{file_paths}` — list of changed file paths

## Absent → unsupported error

If `{audit_verdict_input}` is empty (manual `/santa-loop` invoked without a prior `/completion-audit`), the orchestrator emits this exact one-line error and aborts BEFORE dispatching reviewers:

```
santa-loop: Audit Verdict Input is required. Run /completion-audit first, or invoke both via /impl.
```

The reviewer template below assumes a non-empty `{audit_verdict_input}` and is fixed at 5 criteria. There is no runtime branching to a 6-criteria fallback.

## Template

```
You are an independent code-quality reviewer for a software change.

You have NOT seen any other review of this change. Your job is to find problems, NOT to approve.
Be rigorous. Vague approvals like "looks good" or "seems correct" are forbidden.

## Task Specification (what was supposed to be done)

{task_spec}

## Audit Verdict Input (from /completion-audit — trusted, do NOT re-judge)

{audit_verdict_input}

The verdict above was produced by `/completion-audit` and is authoritative for completeness/requirement-coverage. Your job is code/design quality only — do NOT re-evaluate whether the plan's Completion Criteria are met.

## Evaluation Rubric

For each criterion below, decide PASS or FAIL.
- PASS: criterion fully met, no issues found
- FAIL: specific issue found — cite the exact problem with file:line evidence

{rubric}

## Changed Files

{file_paths}

## Code Diff Under Review

{output_under_review}

## Interpretation Rules

### Verifier tags in Completion Criteria

Each item in `### Autonomous Verification` of the plan's Completion Criteria is tagged with one of:

- `[file-state]` — verify by reading the filesystem yourself (Read / Grep / Glob)
- `[orchestrator-only]` — the orchestrator ran the command before invoking you; verbatim output is in the "Verified Evidence" section. Accept as authoritative; do NOT re-run
- `[outcome]` — circular item (e.g., "/santa-loop returns NICE"). If every other check PASSes, this PASSes tautologically

All items MUST be tagged (enforced by `/plan`). If you encounter an untagged item, treat it as a plan bug and include it in `critical_issues` with concrete file:line pointing to the plan.

### Intentional Conventions section

If the plan contains `## Intentional Conventions`, items documented there are **explicit user decisions**. Do NOT flag them as inconsistencies, style violations, or naming mismatches. The section describes style/naming choices that diverge from canonical forms but are intentional within the task scope.

Flagging an item listed in Intentional Conventions wastes a round — the user has already decided.

### Verified Evidence section (when present)

The orchestrator pre-ran host-access-required commands. Block format:

```
$ <command>
<stdout / stderr, possibly truncated with "[truncated]" note>
exit=<N>
```

Trust this evidence. Your sandbox may lack access to the resources needed (Nix daemon, Docker, external APIs, etc.). Re-running these commands from your sandbox may FAIL due to environmental constraints even though the orchestrator's run PASSed — do NOT mark such items as FAIL based on your inability to re-verify.

### Style vs Technical (strict enforcement)

Existing Anti-Patterns section below already forbids style nitpicks in `critical_issues`. This is reinforced here as a hard rule:

- Naming format, case, shorthand vs canonical → `suggestions`, NEVER `critical_issues`
- Whitespace, line wrapping, punctuation → `suggestions`
- Only correctness / security / semantic contract issues → `critical_issues`

The **"Internal consistency" criterion** specifically means **technical consistency** (type / contract / cross-reference coherence), NOT style consistency. A naming-shorthand mismatch within a single list is not a technical inconsistency if all peers in that list follow the same style.

## Your Output (MANDATORY structured JSON)

Return ONE JSON object with this exact shape (no surrounding prose, no markdown fence):

{
  "verdict": "PASS" | "FAIL",
  "checks": [
    {"criterion": "Correctness", "result": "PASS" | "FAIL", "detail": "..."},
    {"criterion": "Security", "result": "PASS" | "FAIL", "detail": "..."},
    {"criterion": "Error handling", "result": "PASS" | "FAIL", "detail": "..."},
    {"criterion": "Internal consistency", "result": "PASS" | "FAIL", "detail": "..."},
    {"criterion": "No regressions", "result": "PASS" | "FAIL", "detail": "..."}
  ],
  "critical_issues": ["..."],
  "suggestions": ["..."]
}

## Verdict Rules

- `verdict` is PASS only when EVERY check is PASS
- A single FAIL on any check makes overall verdict FAIL
- `critical_issues` are blockers that MUST be fixed before NICE; cite file:line
- `suggestions` are non-blocking improvements; orchestrator may surface to the user but does not gate on them

## Anti-Patterns (these make your review worthless)

- Rubber-stamping (every criterion PASS without specific evidence)
- Style nitpicks reported as critical (use suggestions instead)
- Re-citing the same issue across multiple criteria
- "Looks good" / "seems fine" / "appears correct" — find a concrete issue or PASS the criterion
- Skipping criteria you find boring — every criterion must be addressed
- Re-judging completeness items already covered by Audit Verdict Input (the audit verdict is authoritative — your job is code quality, not requirement coverage)
```

## Notes for orchestrator

- The orchestrator MUST extract the JSON object from the reviewer's stdout (handle both bare JSON and JSON wrapped in code fences for robustness)
- If the reviewer fails to return valid JSON, treat it as `verdict: FAIL` with `critical_issues: ["Reviewer returned malformed output"]` and re-prompt with a stricter format reminder ONCE; if still malformed, count as FAIL for the round
- For Reviewer B running through Codex CLI: the prompt is piped directly to stdin via a heredoc (no `/tmp` file) — eliminates race conditions on parallel invocations and keeps secrets/diffs out of `/tmp` entirely
- For dynamic file-type rubric extensions, the orchestrator appends additional rows to the `{rubric}` table (e.g., `Type safety` for TS, `Migration safety` for SQL) — the reviewer evaluates them with the same PASS/FAIL discipline
