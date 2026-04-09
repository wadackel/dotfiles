---
name: completion-audit
description: "Mandatory completion audit gate. Run this skill ONCE as the final gate task before declaring all work complete. Audits whether implementation and verification evidence are sufficient for the plan's stated purpose. Do NOT run per-task — run only at the final gate. Skipping the completion audit is the #1 cause of false completion claims."
---

# Completion Audit

## Overview

A completion claim without audit is a lie, not an optimization.

**Core principle:** Evidence before claims, always. But evidence is gathered during implementation, not re-gathered at the gate.

## Completion Audit Workflow

This skill runs ONCE at the final gate task, after all implementation tasks are complete.

### Step 1: Evidence Collection

Performed by the main session (the implementer):

1. Read the plan file and extract:
   - **Plan Purpose** (Background/Context section)
   - **Completion Criteria** section
2. For each completed implementation task, collect:
   - What was implemented (files changed, behaviors added/modified)
   - What was verified during the task (commands run, raw output observed, results)
3. Run `git diff --name-only` against the baseline SHA to get the full changed file list

**Anti-curation rules** (these are mandatory):
- The `Verified` field for each task MUST contain raw command output (exit codes, test output, actual stdout/stderr)
- Summaries like "tests pass", "looks correct", "works as expected" are PROHIBITED — paste the actual output
- If a verification command was not executed during the task, state `Result: 未実施` explicitly
- Do NOT paraphrase, rephrase, or selectively quote output

**Evidence format:**

```
## Plan Purpose
[Plan's Background/Context section, verbatim]

## Completion Criteria
[Plan's Completion Criteria section, verbatim]

## Task Evidence

### Task 1: [subject]
- **Implemented**: [files changed, behaviors added/modified]
- **Verified**: [exact commands run and their raw output]
- **Result**: [PASS/FAIL/未実施]

### Task 2: [subject]
...

## Changed Files
[git diff --name-only output]
```

### Step 2: Spawn Completion Auditor

Dispatch a fresh `completion-auditor` subagent via the Agent tool:

```
Agent tool:
  subagent_type: "completion-auditor"
  prompt: [include the evidence document from Step 1]
```

**Pass to the auditor:**
- The complete evidence document from Step 1

**Do NOT pass:** full implementation history, your own assessment of quality, or results from prior audit attempts.

### Step 3: Handle Result

| Result | Action |
|--------|--------|
| `VERIFIED: PASS` | Completion claim is authorized. Proceed to Step 4 |
| `VERIFIED: FAIL` | Read the auditor's gap analysis. Address the specific gaps (run missing verifications, fix issues), then re-run from Step 1 with a **fresh** subagent |
| No VERIFIED line | Treat as FAIL |
| 3 consecutive FAILs | Report the final audit result to the user and let them decide. Do not mark the task complete |

Never retry with the same subagent — always spawn fresh.

### Step 4: Claim

Only after `VERIFIED: PASS` may you declare all work complete.

## Red Flags — STOP

If you catch yourself in any of these thought patterns, return to the Completion Audit Workflow:

- About to use "should work", "probably fixed", or "seems to pass"
- About to write "done" or "complete" before running the completion audit
- "It worked before, so it still works"
- "I changed the code, so the bug is fixed"
- "I wrote the test, so it's fine" (without running it)

## Common Rationalizations

- "No need to audit" → Confidence is not a substitute for audit
- "It's a simple change" → Simple changes can still introduce bugs
- "Each task was verified individually, so the whole is fine" → Individual task verification does not guarantee goal achievement
- "Tests pass, so we're done" → Tests passing is necessary but not sufficient — does the outcome match the purpose?
