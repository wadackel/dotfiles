# Skill Opportunity Detection

This document provides heuristics, litmus tests, and calibration examples for identifying session learnings that should become skill proposals rather than CLAUDE.md entries.

## The /invoke Litmus Test

The single most important question for any learning:

> "Would the user realistically type `/skill-name` to trigger this?"

- **YES** → Skill candidate. Continue evaluating with the detection signals below.
- **NO** → CLAUDE.md entry. The learning is a fact, preference, or behavioral rule that applies passively.

A skill is worth proposing when:
- The user would reach for it by name in future sessions
- It saves the user from explaining a multi-step process each time
- It orchestrates tools in a sequence that Claude wouldn't do autonomously

A CLAUDE.md entry is better when:
- It's a fact Claude should just "know" (no invocation needed)
- It's a preference that applies passively to all interactions
- It's a one-liner that modifies existing behavior

## Five Detection Signals

Apply these to ALL learnings in every category — not just "Repeated Workflows".

### Signal 1: Complex Multi-Step Workflow (even once)

A workflow done once but with 4+ distinct steps, tool orchestration, and clear parameterizability is a stronger skill signal than a trivial 2-step action repeated 3 times.

**Indicators:**
- 4+ distinct steps in a consistent sequence
- Multiple tool types involved (Bash + Read + Edit + WebFetch, etc.)
- Clear parameterization points (URL, file path, name, format)
- Non-obvious ordering (steps depend on output of prior steps)

**Example from this ecosystem:**
- gdocs-to-md: parse URL → download via gog → convert via pandoc → extract images → report. This was a skill even though a user may do it only once per session.

**Anti-example:**
- "Read file, make edit, save" — too simple, too generic, no orchestration

### Signal 2: User Teaching a Sophisticated Process

When the user corrects Claude with detailed multi-step instructions, they're essentially dictating a skill workflow. This is the **highest-confidence signal** because the user has already designed the process.

**Indicators:**
- User correction includes 3+ specific sequential steps
- User says "whenever you do X, always do Y first, then Z"
- User explains a sequence that involves conditional logic
- User provides a complete recipe, not just a preference tweak

**Example:**
- User: "When iterating on a PR, always check CI first, then review comments, then read the actual failure logs before making changes" → This became the iterate-pr skill

**Contrast with CLAUDE.md:**
- User: "Always use pnpm, not npm" → Preference, goes to CLAUDE.md
- User: "When fixing CI, do X → Y → Z → W" → Skill

### Signal 3: Cross-Session Repetition Signals

Users often signal repetition across sessions even if it only occurs once in the current session.

**Verbal indicators (Japanese and English):**
- "I always do X..." / "毎回Xする..."
- "Every time I need to..." / "Xするたびに..."
- "This is a common task for me..." / "よくやる作業だけど..."
- "I do this in every project..." / "全プロジェクトでやる..."
- "Can you automate this workflow?" / "この作業を自動化できない？"
- "Is there a way to not have to explain this every time?" / "毎回説明しなくて済む方法は？"

**Contextual indicators:**
- The workflow relates to a recurring development phase (PR creation, deployment, code review, debugging)
- The task maps to a lifecycle event (project setup, release, maintenance)
- Similar tasks exist in the user's skill ecosystem (e.g., create-pr exists but no "create-issue")

### Signal 4: Tool Orchestration Pattern

Workflows that chain 2+ external tools in a non-obvious way are strong skill candidates because Claude cannot intuit the correct orchestration without explicit instructions.

**Indicators:**
- Chaining CLI tools with specific flags and pipe patterns
- Using MCP tools in a sequence (chrome-devtools → evaluate_script → screenshot)
- Combining file operations with external API calls
- Output of one tool feeds as input to the next

**Examples from this ecosystem:**
- gogcli: orchestrates gog CLI with specific subcommands and flags
- gdocs-to-md: chains gog → pandoc with media extraction
- codex-review: chains git diff → codex MCP → apply fixes → re-review loop

### Signal 5: Pattern Similar to Existing Successful Skills

If the detected workflow resembles an existing skill in structure, it's a strong candidate.

**Structural patterns in existing skills:**

| Pattern | Examples | Characteristics |
|---------|----------|-----------------|
| CLI wrapper | gogcli, tmux-sender | Wraps external CLI with correct flags/sequence |
| Lifecycle automation | create-pr, iterate-pr | Automates a development lifecycle phase |
| Analysis + action | session-retrospective, skill-improver | Analyzes context then proposes/applies changes |
| Interview + build | bash-policy-add, plan-deeper | Gathers info from user then constructs output |
| Format conversion | gdocs-to-md | Transforms input format to output format |
| Multi-tool orchestration | codex-review, qa-planner | Chains multiple tools in a reviewed workflow |

If the detected workflow matches one of these patterns, propose it as a skill.

## Borderline Cases: Skill vs CLAUDE.md

### Case 1: "Always run nix flake check before darwin-rebuild"
- **As CLAUDE.md**: One-line reminder → CLAUDE.md
- **As Skill**: Full workflow (edit → format → check → rebuild → verify → report) → Skill
- **Decision**: Both are valid. If only the reminder was observed, CLAUDE.md. If the full workflow was observed, propose a skill.

### Case 2: "Use gh CLI for GitHub URLs"
- **As CLAUDE.md**: Behavioral preference, applies passively → CLAUDE.md
- **As Skill**: Only if there's a multi-step gh workflow with orchestration
- **Decision**: CLAUDE.md. No orchestration involved.

### Case 3: "When reviewing code, first check PR diff, then read failing tests, then check coverage"
- **As CLAUDE.md**: Too procedural for a one-liner
- **As Skill**: Multi-step, involves tool orchestration, parameterizable (PR number)
- **Decision**: Skill. The user described a workflow, not a preference.

### Case 4: "User corrected commit message format three times"
- **As CLAUDE.md**: "Commit messages should be in Japanese" → one-line preference
- **As Skill**: Only if the full commit workflow is multi-step
- **Decision**: CLAUDE.md. The correction is about format, not process.

### Case 5: "Complex debugging session with specific tool chain"
- **As CLAUDE.md**: If the lesson is "check logs before guessing" → general principle
- **As Skill**: If the lesson is "run X → parse output → check Y → apply fix → verify" → workflow
- **Decision**: Depends on whether it's a principle (CLAUDE.md) or a procedure (skill).

### Case 6: "User explained how to set up a new Nix program module"
- **As CLAUDE.md**: If it's "create default.nix in programs/" → already documented
- **As Skill**: If the full process includes mkdir → write template → add config files → git add → darwin-rebuild → verify
- **Decision**: Skill candidate if the orchestration goes beyond what's already documented. Check existing CLAUDE.md first.

## Skill Proposal Template

When proposing a new skill, use this template to provide enough detail for evaluation:

```markdown
### Skill Proposal: [name]

**Invocation**: `/[name] [arguments]`
**When to use**: [one sentence describing the trigger scenario]

**Why a skill (not CLAUDE.md)**:
[1-2 sentences explaining what orchestration or multi-step process this encodes
that a CLAUDE.md line cannot capture]

**Workflow outline**:
1. [Step 1 — what tool, what action]
2. [Step 2 — what tool, what action]
3. [Step 3 — what tool, what action]
...

**Parameters**: [what would be parameterized — file path, URL, name, etc.]

**Similar to**: [existing skill with similar structure, if any]

**Estimated complexity**: [Simple (3-4 steps) / Medium (5-7 steps) / Complex (8+ steps)]
```

A proposal without a **Why a skill (not CLAUDE.md)** justification is incomplete. If you cannot articulate why CLAUDE.md is insufficient, it should be a CLAUDE.md entry.

### Strong justifications:
- "This is a 6-step workflow — a CLAUDE.md line can't capture the sequencing and conditional logic"
- "This involves orchestrating 3 external tools with specific flags — Claude won't remember the correct combination without a skill"
- "The user explicitly described this as a repeating workflow they want automated"

### Weak justifications (→ use CLAUDE.md instead):
- "This is useful information" (but no orchestration)
- "The user mentioned it multiple times" (but it's a preference, not a workflow)
- "It's complex" (but it's a one-off specific to this codebase)
