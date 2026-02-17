# Skill Validation Criteria

This document defines the criteria for validating Claude Code skills through team-based testing.

## Test Completion Assessment

### How test results are determined

The conductor analyzes the tester's execution report for each test. Each report shows what happened when the test prompt was sent to Claude Code in a fresh agent session.

**Assessment process**:
1. Read the tester's execution report for the test
2. Analyze the report to identify skill triggering, workflow execution, and results (see Test Report Analysis below)
3. Compare observations against the task's expected behavior
4. Evaluate each validation dimension (see Core Validation Dimensions below)
5. Determine overall result: PASS, FAIL, or PARTIAL

**When to request re-execution**:
- Tester's report lacks detail on a critical dimension
- Report is truncated or unclear
- Key workflow steps are not visible in the report
- Triggering was unclear (no obvious skill-specific patterns in the report)

**Result definitions**:
- **PASS**: Skill behaved as expected for this test scenario
- **FAIL**: Skill did not behave as expected (wrong trigger, broken workflow, wrong output)
- **PARTIAL**: Skill partially worked but with limitations (expected limitations are acceptable)

## Test Report Analysis

### Identifying Skill Triggering from Reports

The conductor determines whether a skill triggered by analyzing the tester's "## Actions Taken" section, which lists all tool calls made during the request handling.

**Primary signal (most reliable): Skill tool invocation**
- Check for `Skill(skill: "xxx")` entries in the "## Actions Taken" section
- Verify the skill name matches the target skill being tested
- This is the strongest indicator of skill triggering
- **Critical distinction**: If the tester used Bash or other direct tools to accomplish the task (e.g., `tmux send-keys` via Bash), this is NOT skill triggering — only Skill tool invocation counts

**Secondary signals (supporting evidence):**
- Skill-specific workflow steps appear in the Actions Taken list
- References or resources from the skill's directory are accessed
- Output format matches the skill's documented structure
- Workflow sequence matches the skill's documented steps in SKILL.md

**When a skill did NOT trigger:**
- No Skill tool invocation in the "## Actions Taken" section
- The tester solved the problem using direct tools (Bash, Read, Edit, etc.)
- Generic response without skill-specific workflow patterns

**If the report is unclear:**
- The "## Actions Taken" section is incomplete or missing
- Tool call descriptions are too vague to determine Skill tool usage
- In these cases, spawn a new tester with instructions to provide more detailed tool call reporting

### Parsing Tester Reports

Tester execution reports use a structured format with the following sections:

**Report structure:**
- **Request Summary**: What the tester understood the request to be
- **Actions Taken**: Numbered list of all tool calls made, in order (PRIMARY EVALUATION SOURCE)
- **Outcome**: What the final result was
- **Issues**: Any problems or errors encountered

**How to analyze:**

1. **Extract tool calls from "## Actions Taken" section**
   - Look for `Skill(skill: "xxx")` entries to identify skill invocation
   - Note which skill was called and with what arguments
   - Identify the sequence of tools used after/before the Skill invocation

2. **Compare workflow against SKILL.md**
   - If a Skill tool call is present, verify the subsequent actions match the skill's documented workflow
   - Check if the right tools were used in the right order
   - Validate that skill-specific resources were accessed if applicable

3. **Evaluate outcome quality**
   - Does the outcome match what the skill is supposed to produce?
   - Are there unexpected errors or warnings?
   - Is the output complete and correct?

4. **For story tests, additionally check:**
   - Did the setup work execute without Skill tool invocations?
   - Does the final outcome demonstrate awareness of prior setup work?
   - Are the planted elements from setup properly identified?

## Core Validation Dimensions

### 1. Triggering Accuracy

**What to test:**
- Does the skill activate when it should?
- Does it avoid false positives (triggering when it shouldn't)?

**Validation approach:**
- Test positive cases: prompts that should trigger the skill
- Test negative cases: similar prompts that shouldn't trigger
- Test edge cases: ambiguous prompts that may or may not trigger

**Success criteria:**
- Skill triggers on all positive test cases
- Skill does not trigger on negative test cases
- Edge case behavior matches expected design

### 2. Workflow Execution

**What to test:**
- Does the skill follow its documented workflow correctly?
- Are all steps executed in the right order?
- Does conditional logic work as expected?

**Validation approach:**
- Walk through each major workflow path
- Test branching logic and decision points
- Verify error handling and edge cases

**Success criteria:**
- All workflow steps execute in documented order
- Conditional branches work correctly
- Error conditions are handled gracefully

### 3. Resource Usage

**What to test:**
- Are scripts executed when appropriate?
- Are reference files loaded when needed?
- Are assets used correctly in output?

**Validation approach:**
- Monitor which resources get accessed during execution
- Verify scripts produce expected output
- Check that references inform Claude's decisions
- Validate assets appear in final output

**Success criteria:**
- Scripts execute without errors
- Reference materials are consulted when relevant
- Assets are incorporated correctly

### 4. Output Quality

**What to test:**
- Does the output meet the task requirements?
- Is the quality consistent with the skill's purpose?
- Are there unexpected errors or warnings?

**Validation approach:**
- Compare output against expected results
- Check for completeness and correctness
- Review for quality issues

**Success criteria:**
- Output satisfies the user request
- Quality meets skill standards
- No unexpected errors or warnings

### 5. Context Efficiency

**What to test:**
- Is the skill loading only necessary information?
- Are reference files loaded progressively?
- Is the skill description concise?

**Validation approach:**
- Review what gets loaded into context
- Check if progressive disclosure works
- Measure description token usage

**Success criteria:**
- Only relevant resources are loaded
- Progressive disclosure prevents over-loading
- Description is under 100 words

## Story Test Assessment

Story tests verify that a skill can effectively utilize prior conversation context. These tests involve multi-turn conversations where setup prompts build context before the actual test prompt.

### What to Evaluate

**Context utilization:**
- Does the skill's output reference events from the setup conversation?
- Are corrections, errors, and patterns from the setup properly identified?
- Is the skill's analysis comprehensive (not just the last message)?

**Setup fidelity:**
- Did the setup prompts create a realistic conversation context?
- Were the setup steps natural and believable?
- Did the tester complete setup steps in the specified order?
- **Was the Skill tool avoided during setup?** Check the tester's "## Actions Taken" section for the setup phase — there should be no Skill tool invocations until the final test prompt is processed.

**Temporal awareness:**
- Does the skill correctly identify the chronological order of events?
- Are earlier events properly distinguished from later ones?
- Is the skill's summary coherent with the conversation timeline?

### Success Criteria for Story Tests

A story test passes when:
- Skill output demonstrates awareness of setup conversation (not just test prompt)
- At least 60% of planted elements (corrections, patterns, errors) are identified
- Output quality is comparable to what a real session would produce
- No hallucinated elements that weren't in the setup conversation
- The skill's analysis respects the temporal order of the conversation

### Evaluating Story Test Reports

When reviewing a tester's report from a story test:

1. **Identify conversation structure**: Review the "## Request Summary" to understand how the tester interpreted the multi-step work sequence
2. **Check setup execution**: In "## Actions Taken", verify that setup steps used direct tools (Read, Edit, Bash, etc.) without Skill tool invocations
3. **Identify the test prompt handling**: Look for the Skill tool invocation (if any) that should correspond to the final test prompt
4. **Analyze context utilization**: Does the outcome demonstrate awareness of the entire work sequence, not just the final prompt?
5. **Count element identification**: How many planted elements (errors, corrections, patterns) from the setup work did the skill's output identify?

**Common issues in story tests:**
- Setup responses vary between runs (Claude non-determinism) - this is expected
- Skill may miss some planted elements if Claude's setup responses were atypical
- Very long setup conversations may exceed context windows

## Test Scenario Design

### Positive Test Cases

Create scenarios that clearly fall within the skill's domain:

```
Example for a PDF skill:
- "Extract text from this PDF"
- "Merge these two PDF files"
- "Fill out the PDF form fields"
```

### Negative Test Cases

Create scenarios that might seem related but shouldn't trigger:

```
Example for a PDF skill:
- "Create a PowerPoint presentation" (different format)
- "Read this text file" (not PDF)
- "What's the weather?" (unrelated task)
```

### Edge Cases

Create ambiguous scenarios that test boundary conditions:

```
Example for a PDF skill:
- "Convert this Word doc to PDF" (involves PDF but primary action is conversion)
- "Help me with this document" (unclear format)
- "I need to work with forms" (could be PDF, could be web forms)
```

## Validation Workflow

### 1. Pre-Test Review (Conductor)

- [ ] Review target SKILL.md for clarity and completeness
- [ ] Verify all referenced resources exist
- [ ] Check description matches actual functionality
- [ ] Ensure workflow documentation is accurate

### 2. Test Execution (Conductor spawning testers)

- [ ] Create tasks for each test scenario
- [ ] For each test, spawn a dedicated tester agent
- [ ] Tester executes the skill and reports to conductor
- [ ] Conductor analyzes tester report
- [ ] Conductor shuts down the tester
- [ ] Proceed to next test

### 3. Results Analysis (Conductor)

- [ ] Receive test execution report from tester
- [ ] Compare actual vs. expected behavior
- [ ] Spawn new tester where report is insufficient
- [ ] Evaluate against validation criteria
- [ ] Identify patterns across test results

### 4. Improvement Recommendations (Conductor)

Based on test results, the conductor compiles recommendations:

- **Description updates**: If triggering is inaccurate
- **Workflow refinements**: If execution order is wrong
- **Resource additions**: If Claude needs more information
- **Documentation fixes**: If instructions are unclear

## Common Issues and Solutions

### Issue: Skill doesn't trigger when expected

**Possible causes:**
- Description too narrow or vague
- Missing key trigger phrases
- Competing with another skill

**Solutions:**
- Expand description to include more scenarios
- Add explicit trigger phrases
- Clarify the unique use case

### Issue: Skill triggers on unrelated requests

**Possible causes:**
- Description too broad
- Overlapping keywords with other domains

**Solutions:**
- Narrow the description scope
- Add negative examples in description
- Specify file types or explicit contexts

### Issue: Workflow steps executed out of order

**Possible causes:**
- Instructions not clear about sequence
- Missing dependencies between steps
- Conditional logic unclear

**Solutions:**
- Use numbered steps for sequences
- Explicitly state dependencies
- Clarify conditions with examples

### Issue: Scripts fail during execution

**Possible causes:**
- Environment dependencies not documented
- Missing error handling
- Incorrect file paths

**Solutions:**
- Document all prerequisites
- Add try-catch error handling
- Use relative paths from skill directory

### Issue: Context bloat (too much loaded)

**Possible causes:**
- Description too verbose
- Not using progressive disclosure
- Loading entire references upfront

**Solutions:**
- Condense description to essentials
- Move details to reference files
- Use "See X.md for..." pattern

## Success Evaluation

A well-functioning skill should demonstrate:

- **Appropriate triggering**: Activates for prompts in its domain, doesn't activate for others
- **Workflow adherence**: Follows the steps documented in its SKILL.md
- **Purpose achievement**: Accomplishes what it claims to do
- **Graceful error handling**: When things go wrong, fails informatively
- **Clear documentation**: SKILL.md accurately describes behavior

Focus on whether the skill is useful and works as documented, not on arbitrary percentage thresholds.
