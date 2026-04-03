## Development Guide

### Agent Guidelines

Always prioritize simplicity over correctness. YAGNI, KISS, DRY. No backward-compatibility shims or fallback paths unless they come for free without increasing cyclomatic complexity.

Exception: For parsing (shell commands, ASTs, etc.), prefer dedicated parser libraries over regular expressions. Regex is fragile against quoting and escape edge cases.

### CLI Tool Preferences

- Use `fd` instead of `find` for file search
- Use `rg` instead of `grep` for content search (prefer the dedicated `Grep` tool when available)

### Scripting Language Choice

When a script involves state management, parsing, or conditional logic, prefer Deno/TypeScript over Bash.
- Short 1-2 command chains → Bash is fine
- File processing, JSON parsing, error handling needed → Deno/TypeScript

### Feature Design Flow

When designing new features in plan mode, follow this order:
1. Research existing code and libraries with `/gemini-research` (as needed)
2. Create a design plan based on research findings
3. Critique and refine with `/plan-deeper`

### Static Analysis in Plan Mode

For lint error or type error fix tasks, run `pnpm lint:script` / `tsc` during plan mode to confirm actual errors before deciding the fix approach. Theorizing without real error output leads to wasted fixes on non-existent issues.

### Git Workflow

#### Safe Staging

Before using `git add -A` or `git add .`, run `git status --porcelain` to verify no unintended files (.env, credentials*, *.pem, secrets*, etc.) are included. If sensitive files may be present, use `git add <file>` individually.

#### Git Command Execution Rules

Do not use `git -C <path>`. It does not match `permissions.allow` patterns (e.g., `Bash(git diff *)`) and triggers permission prompts every time. Instead, run git commands directly in the working directory. For other directories, use `cd <path> && git <subcommand>`. **This rule is auto-enforced by `bash-policy.ts` — violating commands are blocked before execution.**

#### Branch Creation for Independent PRs

When creating a separate PR for fixes unrelated to current work:

1. **Always branch from master (or the target base branch)**:
   `git switch master && git pull origin master && git switch -c fix/...`
   Branching from the current feature branch contaminates the PR with that branch's diff.
2. **Verify diff before PR creation**:
   `git diff master...HEAD` to confirm only intended changes are included.

### Shell-Specific Syntax in Bash Tool

`$'...'` (ANSI-C quoting) may not be interpreted correctly inside pipes in the Bash tool's shell environment. Wrap commands containing bash-specific syntax in `bash -c '...'` to verify behavior.

**`!` history expansion**: `!` inside double quotes (e.g., `![[file#heading]]`) triggers history expansion, escaping to `\!`. Disable with `set +H &&` before the command: `set +H && obsidian create ...`

**just (justfile) shell variables**: `just` recipes run with `sh` by default. Shell variable references use `$var` (not `$$var`). `just` does NOT require double-dollar escaping — `$$` in a justfile is interpreted by `sh` as the PID, not as an escaped `$`.

**Bulk text replacement with special characters**: macOS BSD `sed` silently fails or corrupts patterns containing `!`, `$`, backticks. For bulk file replacement, use `fd -x python3 -c "import pathlib; ..."` instead of `sed`.

### Background Processes in Bash Tool

Launch long-running processes (dev servers, etc.) with `run_in_background: true` instead of chaining with `&` or `;`. Verify startup in a separate Bash call with `sleep N && curl ...`. Putting `cmd &` + subsequent commands in a single Bash call breaks argument parsing.

### Write/Edit Tool Unicode Limitation

Write/Edit tools may drop Unicode Private Use Area (PUA) characters (Nerd Font icons, etc.). To include PUA characters in files, generate them at runtime with `printf '\uXXXX'` / `printf '\U000XXXXX'` instead of embedding directly.

### QA Verification

When QA-perspective verification is requested (e.g., "QA観点で確認", "動作確認して", "merge前に確認", dependency update review), load `/qa-planner` via the `Skill` tool.
**Load before planning even in plan mode** (skill contains test design techniques and risk-based prioritization that improve plan quality):

- **`/qa-planner`**: Systematic test case design with risk-based prioritization. Works in both plan mode (test plan output) and implementation mode (test execution)
- If browser verification is also needed, additionally load `/agent-browser`

### Browser Automation

For tasks involving browser interaction, load `/agent-browser` via the `Skill` tool (parameter name: `skill`).
**Load before planning even in plan mode** (skill contains SPA data extraction patterns and verification constraints that improve plan quality):

- **`/agent-browser`**: Required when using agent-browser CLI. Includes SPA data extraction priorities and constraints

### Obsidian Notes

When reading or writing Obsidian notes, load `/obsidian-cli` via the `Skill` tool and use the `obsidian` CLI. Direct file access (Read/Grep/Glob) may fail due to iCloud sync path resolution issues.

### Claude Code Hooks Notes

- **PreToolUse matcher limitation**: `Task` tools (`TaskCreate`, `TaskUpdate`, etc.) and `Skill` tool are NOT matchable (verified on real device 2026-03-19). `ExitPlanMode` IS matchable (verified 2026-03-20). Output `{"decision":"block","reason":"..."}` to stdout to block + deliver message
- **To intercept before skill execution, use `UserPromptSubmit`**: Detect `/skill-name` in the stdin JSON `prompt` field. Example: `jq -e '.prompt | test("^/skill-name")' >/dev/null 2>&1`
- **JSON escaping in hook commands**: Avoid `bash -c '...'` wrapping. Write commands directly in JSON strings and escape with `\"` (avoids single-quote nesting issues)
- **Blocking with `UserPromptSubmit`**: Prefer outputting `{"decision":"block","reason":"..."}` to stdout + exit 0 over exit 2 — this communicates the reason to Claude
- **Approval tracking with `PostToolUse`**: `PermissionRequest` only records that a dialog was shown (cannot distinguish approval/denial). To track actually executed (approved) commands, combine with a `PostToolUse` hook. Exclude high-frequency tools (Read/Glob/Grep) via matcher to reduce overhead
- **task-planner gate**: `task-planner-gate.ts` gates ExitPlanMode via PreToolUse. When blocked, create a marker with `touch /tmp/claude-task-planner-ready-{session_id}` then retry ExitPlanMode

### codex-review Skill Special Rule

**Absolute rule**: When `/codex-review` is triggered, always complete the full Code Review Loop (never skip midway). See codex-review skill's SKILL.md for the detailed flow.

**Default review**: Unless the user explicitly requests codex-review, `/subagent-review` runs as the default review after each implementation task completion.

### General

- `AskUserQuestion` `options` limited to 4 per question (more causes ValidationError)
- When receiving correction instructions from the user, consider appending to `~/.claude/CLAUDE.md` if the instruction is general-purpose, with user approval before appending

#### Rule Compliance

- **Following the letter of the rules IS following the spirit**: "I'm following the spirit of the rules" is a classic rationalization. Execute rules exactly as written
- **These thought patterns are rationalization red flags** — if you catch yourself thinking any of these, STOP and re-read the relevant rule:
  - "This is simple enough to skip the process" → The process applies to simple tasks too
  - "I'm in a hurry, so I'll skip this" → Following the process avoids rework and is faster
  - "Just this once is fine" → There are no exceptions. Execute as written
  - "No need to verify" → Confidence is not a substitute for verification
  - "The plan says X but Y is better" → Plan deviation requires user approval

#### Plan Mode

- **Run `/plan-deeper` before ExitPlanMode**: After creating a plan in plan mode, run `/plan-deeper` via the Skill tool before calling ExitPlanMode. May skip ONLY when ALL of these conditions are met:
  - Target is a single file with a few lines of changes (typo fix, config value change, simple addition)
  - No design decisions or multiple implementation approaches exist
  - User explicitly says "no plan-deeper needed", "just implement it", etc.
- **Run `/simplify-review` after plan-deeper converges**: After `/plan-deeper` completes, run `/simplify-review plan` to detect over-engineering and eliminate unnecessary complexity before ExitPlanMode. Same skip conditions as plan-deeper apply (single file, few lines, no design decisions, user explicitly skips)
- **Wait for explicit user approval before ExitPlanMode**: After plan-deeper and simplify-review complete, present the final plan summary and wait for the user to say "実装して", "OK", "進めて", etc. before calling ExitPlanMode. Do not auto-exit after plan-deeper/simplify-review completion — the user may have additional feedback
- **Exhaustive enumeration before design commitment**: Plans tend to anchor on the most typical scenario and miss boundary conditions. Before finalizing a design, explicitly enumerate:
  1. **Implicit state**: What already exists before the operation runs? (e.g., current process, open connections, occupied slots — operations on a collection often forget the "current" item)
  2. **Existing implementations**: What does the codebase already provide? Search for traits, helpers, and patterns before proposing new code paths for the same category of side effect
  3. **Entry points and preconditions**: From which states/locations/environments can this be invoked? List all valid combinations and verify the design handles each
- **When concrete implementation code review is needed**: Include the full implementation code in the plan for user review, then transition to implementation phase after confirmation
- **Data processing tool plans**: For log analysis/aggregation tool improvements, present Before/After using real files during plan mode before ExitPlanMode. Let the user assess the scale of the problem with real data before approval
- **Definition of Done**: `/plan-deeper` auto-executes the completion criteria proposal and agreement flow. When skipping, manually include completion criteria in the plan (e.g., implementation only, implementation + lightweight verification + PR + CI)
- **Required checks before ExitPlanMode**: For plans involving bug investigation/fixes, explicitly include:
  - "Which command/log/measurement confirms this fix works"
  - "Considered whether this fix approach could be wrong, and the evidence that rules it out"

#### Plan Execution (after ExitPlanMode)

- **Convert plan to tasks**: After ExitPlanMode, extract steps from the plan file and register each as an individual task via TaskCreate
  - **Leverage task-planner agent**: For plans that decompose into 3+ tasks, pass the plan file to the `task-planner` subagent to generate structured task decomposition. Use its output for TaskCreate
  - **Three elements of task descriptions**: Each task description must include: (1) target files to modify, (2) expected behavior after change, (3) verification method (command + expected output)
  - **Separation of concerns**: Separate different concerns (e.g., adding an agent vs. modifying CLAUDE.md) into distinct tasks. Group files sharing the same concern (module + tests) into a single task
  - **Separate implementation and verification tasks** (e.g., "Implement feature A" and "Verify feature A" are distinct tasks)
  - Verification task descriptions must include the exact commands to run and expected output (recoverable from tasks after compaction)
  - Verification tasks must include "Run `/verification-before-completion` before marking complete"
  - **Verification section extraction**: Before creating implementation tasks, read the plan's Verification section. For each item containing an executable command or observable check (e.g., CLI invocation, `curl` request, `agent-browser` screenshot, browser interaction), create a dedicated smoke-test task with the exact command/procedure and expected outcome. These are separate from the final `/verification-before-completion` gate task. Then convert remaining verification steps (test execution, lint, etc.) to tasks as usual
  - Task granularity: one task per numbered plan step or verifiable unit. Do not create separate tasks for sub-bullets
  - Implementation task descriptions must include acceptance criteria sufficient for subagent spec review. Do NOT embed "/verification-before-completion" in implementation task descriptions — it gets ignored by implementation momentum
  - **Verification as final gate task**: Always create a dedicated final task named "Run /verification-before-completion" that is blockedBy all other tasks. This task's description must list the specific verification commands from the plan's Verification section (manual smoke tests, CLI execution, etc.). This structural separation ensures verification is visible in TaskList as a pending task and cannot be silently absorbed into implementation completion
  - May skip task creation ONLY when the user explicitly says to skip, or the plan has no numbered steps (e.g., a single direct instruction)
- **Faithful step execution**: Do not skip, rephrase, or reorder plan steps. Execute commands, file paths, and verification procedures exactly as written in the plan
- **Progress tracking**: Update each task to in_progress when starting (record current HEAD SHA in task metadata as baseline_sha), completed when done. If a step is skipped, state the reason explicitly
- **Verification before task completion**: Before marking any implementation task as completed, run `/verification-before-completion` Gate Function. This is the only reliable mechanism to prevent false completion claims — especially after compaction when prior verification context is lost
- **Simplify review for large diffs**: For tasks with large changes (20+ files or 500+ lines), run `/simplify-review code` before `/subagent-review` to identify over-engineering. Skip for small changes or when user explicitly skips
- **Subagent review after task completion**: Run `/subagent-review` after marking each implementation task completed. See the skill's SKILL.md for skip conditions and detailed flow
- **Recovery after compaction**: If context compression occurs, check TaskList for incomplete tasks, re-read the plan file, then resume work
- **Handling plan deviations**: If you discover a problem with the plan during implementation:
  1. State what the problem is and why the plan cannot be followed
  2. Propose alternatives
  3. Get user approval before deviating
  - Implicit plan changes are prohibited (do not silently change the plan because "this way is better")
- **Plan compliance check on completion**: After all tasks are done, re-read the plan file and compare implemented results against plan items one by one. Check for omissions, extras, or misinterpretations

#### Implementation and Verification

- **UI consistency check**: When modifying display format of one command/view, compare with other commands that show similar data (e.g., list vs. interactive selection). Proactively identify and resolve style inconsistencies (brackets, separators, column ordering) before user review
- **Baseline capture (pre-implementation state recording)**: Before making changes, record the current behavior of the target. For CLI: command output, for config: current values, for UI: screenshots. "Unknown pre-change state" means verification is impossible
- **End-to-end behavioral verification**: After implementation, confirm changes actually work. "Code was written" does not mean "it works". Scripts → execute and check output, hooks → reproduce trigger conditions and verify intervention behavior, config changes → verify in the environment where settings are applied. See `verification-before-completion/references/behavioral-verification.md` for details
- **Verification observability**: Confirm that the changed behavior itself is observable by the test tool. When tests cannot detect the change (e.g., spinner in-place updates are not captured by stdout capture, CSS visual changes are not detectable by unit tests), explicitly state the observation limitations and choose appropriate verification methods (manual confirmation, screenshot comparison, etc.)
- **Post-implementation verification**: Always verify after implementation. For scripts, execute them. Include change detection tests (intentionally modify → re-run → confirm detection → revert). Claude proactively verifies without waiting for user confirmation
- **No completion claims without verification**: Before claiming work is complete or successful, run `/verification-before-completion` and follow the Gate Function
- **UI visual verification**: When implementing changes that affect Web UI (HTML/CSS/JSX/components/styles, etc.), autonomously execute browser verification without waiting for user instruction. "It renders" alone does not count as verification complete
  - Load `/agent-browser` and use agent-browser to open the target page
  - Take screenshots and compare layout, sizing, and spacing against Figma designs or reference pages (existing pages with the same pattern)
  - Check for browser console errors
  - Perform responsive checks (viewport changes) and interaction verification as needed
- **Tests**: When test files exist, include expected value updates and new test cases for behavior changes in both the plan and implementation. Include tests in the work plan unless the user explicitly says "no test plan needed"
- **Temporary verification files (test-*.mjs, verify-*.sh, etc.)**: Not for committing. Exclude during git add and suggest .gitignore additions as needed
- **Establish measurement baseline → implement → re-measure → compare → conclude**: Follow this cycle for all improvement work, not just performance optimization. The definition of done is "demonstrated the effect with before/after numbers", not "made the fix"
- **Performance optimization**: Do not pre-commit to a fixed optimization list before baseline measurement. Treat items as candidates, measure first, then select based on data. "Likely faster" is not a substitute for "measured faster"
- **External library output verification**: Do not trust assumed data structures from external libraries based solely on reading source code or docs. When the implementation depends on the shape of external tool output (JSON schema, file paths, etc.), generate or obtain real sample data during planning phase to verify assumptions before implementation
- **Output value verification**: When verifying new feature output (CI logs, script results), check value correctness — not just error absence. Before inspecting actual output, define what correct output looks like. Divergence signals a bug even without errors (e.g., expected ~3 items, got 16)
- **Evidence over analysis**: When any analysis — yours, a subagent's, or documentation — conflicts with concrete evidence (actual output, user observations, reproducible behavior), trust the evidence. Investigate the discrepancy rather than rationalizing it

#### Bug Fixes

- **Investigation approach**: Always verify these two points:
  1. **Direct observation means included in the plan** — Include means to directly observe facts: log output, debug commands, measurement confirmation. In non-interactive environments, set up debug logging first with `exec >> /tmp/<name>.log 2>&1`
  2. **Fix approach has been falsified** — Do not adopt unverified assumptions as the fix approach
- **Present alternatives**: When both a minimal workaround and a root-cause fix exist, present both options. For areas with TODO comments or technical debt, prioritize the option that resolves the debt
- **Reproduction conditions**: Treat user-provided reproduction conditions ("occurs during X") as hypotheses. Plans must explicitly separate "facts", "analysis", and "estimates (not confirmed)", and must not adopt unconfirmed assumptions as the fix approach
- **Detailed process**: For step-by-step debugging methodology, load the `/systematic-debugging` skill

#### Code Review Reception

Applies to human code review feedback (PR reviews, direct user feedback, etc.). Does NOT apply to codex-review's automated review loop.

- **Technical evaluation first**: When receiving review feedback, verify technical correctness before implementing. Do not implement before verifying
- **No performative agreement**: Skip platitudes like "Great point!" or "Absolutely right!". Respond with technical substance or direct fixes
- **Clarify all unknowns before starting**: If multi-item feedback has unclear items, do not implement only the clear items first — clarify all unknowns before starting (items may have dependencies). For async reviews (PR comments, etc.) where immediate clarification is not possible, state assumptions explicitly before proceeding
- **Pushback when warranted**: If review feedback is inappropriate for the existing codebase, violates YAGNI, or contradicts the user's design decisions, push back with technical reasoning

### Google Docs URL Handling

When a Google Docs URL (`https://docs.google.com/document/d/...`) is provided and its content needs to be referenced or read, use the `/gdocs-to-md` skill to convert the document to Markdown and load it into context. WebFetch cannot retrieve structured Google Docs content, so conversion via gws Docs API is required.

### GitHub URL Handling

GitHub Issue and Pull Request URLs provided by the user are often from private repositories and cannot be accessed directly. As a rule, use the `gh` CLI to retrieve information from GitHub URLs provided by the user.

When a GitHub repository URL is provided and code investigation, analysis, comparison, or reference is needed, use the `/repo-dive` skill to clone locally and explore with native file tools (Read, Grep, Glob, Agent). Do not use WebFetch or `gh api` for code retrieval as they are slow and incomplete.

## Design Principles

- Single responsibility is context-dependent. Allow side effects in internal implementations; prefer pure functions for public APIs
- Group 3+ arguments into an object
- Abstract common patterns early; apply Rule of Three for domain-specific ones
- Prefer function composition over inheritance. Avoid excessive abstraction
- Use descriptive names for exports, concise names for locals

### GitHub Actions Security

- Pin all actions to full commit SHA, not version tags (e.g., `uses: actions/checkout@de0fac2e...` not `uses: actions/checkout@v6`). Verify SHA with `gh api repos/{owner}/{repo}/git/ref/tags/{tag} --jq '.object.sha'`

## Coding Conventions

### CSS/Layout Best Practices

**flexbox and transform interaction:**
- When using `transform: scale()` inside a flex container, set `flex-shrink: 0` (Tailwind: `shrink-0`) to prevent flex-based shrinking
- Browser default `max-width: 100%` also causes double constraints when combined with transform; also apply `max-w-none`
- Example: When scaling an image with transform → `class="shrink-0 max-w-none max-h-none"`

### Deno Scripts

- Read stdin with `new Response(Deno.stdin.readable).text()` (Deno 2.x). No permission flags needed
- Inline code execution uses `deno eval`. `deno run -e` does not exist
- Get the script's own directory: `new URL(".", import.meta.url).pathname` (useful for co-locating config files)
- When diagnosing subprocess failures with `Deno.Command`, use `stderr: "piped"` not `stderr: "null"`, and log stderr content when exit code is non-zero

### File Organization

- Arrange code in dependency order (readable bottom-to-top)
    - Constants, type definitions, and helper functions first
    - Main logic and exports that use them last
- Structure files so dependencies are understood by reading from the bottom up
- Avoid circular references
