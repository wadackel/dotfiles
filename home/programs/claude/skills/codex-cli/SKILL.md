---
name: codex-cli
description: |
  Delegates tasks to Codex CLI for code analysis, investigation, second opinions, and general-purpose coding assistance.
  Also use in plan mode for design validation and architecture second opinions.
  Triggers: "ask Codex", "Codexに聞いて", "Codexで分析して", "Codexで調べて", "get Codex's opinion", "セカンドオピニオン".
  Codex analyzes and advises; Claude Code implements.
---

# Codex CLI

## Overview

Delegates tasks to Codex CLI (`codex exec`) for analysis, investigation, and second opinions. Codex runs locally with full filesystem access and optional sandbox execution.

**Key principle**: Codex analyzes and advises — Claude Code implements. Do not ask Codex to write implementation code directly. Use Codex output to inform Claude Code's implementation decisions.

**Prerequisites**: `codex` CLI must be installed (Homebrew: `brew install openai/codex/codex`).

## Quick start

```bash
# One-off analysis (ephemeral, read-only)
codex exec -s read-only --ephemeral "Analyze error handling in ./src/api/. Read ./CLAUDE.md for context."

# Error investigation with sandbox execution
codex exec --full-auto --ephemeral "Reproduce and debug the test failure in ./tests/auth.test.ts. Run the test suite."
```

## When Claude Should Use This Skill

Use Codex when **sandbox execution** adds value beyond what Claude Code or Gemini can do alone:

1. **Error investigation** — Reproduce errors in a sandbox, run failing commands, inspect runtime behavior
2. **Test execution and validation** — Run test suites, validate fixes, check coverage
3. **Runtime behavior exploration** — Execute code to verify assumptions about behavior
4. **Design second opinion** — Get an independent perspective on architecture or approach decisions
5. **Security analysis** — Analyze code with execution capability (run static analysis tools, etc.)

### When to Use Codex vs Gemini vs Claude Code Directly

| Scenario | Tool |
|---|---|
| Sandbox execution needed (test running, error reproduction) | **Codex** |
| Web search or current information needed | **Gemini** (gemini-research skill) |
| Large codebase exploration (100+ files) | **Gemini** (`--include-directories`) |
| Straightforward implementation, known stack | **Claude Code directly** |
| Read-only analysis where either could work | **Gemini** (default tiebreaker) |

## Basic Usage Pattern

Invoke Codex via the Bash tool:

```bash
codex exec -s <sandbox> --ephemeral "prompt"
```

### Sandbox modes

| Mode | Flag | Use when |
|---|---|---|
| Read-only | `-s read-only` | Analysis, review, no filesystem changes needed |
| Workspace write | `-s workspace-write` | Need to run commands that modify files |
| Full auto | `--full-auto` | Convenience alias: on-request approval + workspace-write |

For current flag details, run `codex exec --help`.

### Large prompts

For prompts exceeding a few lines, use stdin:

```bash
cat <<'EOF' | codex exec -s read-only --ephemeral -
Your large prompt here...
EOF
```

### Structured output

Use `--output-schema` for machine-parseable results:

```bash
codex exec -s read-only --ephemeral --output-schema ./schema.json "Analyze..."
```

## Path-Based Context

Codex runs locally with full filesystem access. Pass file **paths** in the prompt — do not embed file contents.

**Do:**
```bash
codex exec -s read-only --ephemeral "
Analyze error handling patterns in this codebase.
Read these files for context:
- ./src/api/handlers.ts
- ./src/middleware/error.ts
- ./CLAUDE.md (project guidelines)
"
```

**Don't:**
```bash
# Don't embed file contents in the prompt
codex exec --ephemeral "
Here is the file content:
$(cat src/api/handlers.ts)
Analyze this code...
"
```

**Rules:**
- Instruct Codex to run `git diff` itself rather than embedding diff output
- Pass paths to CLAUDE.md, architecture docs, related source files
- Verify file existence before passing paths
- Limit to relevant files only (too many paths slow down Codex)
- **Exception**: Include content directly only for data that does not exist as files (error logs, CI output, etc.)

## Session Management

By default, use `--ephemeral` for general tasks to avoid polluting the session list (which the **codex-review** skill relies on for `codex exec resume --last`).

For multi-turn tasks where session continuity is needed:

```bash
# Start without --ephemeral to persist the session
codex exec -s read-only "initial prompt"

# Resume later
codex exec resume --last --full-auto "follow-up prompt"
# Or with explicit session ID:
codex exec resume <SESSION_ID> --full-auto "follow-up prompt"
```

## Important Guidelines

### Codex's role: analysis and advice

- **DO**: Ask Codex to analyze code, run tests, investigate errors, provide opinions
- **DO**: Ask Codex to execute commands in its sandbox to gather information
- **DON'T**: Ask Codex to write implementation code for Claude Code to copy
- **DON'T**: Use Codex for tasks Claude Code handles directly (simple edits, known patterns)

**Claude Code always writes the actual implementation.**

### Timeout awareness

Codex CLI runs synchronously via Bash tool. Default timeout is 10 minutes (max 20 minutes). For large tasks:
- Scope the prompt narrowly (specific files, specific question)
- Split into multiple focused invocations rather than one broad one

## CLI Gotchas

Non-obvious behavior to be aware of:

1. **`codex exec review` scope + prompt are mutually exclusive**: `--uncommitted`, `--base`, `--commit` cannot be combined with a custom `[PROMPT]`. Use `codex exec --full-auto "Review uncommitted changes (run git diff)..."` for custom criteria with specific scope.

2. **`--full-auto` expands to**: on-request approval policy + workspace-write sandbox. It does NOT grant full filesystem access.

3. **`--ephemeral`**: Prevents session files from being saved to disk. Use for one-off tasks to keep the session list clean for codex-review's `resume --last`.

4. **`--add-dir <DIR>`**: Makes additional directories writable alongside the primary workspace. Useful for multi-repo analysis.

5. **`-i/--image <FILE>`**: Attach images to the prompt for visual analysis (screenshots, diagrams).

6. **`--output-schema <FILE>`**: Pass a JSON Schema file to get structured output from Codex.

## NOT for These Use Cases

### Code review

For code review workflows (plan review, code quality review, security audit with fix loops), use the **codex-review** skill (`/codex-review`). It provides:
- Iterative review with automatic fix loops
- `codex exec review` with scope selectors (`--uncommitted`, `--base`, `--commit`)
- Session-based follow-up reviews
