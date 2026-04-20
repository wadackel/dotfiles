---
name: picker-verify
description: >-
  Runs e2e tests for the tmux Claude Code session picker
  (home/programs/tmux/picker.tsx) in an isolated tmux server sandbox.
  Use proactively after any change to picker.tsx, picker_e2e_harness.ts,
  or picker_e2e_test.ts — even if the user doesn't explicitly ask for
  verification, run at least once to catch regressions before the user
  tries the picker. Also use when asked to "verify picker",
  "picker動作確認", "picker e2e", "picker を検証して",
  "tmux picker のテスト", or "picker-verify".
allowed-tools: Bash(*picker-verify.ts*)
---

# picker-verify

Verify the tmux picker end-to-end against a fresh isolated tmux server.
Warms the Deno module cache, runs every scenario in
`home/programs/tmux/picker_e2e_test.ts`, and writes a machine-readable
JSON result to stdout.

## Quick Start

```bash
.claude/skills/picker-verify/picker-verify.ts
```

## Workflow

### Step 1: Run the script

```bash
.claude/skills/picker-verify/picker-verify.ts
```

The script is self-contained. It:

1. Runs `deno cache home/programs/tmux/picker.tsx` to warm npm modules.
2. Runs `deno test --allow-run=tmux --allow-env --allow-read home/programs/tmux/picker_e2e_test.ts`.
3. Parses the test runner output (scenario names + ok/FAILED).
4. Emits a single JSON object on stdout.

### Step 2: Read the JSON result

Success example:

```json
{
  "check": "picker-e2e",
  "ok": true,
  "scenarios": {
    "passed": 6,
    "failed": 0,
    "names_failed": []
  },
  "elapsed_ms": 2886,
  "errors": []
}
```

Failure example:

```json
{
  "check": "picker-e2e",
  "ok": false,
  "scenarios": {
    "passed": 5,
    "failed": 1,
    "names_failed": ["S3: navigation (Down/Up/jk moves the pointer)"]
  },
  "elapsed_ms": 3104,
  "errors": ["see stderr for full test output"]
}
```

### Step 3: Interpret

- `ok: true` — every scenario passed. Report to user: "picker-verify: 6/6 scenarios pass."
- `ok: false` — at least one scenario failed. Share the `names_failed` list with the user, then read the test's stderr output (the skill prints it under the JSON) to diagnose.
- Exit code follows `ok`: 0 when all pass, 1 otherwise.

### Step 4: Fix and re-run

If failures are in your current change, fix and re-run this skill. Do not
claim picker changes are complete while `ok: false`.

## Scope

This skill only exercises:

- picker.tsx's live rendering + key handling inside a spawned tmux pane
- select-window / select-pane side-effects (not switch-client — see Q1 in the plan)
- Escape-driven clean exit

It does NOT cover:

- picker's unit-level pure helpers (those live in `picker_test.ts`)
- popup-session.sh (tested through direct launch, not popup)
- visual regression / ANSI diff (out of scope by design)

## Timing

Expected runtime: 2–5 s on warm cache, up to ~15 s on cold first-run
(npm module download). The 30 s budget in the plan's Risk R1 is the
upper bound — exceeding it suggests a hung scenario, not a legitimate
slowdown.

Override the per-wait timeout via env var if a slow environment trips
false timeouts:

```bash
PICKER_E2E_TIMEOUT_MS=10000 .claude/skills/picker-verify/picker-verify.ts
```
