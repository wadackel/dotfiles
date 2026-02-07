# Learning Categories

This document provides detailed definitions, identification heuristics, and examples for each of the five learning categories used in session retrospectives.

## 1. Missing Context

**Definition:** Information that Claude needed but did not have access to during the session.

**Identification signals:**
- Claude asked the user for clarification
- Claude made an incorrect assumption that the user corrected
- Claude tried a command that failed due to missing knowledge
- Claude had to read multiple files to discover basic project facts

**Examples:**

**Project-specific:**
- "This repository uses pnpm workspaces, not npm"
- "Always run `nix flake check` before `darwin-rebuild switch`"
- "The API server runs on port 3001, not 3000"
- "Tests must be run with `npm run test:unit`, not `npm test`"

**Universal:**
- "Use `gh` CLI for GitHub URLs instead of WebFetch (private repos)"
- "Always use Explore subagent for codebase exploration, not direct Grep"
- "Check git status before proposing commits"

**Tool-specific:**
- "playwright-cli requires session-list to be run first"
- "ast-grep relational rules require stopBy: end parameter"
- "gemini-research should be invoked for library recommendations"

## 2. Corrected Approaches

**Definition:** Cases where the user explicitly corrected Claude's behavior, approach, or output.

**Identification signals:**
- User said "No, do it this way instead"
- User corrected the format, style, or structure of output
- User specified a tool or method Claude should have used
- User pointed out a better alternative after Claude finished

**Examples:**

**Behavioral corrections:**
- "Commit messages should be in Japanese, not English"
- "Use Edit tool for file modifications, not sed via Bash"
- "Don't use placeholder values — ask the user for real values"
- "Run validation before packaging, not after"

**Technical corrections:**
- "Use `darwin-rebuild switch --flake .#private`, not just `.`"
- "Import paths should use @ alias, not relative paths"
- "Use TypeScript strict mode, not loose typing"

**Output format corrections:**
- "Show diffs before applying changes, not after"
- "Group proposals by target file, not by category"
- "Use concise one-line format, not verbose paragraphs"

## 3. Repeated Workflows

**Definition:** Multi-step procedures that were performed more than once during the session.

**Qualification criteria:**
- Occurred 2+ times in the session
- Involves 3+ distinct steps
- Steps follow a consistent order
- Could be generalized with parameters

**Identification signals:**
- Claude executed the same sequence of commands multiple times
- User asked Claude to "do that again" or "run the same steps"
- Pattern of: read file → modify → validate → apply occurred repeatedly

**Examples:**

**Development workflows:**
- "Edit Nix file → run nix flake check → run darwin-rebuild switch"
- "Make code change → run tests → fix failures → run tests again"
- "Check CI status → read logs → identify failure → fix → push → wait"

**Skill workflows:**
- "Initialize skill → edit SKILL.md → create references → validate → package"
- "Read file → analyze → propose changes → show diff → apply with approval"

**Tool usage patterns:**
- "List sessions → select session → read output → send message"
- "Search with Glob → refine with Grep → read matching files"

**When NOT to propose a skill:**
- Single occurrence (no repetition)
- Less than 3 steps (too trivial)
- Highly context-specific (not generalizable)
- Already covered by an existing skill

## 4. Tool/Library Knowledge

**Definition:** Discoveries about how specific tools, libraries, or APIs work.

**Identification signals:**
- Claude learned a new command flag or option
- Claude discovered a tool-specific requirement or constraint
- Claude found a workaround for a tool limitation
- User explained how a particular tool should be used

**Examples:**

**Command-line tools:**
- "`nix fmt` uses treefmt and nixfmt for Nix files"
- "`gh pr create` requires `--body` flag for multi-line descriptions"
- "`git diff --stat` shows file change statistics without full diff"

**Library/Framework patterns:**
- "React hooks must be called at the top level, not in conditionals"
- "Next.js 15 requires 'use client' directive for client components"
- "TypeScript requires explicit return types for exported functions"

**API specifics:**
- "Gemini CLI supports --output-format json for structured output"
- "skill-creator init_skill.py takes --path for output directory"
- "playwright-cli session-list shows all active browser sessions"

**Tool limitations:**
- "WebFetch fails for authenticated URLs — use specialized tools instead"
- "Bash `find` is slower than Glob for file pattern matching"
- "`nix flake check` doesn't validate all darwin-rebuild issues"

## 5. Preference Patterns

**Definition:** User style preferences, conventions, or behavioral expectations observed during the session.

**Identification signals:**
- User consistently corrected the same aspect across multiple outputs
- User explicitly stated a preference ("I prefer X")
- User showed preference through approvals/rejections
- Pattern emerged from multiple similar corrections

**Examples:**

**Communication style:**
- "User prefers concise responses, dislikes verbose explanations"
- "User wants technical details, not simplified analogies"
- "User prefers Japanese for user-facing text, English for code"

**Code style:**
- "User prefers functional programming patterns over classes"
- "User wants explicit error handling, no silent failures"
- "User prefers named exports over default exports"

**Workflow preferences:**
- "User wants to see all proposals before any are applied"
- "User prefers draft PRs with WIP prefix"
- "User wants validation before every destructive operation"

**Tool preferences:**
- "User prefers Explore subagent over direct searches"
- "User wants skill-tester validation for all new skills"
- "User prefers gh CLI over GitHub web interface"

**When NOT to record as preference:**
- Single instance (not a pattern)
- Project-specific requirement (not a general preference)
- Industry standard practice (Claude should already know)

## How to Identify Each Category

Use this decision tree when analyzing a learning:

```
Did Claude lack information it needed?
  YES → Missing Context

Did the user correct Claude's approach or output?
  YES → Corrected Approaches

Was a multi-step workflow repeated 2+ times?
  YES → Repeated Workflows

Did Claude learn something new about a tool/library?
  YES → Tool/Library Knowledge

Did a user preference pattern emerge?
  YES → Preference Patterns

None of the above?
  → May not be worth recording (one-off or too specific)
```

## Edge Cases

**Learning fits multiple categories:**
- Choose the most specific category
- Example: "User corrected Claude to use Explore subagent" → Corrected Approaches (more specific than Missing Context)

**Uncertain if it's a pattern or one-off:**
- Default to requiring 2+ occurrences for patterns
- Single corrections → Corrected Approaches (not Preference Patterns)

**Distinction between Missing Context and Corrected Approaches:**
- Missing Context: Claude didn't know
- Corrected Approaches: Claude knew but chose wrong approach

**Distinction between Repeated Workflows and Tool Knowledge:**
- Repeated Workflows: Multi-step procedures
- Tool Knowledge: Single tool facts or flags
