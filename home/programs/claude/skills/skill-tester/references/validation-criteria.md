# Skill Validation Criteria

This document defines the criteria for validating Claude Code skills through headless testing.

## Test Completion Assessment

### How test results are determined

The conductor analyzes the stream-json output from each test. Each test runs in a completely isolated `claude -p` session with zero prior context.

**Assessment process**:
1. Execute test using `run-test.sh` or `run-story-test.sh`
2. Parse stream-json output using `analyze-test.sh` to detect Skill tool invocations
3. Compare observations against expected behavior (maintained privately in Step 2 notes)
4. Evaluate each validation dimension (see Core Validation Dimensions below)
5. Determine overall result: PASS, FAIL, or PARTIAL

**When to re-execute**:
- Test execution failed with non-zero exit code
- stream-json output is malformed or incomplete
- analyze-test.sh failed to parse results

**Result definitions**:
- **PASS**: Skill behaved as expected for this test scenario
- **FAIL**: Skill did not behave as expected (wrong trigger, broken workflow, wrong output)
- **PARTIAL**: Skill partially worked but with limitations (expected limitations are acceptable)

## Stream-JSON Output Analysis

### Identifying Skill Triggering from Stream-JSON

The conductor determines whether a skill triggered by parsing the stream-json output automatically using `analyze-test.sh`.

**Primary signal (most reliable): Skill tool invocation**
- `analyze-test.sh` extracts `Skill` tool invocations from stream-json events
- Looks for `{"type":"tool_use","name":"Skill","input":{"skill":"xxx"}}` in assistant messages
- Returns `triggered: true` if target skill name matches
- This is the strongest and most reliable indicator of skill triggering
- **Critical distinction**: If Claude solved the problem using Bash, Read, or other direct tools without invoking the Skill tool, the skill did NOT trigger

**Secondary signals (supporting evidence):**
- Skill-specific workflow steps appear in tool usage
- References or resources from the skill's directory are accessed (visible in tool_usage)
- Output format (in result_preview) matches the skill's documented structure
- Workflow sequence matches the skill's documented steps in SKILL.md

**When a skill did NOT trigger:**
- `analyze-test.sh` returns `triggered: false`
- No Skill tool invocation in stream-json
- Claude solved the problem using direct tools (Bash, Read, Edit, etc.)
- Generic response without skill-specific workflow patterns

**If output is unclear:**
- Exit code is non-zero (test failed)
- stream-json is malformed or incomplete
- analyze-test.sh output is missing required fields
- In these cases, check the raw jsonl file for errors

### Parsing Stream-JSON Output

Each test produces stream-json output analyzed by `analyze-test.sh`, which returns:

**Output structure:**
```json
{
  "triggered": true/false,
  "skills_invoked": ["skill-name"],
  "tool_usage": "tool call summary",
  "num_turns": N,
  "cost_usd": X.XX,
  "result_preview": "truncated final output"
}
```

**How to analyze:**

1. **Check triggered field**
   - `true`: Skill tool was invoked
   - `false`: Skill tool was NOT invoked
   - This is the primary evaluation metric

2. **Review tool_usage**
   - Which tools were called and how many times
   - Identify the sequence of tools used
   - Check if skill-specific tools/resources were accessed

3. **Evaluate result_preview**
   - Does the output match what the skill is supposed to produce?
   - Are there unexpected errors or warnings?
   - Is the output complete and correct?

4. **For story tests, additionally check:**
   - Did setup prompts avoid Skill tool invocations? (check setup-*.json files)
   - Does result_preview demonstrate awareness of prior setup work?
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

Story tests verify that a skill can effectively utilize prior conversation context. These tests use `run-story-test.sh` to execute multi-turn conversations via `--resume`, building context before the final test prompt.

### What to Evaluate

**Context utilization:**
- Does the skill's output reference events from the setup conversation?
- Are corrections, errors, and patterns from the setup properly identified?
- Is the skill's analysis comprehensive (not just the last message)?

**Setup fidelity:**
- Did the setup prompts create a realistic conversation context?
- Were the setup steps natural and believable?
- Were setup steps executed in the specified order?
- **Was the Skill tool avoided during setup?** Check the setup-*.json files — there should be no Skill tool invocations until the final test prompt.

**Temporal awareness:**
- Does the skill correctly identify the chronological order of events?
- Are earlier events properly distinguished from later ones?
- Is the skill's summary coherent with the conversation timeline?

### Success Criteria for Story Tests

A story test passes when:
- `analyze-test.sh` returns `triggered: true` (Skill tool was invoked)
- Skill output demonstrates awareness of setup conversation (not just test prompt)
- At least 60% of planted elements (corrections, patterns, errors) are identified
- Output quality is comparable to what a real session would produce
- No hallucinated elements that weren't in the setup conversation
- The skill's analysis respects the temporal order of the conversation

### Evaluating Story Test Results

When reviewing stream-json output from a story test:

1. **Check triggered status**: `analyze-test.sh` output should show `triggered: true`
2. **Review setup execution**: Read setup-*.json files to verify setup steps used direct tools (Read, Edit, Bash, etc.) without Skill tool invocations
3. **Analyze context utilization**: Does result_preview demonstrate awareness of the entire conversation sequence, not just the final prompt?
4. **Count element identification**: How many planted elements (errors, corrections, patterns) from the setup work did the skill's output identify?
5. **Verify temporal ordering**: Does the output respect the chronological sequence of the setup steps?

**Common issues in story tests:**
- Setup responses vary between runs (Claude non-determinism) - this is expected
- Skill may miss some planted elements if Claude's setup responses were atypical
- Very long setup conversations may exceed context windows
- `--resume` session state may not persist perfectly across many turns

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

### 2. Test Execution (Conductor)

- [ ] Create output directory for test artifacts
- [ ] Read validation-criteria.md for evaluation framework
- [ ] For each simple test (positive/negative/edge):
  - [ ] Execute with `run-test.sh`
  - [ ] Parse results with `analyze-test.sh`
  - [ ] Determine PASS/FAIL based on Step 2 expectations
  - [ ] Record result and issues
- [ ] For each story test:
  - [ ] Create setup prompts file
  - [ ] Execute with `run-story-test.sh`
  - [ ] Parse results with `analyze-test.sh`
  - [ ] Check context awareness in result_preview
  - [ ] Determine PASS/FAIL
  - [ ] Record result with story-specific notes

### 3. Results Analysis (Conductor)

- [ ] Review all test results
- [ ] Compare actual vs. expected behavior
- [ ] Check raw jsonl files if results are unclear
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
