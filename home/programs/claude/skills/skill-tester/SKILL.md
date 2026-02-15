---
name: skill-tester
description: Automated skill validation through isolated agent testing. Use when users want to test or validate newly created or modified Claude Code skills. Triggers include "test this skill", "validate the skill", "verify skill functionality", "check if the skill works correctly", or any request to ensure a skill behaves as expected. Each test runs in a fresh tester agent with minimal context contamination, including support for story-based tests with conversation context.
---

# Skill Tester

Validate Claude Code skills through automated multi-agent team testing.

## Quick Start

```
/skill-tester [skill-name]
```

If no skill name is provided, you'll be prompted to select from available skills.

The skill will analyze the target, design test scenarios, and present a plan for approval before creating a test team with dedicated tester agents.

## Overview

This skill automates the process of testing Claude Code skills by:

1. Analyzing the skill to understand its purpose and expected behavior
2. Designing test scenarios that cover positive, negative, edge cases, and story-based tests
3. Presenting test plan for user approval
4. Creating team and executing tests via dedicated tester agents with evaluation
5. Compiling a final report with pass/fail results and improvement recommendations
6. Cleaning up team resources
7. Iterating on improvements if needed

**Agent roles**:
- **Conductor** (you): Orchestrates workflow, spawns testers, evaluates reports against [validation-criteria.md](references/validation-criteria.md)
- **Tester** (tester-{id}): Single-use agent, one test per agent, fresh context. See [agent-prompts.md](references/agent-prompts.md) for prompt template

**Message flow**: Conductor → spawn Tester → Tester executes → Tester sends report → Conductor evaluates → shutdown Tester → next test

**Key principle**: Each test runs in a dedicated tester agent with fresh context, eliminating cross-test context contamination. The conductor evaluates all results directly using validation-criteria.md.

## Workflow

### Step 1: Understand the Skill

Read and analyze the skill being tested:

```bash
# For skill directories
Read ~/.claude/skills/{skill-name}/SKILL.md

# Also read supporting files if referenced
Read ~/.claude/skills/{skill-name}/references/*
```

Extract and record:
- **Purpose**: What does the skill do?
- **Triggers**: When should it activate? What phrases trigger it?
- **Workflows**: What steps does it execute?
- **Resources**: What scripts/references/assets does it use?

This information will be used to design test scenarios and to evaluate test results.

### Step 2: Design Test Scenarios

#### Context Dependency Assessment

First, determine if the skill requires conversation context:

**Context-dependent skills** (need story tests):
- Skills that analyze conversation history (e.g., `session-retrospective`)
- Skills that require prior code changes (e.g., `codex-review`)
- Skills that depend on prior tool usage or established state

**Context-independent skills** (simple tests sufficient):
- Skills that operate on explicit input (e.g., `tmux-sender`, `ast-grep`)
- Skills that fetch external data (e.g., `playwright-cli`, `gemini-research`)
- Skills with self-contained workflows

#### Test Scenario Types

Create test cases covering four categories:

**Positive cases** (should trigger):
- Main use cases from the description
- Variations of typical user requests
- Each major workflow path

**Negative cases** (should not trigger):
- Similar but unrelated requests
- Other skills' domains
- General queries

**Edge cases** (boundary testing):
- Ambiguous requests
- Partial information
- Unusual phrasing

**Story cases** (context-dependent skills only):
- Multi-turn conversations with setup prompts to build context
- Test prompt that triggers the skill after context is established
- Validates that skill uses prior conversation appropriately

#### Simple Test Scenario Structure

Each simple scenario (positive/negative/edge) should be:
- **ID**: Unique identifier (e.g., P1, N1, E1)
- **Type**: positive | negative | edge
- **Prompt**: The exact text to send to Claude
- **Expected behavior**: What should happen (or not happen)
- **Validation focus**: Which dimension from validation-criteria.md to emphasize

#### Story Test Scenario Structure

Each story scenario should be:
- **ID**: Unique identifier (e.g., S1, S2)
- **Type**: story
- **Name**: Descriptive name for the story scenario
- **Setup**: Array of prompts to send sequentially before the test prompt
  - Each setup prompt should have:
    - `prompt`: The exact text to send
    - `description`: What this setup step establishes
- **Test**: The final prompt that triggers the skill
  - `prompt`: The exact text
  - `expected`: What the skill should identify or produce
  - `validation_focus`: Which dimension to emphasize

**Example story scenario for session-retrospective**:
```
- ID: S1
  type: story
  name: "Session with mistakes and corrections"
  setup:
    - prompt: "Read /tmp/test.py and fix the syntax error"
      description: "Build coding session context"
    - prompt: "Actually, use try-except instead of if-else"
      description: "User correction - creates 'corrected approach' learning"
    - prompt: "Now add logging to the function"
      description: "Additional work to build session history"
  test:
    prompt: "振り返って"
    expected: "Identifies corrected approaches, missing context, and workflow patterns"
    validation_focus: workflow_execution
```

For validation criteria details, see [validation-criteria.md](references/validation-criteria.md).

### Step 3: Present Test Plan

Before executing tests, show the user:

```
Proposed test scenarios for {skill-name}:

Positive tests:
1. "{prompt}" - Should trigger and {expected-behavior}
2. "{prompt}" - Should trigger and {expected-behavior}

Negative tests:
1. "{prompt}" - Should NOT trigger

Edge cases:
1. "{prompt}" - Expected: {behavior}

This will create a team with dedicated tester agents. Proceed with these tests?
```

Wait for user confirmation before proceeding.

### Step 4: Create Team and Execute

After user approval:

**1. Create the team**:

```
TeamCreate:
  team_name: "skill-test-{skill-name}"
  description: "Testing skill: {skill-name}"
```

**2. Read validation criteria**:

Read [validation-criteria.md](references/validation-criteria.md) to prepare for evaluating test results.

**3. Create tasks for each scenario**:

For simple tests (positive/negative/edge):
```
TaskCreate:
  subject: "[{type}] {scenario-id}: {brief description}"
  description: |
    ## Test Scenario

    **Type**: {positive/negative/edge}
    **ID**: {scenario-id}
    **Prompt**: "{exact prompt}"
    **Expected behavior**: {expected behavior}
    **Validation focus**: {dimension}

    ## Target Skill
    **Name**: {skill-name}
    **Path**: {skill-path}

    ## Success Criteria
    {what constitutes a pass for this test}
  activeForm: "Testing {scenario-id}: {brief description}"
```

For story tests:
```
TaskCreate:
  subject: "[story] {scenario-id}: {story-name}"
  description: |
    ## Story Test Scenario

    **Type**: story
    **ID**: {scenario-id}
    **Name**: {story-name}

    **Setup Prompts** (send sequentially):
    1. "{setup-prompt-1}" - {description}
    2. "{setup-prompt-2}" - {description}
    3. "{setup-prompt-3}" - {description}

    **Test Prompt**: "{test-prompt}"
    **Expected**: {expected behavior}
    **Validation focus**: {dimension}

    ## Target Skill
    **Name**: {skill-name}
    **Path**: {skill-path}

    ## Success Criteria
    {what constitutes a pass, including context utilization requirements}
  activeForm: "Testing story {scenario-id}"
```

**4. Execute tests sequentially**:

Process tests in priority order:
1. Negative tests first (lightest, semantic analysis only)
2. Edge tests next (also semantic analysis)
3. Positive tests (skill execution)
4. Story tests last (most expensive, multiple prompts)

For each test:

```
a. Spawn a dedicated tester for this specific test (see agent-prompts.md for template):
   Task:
     subagent_type: "general-purpose"
     team_name: "skill-test-{skill-name}"
     name: "tester-{scenario-id}"
     model: "sonnet"
     prompt: |
       [Tester Prompt Template with skill-name, skill-path, skill-purpose-summary filled in]

b. Wait for the tester to send its report to you (SendMessage)

c. Evaluate the report:
   - Read the task description for expected behavior
   - Assess against validation dimensions (from validation-criteria.md):
     * Triggering accuracy: Did it activate appropriately?
     * Workflow execution: Steps followed in order?
     * Resource usage: Scripts/references used correctly?
     * Output quality: Requirements met, no unexpected errors?
     * Context efficiency: Only necessary info loaded?
   - For story tests: additionally check context utilization and setup validity
   - Determine PASS/FAIL/PARTIAL

d. If report insufficient: spawn a new tester with additional guidance

e. Record the evaluation result (dimension assessments, issues, recommendations)

f. Shutdown the tester:
   SendMessage:
     type: "shutdown_request"
     recipient: "tester-{scenario-id}"
     content: "Test complete, thank you"

g. Proceed to the next test
```

**Important**: Always specify `model: "sonnet"` when spawning agents. Using opus increases token costs significantly without proportional quality gains for testing tasks.

**Key principle**: Each tester executes exactly ONE test scenario in a fresh agent context, eliminating cross-test context contamination. You evaluate all results directly using validation-criteria.md.

### Step 5: Compile Final Report

After evaluating all test reports, compile the final report:

```
Test Results for {skill-name}

✅ Passed (X/Y tests):
- Test P1: {description} - Worked as expected
- Test N1: {description} - Correctly did not trigger

❌ Failed (Z/Y tests):
- Test E1: {description} - Issue: {what went wrong}

📝 Recommendations (prioritized):
1. {specific recommendation with file:line reference if applicable}
2. {specific recommendation}
3. {specific recommendation}

Would you like me to apply these fixes?
```

### Step 6: Cleanup

After the report is delivered:

1. (Individual testers are already shut down after each test in Step 4)
2. Delete the team:
   ```
   TeamDelete
   ```

### Step 7: Iterate on Improvements

If issues were found and user approves fixes:

1. **Apply improvements**:
   - Update SKILL.md (description, workflow instructions, or documentation)
   - Modify scripts (patch bugs or add error handling)
   - Add/update references (provide missing context)

2. **Re-test failed tests** (optional):
   - Create a new team for just the failed test scenarios
   - Run through the same workflow
   - Verify fixes resolved the issues

3. **Repeat** until all tests pass or user is satisfied with results.

## Examples

### Example: Testing tmux-sender skill

```
User: "Test the tmux-sender skill"
[Analysis, test design with 4 scenarios, user approval]
[Creates team, spawns tester agents, tests execute]

Results:
✅ Tests 1-3: Passed
❌ Test 4: Failed - Should ask for clarification when pane is ambiguous

Recommendations:
1. Add error handling in workflow step 2 to ask user for pane specification when ambiguous

[Cleanup: shutdown agents, delete team]
```

## Validation Checklist

Before reporting test completion, ensure:

- [ ] All test scenarios assigned as tasks
- [ ] Each tester executed its assigned scenario
- [ ] Each test result evaluated against validation criteria
- [ ] Both successful and failed tests documented
- [ ] Root causes identified for failures
- [ ] Specific, actionable recommendations provided
- [ ] User given option to apply fixes
- [ ] Team cleaned up (agents shut down, TeamDelete called)

## Resources

### references/validation-criteria.md

Comprehensive validation framework covering:
- Test completion assessment
- Core validation dimensions (triggering, workflow, resources, output, context)
- Test scenario design patterns
- Validation workflow with role annotations
- Success metrics and common issues

The conductor consults this file when evaluating test results.

### references/agent-prompts.md

Prompt template for spawning tester agents. Contains:
- Complete tester prompt template with workflow, message formats, and single-test execution
- Template usage examples

The conductor uses this template in Step 4 when spawning testers.

### references/known-limitations.md

Testing constraints and considerations including:
- Agent-based testing constraints (context awareness, triggering accuracy, test isolation)
- Story test constraints (non-determinism, context utilization, setup execution)
- When to use semantic analysis results
- Cost and duration trade-offs
