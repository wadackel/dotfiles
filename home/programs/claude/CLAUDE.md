## Development Guide

### Core Principles

- Prioritize simplicity. Prefer YAGNI, KISS, and DRY over speculative flexibility.
- Do not add backward-compatibility shims or fallback paths unless they are effectively free.
- For parsing work, prefer dedicated parser libraries over regex when quoting or escaping edge cases matter.
- Discover facts from code and the environment before asking the user. Ask only for user-only knowledge, constraints, or tradeoff decisions.
- When presenting choices to the user, state the tradeoff axis in one sentence instead of listing pros/cons without framing.
- Follow rules as written. "This is too small to follow the process" and "verification can be skipped" are rationalization red flags.

### Tooling Defaults

- Use `fd` for file search.
- Use `rg` for content search.
- Prefer Deno/TypeScript over Bash when a script needs parsing, state management, or branching logic.
- Short one-off command chains are fine in Bash.

### Workflow Entrypoints

- Use `/plan <request>` as the default design-first entrypoint for implementation work. It supports trivial requests with a minimal path, so do not skip it just because the task looks small.
- Use `/impl` after `/plan` to execute the task list faithfully. `/impl` details live in `skills/impl/SKILL.md`.
- When QA-style verification is requested, load `/qa-planner` before planning. See `skills/qa-planner/SKILL.md`.
- For browser interaction or UI verification, load `/agent-browser` before planning. See `skills/agent-browser/SKILL.md`.
- For debugging or bug-fix work, load `/systematic-debugging`. See `skills/systematic-debugging/SKILL.md`.
- When a Google Docs URL must be read, use `/gdocs-to-md`. See `skills/gdocs-to-md/SKILL.md`.
- When a GitHub repository URL must be inspected as code, use `/repo-dive`. See `skills/repo-dive/SKILL.md`.
- When `/codex-review` is explicitly requested, complete its full review loop; do not stop midway.

### Planning And Execution

- `/plan` is the design-first entrypoint. Keep `CLAUDE.md` high-level; detailed plan mechanics belong in `skills/plan/SKILL.md`.
- During planning, resolve code-discoverable questions yourself and record reasonable assumptions when a default is safe.
- Ask the user only for goals, hidden constraints, deadlines, terminology, or tradeoffs that materially change the plan.
- `/impl` is the execution source of truth once a plan exists. Follow task order, verification requirements, and final-gate rules from `skills/impl/SKILL.md`.
- Infra path allowances exist only to edit Claude infra itself. Do not use them as a shortcut to bypass `/plan` for normal implementation work.

### Question Triage

- Ask now: user-only knowledge such as goals, hidden constraints, deadlines, preferences, or tradeoffs requiring judgment.
- Document as an assumption: when a reasonable default is safe and can be validated later.
- Self-resolve via code or environment: existing behavior, file structure, current implementation, or other discoverable facts.

### Verification

- Capture the pre-change baseline before editing: current output, config values, screenshots, or other observable state.
- Verify changed behavior after implementation. "Code changed" is not evidence that the change works.
- Choose a verification method that can actually observe the behavior you changed. When tests cannot observe it, use a better method and state the limitation.
- When behavior changes and relevant tests already exist, add or update tests as part of the change unless the user explicitly says not to.
- For Web UI changes, verify with `/agent-browser`: check screenshots/layout, console errors, and responsive behavior.
- Trust concrete evidence over analysis or documentation when they disagree.
- When running through `/impl`, do not claim completion until `/completion-audit` and `/subagent-review` pass. Details live in `skills/completion-audit/SKILL.md` and `skills/subagent-review/SKILL.md`. `/santa-loop` is opt-in and only runs when the user invokes it explicitly.

### Bug Fixes

- For bug-fix work, `CLAUDE.md` Bug Fixes rules are authoritative; `/systematic-debugging` adds procedure on top of them.
- Include direct observation in the plan and investigation: logs, repro commands, measurements, or other evidence that shows the symptom and where it occurs.
- Treat the proposed fix as a hypothesis that must be falsified. Consider why it could be wrong and gather evidence that rules alternatives out before committing to it.
- When both a minimal workaround and a root-cause fix exist, present both options and prefer the root-cause fix when it retires known debt safely.
- Use the baseline -> implement -> re-measure -> compare -> conclude loop for bug fixes and other behavior revisions.

### Git And Shell Hard Rules

- Before `git add -A` or `git add .`, run `git status --porcelain` and confirm no sensitive or unintended files are included.
- Do not use `git -C <path>`. Change directories and run `git` from the target repo instead.
- When creating an unrelated fix branch, branch from the intended base branch, then verify with `git diff <base-branch>...HEAD`.
- If Bash quoting behavior is uncertain, especially with `$'...'` inside pipes, wrap the command in `bash -c`.
- Disable history expansion with `set +H &&` before commands containing literal `!` inside double quotes.
- In `just` recipes, shell variables are `$var`, not `$$var`.
- Avoid BSD `sed` for bulk replacements involving special characters such as `!`, `$`, or backticks.
- Start long-running background processes with the tool's background mode rather than shell `&` chaining.
- If Private Use Area glyphs are needed in generated files, emit them at runtime with `printf` instead of embedding them directly.

### External Resource Handling

- GitHub Issue and PR URLs may be private. Use `gh` to retrieve their data.
- GitHub repository code should be inspected locally via `/repo-dive`, not via WebFetch or `gh api`.
- Google Docs content should be converted with `/gdocs-to-md` before use.
- For Obsidian notes, use `/obsidian-cli` rather than direct file access when iCloud path behavior is unreliable.

### Design Principles

- Single responsibility is context-dependent. Internal side effects are acceptable; prefer purity at public boundaries.
- Group three or more related arguments into an object.
- Prefer function composition over inheritance.
- Abstract common patterns early only when the abstraction is genuinely shared; use Rule of Three for domain-specific patterns.
- Use descriptive names for exports and concise names for local variables.

### Coding Conventions

#### GitHub Actions Security

- Pin GitHub Actions to full commit SHAs, not version tags.

#### Deno Scripts

- Read stdin with `new Response(Deno.stdin.readable).text()` on Deno 2.x.
- Use `deno eval` for inline execution; `deno run -e` does not exist.
- Get a script directory with `new URL(".", import.meta.url).pathname`.
- When diagnosing `Deno.Command` failures, pipe and inspect `stderr`.

#### File Organization

- Arrange files in dependency order so helper definitions appear before the logic that uses them.
- Avoid circular references.

@RTK.md
