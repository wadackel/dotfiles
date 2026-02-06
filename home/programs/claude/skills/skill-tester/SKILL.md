---
name: skill-tester
description: Automated skill validation through multi-agent team testing. Use when users want to test or validate newly created or modified Claude Code skills. Triggers include "test this skill", "validate the skill", "verify skill functionality", "check if the skill works correctly", or any request to ensure a skill behaves as expected. Spawns a verifier agent to execute the skill and an evaluator agent to assess results against validation criteria.
---

# Skill Tester

Validate Claude Code skills through automated multi-agent team testing.

## Quick Start

```
/skill-tester [skill-name]
```

If no skill name is provided, you'll be prompted to select from available skills.

The skill will analyze the target, design test scenarios, and present a plan for approval before creating a test team with a verifier (executes tests) and evaluator (assesses results).

## Overview

This skill automates the process of testing Claude Code skills by:

1. Analyzing the skill to understand its purpose and expected behavior
2. Designing test scenarios that cover positive, negative, and edge cases
3. Creating a team with two specialized agents:
   - **Verifier**: Executes the target skill and reports observations
   - **Evaluator**: Assesses verification results against validation criteria
4. Coordinating the testing workflow through structured tasks and messages
5. Compiling a final report with pass/fail results and improvement recommendations

**Key principle**: The verifier runs the target skill in its own agent context, providing isolation equivalent to the old tmux approach but with structured communication and task tracking.

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

This information will be used to design test scenarios and to provide context to the evaluator agent.

### Step 2: Design Test Scenarios

Based on skill analysis, create test cases covering three categories:

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

Each scenario should be structured as:
- **ID**: Unique identifier (e.g., P1, N1, E1)
- **Type**: positive | negative | edge
- **Prompt**: The exact text to send to the skill
- **Expected behavior**: What should happen (or not happen)
- **Validation focus**: Which dimension from validation-criteria.md to emphasize

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

This will create a team with a verifier and evaluator. Proceed with these tests?
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

**2. Create tasks for each scenario**:

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

**3. Spawn the verifier agent**:

```
Task:
  subagent_type: "general-purpose"
  team_name: "skill-test-{skill-name}"
  name: "verifier"
  prompt: |
    [See references/agent-prompts.md - Verifier Prompt Template]

    Fill in the template with:
    - skill-name
    - skill-path
    - skill-purpose-summary (from Step 1)
    - trigger-phrases (from Step 1)
```

**4. Spawn the evaluator agent**:

```
Task:
  subagent_type: "general-purpose"
  team_name: "skill-test-{skill-name}"
  name: "evaluator"
  prompt: |
    [See references/agent-prompts.md - Evaluator Prompt Template]

    Fill in the template with:
    - skill-name
    - skill-path
    - skill-purpose-summary (from Step 1)
    - trigger-phrases (from Step 1)
    - workflow-steps-summary (from Step 1)
    - validation-criteria-path (full path to validation-criteria.md)
    - conductor-agent-name (your agent name for receiving reports)
```

The verifier will automatically claim tasks from the task list and begin executing tests. The evaluator will wait for verification reports from the verifier.

### Step 5: Monitor and Coordinate

Enter a monitoring phase:

1. **Wait for evaluator messages**: Messages from the evaluator (containing evaluation reports for each test) are delivered automatically to your session.

2. **Accumulate results**: Collect each evaluation report as it arrives. Each report contains:
   - Task ID and result (PASS/FAIL/PARTIAL)
   - Dimension-by-dimension assessment
   - Issues found
   - Recommendations

3. **Track progress**: Periodically check TaskList to see overall progress:
   ```
   TaskList
   ```

4. **Observe re-verification**: If the evaluator requests re-verification from the verifier, you'll see this through idle notifications with peer DM summaries. No action needed - let them work it out.

5. **Wait for completion**: When all tasks show status: completed, move to Step 6.

6. **Safety timeout**: If no progress for 5 minutes, send a status inquiry:
   ```
   SendMessage:
     type: "message"
     recipient: "verifier"
     content: "Status check - are you still processing tests?"
     summary: "Status inquiry"

   SendMessage:
     type: "message"
     recipient: "evaluator"
     content: "Status check - have you received all verification reports?"
     summary: "Status inquiry"
   ```

### Step 6: Compile Final Report

After receiving evaluation reports for all tests, compile the final report:

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

### Step 7: Cleanup

After the report is delivered:

1. **Send shutdown requests to both agents**:

   ```
   SendMessage:
     type: "shutdown_request"
     recipient: "verifier"
     content: "Testing complete, shutting down"

   SendMessage:
     type: "shutdown_request"
     recipient: "evaluator"
     content: "Testing complete, shutting down"
   ```

2. **Wait for shutdown confirmations**: Both agents will respond with shutdown_response.

3. **Delete the team**:

   ```
   TeamDelete
   ```

### Step 8: Iterate on Improvements

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

## Agent Roles

### Verifier (verifier)

The verifier agent executes test scenarios and reports observations.

**Responsibilities**:
- Claims test tasks from the task list
- Executes the target skill using the test prompt
- Observes: did the skill trigger? What workflow steps occurred? What was the output?
- Documents observations in detail
- Sends verification results to the evaluator via SendMessage
- Handles re-verification requests from the evaluator

**Key principle**: The verifier observes and reports, but does not evaluate pass/fail. It captures what happened, not whether it was correct.

For the complete verifier prompt template, see [references/agent-prompts.md](references/agent-prompts.md).

### Evaluator (evaluator)

The evaluator agent assesses verification results against validation criteria.

**Responsibilities**:
- Reads the target skill's SKILL.md to understand expected behavior
- Reads validation-criteria.md for the evaluation framework
- Receives verification results from the verifier
- Evaluates against five validation dimensions:
  - Triggering accuracy
  - Workflow execution
  - Resource usage
  - Output quality
  - Context efficiency
- If verification data is insufficient, sends re-verification request to verifier
- Compiles evaluation report (PASS/FAIL/PARTIAL) with specific issues and recommendations
- Sends evaluation report to the conductor
- Updates task status to completed after evaluation

For the complete evaluator prompt template, see [references/agent-prompts.md](references/agent-prompts.md).

## Communication Protocol

### Message Flow

```
Conductor → (TaskCreate) → Task List
Verifier  → claims tasks from Task List
Verifier  → (SendMessage: verification report) → Evaluator
Evaluator → (SendMessage: re-verify request) → Verifier (if needed)
Evaluator → (SendMessage: evaluation report) → Conductor
Conductor → compiles final report
```

### Message Content Guidelines

**Verification reports** (verifier to evaluator) should include:
- Task ID being verified
- Whether the skill triggered (yes/no/partial/unclear)
- Evidence of triggering
- Observed workflow steps
- Full output summary
- Any errors or warnings encountered
- User interactions that occurred
- Approximate duration

**Re-verification requests** (evaluator to verifier) should include:
- Task ID
- Reason for insufficiency
- Specific aspects needing more detail
- Optional guidance for re-execution

**Evaluation reports** (evaluator to conductor) should include:
- Task ID and result (PASS/FAIL/PARTIAL)
- Dimension-by-dimension assessment table
- Issues found (numbered list)
- Recommendations for improvement (numbered list)

## Examples

### Example 1: Testing a simple skill

```
User: "Test the tmux-sender skill"

Conductor: "I'll test the tmux-sender skill by analyzing SKILL.md and creating test scenarios."

[Reads tmux-sender/SKILL.md, extracts purpose, triggers, workflow]

Proposed tests:
1. ✅ "Send echo hello to pane 1" - Should trigger and send command to specified pane
2. ✅ "Run ls in the left pane" - Should trigger and identify pane by description
3. ❌ "Show me the current directory" - Should NOT trigger (not a tmux operation)
4. ❓ "Execute command in pane" - Edge case (missing specifics)

Proceed? [User confirms]

[Creates team, spawns verifier and evaluator, tests execute]

Results:
✅ Test 1: Passed - Correctly triggered and sent command
✅ Test 2: Passed - Identified pane and sent command
✅ Test 3: Passed - Did not trigger (correct)
❌ Test 4: Failed - Skill triggered but couldn't determine which pane (should ask for clarification)

Recommendations:
1. Add error handling in workflow step 2 to ask user for pane specification when ambiguous

[Cleanup: shutdown agents, delete team]
```

### Example 2: Testing with re-verification

```
User: "Validate the updated playwright-cli skill"

[Analysis, test design, user approval]

[Test execution begins]

Verifier sends report for Test P1: "Skill triggered, output suggests screenshot taken, but unclear if file was saved"

Evaluator to Verifier: "Re-verify P1 - please check if screenshot file exists in the expected location and confirm file size"

Verifier re-executes and responds: "Confirmed: screenshot.png created, 45KB, timestamp matches test execution"

Evaluator to Conductor: "P1 PASS - skill correctly captured screenshot, file verified"

[Tests complete, final report delivered, cleanup]
```

## Validation Checklist

Before reporting test completion, ensure:

- [ ] All test scenarios assigned as tasks
- [ ] Verifier executed each scenario
- [ ] Evaluator assessed each verification result
- [ ] Both successful and failed tests documented
- [ ] Root causes identified for failures
- [ ] Specific, actionable recommendations provided
- [ ] User given option to apply fixes
- [ ] Team cleaned up (agents shut down, TeamDelete called)

## Resources

### references/validation-criteria.md

Comprehensive validation framework covering:
- Test completion assessment for evaluators
- Core validation dimensions (triggering, workflow, resources, output, context)
- Test scenario design patterns
- Validation workflow with role annotations
- Success metrics and common issues

The evaluator consults this file when assessing verification results.

### references/agent-prompts.md

Prompt templates for spawning verifier and evaluator agents. Contains:
- Complete verifier prompt template with workflow, message formats, and re-verification handling
- Complete evaluator prompt template with assessment process, evaluation dimensions, and reporting formats
- Template usage examples

The conductor uses these templates in Step 4 when spawning teammates.
