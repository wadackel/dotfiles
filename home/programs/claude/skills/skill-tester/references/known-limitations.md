# Known Limitations

## Agent-Based Testing Constraints

**Context Awareness:**
- Each tester agent executes in a fresh context with no knowledge of other tests (**minimizes contamination**)
- Testers do NOT know they are executing a test — they are framed as "assistant helping a user"
- Testers see all available skills in their system-reminder (same as real user sessions), but do not know which skill is being tested

**Triggering Accuracy Testing:**
- Tests rely on natural Skill tool invocation by the tester agent
- The tester processes a user request and may or may not invoke the target skill based on skill description matching
- This tests both triggering AND workflow execution in realistic conditions
- **Positive test false negatives**: If the tester can accomplish the request using direct tools (e.g., Bash) without invoking a skill, the test will fail. This is a valid signal that the skill's description may need improvement to make it more discoverable.

**Skill Tool Observation Limitations:**
- The conductor identifies skill triggering by checking for Skill tool invocations in the tester's "## Actions Taken" report section
- Testers are instructed to list all tool calls, but completeness is not guaranteed
- The structured reporting format mitigates this, but cannot eliminate the risk entirely

**Test Isolation:**
- Tests execute sequentially, one tester at a time
- Each tester is terminated after completing its single test
- Cross-test context contamination is eliminated by using fresh agent instances

**Cost and Duration:**
- Each test spawns a dedicated tester agent, increasing total API usage
- Negative tests now execute fully (rather than using semantic analysis), potentially triggering skills
- Story tests are particularly expensive (setup + test prompts)
- Sequential execution means a 10-test suite may take 10-15 minutes
- Trade-off: higher cost and time vs. better isolation and more realistic testing

## Story Test Constraints

**Non-determinism:**
- Claude's responses during setup prompts vary between runs
- The same story scenario may produce different conversation contexts
- The conductor must account for reasonable variation in planted element identification

**Context Utilization:**
- Story tests rely on the skill's ability to use conversation history
- If the skill doesn't access prior messages, story tests may fail even if the skill works correctly in real usage
- This limitation applies to skills that analyze conversation context

**Setup Execution:**
- Setup prompts are executed as normal work (not via Skill tool) to build natural conversation history
- The tester uses Read, Edit, Bash etc. to perform the setup work directly
- Only the final test prompt is processed naturally (may or may not trigger the target skill)
- Setup results vary between runs due to Claude non-determinism

**Step Ordering:**
- Story tasks instruct testers to complete steps in order and not skip or combine steps
- However, LLM agents may still optimize or parallelize steps
- The conductor should verify step execution order from the tester's report

## Subagent Configuration

**Why `general-purpose` subagent type:**
- Tester agents require access to the Skill tool to potentially invoke skills
- Read-only subagent types (e.g., Plan) do not have Skill tool access
- `general-purpose` provides full tool access including the Skill tool
- This matches real user session conditions where all skills are available
