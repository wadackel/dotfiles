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
  team_name: "skill-test-session"
  description: "Testing skill: {skill-name}"
```

**Important**: Use a generic team name that does not contain the skill name. Tester agents can read the team config, and including the skill name would leak which skill is being tested.

**2. Read validation criteria**:

Read [validation-criteria.md](references/validation-criteria.md) to prepare for evaluating test results.

**3. Create tasks for each scenario**:

**IMPORTANT**: Task descriptions visible to testers must NOT contain:
- Expected behavior or success criteria
- Target skill name or path
- Test type classification
- Any indication that this is a test

The conductor maintains this information privately in Step 2 notes.

For simple tests (positive/negative/edge):
```
TaskCreate:
  subject: "Handle request: {scenario-id}"
  description: |
    ## User Request

    "{exact prompt}"

    Handle this request using whatever approach seems most appropriate.
  activeForm: "Handling request {scenario-id}"
```

For story tests:
```
TaskCreate:
  subject: "Multi-step request: {scenario-id}"
  description: |
    ## Work Sequence

    Complete the following work requests in order.
    You MUST complete each step in the listed order.
    Do not skip or combine steps.
    If any step fails, note the failure and proceed to the next step.

    1. "{setup-prompt-1}"
    2. "{setup-prompt-2}"
    3. "{setup-prompt-3}"

    After completing all the above, handle this final request:
    "{test-prompt}"

    Report what you did for each step.
  activeForm: "Handling story {scenario-id}"
```

**4. Execute tests sequentially**:

Process tests in priority order:
1. **Negative tests first** (false positives indicate description problems — a blocker)
2. **Positive tests** (core use case validation)
3. **Edge tests** (boundary behavior)
4. **Story tests last** (most expensive, multiple prompts)

**Early termination**: If multiple negative tests trigger the skill when they shouldn't, flag this immediately as a critical description issue and consider stopping further tests.

For each test:

```
a. Spawn a dedicated tester for this specific test:
   Task:
     subagent_type: "general-purpose"  # Required for Skill tool access
     team_name: "skill-test-session"
     name: "tester-{scenario-id}"
     model: "sonnet"
     prompt: |
       [Use the Naive User template from agent-prompts.md]
       [Replace {conductor-agent-name} with your actual agent name]

b. Wait for the tester to send its report to you (SendMessage)

c. Evaluate the report using your private Step 2 notes:

   **Primary evaluation (Skill tool observation):**
   - Check the "## Actions Taken" section for Skill tool invocations
   - Did the tester call Skill(skill: "{target-skill-name}")?
   - If yes: Skill triggered
   - If no: Skill did NOT trigger (even if task was accomplished)

   **Secondary evaluation (workflow quality):**
   - If Skill tool was invoked, check if the workflow steps match SKILL.md
   - Verify output quality meets the skill's documented purpose
   - Check for errors or unexpected behavior

   **Determine result:**
   - Positive test: PASS if Skill tool was invoked, FAIL if not
   - Negative test: PASS if Skill tool was NOT invoked, FAIL if invoked
   - Edge test: Evaluate based on your Step 2 expectation for this scenario
   - Story test: PASS if Skill tool invoked AND output shows context awareness

d. If report insufficient: spawn a new tester with instructions to provide more detailed tool call reporting

e. Record the evaluation result (trigger status, workflow quality, issues, recommendations)

f. Shutdown the tester:
   SendMessage:
     type: "shutdown_request"
     recipient: "tester-{scenario-id}"
     content: "Test complete, thank you"

g. Proceed to the next test
```

**Important notes**:
- Always specify `model: "sonnet"` when spawning agents
- The tester does not know which skill is being tested — this eliminates confirmation bias
- You (conductor) maintain all test expectations in your conversation context from Step 2
- Skill tool invocation is the primary signal — if the tester solves the problem with Bash/Read/etc without using Skill tool, the skill did not trigger

**Key principle**: Each tester executes exactly ONE test scenario in a fresh agent context, eliminating cross-test context contamination. The conductor evaluates all results by checking for Skill tool invocations in the tester's "## Actions Taken" section.

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
- Naive User template: frames the tester as "assistant helping a user" without test awareness
- Structured reporting format with "## Actions Taken" section for tool call observation
- Template usage examples

The conductor uses this template in Step 4 when spawning testers. The template removes all skill-specific information and expected behavior to eliminate confirmation bias.

### references/known-limitations.md

Testing constraints and considerations including:
- Agent-based testing constraints (testers see all available skills but don't know test target)
- Triggering accuracy testing (relies on natural Skill tool invocation)
- Skill tool observation limitations (completeness not guaranteed)
- Positive test false negatives (skill description improvement signal)
- Story test constraints (non-determinism, step ordering, context utilization)
- Cost considerations (negative tests now execute fully)
- Subagent configuration (why `general-purpose` type is required)
