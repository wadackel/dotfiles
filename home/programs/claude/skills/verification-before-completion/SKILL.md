---
name: verification-before-completion
description: "Mandatory verification gate before any completion claim. Run this skill before: marking tasks completed (TaskUpdate), claiming a bug is fixed, claiming tests pass, claiming a build succeeds, committing changes, or creating PRs. If you are about to write \"done\", \"complete\", \"fixed\", \"passing\", or \"all tests pass\" \u2014 stop and run this skill first. Even for simple changes. Skipping verification is the #1 cause of false completion claims."
---

# Verification Before Completion

## Overview

A completion claim without verification is a lie, not an optimization.

**Core principle:** Evidence before claims, always.

## Gate Function

Before using any expression that implies completion or success, follow these steps:

1. **IDENTIFY**: What action proves this claim? (command to run, file to read back, output to inspect)
2. **RUN**: Execute that command fully (no shortcuts)
3. **READ**: Read the entire output, check exit code and failure count
4. **VERIFY**: Does the output support the claim?
   - NO → Report the actual state with evidence
   - YES → Make the claim with evidence
5. **CLAIM**: Only now may you declare completion

Skipping any step = not verified.

## Claims and Required Verification

- Tests pass → Run test command + confirm failure=0 in output (previous run results or "should pass" are insufficient)
- Build succeeds → Run build command + confirm exit 0 (lint passing alone is insufficient)
- Bug fixed → Reproduction test for original symptom passes (code change alone is insufficient)
- Requirements met → Compare against each plan item (tests passing alone is insufficient)
- Non-executable changes (docs, etc.) → Read back the changes to confirm (having written it is insufficient)

## Red Flags — STOP

If you catch yourself in any of these thought patterns, return to the Gate Function:

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
