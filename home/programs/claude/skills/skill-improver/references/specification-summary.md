# Skill Specification Summary

This document provides a compact summary of key specifications from both Agent Skills standard and Claude Code documentation. Use this as a fallback reference when WebFetch is unavailable.

## Agent Skills Core Specification

### Required Fields

**name**:
- Required
- 1-64 characters
- Lowercase alphanumeric characters and hyphens only (a-z, 0-9, -)
- Must not start or end with hyphen
- Must not contain consecutive hyphens (--)
- Must match parent directory name

**description**:
- Required
- 1-1024 characters
- Non-empty
- Should describe both WHAT the skill does and WHEN to use it
- Should include specific trigger phrases and keywords

### Optional Fields

**license**: License name or reference to bundled license file

**compatibility**: Max 500 characters. Indicates environment requirements (intended product, system packages, network access, etc.)

**metadata**: Arbitrary key-value mapping for additional metadata

**allowed-tools**: Space-delimited list of pre-approved tools (experimental)

### File Structure

```
skill-name/
├── SKILL.md (required)
├── scripts/ (optional - executable code)
├── references/ (optional - documentation)
└── assets/ (optional - templates, resources)
```

### Progressive Disclosure Model

1. **Metadata** (~100 tokens): name + description, always loaded
2. **Instructions** (<5000 tokens): Full SKILL.md body, loaded when skill activates
3. **Resources** (as needed): Additional files loaded only when required

### File Reference Best Practices

- Keep file references one level deep from SKILL.md
- Avoid deeply nested reference chains (SKILL.md → file1.md → file2.md)
- Use relative paths from skill root
- Reference files explicitly in SKILL.md so Claude knows what they contain

## Claude Code Extensions

Claude Code extends the Agent Skills standard with additional frontmatter fields:

### Additional Frontmatter Fields

**argument-hint**: Hint shown during autocomplete (e.g., "[issue-number]", "[filename] [format]")

**disable-model-invocation**:
- true|false (default: false)
- Set to true to prevent Claude from automatically loading this skill
- Use for workflows you want to trigger manually (e.g., /commit, /deploy)

**user-invocable**:
- true|false (default: true)
- Set to false to hide from the / menu
- Use for background knowledge users shouldn't invoke directly

**model**: Override model to use when this skill is active

**context**: Set to "fork" to run in a forked subagent context

**agent**: Which subagent type to use when context: fork is set

**hooks**: Hooks scoped to this skill's lifecycle

### String Substitutions

Available in SKILL.md content:

- `$ARGUMENTS`: All arguments passed when invoking the skill
- `$ARGUMENTS[N]` or `$N`: Specific argument by 0-based index
- `${CLAUDE_SESSION_ID}`: Current session ID

### Dynamic Context Injection

Use `` !`command` `` syntax to run shell commands before skill content is sent to Claude. The command output replaces the placeholder.

Example:
```markdown
## Pull request context
- PR diff: !`gh pr diff`
- PR comments: !`gh pr view --comments`
```

## Best Practices Summary

### Description Writing

- **Always write in third person** (not "I can help" or "You can use")
- Include both WHAT and WHEN
- Add specific trigger phrases users would naturally say
- Be comprehensive but concise (max 1024 chars)

Good example:
```yaml
description: Extracts text and tables from PDF files, fills forms, and merges documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
```

Bad example:
```yaml
description: Helps with documents
```

### Content Guidelines

- **Concise is key**: Only add context Claude doesn't already have
- Keep SKILL.md body under 500 lines
- Move detailed reference material to separate files
- Assume Claude knows well-known concepts
- Use consistent terminology throughout
- Avoid time-sensitive information
- Use forward slashes for all file paths

### Progressive Disclosure Patterns

**Pattern 1: High-level guide with references**
```markdown
## Quick start
[Basic example]

## Advanced features
- **Feature 1**: See [FEATURE1.md](FEATURE1.md)
- **Feature 2**: See [FEATURE2.md](FEATURE2.md)
```

**Pattern 2: Domain-specific organization**
```
skill/
├── SKILL.md (overview)
└── references/
    ├── domain1.md
    ├── domain2.md
    └── domain3.md
```

### Workflow Design

- Use numbered steps for sequential workflows
- Make decision points explicit
- Include error handling guidance
- Add feedback loops for quality-critical tasks
- Set appropriate degrees of freedom:
  - High (text instructions): Multiple approaches valid
  - Medium (pseudocode): Preferred pattern exists
  - Low (specific scripts): Operations fragile, consistency critical

### Naming Conventions

Recommended: Use gerund form (verb + -ing)
- `processing-pdfs`
- `analyzing-spreadsheets`
- `managing-databases`

Acceptable alternatives:
- Noun phrases: `pdf-processing`
- Action-oriented: `process-pdfs`

Avoid:
- Vague names: `helper`, `utils`, `tools`
- Overly generic: `documents`, `data`
- Reserved words: `anthropic-helper`, `claude-tools`

## Common Anti-Patterns to Avoid

1. **Windows-style paths**: Use forward slashes, not backslashes
2. **Too many options**: Provide a default with escape hatch, not a list of 5 alternatives
3. **Over-explained content**: Don't explain well-known concepts
4. **Vague descriptions**: Include specific trigger phrases and keywords
5. **Missing progressive disclosure**: Don't put everything in SKILL.md
6. **Inconsistent terminology**: Choose one term and use it throughout
7. **Time-sensitive information**: Avoid "before August 2025" style statements
8. **Deeply nested references**: Keep references one level deep

## Validation Quick Check

Before finalizing a skill:

- [ ] name: lowercase, hyphens only, max 64 chars, matches directory
- [ ] description: includes WHAT and WHEN, third person, under 1024 chars
- [ ] SKILL.md body: under 500 lines
- [ ] File references: one level deep
- [ ] Consistent terminology throughout
- [ ] No Windows-style paths
- [ ] No time-sensitive information
- [ ] Appropriate progressive disclosure
