---
name: gemini-research
description: Research assistant for library recommendations, error solutions, and best practices. Use when users ask "what's the best library for X?", "which framework should I use?", "how do I fix this error?", "what are current best practices for Y?", or need web-enhanced research for up-to-date information. Leverages Gemini CLI with Google Search integration. Gemini analyzes and researches but does NOT write code - Claude Code handles all implementation.
---

# Gemini Research

## Overview

This skill enables Claude Code to delegate research and analysis tasks to Gemini CLI, leveraging Gemini's strengths in codebase exploration, web-enhanced investigation, and multimodal analysis. While Claude Code focuses on implementation, Gemini provides deep analysis and current information through Google Search integration.

**Key principle**: Gemini is used for **research and analysis only** - it does NOT write code. Claude Code remains responsible for all implementation work.

## When Claude Should Use This Skill

Automatically leverage Gemini CLI in these scenarios:

1. **Plan Mode - Repository Analysis**: Understanding large or unfamiliar codebases before planning changes
2. **Plan Mode - Library Research**: Evaluating and selecting libraries, researching APIs and frameworks
3. **Error Investigation**: Finding solutions to build errors, runtime issues, or unexpected behavior
4. **Best Practices Research**: Gathering current patterns, conventions, and community consensus
5. **Documentation Discovery**: Finding usage examples and implementation guides for libraries/APIs

## Basic Usage Pattern

Gemini CLI is invoked via bash commands. The general pattern:

```bash
gemini -p "research prompt here" --output-format json
```

**Key flags:**
- `-p`: Non-interactive mode with direct prompt
- `--output-format json`: Structured output for programmatic parsing
- `--include-directories`: Target specific directories for codebase analysis

**Example:**
```bash
gemini -p "Analyze the testing strategy in this repository. What frameworks are used and how are tests organized?" --include-directories ./tests --output-format json
```

## Research Workflows

### Workflow 1: Repository Analysis (Plan Mode)

**Trigger**: User requests feature work requiring codebase understanding

1. **Identify scope**: Determine which parts of the codebase are relevant
2. **Construct prompt**: Use templates from [references/prompts.md](references/prompts.md)
3. **Execute Gemini CLI**:
   ```bash
   gemini -p "Analyze [ASPECT] in this codebase. Focus on [SPECIFIC_AREAS]." \
     --include-directories [TARGET_DIR] \
     --output-format json
   ```
4. **Parse results**: Extract key findings (architecture, patterns, dependencies)
5. **Inform plan**: Use Gemini's analysis to design implementation approach
6. **Report to user**: Summarize findings and proposed plan

**Example scenario**: "Add authentication to this app"
- Gemini analyzes current auth patterns, middleware structure, database schema
- Claude Code uses findings to plan authentication implementation

### Workflow 2: Library Research (Plan Mode)

**Trigger**: Need to select, learn, or migrate libraries

1. **Define requirements**: What problem needs solving? What are the constraints?
2. **Construct research prompt**: Library comparison, API usage, or migration guidance
3. **Execute Gemini CLI**:
   ```bash
   gemini -p "Research libraries for [USE_CASE]. Compare options and recommend best choice for [REQUIREMENTS]." \
     --output-format json
   ```
4. **Evaluate options**: Parse Gemini's recommendations
5. **Inform plan**: Choose library and design integration approach
6. **Report to user**: Present recommendation with rationale

**Example scenario**: "Choose a form validation library for React"
- Gemini researches current options (React Hook Form, Formik, Zod, etc.)
- Claude Code proposes best fit and integration plan

### Workflow 3: Error Investigation

**Trigger**: Build failure, runtime error, or unexpected behavior

1. **Capture error context**:
   - Full error message
   - Stack trace
   - Environment details (OS, framework versions, etc.)
   - Recent changes
2. **Construct investigation prompt**:
   ```bash
   gemini -p "Investigate this error: [ERROR_MESSAGE]. Environment: [CONTEXT]. Find known solutions." \
     --output-format json
   ```
3. **Parse solutions**: Extract root cause, known issues, workarounds
4. **Apply fix**: Implement solution (Claude Code writes the code)
5. **Verify**: Test that error is resolved
6. **Report**: Explain what was found and how it was fixed

**Example scenario**: TypeScript build fails with cryptic error
- Gemini searches for error message, finds it's a known tsconfig issue
- Claude Code applies the documented fix

### Workflow 4: Documentation and Best Practices

**Trigger**: Implementing unfamiliar API or pattern

1. **Identify knowledge gap**: What specific information is needed?
2. **Request targeted research**:
   ```bash
   gemini -p "How do I use [LIBRARY/API] for [SPECIFIC_TASK]? Show examples and best practices." \
     --output-format json
   ```
3. **Extract guidance**: Code patterns, configuration, gotchas
4. **Implement with Claude Code**: Write actual code following Gemini's guidance
5. **Report**: Explain implementation approach

**Example scenario**: "Implement server-sent events in Express"
- Gemini finds documentation, examples, and best practices
- Claude Code writes the Express SSE implementation

## Prompt Construction Guidelines

**Effective research prompts are:**
- **Specific**: Include exact versions, error codes, technology stack
- **Contextual**: Provide environment details and constraints
- **Focused**: Ask for specific information, not general overviews
- **Actionable**: Request concrete recommendations or steps

**See [references/prompts.md](references/prompts.md) for proven templates.**

## Important Guidelines

### Gemini's Role: Research Only

- **DO**: Use Gemini for analysis, investigation, and information gathering
- **DO**: Leverage Gemini's web search for current best practices
- **DO**: Ask Gemini to explain, compare, and recommend approaches
- **DON'T**: Ask Gemini to write production code
- **DON'T**: Have Gemini make file edits or changes

**Claude Code always writes the actual implementation.**

### When to Use Gemini vs. Claude Code Directly

**Use Gemini when:**
- Codebase is large (>100 files) and unfamiliar
- Need current web information (library versions, known issues)
- Investigating errors with unclear root cause
- Comparing multiple approaches or technologies
- Learning unfamiliar APIs or frameworks

**Use Claude Code directly when:**
- Codebase is small or already understood
- Task is straightforward implementation
- No external research needed
- Working within well-known stack

### Output Handling

When using `--output-format json`, parse the JSON response to extract:
- Key findings and recommendations
- Code examples (for reference, not direct use)
- Links and resources
- Next steps or action items

Structure findings clearly when reporting to user:
- What was researched
- Key discoveries
- Recommended approach
- Why this approach makes sense

## Example Session Flow

```
User: "Add Stripe payment integration to the checkout page"

Claude Code:
1. Enters plan mode
2. Uses Gemini to research:
   - Stripe API best practices 2026
   - React + Stripe integration patterns
   - PCI compliance considerations
3. Parses Gemini's findings
4. Designs implementation plan
5. Presents plan to user with:
   - Stripe SDK recommendation
   - Security approach
   - UI/UX pattern
   - Testing strategy
6. After approval, implements (without Gemini)
```

## Tips for Effective Usage

1. **Be strategic**: Don't use Gemini for simple tasks Claude Code handles easily
2. **Batch questions**: Combine related research into single comprehensive prompts
3. **Extract learnings**: Apply Gemini's insights to inform better implementation
4. **Verify information**: Cross-reference critical recommendations before implementing
5. **Use JSON output**: Enables programmatic parsing for automated workflows
