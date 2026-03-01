---
name: skill-improver
description: Improves existing Claude Code skill definitions by evaluating them against official best practices. Use when users want to improve, refine, review, or optimize a skill's quality, description, structure, or workflow. Triggers include "improve this skill", "review skill quality", "make this skill better", "スキルを改善して", "スキルの品質を上げて", "スキルをレビューして", or when skill definitions need refinement.
argument-hint: "[skill-name]"
---

# Skill Improver

Systematically improve Claude Code skills by evaluating them against official best practices from Claude Code documentation and the Agent Skills open standard.

## Overview

This skill helps refine existing skill definitions through a structured evaluation and improvement process. It references authoritative sources to ensure skills follow current best practices for triggering, structure, progressive disclosure, and workflow design.

## Authoritative Sources

This skill consults two authoritative sources for every improvement session:

1. **Claude Code Skills Documentation**: https://code.claude.com/docs/en/skills
2. **Agent Skills Specification**: https://agentskills.io/specification

These sources are fetched via WebFetch at the start of each session to ensure latest best practices are applied. If WebFetch fails, fallback to [references/specification-summary.md](references/specification-summary.md).

## Quick Start

```
/skill-improver [skill-name]
```

If no skill name is provided, you'll be prompted to select from available skills.

## Workflow

### Step 1: Fetch Latest Best Practices

**Always start by fetching the authoritative sources:**

```bash
# Fetch Claude Code documentation
WebFetch https://code.claude.com/docs/en/skills

# Fetch Agent Skills specification
WebFetch https://agentskills.io/specification
```

Parse these sources to extract:
- Frontmatter requirements and constraints
- Description best practices and trigger phrase patterns
- Progressive disclosure guidelines
- Workflow design patterns
- Common anti-patterns to avoid

**If WebFetch fails:**
- Read [references/specification-summary.md](references/specification-summary.md) as fallback
- Note to user that fallback was used and latest online docs may have updates

### Step 2: Identify Target Skill

**If $ARGUMENTS is provided:**
- Use it as the target skill name
- Verify the skill exists at `~/.claude/skills/$ARGUMENTS/` or `.claude/skills/$ARGUMENTS/`

**If no arguments:**
1. List available skills:
   ```bash
   # Personal skills
   ls -1 ~/.claude/skills/

   # Project skills (if in a project with .claude/skills/)
   ls -1 .claude/skills/
   ```

2. Present list to user and ask which to improve

**Validation:**
- Confirm the skill directory exists
- Verify SKILL.md is present
- If not found, report error and stop

### Step 3: Understand User's Needs

Ask the user about their improvement goals:

```
What would you like to improve about this skill?

Options:
- Triggering accuracy (skill doesn't activate when expected, or activates incorrectly)
- Description clarity (hard to understand when to use it)
- Content organization (verbose, hard to navigate, or unclear structure)
- Workflow design (steps unclear or confusing)
- Progressive disclosure (everything in SKILL.md, or references poorly organized)
- General quality review (evaluate everything)
- Specific issue: [user describes]
```

**Listen for:**
- Specific pain points (e.g., "it never triggers when I ask about PDFs")
- General concerns (e.g., "it feels too verbose")
- No specific issue (treat as general quality review)

**Record their response** to focus the evaluation and prioritize improvements.

### Step 4: Analyze Current Skill

**Read the skill files:**

```bash
# Main skill file
Read ~/.claude/skills/[skill-name]/SKILL.md

# Supporting files (if they exist)
ls -la ~/.claude/skills/[skill-name]/
Read [any references/, scripts/, assets/ files]
```

**Load evaluation framework:**

Read [references/evaluation-checklist.md](references/evaluation-checklist.md) to get the complete evaluation criteria.

**Perform systematic evaluation:**

For each of the 6 dimensions in the checklist:
1. Frontmatter Quality
2. Content Quality
3. Progressive Disclosure
4. Workflow Design
5. Structure and Organization
6. Invocation Control

Score 1-5 based on the criteria. Document specific issues found.

**Focus on user's stated needs:**
- If user mentioned specific issues, pay extra attention to those dimensions
- If general review, evaluate all dimensions equally
- Prioritize issues by impact (Critical > High > Medium > Low)

### Step 5: Present Improvement Plan

**Format the report clearly:**

```
## Skill Evaluation: [skill-name]

### Score Summary
- Frontmatter Quality: [X/5]
- Content Quality: [X/5]
- Progressive Disclosure: [X/5]
- Workflow Design: [X/5]
- Structure and Organization: [X/5]
- Invocation Control: [X/5]
**Total: [X/30]**

### Assessment
[Excellent (26-30) / Good (21-25) / Functional (16-20) / Needs Improvement (11-15) / Major Issues (6-10)]

### Issues Found

#### Critical (fix immediately)
1. [Issue description with file:line reference]

#### High (address soon)
1. [Issue description with file:line reference]

#### Medium (improve when convenient)
1. [Issue description with file:line reference]

### Recommended Improvements

#### Improvement 1: [Clear title]
**Priority:** [Critical/High/Medium/Low]
**Issue:** [What's wrong]
**Impact:** [Why it matters]

**Before:**
```yaml or markdown
[current problematic content]
```

**After:**
```yaml or markdown
[improved content]
```

**Rationale:** [Why this is better, citing best practices]

[Repeat for each improvement]
```

**Ask user which improvements to apply:**
- All improvements
- Specific improvements (let them choose)
- Skip (just wanted the evaluation)

### Step 6: Apply Improvements

**After user approval:**

For each approved improvement:

1. **Make the edits:**
   ```bash
   Edit ~/.claude/skills/[skill-name]/SKILL.md
   # or create/edit supporting files as needed
   ```

2. **Create supporting files if recommended:**
   - If progressive disclosure suggests splitting content, create `references/` files
   - If workflow needs scripts, create `scripts/` directory
   - Always reference new files from SKILL.md

3. **Preserve existing choices:**
   - Keep language (Japanese/English) as-is
   - Maintain author's voice and intent
   - Don't change more than necessary

**After all improvements applied:**

```
✅ Improvements applied to [skill-name]

Changes made:
- [List of edits]

Next steps:
1. Test the improved skill: /[skill-name] [test-prompt]
2. Validate with skill-tester: /skill-tester [skill-name]
3. Compare triggering accuracy with before/after prompts

Would you like me to run skill-tester to validate the changes?
```

**If user wants validation:**
- Offer to invoke `/skill-tester [skill-name]` to verify improvements
- Focus tests on the areas that were improved (e.g., if description was updated, test triggering)

## Evaluation Framework

See [references/evaluation-checklist.md](references/evaluation-checklist.md) for the complete evaluation criteria across 6 dimensions:

1. **Frontmatter Quality**: name format, description comprehensiveness, trigger phrases
2. **Content Quality**: Conciseness, clarity, formatting, time-sensitivity
3. **Progressive Disclosure**: SKILL.md as navigation, reference file organization
4. **Workflow Design**: Numbered steps, decision points, error handling, feedback loops
5. **Structure and Organization**: Quick start, logical flow, supporting resources
6. **Invocation Control**: Appropriate frontmatter settings for the use case

Each dimension is scored 1-5, with specific criteria for each score level.

## Tips for Effective Improvements

### Respect Existing Choices
- **Language**: Keep Japanese skills in Japanese, English skills in English
- **Voice**: Preserve the author's style and intent
- **Scope**: Only change what needs improving

### Prioritize Impact
- Fix Critical issues first (broken functionality, invalid formats)
- Address High issues next (poor triggering, unclear workflows)
- Medium issues can wait (verbosity, minor organizational improvements)
- Low issues are nice-to-have (additional examples, minor formatting)

### Focus on High-Impact Areas

**Description improvements often have the highest impact:**
- Adding missing trigger phrases fixes false negatives
- Narrowing scope fixes false positives
- Making WHEN explicit helps Claude understand context

**Progressive disclosure improvements save tokens:**
- Moving 200 lines of reference material to a separate file keeps SKILL.md focused
- Users see faster loading and clearer navigation
- Context window pressure is reduced

**Workflow clarity improvements reduce confusion:**
- Numbered steps make sequences obvious
- Explicit decision points guide Claude through branching logic
- Error handling prevents Claude from getting stuck

### Use Before/After Examples

Always show concrete before/after for improvements:
- Makes the change clear and actionable
- Helps user understand the rationale
- Demonstrates best practices in context

### Cite Best Practices

Reference the authoritative sources when explaining why:
- "According to Claude Code docs, descriptions should be in third person"
- "Agent Skills spec recommends keeping file references one level deep"
- "Platform best practices suggest SKILL.md under 500 lines"

This builds confidence and helps users learn the principles.

## Common Improvement Patterns

See [references/improvement-patterns.md](references/improvement-patterns.md) for concrete before/after examples of the most frequent improvements:

- Vague → Specific description
- Missing progressive disclosure
- Over-explained content
- Unclear workflow
- Missing trigger phrases

## Related Skills

- **skill-tester**: Validate improvements by testing the skill's triggering and functionality
- **gemini-research**: Research latest skill authoring trends (if desired)
- **skill-creator**: For creating new skills from scratch

## Troubleshooting

### WebFetch fails for authoritative sources

**Solution:** Read [references/specification-summary.md](references/specification-summary.md) as fallback. Inform user that local cached specifications are being used.

### Skill not found

**Solution:**
- Check spelling of skill name
- Verify skill location (personal vs. project)
- List available skills again

### User wants to improve skill-improver itself

**Solution:** This is valid! Use the same workflow on this skill. Reference the evaluation checklist and apply improvements. This is a good integration test.

### Improvements break existing functionality

**Solution:**
- Revert the changes
- Analyze what went wrong
- Apply more conservative improvements
- Test incrementally

### User disagrees with evaluation

**Solution:**
- Explain rationale citing best practices
- Respect user's judgment on subjective matters
- Skip improvements they don't want
- Focus on objective criteria (format requirements, best practices)
