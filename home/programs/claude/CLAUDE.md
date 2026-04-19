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

Run `/plan <request>` — a single fused skill that does research / draft / adversarial critique / task decomposition internally. `/plan` Phase 1 auto-detects `trivial` and short-circuits to a minimal plan + single task. Follow `/plan` with `/impl` to execute the task list.

CC builtin plan mode is no longer used. The `/plan` skill + `plan-gate.ts` PreToolUse hook enforce design-first without depending on plan mode's gating (which had reliability issues).

### Static Analysis During /plan

For lint error or type error fix tasks, run `pnpm lint:script` / `tsc` during `/plan` Phase 2 EXPLORE to confirm actual errors before deciding the fix approach. Theorizing without real error output leads to wasted fixes on non-existent issues.

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
- **plan-gate**: `plan-gate.ts` gates `Edit|Write|MultiEdit` via PreToolUse. Blocks edits to files under cwd unless a valid cwd-hash marker (`~/.claude/plans/.active-<hash>`, mtime < 24h) is present. `/plan` creates the marker at Phase 6. Infra files (`~/dotfiles/home/programs/claude/{CLAUDE.md,settings.json,scripts/**}`) are always allowed via an infra path allowlist (bootstrap safety). Missing fields (`file_path` / `cwd`) fail-open. Both bash (`realpath "$PWD" | shasum -a 256 | cut -c1-16`) and TS (`crypto.subtle.digest` on `Deno.realPath()`) must canonicalize before hashing. Manual `touch` bypass is a rationalization red flag — always run `/plan` instead

### codex-review Skill Special Rule

**Absolute rule**: When `/codex-review` is triggered, always complete the full Code Review Loop (never skip midway). See codex-review skill's SKILL.md for the detailed flow.

**Default review**: Unless the user explicitly requests codex-review, `/subagent-review` runs as the default review after each implementation task completion.

**`/santa-loop` is the final gate, not `/codex-review`**: `/codex-review` is a single-external lightweight review for opt-in mid-task use (runs a single Codex CLI reviewer). `/santa-loop` handles dual-reviewer adversarial verification at the final gate (Claude opus + codex, both must PASS, max 3 fix rounds). Do not confuse them — `/codex-review` is for ad-hoc second opinion, `/santa-loop` is the end-of-implementation quality/completeness dual gate.

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
  - "/plan is too heavy for a typo fix" → `/plan` Phase 1 detects `trivial` and collapses to a 1-phase minimal plan, so it is not heavy. Trying to skip is a red flag
  - "Abuse the infra allowlist to skip /plan every time" → the infra allowlist applies only to edits of infra itself (CLAUDE.md / settings.json / scripts/). It does not apply to normal feature implementation

#### /plan Workflow

- **Question triage before AskUserQuestion**: In `/plan` Phase 1-4, before calling AskUserQuestion, triage each unclear point into one of three categories and ask ONLY category 1:
  1. **Ask now (user-only knowledge)**: goals, hidden constraints, deadlines, preferences, domain terminology, trade-offs requiring user judgment
  2. **Document as assumption (analyzable later)**: implementation patterns, abstraction level, library choice when codebase signal is weak — write `Assumption: X` in the plan body and let Phase 4 Critic / Adversarial Falsification validate
  3. **Self-resolve via code (discoverable)**: existing function presence, current behavior, file structure — use Grep/Read/Explore agent, never AskUserQuestion
  - Goal: apply the same Self-resolvable/Needs-user-input/Reject classification that Phase 4 Step 3 uses, but at the initial drafting stage
- **Phase 1 Requirement Clarification (small+)**: For non-trivial requests, always apply the 8-observation walk in `skills/plan/references/requirement-checklist.md`. Step 1 (Clear vs NotClear grep-able signal) → Step 2 (triage: Ask/Assume/Self-resolve via the 3-category rule above). Batch Ask items by impact priority and call AskUserQuestion **at Phase 1** (single-pass, no re-walk, max 4) — this is treated as the **exception to the Consolidated interview rule below** so Phase 2 Explore receives the correct scope. With 5+ items, ask the top 4 and record the remainder in the plan body as `Assumption (deferred from Phase 1 Ask truncation): <observation>: unresolved — requires user confirmation in Phase 4 Critic`, requiring Phase 4 Critic to re-detect them (do not invent tentative defaults). With 0 items, skip AskUserQuestion. Trivial requests are exempt
- **Consolidated interview**: `/plan` Phase 4 accumulates needs-user-input items from Phase 2/4 Steps and asks them once at the end of Phase 4 (Step 7). Do not interview per-step. **Exception**: the Phase 1 Requirement Clarification Ask runs at Phase 1 (see above) — at most 2 blocking interviews per plan (Phase 1 + Phase 4 Step 7)
- **Exhaustive enumeration before design commitment**: Plans tend to anchor on the most typical scenario and miss boundary conditions. Before finalizing a design, explicitly enumerate:
  1. **Implicit state**: What already exists before the operation runs? (e.g., current process, open connections, occupied slots — operations on a collection often forget the "current" item)
  2. **Existing implementations**: What does the codebase already provide? Search for traits, helpers, and patterns before proposing new code paths for the same category of side effect
  3. **Entry points and preconditions**: From which states/locations/environments can this be invoked? List all valid combinations and verify the design handles each
- **When concrete implementation code review is needed**: Include the full implementation code in the plan for user review, then transition to `/impl` after confirmation
- **Data processing tool plans**: For log analysis/aggregation tool improvements, present Before/After using real files during `/plan` before handing off to `/impl`. Let the user assess the scale of the problem with real data before approval
- **Definition of Done**: `/plan` Phase 4 Step 8 auto-executes the verification plan design and agreement flow — it designs observable completion conditions that Claude can autonomously verify, then confirms alignment with the user. Baseline activities (tests, lint) are executed within each implementation task's acceptance criteria; the final gate task runs `/verification-loop` (deterministic checks) → `/santa-loop` (dual-reviewer; rubric embeds Completion Criteria)
- **Required checks before handing off to /impl**: For plans involving bug investigation/fixes, explicitly include:
  - "Which command/log/measurement confirms this fix works"
  - "Considered whether this fix approach could be wrong, and the evidence that rules it out"

#### /impl Workflow

After `/plan` completes, invoke `/impl` to process the task list. Per-task rules (verification within task completion, simplify-review threshold, subagent-review timing, deviation handling, plan compliance check, recovery after compaction, three-elements task description, baseline_sha metadata, verification-loop + santa-loop as final gate) are documented in `~/.claude/skills/impl/SKILL.md` — single source of truth.

Key invariants enforced by `/impl`:
- Faithful step execution (no skip/rephrase/reorder)
- Raw evidence recording (verbatim command + output in `metadata.evidence`)
- `/subagent-review` after every implementation task. subagent-review auto-dispatches 10 domain-specific reviewers (typescript / deno / react / a11y / database / cloud-architecture / go / rust / dart / nix) by file extension + content heuristic, and `security-auditor` by security heuristic
- `/simplify-review code` when diff ≥ 20 files OR ≥ 500 lines
- Re-plan keeps `completed` tasks, deletes `pending`/`in_progress` only
- Final gate task is `Run /verification-loop and /santa-loop` with `blockedBy` all impls. `/verification-loop` returns READY → `/santa-loop` is invoked → must return NICE (dual-reviewer: Claude opus + codex (claude-second fallback)). `/santa-loop`'s "Completeness vs Completion Criteria" rubric criterion covers what `/completion-audit` used to check
- `/completion-audit` is deprecated for the default flow; re-invoke manually only when stricter evidence-sufficiency audit is specifically required

#### Implementation and Verification

- **UI consistency check**: When modifying display format of one command/view, compare with other commands that show similar data (e.g., list vs. interactive selection). Proactively identify and resolve style inconsistencies (brackets, separators, column ordering) before user review
- **Baseline capture (pre-implementation state recording)**: Before making changes, record the current behavior of the target. For CLI: command output, for config: current values, for UI: screenshots. "Unknown pre-change state" means verification is impossible
- **End-to-end behavioral verification**: After implementation, confirm changes actually work. "Code was written" does not mean "it works". Scripts → execute and check output, hooks → reproduce trigger conditions and verify intervention behavior, config changes → verify in the environment where settings are applied. See `completion-audit/references/behavioral-verification.md` for details
- **Verification observability**: Confirm that the changed behavior itself is observable by the test tool. When tests cannot detect the change (e.g., spinner in-place updates are not captured by stdout capture, CSS visual changes are not detectable by unit tests), explicitly state the observation limitations and choose appropriate verification methods (manual confirmation, screenshot comparison, etc.)
- **Post-implementation verification**: Always verify after implementation. For scripts, execute them. Include change detection tests (intentionally modify → re-run → confirm detection → revert). Claude proactively verifies without waiting for user confirmation
- **No completion claims without audit**: Before claiming all work is complete, the final `/verification-loop` must return READY and `/santa-loop` must return NICE. Individual task completion requires executing acceptance criteria verifications and recording raw evidence
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
