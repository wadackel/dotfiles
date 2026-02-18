# Known Limitations

## Headless Testing Constraints

**Complete Isolation:**
- Each test executes in a completely independent `claude -p` session with zero prior context
- Tests run sequentially using shell scripts (`run-test.sh`, `run-story-test.sh`)
- No team configuration, agent names, or other metadata is visible to the test session
- This eliminates context contamination entirely but requires process orchestration

**Triggering Accuracy Testing:**
- Tests rely on natural Skill tool invocation based on skill description matching
- The headless Claude session processes a user request and may or may not invoke the target skill
- This tests triggering accuracy in completely realistic conditions (no test awareness, no context bias)
- **Positive test false negatives**: If Claude can accomplish the request using direct tools (e.g., Bash, Read) without invoking a skill, the test will fail. This is a valid signal that the skill's description may need improvement to make it more discoverable.

**Skill Tool Detection:**
- The conductor identifies skill triggering by parsing stream-json output via `analyze-test.sh`
- Automatic detection of `{"type":"tool_use","name":"Skill","input":{"skill":"xxx"}}` events
- This is 100% reliable for detecting whether the Skill tool was invoked
- No reliance on self-reporting or structured formats

**Test Isolation:**
- Tests execute sequentially, one headless session at a time
- Each session is completely independent (no shared state, no persistence)
- `env -u CLAUDECODE` bypasses nest detection (official documented method)
- `--no-session-persistence` ensures sessions are not saved to disk

**Cost and Duration:**
- Each test spawns a full Claude Code session, increasing total API usage
- Negative tests execute fully (rather than semantic analysis), consuming tokens even when passing
- Story tests are particularly expensive (setup + test prompts, all with `--resume`)
- Sequential execution means a 10-test suite may take 10-15 minutes
- Trade-off: higher cost and time vs. perfect isolation and 100% accurate triggering detection

## Story Test Constraints

**Non-determinism:**
- Claude's responses during setup prompts vary between runs
- The same story scenario may produce different conversation contexts
- The conductor must account for reasonable variation in planted element identification
- Setup responses may not always contain the exact elements planted in the setup prompts

**Context Preservation via `--resume`:**
- Story tests rely on `--resume session_id` to continue conversations across multiple `claude -p` invocations
- Session state is maintained by Claude Code's session management (stored in `~/.claude/sessions/`)
- Very long setup conversations may exceed context windows
- Session resumption is generally reliable but not guaranteed for very complex scenarios

**Setup Execution:**
- Setup prompts are executed with `--output-format json` (not stream-json) to extract session_id
- Only the final test prompt uses stream-json for Skill tool detection
- Setup results vary between runs due to Claude non-determinism
- The conductor checks that setup phases did NOT invoke the Skill tool (only test prompt should)

**Context Utilization:**
- Story tests rely on the skill's ability to use conversation history
- If the skill doesn't access prior messages, story tests may fail even if the skill works correctly in real usage
- This limitation applies to skills that analyze conversation context
- At least 60% element identification rate is expected for passing story tests

## Headless Mode Constraints

**`env -u CLAUDECODE` Safety:**
- This is the officially documented method to bypass nest detection (see Claude Code docs)
- Used to run `claude -p` from within a Claude Code session
- Safe when used with `--no-session-persistence` to avoid state pollution
- Bash tool's 10-minute timeout applies — mitigated by `--max-turns` limit

**Skills in `-p` Mode:**
- Skills ARE available in print mode — only slash commands are restricted
- Skill auto-triggering (description-based) works normally in `-p` mode
- Verified: ast-grep skill successfully triggered in Phase 1 verification
- This is a key advantage over interactive mode restrictions

**stream-json Format Compatibility:**
- stream-json output format is newline-delimited JSON with predictable structure
- Format may change in future Claude Code versions (risk of breaking analyze-test.sh)
- Mitigation: analyze-test.sh handles both `assistant` message format and `stream_event` wrapper
- Format has been stable across recent Claude Code versions

**Bash Tool Timeout:**
- Bash tool has a 10-minute maximum timeout
- Long tests may exceed this limit and be killed
- Mitigation: Use `--max-turns 10` to limit test duration
- For particularly long tests, consider using `run_in_background` (not yet implemented)

## Comparison with Agent Teams Approach

| Aspect | Agent Teams (Old) | Headless (New) |
|--------|-------------------|----------------|
| Context contamination | Tester sees team config | Zero contamination |
| Skill detection | Self-reported (unreliable) | Automatic parsing (100% reliable) |
| Positive test accuracy | Low (subagents prefer direct tools) | High (realistic conditions) |
| Test isolation | Partial (shared team context) | Complete (separate processes) |
| Setup complexity | High (TeamCreate/Task/SendMessage) | Low (shell scripts + Bash) |
| Cost | High (agent spawning overhead) | High (full Claude sessions) |
| Debugging | Difficult (agent internals hidden) | Easy (all output in files) |
| Story test support | Single agent multi-prompt (awkward) | Natural `--resume` multi-turn |

The headless approach trades similar cost for significantly better test accuracy and complete isolation.
