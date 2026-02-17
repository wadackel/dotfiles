# Agent Prompt Templates

This file contains prompt templates for spawning tester agents when running skill tests.

## Tester Prompt Template

When spawning a tester agent for a single test scenario, use this template structure (replace `{placeholders}` with actual values):

```
You are an assistant helping a user with their request. Process the
following request naturally, using whatever tools and skills are
available to you.

### Your Task

Use TaskGet to read your assigned task. It contains a user request
for you to handle.

### Instructions

- Process the request as you normally would for any user
- Use whatever tools, skills, or approaches seem appropriate
- If the request is unclear, make reasonable assumptions

### Reporting

After completing the request, send a message to {conductor-agent-name}
with the following structure:

## Request Summary
[What you understood the request to be]

## Actions Taken
[Numbered list of every tool call you made, in order]
1. ToolName(key arguments) → result summary
2. ToolName(key arguments) → result summary
(Include ALL tool calls: Bash, Read, Skill, etc.)

## Outcome
[What the final result was]

## Issues
[Any problems, ambiguities, or errors encountered, or "None"]

Then mark your task as completed and wait for shutdown.
```

### Template Notes

**What is removed from the old template:**
- No mention of "test" or "tester" role
- No target skill information (name, path, purpose)
- No test type information (positive/negative/edge/story)
- No expected behavior
- No test-type-specific execution instructions

**What is added:**
- Structured "## Actions Taken" section for reliable tool call reporting
- Neutral "assistant helping a user" framing
- Generic task handling instructions

**Why this design:**
The tester does not know which skill is being tested or what the expected outcome is. This eliminates confirmation bias and tests whether skills naturally trigger based on their descriptions. The conductor evaluates results by checking for Skill tool invocations in the "## Actions Taken" section.

## Template Usage Examples

### Example 1: Spawning a Tester for a Request

The conductor constructs a tester prompt like:

```
You are an assistant helping a user with their request...

[Full template with {conductor-agent-name} replaced with actual conductor name]
```

The tester then receives a task via TaskGet that contains only:
```
## User Request

"Send echo hello to pane 1"

Handle this request using whatever approach seems most appropriate.
```

### Example 2: Tester Report to Conductor

After handling the request, the tester sends:

```
SendMessage:
  type: "message"
  recipient: "team-lead"
  content: |
    ## Request Summary
    User wanted to send "echo hello" to tmux pane 1.

    ## Actions Taken
    1. Skill(skill: "tmux-sender", args: "Send echo hello to pane 1") → Invoked tmux-sender skill
    2. Bash(command: "tmux list-panes -F '#{pane_index}'") → Listed available panes
    3. Bash(command: "tmux send-keys -t 1 'echo hello' Enter") → Sent command to pane 1

    ## Outcome
    Command "echo hello" successfully sent to tmux pane 1.

    ## Issues
    None
  summary: "Handled tmux request"
```

The conductor reads this report and identifies:
- Primary signal: Skill tool was invoked with skill="tmux-sender"
- Secondary signal: tmux-specific workflow steps (list-panes, send-keys)
- Conclusion: Skill triggered and executed correctly
