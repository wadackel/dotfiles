---
name: bypass-plan-gate
description: Bypasses the plan-gate for the current session+cwd, allowing Edit/Write/MultiEdit without an active /plan marker.
argument-hint: "[activate|status|clear]"
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/bypass-plan-gate.ts:*)
---

# /bypass-plan-gate

Activates a session+cwd scoped bypass marker so subsequent Edit/Write/MultiEdit pass the plan-gate even without an active `/plan` marker.

## Action

!`"${CLAUDE_SKILL_DIR}/bypass-plan-gate.ts" "$ARGUMENTS" "$PWD" "${CLAUDE_SESSION_ID}"`

Report the JSON result above to the user.

## Subcommands

- (default / `activate`): write a session+cwd bypass marker for the current cwd.
- `status`: print marker state as JSON (`valid`, `path`, hashes).
- `clear`: remove the marker for the current session+cwd.
