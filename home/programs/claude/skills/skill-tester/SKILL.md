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

The skill will analyze the target, design test scenarios, and present a plan for approval before creating a test team with dedicated tester agents and an evaluator (assesses results).

## Overview

This skill automates the process of testing Claude Code skills by:

1. Analyzing the skill to understand its purpose and expected behavior
2. Designing test scenarios that cover positive, negative, edge cases, and story-based tests
3. Creating a test team with specialized agents:
   - **Tester**: Each test runs in a fresh tester agent with minimal context contamination
   - **Evaluator**: Analyzes test execution reports from tester agents and assesses results against validation criteria
4. Executing tests via dedicated tester agents with fresh context
5. Coordinating the testing workflow through structured tasks and messages
6. Compiling a final report with pass/fail results and improvement recommendations

**Key principle**: Each test runs in a dedicated tester agent with fresh context and minimal knowledge of the testing framework. Each tester executes exactly one test scenario, eliminating cross-test context contamination and minimizing awareness of being in a test environment.

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

This will create a team with dedicated tester agents and an evaluator. Proceed with these tests?
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

**3. Spawn the evaluator agent** (once, at the beginning):

```
Task:
  subagent_type: "general-purpose"
  team_name: "skill-test-{skill-name}"
  name: "evaluator"
  model: "sonnet"
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

**Important**: Always specify `model: "sonnet"` when spawning agents.
Using opus increases token costs significantly without proportional quality gains for testing tasks.

**4. For each test scenario, spawn a dedicated tester**:

Process tests sequentially in priority order:
1. Negative tests first (lightest, semantic analysis only)
2. Edge tests next (also semantic analysis)
3. Positive tests (skill execution)
4. Story tests last (most expensive, multiple prompts)

For each test:

```
a. Spawn a dedicated tester for this specific test:

Task:
  subagent_type: "general-purpose"
  team_name: "skill-test-{skill-name}"
  name: "tester-{scenario-id}"
  model: "sonnet"
  prompt: |
    [See references/agent-prompts.md - Tester Prompt Template]

    Fill in the template with:
    - skill-name
    - skill-path
    - skill-purpose-summary (from Step 1)

**Important**: Always specify `model: "sonnet"` when spawning agents.
Using opus increases token costs significantly without proportional quality gains for testing tasks.

b. Wait for the tester to send its report to the evaluator

c. Wait for the evaluator to send its evaluation report to you

d. Shutdown the tester:
   SendMessage:
     type: "shutdown_request"
     recipient: "tester-{scenario-id}"
     content: "Test complete, thank you"

e. Proceed to the next test
```

**Key principle**: Each tester executes exactly ONE test scenario in a fresh agent context, eliminating cross-test context contamination. The evaluator persists across all tests to maintain consistency in evaluation standards.

### Step 5: Monitor and Coordinate

This step is now integrated into Step 4's sequential execution. For each test:

1. **Wait for tester report**: The tester sends its observations to the evaluator
2. **Wait for evaluator assessment**: The evaluator sends its evaluation report to you
3. **Accumulate results**: Collect each evaluation report
4. **Shutdown the tester**: Send shutdown request to the specific tester agent
5. **Proceed to next test**: Spawn the next tester for the next scenario

If the evaluator requests a re-test (insufficient data):
1. Acknowledge the request
2. Spawn a new tester for the same test scenario with additional guidance
3. Wait for the new report

Progress tracking is automatic through the sequential execution model.

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

1. **Send shutdown request to the evaluator**:

   ```
   SendMessage:
     type: "shutdown_request"
     recipient: "evaluator"
     content: "Testing complete, shutting down"
   ```

   (Individual testers are already shut down after each test in Step 4)

2. **Wait for shutdown confirmation**: The evaluator will respond with shutdown_response.

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

### Tester (tester-{scenario-id})

Each tester agent executes exactly ONE test scenario in a fresh agent context.

**Responsibilities**:
- Read the assigned test task (exactly one task)
- Execute the test according to type:
  - Positive: Use Skill tool to invoke the target skill
  - Negative/Edge: Perform semantic analysis (no execution)
  - Story: Execute setup prompts sequentially, then the test prompt
- Observe and document:
  - Did the skill trigger? Evidence?
  - What workflow steps occurred?
  - What output was produced?
  - Any errors or warnings?
- Send test execution report to the evaluator
- Mark task as completed
- Wait for shutdown

**Key principle**: Each tester is single-use and executes in isolation. It has no knowledge of other tests, minimizing context contamination.

For the complete tester prompt template, see [references/agent-prompts.md](references/agent-prompts.md).

### Evaluator (evaluator)

The evaluator agent assesses all test execution reports against validation criteria. Unlike testers, the evaluator persists across all tests to maintain consistent evaluation standards.

**Responsibilities**:
- Read the target skill's SKILL.md to understand expected behavior
- Read validation-criteria.md for the evaluation framework
- Receive test execution reports from testers
- Evaluate against five validation dimensions:
  - Triggering accuracy
  - Workflow execution
  - Resource usage
  - Output quality
  - Context efficiency
- For story tests: additionally evaluate context utilization
- If tester report is insufficient, request conductor to re-run the test with a new tester
- Compile evaluation report (PASS/FAIL/PARTIAL) with specific issues and recommendations
- Send evaluation report to the conductor

For the complete evaluator prompt template, see [references/agent-prompts.md](references/agent-prompts.md).

## Communication Protocol

### Message Flow

```
Conductor → (Task Create) → Task List
Conductor → (spawn tester for test N) → Tester-N
Tester-N  → (read task from Task List) → Execute test
Tester-N  → (SendMessage: test execution report) → Evaluator
Evaluator → (SendMessage: evaluation report) → Conductor
Conductor → (shutdown tester) → Tester-N terminates
Conductor → (spawn next tester) → Tester-(N+1)
... repeat for all tests ...
```

### Message Content Guidelines

**Test execution reports** (tester to evaluator) should include:
- Task ID
- Test type (positive/negative/edge/story)
- Prompt used
- Whether the skill triggered (yes/no/unclear)
- Evidence of triggering or non-triggering
- Observed workflow steps (or "N/A" for semantic analysis)
- Output produced
- Any errors or warnings
- Approximate duration
- Additional notes

**Re-test requests** (evaluator to conductor) should include:
- Task ID
- Reason why the tester's report was insufficient
- Specific aspects for the new tester to observe
- Optional guidance for the new tester

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

[Creates team, spawns tester agents and evaluator, tests execute]

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

Tester sends report for Test P1: "Skill triggered, output suggests screenshot taken, but unclear if file was saved"

Evaluator requests conductor to re-test: "Re-run P1 - new tester should check if screenshot file exists in the expected location and confirm file size"

New tester re-executes and responds: "Confirmed: screenshot.png created, 45KB, timestamp matches test execution"

Evaluator to Conductor: "P1 PASS - skill correctly captured screenshot, file verified"

[Tests complete, final report delivered, cleanup]
```

## Known Limitations

### Agent-Based Testing Constraints

**Context Awareness:**
- Each tester agent executes in a fresh context with no knowledge of other tests (**minimizes contamination**)
- However, testers DO know they are executing a test (via task description), which differs slightly from a completely naive user interaction
- This is a reasonable trade-off: near-complete isolation vs. perfect realism

**Triggering Accuracy Testing:**
- Positive tests use Skill tool direct invocation, which **forces** the skill to run
- This tests workflow execution and output quality, but NOT natural triggering behavior
- For negative/edge tests, testers perform semantic analysis to determine if the skill would trigger
- Semantic analysis is a heuristic and may not perfectly match Claude Code's actual skill matching logic

**Test Isolation:**
- Tests execute sequentially, one tester at a time
- Each tester is terminated after completing its single test
- Cross-test context contamination is eliminated by using fresh agent instances
- However, the evaluator persists across all tests (intentional, to maintain consistent evaluation standards)

**Cost and Duration:**
- Each test spawns a dedicated tester agent, increasing total API usage
- Story tests are particularly expensive (setup + test prompts)
- Sequential execution means a 10-test suite may take 10-15 minutes
- Trade-off: higher cost and time vs. better isolation and accuracy

### Story Test Constraints

**Non-determinism:**
- Claude's responses during setup prompts vary between runs
- The same story scenario may produce different conversation contexts
- Evaluator must account for reasonable variation in planted element identification

**Context Utilization:**
- Story tests rely on the skill's ability to use conversation history
- If the skill doesn't access prior messages, story tests may fail even if the skill works correctly in real usage
- This limitation applies to skills that analyze conversation context

**Setup Execution:**
- Setup prompts are executed as normal work (not via Skill tool) to build natural conversation history
- The tester uses Read, Edit, Bash etc. to perform the setup work directly
- Only the final test prompt uses the Skill tool to invoke the target skill
- Evaluator verifies that Skill tool was not used during setup via tester's report
- Setup results vary between runs due to Claude non-determinism

### When to Use Semantic Analysis Results

For negative/edge tests that use semantic analysis:
- **High confidence**: Very likely to match actual Claude Code skill matching
- **Medium confidence**: Reasonable prediction, but some ambiguity
- **Low confidence**: Uncertain, consider manual verification in a real conversation

For critical triggering accuracy verification, manual testing in a main conversation may be necessary.

## Validation Checklist

Before reporting test completion, ensure:

- [ ] All test scenarios assigned as tasks
- [ ] Each tester executed its assigned scenario
- [ ] Evaluator assessed each test execution result
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

Prompt templates for spawning tester and evaluator agents. Contains:
- Complete tester prompt template with workflow, message formats, and single-test execution
- Complete evaluator prompt template with assessment process, evaluation dimensions, and reporting formats
- Template usage examples

The conductor uses these templates in Step 4 when spawning teammates.
