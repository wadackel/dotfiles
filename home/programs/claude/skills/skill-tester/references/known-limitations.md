# Known Limitations

## Agent-Based Testing Constraints

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

**Cost and Duration:**
- Each test spawns a dedicated tester agent, increasing total API usage
- Story tests are particularly expensive (setup + test prompts)
- Sequential execution means a 10-test suite may take 10-15 minutes
- Trade-off: higher cost and time vs. better isolation and accuracy

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
- Only the final test prompt uses the Skill tool to invoke the target skill
- The conductor verifies that Skill tool was not used during setup via the tester's report
- Setup results vary between runs due to Claude non-determinism

## When to Use Semantic Analysis Results

For negative/edge tests that use semantic analysis:
- **High confidence**: Very likely to match actual Claude Code skill matching
- **Medium confidence**: Reasonable prediction, but some ambiguity
- **Low confidence**: Uncertain, consider manual verification in a real conversation

For critical triggering accuracy verification, manual testing in a main conversation may be necessary.
