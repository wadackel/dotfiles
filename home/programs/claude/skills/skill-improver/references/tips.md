# Tips for Effective Improvements

## Respect Existing Choices
- **Language**: Keep Japanese skills in Japanese, English skills in English
- **Voice**: Preserve the author's style and intent
- **Scope**: Only change what needs improving

## Prioritize Impact
- Fix Critical issues first (broken functionality, invalid formats)
- Address High issues next (poor triggering, unclear workflows)
- Medium issues can wait (verbosity, minor organizational improvements)
- Low issues are nice-to-have (additional examples, minor formatting)

## Focus on High-Impact Areas

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

## Use Before/After Examples

Always show concrete before/after for improvements:
- Makes the change clear and actionable
- Helps user understand the rationale
- Demonstrates best practices in context

## Cite Best Practices

Reference the authoritative sources when explaining why:
- "According to Claude Code docs, descriptions should be in third person"
- "Agent Skills spec recommends keeping file references one level deep"
- "Platform best practices suggest SKILL.md under 500 lines"

This builds confidence and helps users learn the principles.
