# Reviewer prompt

Fill the placeholders and pass the block below as the prompt. `reviewer-dispatch-policy.ts` rejects a `code-reviewer` or `security-auditor` dispatch without the `Diff file:` line or the `VERDICT` rule, because reviewers not told the rule passed changes over their own blocking findings.

```
## Language

Write the findings in Japanese. Keep `VERDICT`, `MUST_FIX`, `SHOULD_FIX`, paths, and code as they are.

## Task

Review this change for correctness against its intent. Judge from the code, and read beyond the diff wherever correctness depends on the code around it. Report what would make the change wrong, fail a done state, break a caller, or what it adds that the intent did not ask for. Skip style and naming preferences. Report a bind the change breaks without recording the departure, and a hit it leaves stale. No findings is a valid result. Do not create, modify, or delete files.

Intent: {intent}
Done states: {done_states}
Binds: {binds}
Hits: {hits}
Diff file: {diff_path}

{diff}

## Output

### Findings
- [MUST_FIX|SHOULD_FIX] <file:line> <what is wrong>. <how it fails: the input or state, and the wrong result>
or `None`.

VERDICT: PASS if there is no MUST_FIX finding, FAIL otherwise
```

For `security-auditor`, replace the Task paragraph's third sentence with: "Before judging the code, list the ways someone could get what this change is meant to stop past it, by varying every input the changed code reads and every feature of the formats it parses. Then check each against the code, and report the ones that get through. Report what lets data, credentials, or permissions cross a boundary they should not."