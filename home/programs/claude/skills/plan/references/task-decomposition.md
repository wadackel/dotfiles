# Task Decomposition Reference

Reference for `/plan` Phase 5 DECOMPOSE. The main session (orchestrator) consults this file when converting a plan into a task list and dispatching `TaskCreate`. No subagent is involved — main session applies these rules directly using the plan content it already holds in context.

History: these rules were previously embodied by the `task-planner` subagent (`~/.claude/agents/task-planner.md`, now removed). The subagent was inlined to eliminate dispatch overhead, avoid redundant plan re-reads, and prevent drift between the orchestrator's workflow and the agent's stale instructions.

## Decomposition Rules

1. **1 task = 1 verifiable unit**: Granularity where completion can be confirmed independently.
2. **Verification within implementation tasks**: Each implementation task includes its own acceptance criteria with verification commands. Do not split verification out into standalone tasks among the implementation tasks — the only verification-only task allowed is the mandatory final gate in rule 5.
3. **Separation of concerns**: Different concerns go in separate tasks. Files sharing the same concern go in one task.
4. **Three elements of task descriptions**: Every task description must contain (1) target files to modify, (2) expected behavior after change, (3) acceptance criteria (verification commands + expected output).
5. **Final gate task**: Always include a final gate task titled `Run /verification-loop and /santa-loop`, `blockedBy` all implementation tasks. `/verification-loop` runs first (deterministic build/typecheck/lint/test gate), then `/santa-loop` runs (dual-reviewer adversarial verification). `/completion-audit` is NOT the default final gate — it is deprecated for the standard flow and invoked manually only when stricter evidence-sufficiency audit is specifically required.

## Acceptance Criteria by Change Type

Analyze the changes in the plan and embed appropriate acceptance criteria within each implementation task description:

| Change Type | Acceptance criteria to include in implementation task description |
|---|---|
| CLI script | Execute the script and confirm output matches expected values |
| Hook script | Reproduce the hook trigger condition and confirm intervention works correctly |
| Web UI | Open the page with `/agent-browser`, take screenshots. Check layout, console errors, and responsiveness |
| Nix config | Confirm settings are applied after `darwin-rebuild` |
| Skill/agent addition | Verify with skill-tester trigger test or manual invocation |
| Improvement task | Record a Before baseline and compare with After to demonstrate improvement numerically |

`code-simplifier` dispatch is NOT a decomposition concern — `/impl` Step 4.5 auto-spawns it per implementation task when that task's diff ≥ 20 files OR ≥ 500 lines (see `~/.claude/skills/impl/SKILL.md`). Do not create a standalone simplifier task here.

See `~/.claude/skills/completion-audit/references/behavioral-verification.md` for the detailed per-change-type verification template.

## Anti-patterns

- Creating separate verification tasks among the implementation tasks (per-task verification is embedded in that task's acceptance criteria). The one exception is the final `Run /verification-loop and /santa-loop` gate task, which is required by rule 5.
- Verification tasks that only say "confirm" without specific commands.
- Missing dependencies (tasks that cannot execute without a prerequisite task must declare `blockedBy`).
- Missing final gate task (`Run /verification-loop and /santa-loop` must exist and block on all implementation tasks).
- Using `/completion-audit` as the default final gate (it is deprecated for the standard flow — use `/verification-loop` + `/santa-loop` instead).
