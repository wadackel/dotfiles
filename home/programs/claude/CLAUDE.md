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

**Bulk text replacement with special characters**: macOS BSD `sed` silently fails or corrupts patterns containing `!`, `$`, backticks. For bulk file replacement, use `fd -x python3 -c "import pathlib; ..."` instead of `sed`.

### Background Processes in Bash Tool

Launch long-running processes (dev servers, etc.) with `run_in_background: true` instead of chaining with `&` or `;`. Verify startup in a separate Bash call with `sleep N && curl ...`. Putting `cmd &` + subsequent commands in a single Bash call breaks argument parsing.

### Write/Edit Tool Unicode Limitation

Write/Edit tools may drop Unicode Private Use Area (PUA) characters (Nerd Font icons, etc.). To include PUA characters in files, generate them at runtime with `printf '\uXXXX'` / `printf '\U000XXXXX'` instead of embedding directly.

### QA Verification

When QA-perspective verification is requested (e.g., "QA観点で確認", "動作確認して", "merge前に確認", dependency update review), load `/qa-planner` via the `Skill` tool.
**Load before planning even in plan mode** (skill contains test design techniques and risk-based prioritization that improve plan quality):

- **`/qa-planner`**: Systematic test case design with risk-based prioritization. Works in both plan mode (test plan output) and implementation mode (test execution)
- If browser verification is also needed, additionally load `/browser-automation`

### Browser Automation

For tasks involving browser interaction, load `/browser-automation` via the `Skill` tool (parameter name: `skill`).
**Load before planning even in plan mode** (skill contains SPA data extraction patterns and verification constraints that improve plan quality):

- **`/browser-automation`**: Required when using Chrome MCP tools. Includes SPA data extraction priorities and constraints

### Claude Code Hooks Notes

- **`Skill` tool cannot be matched in `PreToolUse`**: Valid match targets are `Bash`, `Edit`, `Write`, `Read`, `Glob`, `Grep`, `Task`, `WebFetch`, `WebSearch`, and MCP tools only (per official docs)
- **To intercept before skill execution, use `UserPromptSubmit`**: Detect `/skill-name` in the stdin JSON `prompt` field. Example: `jq -e '.prompt | test("^/skill-name")' >/dev/null 2>&1`
- **JSON escaping in hook commands**: Avoid `bash -c '...'` wrapping. Write commands directly in JSON strings and escape with `\"` (avoids single-quote nesting issues)
- **Blocking with `UserPromptSubmit`**: Prefer outputting `{"decision":"block","reason":"..."}` to stdout + exit 0 over exit 2 — this communicates the reason to Claude
- **Approval tracking with `PostToolUse`**: `PermissionRequest` only records that a dialog was shown (cannot distinguish approval/denial). To track actually executed (approved) commands, combine with a `PostToolUse` hook. Exclude high-frequency tools (Read/Glob/Grep) via matcher to reduce overhead

### codex-review Skill Special Rule

**Absolute rule**: Always execute the Code Review Loop after implementation is complete (exception only when the user explicitly says "no review needed"). See codex-review skill's SKILL.md for the detailed flow.

### General

- `AskUserQuestion` `options` limited to 4 per question (more causes ValidationError)
- When receiving correction instructions from the user, consider appending to `~/.claude/CLAUDE.md` if the instruction is general-purpose, with user approval before appending

#### Plan Mode

- **Run `/plan-deeper` before ExitPlanMode**: After creating a plan in plan mode, run `/plan-deeper` via the Skill tool before calling ExitPlanMode. May skip ONLY when ALL of these conditions are met:
  - Target is a single file with a few lines of changes (typo fix, config value change, simple addition)
  - No design decisions or multiple implementation approaches exist
  - User explicitly says "no plan-deeper needed", "just implement it", etc.
- **When concrete implementation code review is needed**: Include the full implementation code in the plan for user review, then transition to implementation phase after confirmation
- **Data processing tool plans**: For log analysis/aggregation tool improvements, present Before/After using real files during plan mode before ExitPlanMode. Let the user assess the scale of the problem with real data before approval
- **Definition of Done**: `/plan-deeper` auto-executes the completion criteria proposal and agreement flow. When skipping, manually include completion criteria in the plan (e.g., implementation only, implementation + lightweight verification + PR + CI)
- **Required checks before ExitPlanMode**: For plans involving bug investigation/fixes, explicitly include:
  - "Which command/log/measurement confirms this fix works"
  - "Considered whether this fix approach could be wrong, and the evidence that rules it out"

#### Implementation and Verification

- **UI consistency check**: When modifying display format of one command/view, compare with other commands that show similar data (e.g., list vs. interactive selection). Proactively identify and resolve style inconsistencies (brackets, separators, column ordering) before user review
- **Post-implementation verification**: Always verify after implementation. For scripts, execute them. Include change detection tests (intentionally modify → re-run → confirm detection → revert). Claude proactively verifies without waiting for user confirmation
- **UI visual verification**: When implementing changes that affect Web UI (HTML/CSS/JSX/components/styles, etc.), autonomously execute browser verification without waiting for user instruction. "It renders" alone does not count as verification complete
  - Load `/browser-automation` and open the target page with Chrome MCP
  - Take screenshots and compare layout, sizing, and spacing against Figma designs or reference pages (existing pages with the same pattern)
  - Check for browser console errors
  - Perform responsive checks (viewport changes) and interaction verification as needed
- **Tests**: When test files exist, include expected value updates and new test cases for behavior changes in both the plan and implementation. Include tests in the work plan unless the user explicitly says "no test plan needed"
- **Temporary verification files (test-*.mjs, verify-*.sh, etc.)**: Not for committing. Exclude during git add and suggest .gitignore additions as needed
- **Establish measurement baseline → implement → re-measure → compare → conclude**: Follow this cycle for all improvement work, not just performance optimization. The definition of done is "demonstrated the effect with before/after numbers", not "made the fix"

#### Bug Fixes

- **Investigation approach**: Always verify these two points:
  1. **Direct observation means included in the plan** — Include means to directly observe facts: log output, debug commands, measurement confirmation. In non-interactive environments, set up debug logging first with `exec >> /tmp/<name>.log 2>&1`
  2. **Fix approach has been falsified** — Do not adopt unverified assumptions as the fix approach
- **Present alternatives**: When both a minimal workaround and a root-cause fix exist, present both options. For areas with TODO comments or technical debt, prioritize the option that resolves the debt
- **Reproduction conditions**: Treat user-provided reproduction conditions ("occurs during X") as hypotheses. Plans must explicitly separate "facts", "analysis", and "estimates (not confirmed)", and must not adopt unconfirmed assumptions as the fix approach
- **Detailed process**: For step-by-step debugging methodology, load the `/debug` skill

### Google Docs URL Handling

Google Docs の URL（`https://docs.google.com/document/d/...`）が提供され、その内容を参照・読み取る必要がある場合は、`/gdocs-to-md` スキルを使用してドキュメントをMarkdownに変換し、その内容をコンテキストに読み込む。WebFetch では Google Docs の構造化された内容を取得できないため、gws Docs API 経由の変換が必要。

### GitHub URL Handling

GitHub Issue and Pull Request URLs provided by the user are often from private repositories and cannot be accessed directly. As a rule, use the `gh` CLI to retrieve information from GitHub URLs provided by the user.

## Design Principles

- Single responsibility is context-dependent. Allow side effects in internal implementations; prefer pure functions for public APIs
- Group 3+ arguments into an object
- Abstract common patterns early; apply Rule of Three for domain-specific ones
- Prefer function composition over inheritance. Avoid excessive abstraction
- Use descriptive names for exports, concise names for locals

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
