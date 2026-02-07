# Routing Logic

This document provides the complete decision tree for routing session learnings to the appropriate target: project CLAUDE.md, global ~/.claude/CLAUDE.md, or skill proposals.

## Decision Tree

For each categorized learning, follow this decision tree:

```
1. Is this learning project-specific?
   └─ YES → Route to PROJECT CLAUDE.md
   └─ NO → Continue to step 2

2. Is this learning universal/cross-project?
   └─ YES → Route to GLOBAL ~/.claude/CLAUDE.md
   └─ NO → Continue to step 3

3. Is this a repeated workflow (2+ times, 3+ steps)?
   └─ YES → Continue to step 4
   └─ NO → Skip (too specific or one-off)

4. Does an existing skill already cover this workflow?
   └─ YES → Route to SKILL MODIFICATION proposal
   └─ NO → Route to NEW SKILL proposal

5. Is this tool-specific knowledge for an existing skill?
   └─ YES → Route to SKILL MODIFICATION proposal
   └─ NO → Route to appropriate CLAUDE.md (step 1-2)
```

## Rules for Determining Project-Specific vs Universal

### Project-Specific Indicators

A learning is **project-specific** if it:

**Contains project-specific references:**
- Mentions specific file paths in the project (e.g., "src/components/", "config/database.yml")
- References project directory structure
- Mentions project-specific module or package names

**Uses project-specific tools or commands:**
- Build commands unique to this project (e.g., "pnpm workspace:build")
- Test commands with project-specific flags (e.g., "npm run test:e2e -- --env=staging")
- Deployment commands for this project's infrastructure

**Describes project-specific conventions:**
- Naming conventions used only in this project
- File organization patterns specific to this codebase
- Project-specific code style or architecture

**Relates to project-specific technology versions:**
- Framework versions used only in this project (e.g., "React 19 is used in this project")
- Library versions specific to this project's dependencies

**Examples:**
- ✅ "This repository uses pnpm workspaces, not npm"
- ✅ "Tests run with `npm run test:unit` in this project"
- ✅ "The API server runs on port 3001 (not 3000)"
- ✅ "Always run `nix flake check` before `darwin-rebuild switch` in this dotfiles repo"

### Universal/Cross-Project Indicators

A learning is **universal** if it:

**Applies to the user's general coding style:**
- Code formatting preferences (e.g., "Prefer named exports over default exports")
- Commenting style (e.g., "Add JSDoc for all exported functions")
- Design patterns (e.g., "Use composition over inheritance")

**Relates to tools used across all projects:**
- git usage patterns (e.g., "Always check git status before commits")
- GitHub CLI preferences (e.g., "Use `gh` for GitHub URLs, not WebFetch")
- Editor or IDE preferences (e.g., "Use Neovim for text editing")

**Describes Claude's general behavior:**
- When to use subagents (e.g., "Use Explore subagent for codebase exploration")
- Communication preferences (e.g., "User prefers concise responses")
- Tool selection patterns (e.g., "Use Edit tool for file modifications, not sed")

**Applies to general programming knowledge:**
- Language-agnostic best practices (e.g., "Validate input at system boundaries")
- Security principles (e.g., "Never commit secrets to git")
- Performance patterns (e.g., "Prefer iteration over recursion for large datasets")

**Examples:**
- ✅ "Use `gh` CLI for GitHub URLs instead of WebFetch (private repos)"
- ✅ "Always use Explore subagent for codebase exploration, not direct Grep"
- ✅ "User prefers Japanese for user-facing text, English for code"
- ✅ "Commit messages should be in Japanese, not English"

## Rules for Skill Proposals

### When to Propose a New Skill

Propose a new skill when:

**Repetition threshold met:**
- Workflow was performed 2+ times in the session
- Each occurrence followed the same basic structure

**Sufficient complexity:**
- Involves 3 or more distinct steps
- Each step requires a different tool or operation
- Not trivial enough to be a single command

**Generalizable:**
- Can be parameterized for different inputs
- Applies to multiple scenarios, not just this one-off case
- Would be useful in future sessions

**No existing skill covers it:**
- Checked ~/.claude/skills/ and found no match
- Existing skills are too narrow or too broad
- This workflow has unique characteristics

**Examples of new skill proposals:**
- ✅ "Edit Nix file → nix flake check → darwin-rebuild switch" (repeated 3 times)
- ✅ "Check CI → read logs → identify failure → fix → push → wait" (repeated 2 times)
- ❌ "Read file → make one edit → save" (too simple, only 1 occurrence)
- ❌ "Complex 10-step process" (only happened once, too specific)

### When to Propose Skill Modification

Propose a skill modification when:

**Existing skill was used but missing information:**
- Skill was invoked during the session
- Claude had to look up additional information not in the skill
- The missing information would have helped

**Existing skill's workflow needed adjustment:**
- Skill's steps were correct but incomplete
- User corrected the skill's approach
- A better workflow pattern was discovered

**Existing skill's description didn't trigger properly:**
- User had to manually invoke the skill when it should have triggered
- Description is missing key trigger phrases
- Skill's use case wasn't clear from description

**Tool-specific knowledge applies to existing skill:**
- Learning is about a tool that an existing skill uses
- The knowledge would improve the skill's effectiveness
- Adding it to the skill is better than CLAUDE.md

**Examples of skill modification proposals:**
- ✅ skill-improver: Add "スキルを改善して" trigger phrase
- ✅ playwright-cli: Add note about checking session-list first
- ✅ gemini-research: Clarify that it's for research only, not implementation
- ❌ Generic git usage: Not specific to any skill, goes to CLAUDE.md

## Edge Cases and Ambiguity

### Learning Could Go to Multiple Targets

**General rule:** Choose the most specific, most actionable target.

**Example 1:** "Use Explore subagent for codebase exploration"
- Could be: Global CLAUDE.md (general Claude behavior)
- Could be: Multiple skill modifications (any skill that explores code)
- **Decision:** Global CLAUDE.md (broader applicability, affects all workflows)

**Example 2:** "playwright-cli requires session-list to be run first"
- Could be: Global CLAUDE.md (tool knowledge)
- Could be: playwright-cli skill modification (tool-specific)
- **Decision:** playwright-cli skill modification (more specific, users already using the skill will benefit)

**Example 3:** "Always run nix flake check before darwin-rebuild"
- Could be: Project CLAUDE.md (this is a Nix project)
- Could be: New skill proposal (repeated workflow)
- **Decision:** Both! Add to project CLAUDE.md AND propose skill if workflow was repeated

### Uncertain if Project-Specific or Universal

**Default to project-specific** when uncertain:
- It's easier to generalize later than to make specific
- Project CLAUDE.md is read when working in that project
- Global CLAUDE.md should only have truly universal patterns

**Heuristic:** If in doubt, ask:
- "Would this apply to a completely different project/codebase?"
- If NO → Project-specific
- If YES → Universal

### Uncertain if Workflow is Generalizable

**Default to requiring clear generalizability:**
- If the workflow involved very project-specific steps → Don't propose a skill
- If the workflow was only done once → Don't propose a skill
- If unsure whether it would apply to other cases → Don't propose a skill

**Heuristic:** A workflow is generalizable if:
- You can imagine parameterizing it (e.g., "file path", "target environment")
- It would be useful in different projects
- The steps are transferable, not hard-coded to this specific case

## Language Matching for CLAUDE.md Additions

When proposing additions to CLAUDE.md files:

**Read the target file first:**
- Determine the primary language (Japanese or English)
- Note if different sections use different languages

**Match the language:**
- If file is primarily Japanese → Write proposal in Japanese
- If file is primarily English → Write proposal in English
- If file is mixed → Match the language of the relevant section

**Examples:**
- User's ~/.claude/CLAUDE.md is in Japanese → Proposals in Japanese
- Project CLAUDE.md is in English → Proposals in English
- Project CLAUDE.md has Japanese headers but English content → Match section language

## Validation Checklist

Before finalizing routing decisions, verify:

- [ ] Read the target CLAUDE.md file (if proposing addition)
- [ ] Confirmed the learning doesn't already exist in the target
- [ ] Checked ~/.claude/skills/ for potentially related skills
- [ ] Applied the decision tree consistently
- [ ] Language of proposal matches target file
- [ ] Proposal is concise (one line for CLAUDE.md entries)
- [ ] Placement in target file is specified (after which section)

## Routing Summary Table

| Learning Category | Default Target | Alternative Target | Condition |
|-------------------|----------------|-------------------|-----------|
| Missing Context | Project CLAUDE.md | Global CLAUDE.md | If universal |
| Corrected Approaches | Global CLAUDE.md | Project CLAUDE.md | If project-specific |
| Repeated Workflows | New Skill | Skill Modification | If existing skill covers it |
| Tool/Library Knowledge | Project/Global CLAUDE.md | Skill Modification | If related to existing skill |
| Preference Patterns | Global CLAUDE.md | Rarely project CLAUDE.md | Almost always universal |
