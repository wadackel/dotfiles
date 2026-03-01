---
name: skill-tester
description: Tests and validates Claude Code skills through isolated headless agent sessions. Use when users want to test or validate newly created or modified Claude Code skills. Triggers include "test this skill", "validate the skill", "verify skill functionality", "check if the skill works correctly", "スキルをテストして", "スキルを検証して", or any request to ensure a skill behaves as expected. Each test runs in a fresh headless Claude session with minimal context contamination, including support for story-based tests with conversation context. Do NOT use for quality scoring or description improvement (use skill-improver instead).
argument-hint: "[skill-name]"
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
4. Executing tests via isolated headless Claude sessions with automatic evaluation
5. Compiling a final report with pass/fail results and improvement recommendations
6. Cleaning up temporary test artifacts
7. Iterating on improvements if needed

**Testing approach**:
- **Conductor** (you): Orchestrates workflow, executes tests via shell scripts, evaluates results against [validation-criteria.md](references/validation-criteria.md)
- **Headless tests**: Each test runs in a completely isolated `claude -p` session with stream-json output
- **Automatic detection**: Skill tool invocations are automatically parsed from stream-json (no self-reporting)

**Test flow**: Conductor → run-test.sh → headless Claude session → stream-json output → analyze-test.sh → Conductor evaluates → next test

**Key principle**: Each test executes in a fresh headless Claude session with zero prior context, ensuring complete isolation. Skills trigger naturally based on their descriptions, and invocations are detected automatically from stream-json output.

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

#### Description Quality Check

Before designing test scenarios, check the skill's description against these criteria:

- [ ] Starts with an action verb (third person singular, e.g., "Validates", "Generates", "Converts")
- [ ] Includes WHAT the skill does
- [ ] Includes WHEN to use it (trigger conditions)
- [ ] Contains specific trigger phrases users would say
- [ ] Has bilingual triggers if the user communicates in multiple languages
- [ ] If `$ARGUMENTS` is used, `argument-hint` is present in frontmatter
- [ ] Description is under 100 words (concise for context efficiency)

Flag any failures as pre-test recommendations. These inform test design (e.g., undertriggering risk) but do not block test execution.

#### Context Dependency Assessment

First, determine if the skill requires conversation context:

**Context-dependent skills** (need story tests):
- Skills that analyze conversation history (e.g., `session-retrospective`)
- Skills that require prior code changes (e.g., `codex-review`)
- Skills that depend on prior tool usage or established state

**Context-independent skills** (simple tests sufficient):
- Skills that operate on explicit input (e.g., `tmux-sender`, `ast-grep`)
- Skills that fetch external data (e.g., `gemini-research`, `gogcli`)
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

### Step 4: Execute Tests

After user approval:

**1. Create output directory**:

```bash
OUTPUT_DIR="/tmp/skill-test-$(date +%s)"
Bash: mkdir -p "$OUTPUT_DIR"
```

**2. Read validation criteria**:

Read [validation-criteria.md](references/validation-criteria.md) to prepare for evaluating test results.

**3. Pre-flight: Description quick check**:

Before running the full suite, validate that the skill's description is discoverable using the first positive test case with `--max-turns 2` (~30–60 seconds):

```
a. Run the first positive test scenario (P1) with max-turns=2:
   Bash: ~/.claude/skills/skill-tester/scripts/run-test.sh \
     "$OUTPUT_DIR" "preflight" "{P1-prompt}" 2

b. Analyze result:
   Bash: ~/.claude/skills/skill-tester/scripts/analyze-test.sh \
     "$OUTPUT_DIR/preflight.jsonl" "{target-skill-name}"

c. Evaluate:
   - triggered=true  → ✅ Description is discoverable. Proceed to full suite.
   - triggered=false → ❌ Description problem detected. Stop immediately and report:
       "Pre-flight failed: the skill did not trigger on '{P1-prompt}'.
        Likely cause: description is unclear or missing key trigger phrases.
        Recommendation: revise the description before running the full test suite."
     Ask the user whether to fix the description now or proceed anyway.
```

This prevents spending 10–15 minutes on the full suite when the description is the only problem.

**4. Execute tests sequentially**:

Process tests in priority order:
1. **Negative tests first** (false positives indicate description problems — a blocker)
2. **Positive tests** (core use case validation)
3. **Edge tests** (boundary behavior)
4. **Story tests last** (most expensive, multiple prompts)

**Early termination**: If multiple negative tests trigger the skill when they shouldn't, flag this immediately as a critical description issue and consider stopping further tests.

**5. For simple tests (positive/negative/edge):**

For each test scenario from Step 2:

```
a. Execute test with run-test.sh:
   Bash: ~/.claude/skills/skill-tester/scripts/run-test.sh \
     "$OUTPUT_DIR" "{test-id}" "{prompt}" 10

b. Analyze results with analyze-test.sh:
   Bash: ~/.claude/skills/skill-tester/scripts/analyze-test.sh \
     "$OUTPUT_DIR/{test-id}.jsonl" "{target-skill-name}"

   This outputs JSON with:
   - triggered: true/false (whether Skill tool was invoked)
   - skills_invoked: array of skill names invoked
   - tool_usage: summary of all tool calls
   - num_turns: number of agentic turns
   - cost_usd: API cost
   - result_preview: final output (truncated)

c. Determine PASS/FAIL using your private Step 2 expectations:
   - Positive test: PASS if triggered=true, FAIL if triggered=false
   - Negative test: PASS if triggered=false, FAIL if triggered=true
   - Edge test: Evaluate based on your Step 2 expectation

d. Record the result (PASS/FAIL, reasoning, issues, recommendations)

e. Keep the stream-json output for debugging:
   Read: "$OUTPUT_DIR/{test-id}.jsonl" (if needed for detailed analysis)
```

**For story tests:**

For each story scenario from Step 2:

```
a. Create setup prompts file:
   Write: "$OUTPUT_DIR/{test-id}-setup.txt"
   Content: One setup prompt per line from the story scenario

b. Execute story test with run-story-test.sh:
   Bash: ~/.claude/skills/skill-tester/scripts/run-story-test.sh \
     "$OUTPUT_DIR" "{test-id}" "$OUTPUT_DIR/{test-id}-setup.txt" "{test-prompt}" 10

c. Analyze results (same analyze-test.sh as simple tests):
   Bash: ~/.claude/skills/skill-tester/scripts/analyze-test.sh \
     "$OUTPUT_DIR/{test-id}.jsonl" "{target-skill-name}"

d. Additional story test evaluation:
   - Check result_preview for context awareness indicators
   - Does the output reference elements from setup prompts?
   - Are planted elements (corrections, patterns, errors) identified?
   - Context utilization rate should be ≥60%

e. Determine PASS/FAIL:
   - PASS if triggered=true AND output demonstrates context awareness
   - FAIL if triggered=false OR output ignores setup context

f. Record the result with story-specific notes
```

**Important notes**:
- Each test runs in a completely independent `claude -p` session
- No context contamination between tests (unlike agent teams approach)
- Skill tool detection is automatic via stream-json parsing
- All test output is preserved in `$OUTPUT_DIR` for debugging
- Tests use `--dangerously-skip-permissions` to avoid interactive prompts

**Key principle**: Each test executes in a fresh headless Claude session with zero prior context, ensuring complete isolation. Skills trigger naturally based on their descriptions, and invocations are detected automatically from stream-json output.

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

### Performance Summary
| Test | Turns | Cost (USD) |
|------|-------|------------|
| P1   | N     | $X.XX      |
| N1   | N     | $X.XX      |
| ...  | ...   | ...        |
| **Total** | **N** | **$X.XX** |

Would you like me to apply these fixes?
```

### Step 6: Cleanup

After the report is delivered:

```bash
Bash: rm -rf "$OUTPUT_DIR"
```

This removes all temporary test output files. The headless approach doesn't require team cleanup since no agent teams are created.

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

- [ ] All test scenarios executed via run-test.sh / run-story-test.sh
- [ ] Each test result parsed with analyze-test.sh
- [ ] Each test result evaluated against validation criteria
- [ ] Both successful and failed tests documented
- [ ] Root causes identified for failures
- [ ] Specific, actionable recommendations provided
- [ ] User given option to apply fixes
- [ ] Temporary test output directory cleaned up

## Resources

### references/validation-criteria.md

Comprehensive validation framework covering:
- Test completion assessment
- Core validation dimensions (triggering, workflow, resources, output, context)
- Stream-JSON output analysis
- Test scenario design patterns
- Validation workflow
- Success metrics and common issues

The conductor consults this file when evaluating test results.

### references/known-limitations.md

Testing constraints and considerations including:
- Headless testing constraints (complete isolation, process orchestration)
- Triggering accuracy testing (relies on natural Skill tool invocation)
- Skill tool detection (automatic parsing from stream-json)
- Positive test false negatives (skill description improvement signal)
- Story test constraints (non-determinism, `--resume` context preservation)
- Cost considerations (each test is a full Claude session)
- Headless mode constraints (`env -u CLAUDECODE`, skills in `-p` mode, stream-json format)
- Comparison with agent teams approach
