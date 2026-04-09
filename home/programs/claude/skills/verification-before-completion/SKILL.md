---
name: verification-before-completion
description: "Mandatory verification gate before any completion claim. Run this skill before: marking tasks completed (TaskUpdate), claiming a bug is fixed, claiming tests pass, claiming a build succeeds, committing changes, or creating PRs. If you are about to write \"done\", \"complete\", \"fixed\", \"passing\", or \"all tests pass\" \u2014 stop and run this skill first. Even for simple changes. Skipping verification is the #1 cause of false completion claims."
---

# Verification Before Completion

## Overview

A completion claim without verification is a lie, not an optimization.

**Core principle:** Evidence before claims, always.

## Verification Workflow

Before using any expression that implies completion or success, delegate verification to an independent subagent:

### Step 1: Context Collection

Performed by the main session (the implementer):

1. Identify all completion claims about to be made (e.g., "tests pass", "build succeeds", "bug fixed")
2. Consult the "Claims and Required Verification" section below and `references/behavioral-verification.md` to determine recommended verification commands for each claim
3. Run `git diff --name-only` to get the list of changed files

### Step 2: Spawn Verification Auditor

Dispatch a fresh `verification-auditor` subagent via the Agent tool:

```
Agent tool:
  subagent_type: "verification-auditor"
  prompt: [include the information below]
```

**Pass to the auditor:**
- List of completion claims
- Recommended verification commands (the auditor may add or modify these independently)
- Changed file list

**Do NOT pass:** implementation history, your own judgment about whether the claims are true, or results from prior verification attempts.

### Step 3: Handle Result

| Result | Action |
|--------|--------|
| `VERIFIED: PASS` | Completion claim is authorized. Proceed to Step 4 |
| `VERIFIED: FAIL` | Read the auditor's findings, fix the issues, then re-run from Step 1 with a **fresh** subagent |
| No VERIFIED line | Treat as FAIL |
| 3 consecutive FAILs | Report the final audit result to the user and let them decide. Do not mark the task complete |

Never retry with the same subagent — always spawn fresh.

### Step 4: Claim

Only after `VERIFIED: PASS` may you declare completion.

## Claims and Required Verification

- Tests pass → Run test command + confirm failure=0 in output (previous run results or "should pass" are insufficient)
- Build succeeds → Run build command + confirm exit 0 (lint passing alone is insufficient)
- Bug fixed → Reproduce the original symptom's trigger scenario and confirm it no longer occurs (code change alone is insufficient; unit tests passing is insufficient — the reproduction must exercise the same entry point that exhibited the bug, e.g., run the CLI command, call the API endpoint, load the UI page)
- Requirements met → Compare against each plan item (tests passing alone is insufficient)
- Non-executable changes (docs, etc.) → Read back the changes to confirm (having written it is insufficient)

## Red Flags — STOP

If you catch yourself in any of these thought patterns, return to the Verification Workflow:

- About to use "should work", "probably fixed", or "seems to pass"
- About to write "done" or "complete" before running verification commands
- "It worked before, so it still works"
- "I changed the code, so the bug is fixed"
- "I wrote the test, so it's fine" (without running it)

## Common Rationalizations

- "No need to verify" → Confidence is not a substitute for verification
- "It's a simple change" → Simple changes can still introduce bugs
- "It passed earlier" → "Earlier" is not "now". Re-run it
- "Lint passed, so build will pass too" → Lint and build are separate verifications
