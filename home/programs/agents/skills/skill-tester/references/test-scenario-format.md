# Test Scenario Format

## Story Test Scenario Structure

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

## Example Story Scenario

**For session-retrospective:**

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

For validation criteria details, see [validation-criteria.md](validation-criteria.md).
