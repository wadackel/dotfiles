---
name: tdd-workflow
description: Enforces test-first development patterns. Use when writing new features, fixing bugs with reproducible symptoms, or creating testable scripts. Guides through defining expected behavior FIRST, writing failing tests, then implementing. Triggers include "テストファーストで", "TDDで", "test-first", "write tests first", "テスト駆動で".
---

# TDD Workflow

Enforces test-first development patterns. Work in the order "design verification -> implement -> run verification" instead of "implement -> verify".

## When to Use

- Implementing new features (when testable behavior exists)
- Bug fixes (when symptoms are reproducible)
- Creating or modifying CLI scripts
- Creating or modifying hook scripts
- Proactively use when implementing new features

## When NOT to Use

- Configuration value changes only
- Documentation fixes
- Refactoring within existing test coverage

## Workflow

### Step 1: Define Expected Behavior

Before starting implementation, concretely write out "what correct behavior looks like".

- Deno scripts -> write test cases in `_test.ts`
- Nix configuration -> define expected output (`which <command>`, generation number changes)
- Hooks -> enumerate input -> expected output pairs
- Skills -> define positive/negative trigger test cases

### Step 2: Write Tests -> Confirm Failure (RED)

```bash
# For Deno
deno test --allow-env=HOME --allow-read --allow-write path/to/script_test.ts
# -> Confirm FAILED output (expected since no implementation exists)
```

Confirming test failure is mandatory. Writing tests that already pass is meaningless.

### Step 3: Minimal Implementation (GREEN)

Write only enough code to make the tests pass. Do not add extra features.

```bash
# Run tests again
deno test --allow-env=HOME --allow-read --allow-write path/to/script_test.ts
# -> Confirm PASSED
```

### Step 4: Refactor

Improve code quality while confirming tests continue to pass.

### Step 5: Declare Verification Complete

Declare completion only after confirming all tests pass and expected behavior is implemented.

## Context-Specific Guide

### Deno Scripts

Follow existing test patterns:
- `bash-policy_test.ts` -- glob pattern matching tests
- `approve-piped-commands_test.ts` -- pipe command splitting tests
- `shell-utils_test.ts` -- utility function tests

Test execution: `deno test --allow-env=HOME --allow-read --allow-write <path>`

### Nix Configuration

Not pure TDD but a "structural verification gate":
1. Pre-define expected results (e.g., "htop exists in PATH")
2. Syntax verification with `nix flake check`
3. Apply with `darwin-rebuild switch`
4. Confirm expected results

### Hook Scripts

1. Define test scenarios (stdin JSON -> expected stdout/exit code)
2. Implement hook
3. Run test scenarios

### Skill Definitions

1. Define skill-tester test cases (positive/negative/edge triggers)
2. Create SKILL.md
3. Run skill-tester

## Related

- **tdd-guide agent** -- subagent that assists with TDD execution
- **verification-before-completion** -- pre-completion verification gate
- **qa-planner** -- QA test case design
