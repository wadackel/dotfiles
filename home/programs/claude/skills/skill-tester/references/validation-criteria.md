# Skill Validation Criteria

This document defines the criteria for validating Claude Code skills through team-based testing.

## Test Completion Assessment

### How the evaluator determines test results

The evaluator receives verification reports from the verifier agent. Each report describes what happened when the test prompt was sent to the target skill.

**Assessment process**:
1. Read the verification report for the test
2. Compare observations against the task's expected behavior
3. Evaluate each validation dimension (see Core Validation Dimensions below)
4. Determine overall result: PASS, FAIL, or PARTIAL

**When to request re-verification**:
- Verification report lacks detail on a critical dimension
- Observations are ambiguous or contradictory
- Key workflow steps are mentioned but not clearly confirmed
- Triggering was unclear (e.g., "something happened but not sure if it was the skill")

**Result definitions**:
- **PASS**: Skill behaved as expected for this test scenario
- **FAIL**: Skill did not behave as expected (wrong trigger, broken workflow, wrong output)
- **PARTIAL**: Skill partially worked but with limitations (expected limitations are acceptable)

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

### 2. Test Execution (Verifier)

- [ ] Execute positive test cases
- [ ] Execute negative test cases
- [ ] Execute edge case scenarios
- [ ] Document all observations in verification reports
- [ ] Send reports to evaluator

### 3. Results Analysis (Evaluator)

- [ ] Evaluate each verification report against criteria
- [ ] Request re-verification where data is insufficient
- [ ] Compare actual vs. expected behavior
- [ ] Identify patterns across test results

### 4. Improvement Recommendations (Evaluator + Conductor)

Based on test results, the evaluator provides per-test recommendations and the conductor compiles them:

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
