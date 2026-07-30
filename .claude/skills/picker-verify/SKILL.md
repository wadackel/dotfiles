---
name: picker-verify
description: >-
  Runs e2e tests for the tmux Claude Code session picker
  (home/programs/tmux/picker/picker.tsx) in an isolated tmux server sandbox.
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
`home/programs/tmux/picker/picker_e2e_test.ts`, and writes a machine-readable
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

1. Runs `deno cache home/programs/tmux/picker/picker.tsx` to warm npm modules.
2. Runs `picker_e2e_test.ts` under `deno test` with the permission scopes the
   script defines (see the `runDeno` call and its scope-rationale comments in
   `picker-verify.ts` — that file is the source of truth for the exact flags).
3. Parses the test runner output (scenario names + ok/FAILED).
4. Emits a single JSON object on stdout.

### Step 2: Read the JSON result

Success example (illustrative — treat `ok` as the verdict, not any specific
number):

```json
{
  "check": "picker-e2e",
  "ok": true,
  "scenarios": {
    "passed": 37,
    "failed": 0,
    "names_failed": []
  },
  "elapsed_ms": 20502,
  "errors": []
}
```

Failure example:

```json
{
  "check": "picker-e2e",
  "ok": false,
  "scenarios": {
    "passed": 36,
    "failed": 1,
    "names_failed": ["S3: navigation (Down/Up/jk moves the pointer)"]
  },
  "elapsed_ms": 21104,
  "errors": ["see stderr for full test output"]
}
```

### Step 3: Interpret

- `ok: true` — every scenario passed. Report to user: "picker-verify: all scenarios pass (N/N)."
- `ok: false` — at least one scenario failed. Share the `names_failed` list with the user, then read the test's stderr output (the skill prints it under the JSON) to diagnose.
- Exit code follows `ok`: 0 when all pass, 1 otherwise.

### Step 4: Fix and re-run

If failures are in your current change, fix and re-run this skill. Do not
claim picker changes are complete while `ok: false`.

## Scope

This skill only exercises:

- picker.tsx's live rendering + key handling inside a spawned tmux pane
- select-window / select-pane side-effects (switch-client is out of scope)
- Escape-driven clean exit

It does NOT cover:

- picker's unit-level pure helpers (those live in `picker_test.ts`)
- popup-session.sh (tested through direct launch, not popup)
- visual regression / ANSI diff (out of scope by design)

## Timing

Runtime varies with the machine, the Deno cache state, and the scenario
count. A run that produces no new scenario output for a long stretch
indicates a hung scenario.

Override the per-wait timeout via env var if a slow environment trips
false timeouts:

```bash
PICKER_E2E_TIMEOUT_MS=10000 .claude/skills/picker-verify/picker-verify.ts
```
