---
name: skill-tester
description: Automated skill validation through Claude Code simulation testing in isolated tmux sessions. Use when users want to test or validate newly created or modified Claude Code skills. Triggers include "test this skill", "validate the skill", "verify skill functionality", "check if the skill works correctly", or any request to ensure a skill behaves as expected. Works by spawning fresh Claude instances in tmux panes to simulate real usage.
---

# Skill Tester

Validate Claude Code skills through automated simulation testing in isolated environments.

## Overview

This skill automates the process of testing Claude Code skills by:

1. Analyzing the skill to understand its purpose and expected behavior
2. Designing simulation scenarios that test triggering and functionality
3. Spawning isolated Claude Code sessions in tmux panes
4. Executing test prompts and capturing results
5. Evaluating whether the skill behaved as expected
6. Providing actionable feedback for improvement

**Key principle:** Each test runs in a fresh Claude Code session to ensure the skill is evaluated in the same environment users will experience.

## Workflow

### Step 1: Understand the Skill

Read and analyze the skill being tested:

```bash
# For skill directories
Read <skill-path>/SKILL.md

# For packaged skills (.skill files)
# Extract and read SKILL.md from the archive
```

Understand:
- **Purpose**: What does the skill do?
- **Triggers**: When should it activate?
- **Workflows**: What steps does it execute?
- **Resources**: What scripts/references/assets does it use?

### Step 2: Design Test Scenarios

Based on skill analysis, create test cases covering:

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

For validation criteria details, see [validation-criteria.md](references/validation-criteria.md).

### Step 3: Present Test Plan to User

Before executing tests, show the user:

```
Proposed test scenarios for <skill-name>:

Positive tests:
1. "<prompt>" - Should trigger and <expected-behavior>
2. "<prompt>" - Should trigger and <expected-behavior>

Negative tests:
1. "<prompt>" - Should NOT trigger

Edge cases:
1. "<prompt>" - Expected: <behavior>

Proceed with these tests?
```

Wait for user confirmation before proceeding.

### Step 4: Execute Tests in Isolated Sessions

For each test scenario:

1. **Create tmux pane**: Split window vertically to isolate the test
   ```bash
   tmux split-window -v -d -P -F "#{pane_id}"
   ```

   **Note**: The `-d` flag keeps focus on the current pane (detached mode), so the main session remains active.

2. **Launch Claude Code**: Start fresh session in the pane
   ```bash
   # Launch with auto-approval for edits (file reads still require permission)
   tmux send-keys -t <pane-id> "claude --permission-mode acceptEdits" Enter
   ```

   **Note**: `--permission-mode acceptEdits` auto-approves edits but file reads still require permission. Use `Enter` keyword for tmux send-keys (not `C-m`).

3. **Wait for Claude startup**: Monitor for initial prompt

   Poll the pane output until the prompt appears:
   ```bash
   # Check every second for prompt pattern
   while true; do
       last_line=$(tmux capture-pane -t <pane-id> -p | tail -1)

       # Detect normal prompt
       if [[ "$last_line" =~ ^\> ]]; then
           echo "Claude ready"
           break
       fi

       sleep 1
   done
   ```

   **Timeout**: Stop checking after 30 seconds if no prompt detected.

4. **Send test prompt**: Submit the test query
   ```bash
   # Send prompt text with Enter (enters multi-line mode)
   tmux send-keys -t <pane-id> "<test-prompt>" Enter

   # Send another Enter to submit (empty line submits in Claude Code)
   tmux send-keys -t <pane-id> "" Enter
   ```

   **Note**: Claude Code uses multi-line input. First `Enter` adds the text, second empty `Enter` submits the prompt.

5. **Monitor response progress**: Observe output and judge completion

   **Philosophy**: Instead of pattern matching, let Claude periodically check the output and decide the state.

   **Simple observation approach**:
   ```bash
   # Initial wait for processing to begin
   sleep 10

   # Periodic checks (every 30 seconds, up to 5 minutes)
   max_iterations=10
   for i in $(seq 1 $max_iterations); do
       # Capture current output
       tmux capture-pane -t <pane-id> -p -S -100

       # Claude evaluates: Is this complete? Still processing? Error? Mid-workflow dialog?
       # Based on judgment, decide next action

       sleep 30
   done
   ```

   **What Claude should evaluate**:
   - **Still processing**: Output shows thinking, streaming, or active work
     - Action: Continue waiting, check again in 30 seconds

   - **Confirmation dialog**: "Do you want to proceed?", "Approve edit?", etc.
     - **This is NOT completion** - it's mid-workflow
     - Action: Respond appropriately and continue monitoring
     ```bash
     tmux send-keys -t <pane-id> "y" Enter
     sleep 10  # Wait for response to process
     ```

   - **Error state**: Stack trace, "[ERROR]", or failure message
     - Action: Mark as complete with error, capture for analysis

   - **Actually complete**: Returned to prompt, task finished, output stable
     - Look for: Prompt symbol `>`, completion message, or clear task done signal
     - Verify the skill achieved its documented purpose
     - Action: Capture final output and proceed to analysis

   **Key principles**:
   - No fixed pattern matching - Claude reads and interprets context
   - 30-second intervals are sufficient for most operations
   - 5-minute total timeout protects against hangs
   - Dialogs are workflow steps, not completion signals
   - When uncertain, wait one more cycle

6. **Capture output**: Extract the full pane content
   ```bash
   # Capture with scrollback for long responses
   tmux capture-pane -t <pane-id> -p -S -100
   ```

7. **Cleanup**: Kill the test pane
   ```bash
   tmux kill-pane -t <pane-id>
   ```

**Important notes**:
- Never reuse a pane between tests - always create fresh
- Don't rely on fixed wait times - use dynamic detection
- Capture enough scrollback for long responses (-S -100)
- Always cleanup panes, even if errors occur

### Step 5: Validate Skill Purpose Achievement

**Core Question**: Did the skill achieve what its SKILL.md says it should do?

For each test, evaluate by tracing through the skill's documented purpose:

**1. Skill Activation**
- Did the skill load when it should have?
  - Look for skill name mention in output
  - Check for initialization messages
- Was the triggering appropriate for this prompt?
  - Compare prompt to skill description
  - Consider if another skill would be more appropriate

**2. Workflow Completion**
- Follow the skill's SKILL.md workflow section
- Trace through each documented step:
  - Step 1: Is there evidence it executed?
  - Step 2: Did it happen in the right order?
  - Continue through all steps...
- Did the skill reach its intended conclusion?

**3. Purpose Achievement**
- What was the test prompt asking for?
- Did the final output satisfy that request?
- If the skill encountered errors, did it handle them gracefully?
- Would a user consider this successful?

**4. Mid-Workflow Interactions**
- Confirmation dialogs are NORMAL, not failures
  - "Do you want to proceed?" = skill is working correctly
  - These represent decision points in the workflow
- Did Claude respond appropriately to dialogs?
- Did execution continue after approval?

**Important distinctions**:
- **Success**: Skill loaded, followed its workflow, achieved its documented purpose
- **Partial success**: Skill worked but hit expected limitations (permissions, missing files, etc.)
- **Failure**: Skill didn't load, crashed, produced wrong output, or deviated from documented workflow

**Avoid mechanistic thresholds**:
- Don't require "loaded within 5 seconds" - focus on "did it load?"
- Don't expect "100% completion" - focus on "did it accomplish the goal?"
- Don't demand "zero errors" - focus on "did it handle errors appropriately?"

### Step 6: Provide Feedback

Report findings to the user with structure:

```
Test Results for <skill-name>

✅ Passed (X/Y tests)
- Test 1: <description> - Worked as expected
- Test 2: <description> - Correct behavior

❌ Failed (Y/Y tests)
- Test 3: <description> - Issue: <what-went-wrong>

📝 Recommendations:
1. Update description to include "<missing-trigger-phrase>"
2. Fix workflow step 3: <specific-issue>
3. Add error handling in <script-name>

Would you like me to apply these fixes?
```

### Step 7: Iterate on Improvements

If issues found and user approves fixes:

1. **Update SKILL.md**: Fix description, workflow instructions, or documentation
2. **Modify scripts**: Patch bugs or add error handling
3. **Add/update references**: Provide missing context
4. **Re-test**: Run failed tests again to confirm fixes

Repeat until all tests pass or user is satisfied with results.

## Best Practices

### Test Design

- **Start simple**: Test basic triggering before complex workflows
- **One variable at a time**: Isolate what's being tested
- **Realistic prompts**: Use natural language users would actually type
- **Cover happy and sad paths**: Test both success and failure cases

### Execution

- **Fresh sessions always**: Never reuse a Claude instance between tests
  - Each test must start with a new `claude` invocation
  - Kill pane completely before next test
- **Dynamic completion detection**: Wait for completion signals, not fixed times
  - Monitor for prompt patterns (`>`, dialogs, errors)
  - Verify output stability (unchanged for 3 seconds)
  - Use timeout (5 minutes) as safety net only
- **Proper key sending**: Use `Enter` for Claude Code, `C-m` for shells
  - Claude Code: `tmux send-keys -t <pane> "text" Enter` (treats `C-m` as newline)
  - Regular shells: `tmux send-keys -t <pane> "text" C-m` (more reliable)
- **Capture sufficient context**: Include scrollback for long responses
  - Use `-S -100` to capture last 100 lines
  - Adjust if responses are very long
- **Clean up reliably**: Always kill test panes
  - Verify pane is killed before next test
  - Use trap for cleanup on script errors (if scripting)

### Analysis

- **Compare to expectations**: Have clear success criteria
- **Look for patterns**: Multiple failures may indicate systemic issues
- **Consider context**: Some behaviors may be model-dependent
- **Prioritize fixes**: Focus on high-impact issues first

### Judging Completion

- **Read, don't pattern match**: Understand what's happening, don't just look for `>`
- **Know the skill's workflow**: Before testing, understand what steps it should take
- **Dialogs are workflow steps**: Confirmation prompts mean it's working, not done
- **Trust your judgment**: If output looks complete and stable, it probably is
- **When uncertain, wait**: One more 30-second cycle won't hurt
- **Context matters**: Same output might mean different things for different skills

### Feedback

- **Be specific**: "Add X to description" not "description unclear"
- **Explain why**: Help user understand the root cause
- **Offer solutions**: Don't just report problems
- **Show examples**: Demonstrate what good looks like

## Troubleshooting

### Issue: tmux pane creation fails

**Cause**: Not in a tmux session

**Solution**:
```bash
# Check if in tmux
echo $TMUX

# If empty, start tmux first
tmux new-session
```

### Issue: Claude doesn't start in test pane

**Cause**: PATH or shell initialization issues

**Solution**: Use full path to claude binary:
```bash
which claude  # Find full path
/full/path/to/claude  # Use in test
```

### Issue: Can't capture output reliably

**Cause**: Timing issues or incomplete rendering

**Solution**:
- Increase wait time before capture
- Use `tmux capture-pane -e` to include escape sequences
- Add `-S -` to capture entire scrollback

### Issue: Test panes not cleaning up

**Cause**: Script errors before cleanup

**Solution**: Manual cleanup:
```bash
# List all panes
tmux list-panes

# Kill specific pane
tmux kill-pane -t <pane-id>

# Or kill all but current
tmux kill-pane -a
```

### Issue: Permission dialogs block testing

**Cause**: Skills require user approval for tool use

**Solution**:
1. **Primary**: Launch Claude with auto-approval for edits
   ```bash
   claude --permission-mode acceptEdits
   ```
   Note: This auto-approves edits but file reads still require permission.

2. **If dialogs still appear**:
   - For skill's documented commands: Update skill's frontmatter `allowed-tools`
   - For other cases: Document permission requirement, treat as test completion
   - Consider the dialog itself as a completion signal

3. **Recognize dialog as completion**:
   - "Do you want to proceed?" is a valid completion pattern
   - Test has reached a decision point - can analyze behavior up to this point
   - Permission dialogs are part of normal skill workflow

## Resources

### references/validation-criteria.md

Comprehensive validation framework covering:
- Core validation dimensions (triggering, workflow, resources, output, context)
- Test scenario design patterns
- Success metrics and common issues
- Improvement recommendation guidelines

Consult when designing test cases or analyzing results.

## Examples

### Example 1: Testing a PDF skill

```
User: "Test my pdf-editor skill"

Claude: "I'll test the pdf-editor skill by analyzing SKILL.md and creating test scenarios."

[Reads skill, designs tests]

Proposed tests:
1. ✅ "Rotate this PDF 90 degrees" - Should trigger and use rotate script
2. ✅ "Extract text from this PDF" - Should trigger and extract content
3. ❌ "Create a PowerPoint" - Should NOT trigger (different format)
4. ❓ "Help me with this document" - Edge case (format unclear)

Proceed? [User confirms]

[Executes tests in tmux panes, captures results]

Results:
✅ Test 1: Passed - Correctly triggered and rotated PDF
❌ Test 2: Failed - Skill triggered but extraction script had error
✅ Test 3: Passed - Did not trigger (correct)
❌ Test 4: Failed - Should not trigger but did (false positive)

Recommendations:
1. Fix extract_text.py script - missing import
2. Narrow description to mention "PDF files" explicitly to avoid false positives
```

### Example 2: Testing a workflow skill

```
User: "Validate the code-review skill I just modified"

Claude: "I'll validate the updated code-review skill."

[Reads SKILL.md, identifies recent changes]

I see you added a new step for security checks. I'll focus testing on:
1. Does the new step execute in the right order?
2. Does it work with the existing workflow?
3. Are the security checks effective?

[Designs and executes targeted tests]

Results:
✅ Security step executes correctly in sequence
❌ Step fails when no security issues found (expects array, gets null)
✅ Integration with existing workflow works well

Fix needed:
Update scripts/security_check.py line 45 to handle empty results:
```python
findings = findings or []
```

Shall I apply this fix?
```

## Validation Checklist

Before reporting test completion, ensure:

- [ ] All test scenarios executed in fresh Claude sessions
- [ ] Results captured and analyzed against expectations
- [ ] Both successful and failed tests documented
- [ ] Root causes identified for failures
- [ ] Specific, actionable recommendations provided
- [ ] User given option to apply fixes
- [ ] All tmux panes cleaned up

## Technical Details

### tmux Key Sending

**For Claude Code** (multi-line input support):

```bash
# Launch with permission mode
tmux send-keys -t <pane-id> "claude --permission-mode acceptEdits" Enter

# Send prompt (enters multi-line mode)
tmux send-keys -t <pane-id> "<prompt>" Enter

# Submit with empty line (Claude Code multi-line convention)
tmux send-keys -t <pane-id> "" Enter
```

**Why this approach for Claude Code?**
- Claude Code supports multi-line input
- First `Enter` adds text to buffer (allows more lines)
- Second empty `Enter` (blank line) submits the prompt
- `--permission-mode acceptEdits` auto-approves edits (reads still need approval)

**For regular shells** (bash, zsh, etc.):

```bash
# Use C-m - more reliable than Enter keyword
tmux send-keys -t <pane-id> "<command>" C-m
```

**Why C-m for shells?**
- `C-m` is the actual control character for carriage return (ASCII 13)
- More reliable across different terminal emulators and shell configurations
- Consistent with tmux documentation and common practice

**Summary:**
- **Claude Code testing**: Use `Enter` keyword
- **Shell commands**: Use `C-m`
- **General rule**: Match the behavior of the application being tested

### Output State Recognition

Claude Code shows various states during execution. Rather than matching fixed patterns, read the output and understand the context:

**Common states** (examples, not exhaustive):
- **Normal prompt**: Usually starts with `>`, indicates ready for input
- **Processing**: Output actively changing, thinking indicators, streaming text
- **Confirmation dialog**: Questions like "Do you want to proceed?", "Approve this edit?"
- **Interactive menu**: Options with keyboard shortcuts (Tab, Esc, etc.)
- **Error**: Stack traces, [ERROR] markers, failure messages
- **Long operation**: Progress indicators, "esc to interrupt" messages

**How to interpret**:
- Read the last 20-50 lines of output
- Understand what the skill is doing based on its SKILL.md workflow
- Determine if it's: waiting for input, processing, requesting interaction, or complete
- When in doubt, wait another 30 seconds and check again

**Pattern hints** (not rules):
- `>` at line start often means prompt
- Questions usually need responses
- Stable output (unchanged for 30+ seconds) often indicates waiting

These are guidelines, not rigid matching rules. Context and judgment matter more than exact patterns.
