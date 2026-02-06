# Skill Evaluation Checklist

This checklist consolidates evaluation criteria from Claude Code documentation, Agent Skills specification, and platform best practices. Use it to systematically evaluate skill quality.

## Evaluation Dimensions

### 1. Frontmatter Quality (Score: 1-5)

#### name Field
- [ ] Lowercase letters, numbers, and hyphens only
- [ ] 1-64 characters
- [ ] No consecutive hyphens (--)
- [ ] Does not start or end with hyphen
- [ ] Matches parent directory name
- [ ] No reserved words (anthropic, claude)
- [ ] Uses consistent naming pattern (gerund form recommended)

#### description Field
- [ ] Non-empty, 1-1024 characters
- [ ] Written in third person (not "I can" or "You can")
- [ ] Includes WHAT the skill does
- [ ] Includes WHEN to use it (trigger conditions)
- [ ] Contains specific trigger phrases users would naturally say
- [ ] Includes relevant keywords for discovery
- [ ] Avoids vague terms ("helps with", "does stuff", "works with")
- [ ] Comprehensive enough for Claude to understand when to activate

#### Optional Fields (if present)
- [ ] allowed-tools: Correctly scoped and formatted
- [ ] disable-model-invocation: Appropriate for the skill's use case
- [ ] user-invocable: Appropriate for the skill's use case
- [ ] context: "fork" used appropriately (if applicable)
- [ ] agent: Valid subagent type specified (if context: fork)
- [ ] Other fields are valid and correctly used

**Scoring Guide:**
- 5: Excellent - All criteria met, description is comprehensive and precise
- 4: Good - Minor improvements possible (e.g., could add more trigger phrases)
- 3: Functional - Meets requirements but has room for improvement
- 2: Significant gaps - Missing key elements (e.g., description lacks WHEN)
- 1: Critical issues - Invalid format or severely incomplete

---

### 2. Content Quality (Score: 1-5)

#### Conciseness
- [ ] Body is under 500 lines
- [ ] Only includes context Claude doesn't already have
- [ ] No unnecessary explanations of well-known concepts
- [ ] Avoids over-explaining basic operations
- [ ] Each paragraph justifies its token cost

#### Clarity
- [ ] Consistent terminology throughout (no synonym mixing)
- [ ] Clear, specific instructions
- [ ] Examples are concrete, not abstract
- [ ] Technical terms defined when necessary

#### Formatting
- [ ] File paths use forward slashes (not backslashes)
- [ ] Code blocks are properly formatted
- [ ] Markdown structure is logical

#### Time-Sensitivity
- [ ] No time-sensitive information (e.g., "before August 2025")
- [ ] OR uses "old patterns" section for deprecated approaches
- [ ] Future-proof language

**Scoring Guide:**
- 5: Excellent - Concise, clear, well-formatted
- 4: Good - Minor verbosity or clarity issues
- 3: Functional - Some unnecessary content or inconsistent terminology
- 2: Significant gaps - Verbose, confusing, or poorly formatted
- 1: Critical issues - Extremely verbose, unclear, or broken formatting

---

### 3. Progressive Disclosure (Score: 1-5)

#### Main SKILL.md
- [ ] Serves as overview/navigation
- [ ] Points to detailed resources with clear descriptions
- [ ] Doesn't duplicate information that's in reference files
- [ ] Under 500 lines (ideally 200-300)

#### Reference Files (if applicable)
- [ ] Referenced files exist and are properly linked
- [ ] Links use relative paths from skill root
- [ ] File references are one level deep (not nested)
- [ ] Each reference file has a clear purpose stated in SKILL.md
- [ ] Reference files are focused and well-organized
- [ ] Longer reference files (>100 lines) have table of contents

#### Scripts/Assets (if applicable)
- [ ] Purpose and usage clearly documented in SKILL.md
- [ ] Scripts have explicit error handling
- [ ] Assets are referenced appropriately

**Scoring Guide:**
- 5: Excellent - Perfect progressive disclosure, optimal token efficiency
- 4: Good - Well-structured, minor optimization possible
- 3: Functional - Some progressive disclosure, but could be better organized
- 2: Significant gaps - Limited use of references, or poorly organized
- 1: Critical issues - No progressive disclosure, everything in SKILL.md

---

### 4. Workflow Design (Score: 1-5)

#### Structure
- [ ] Steps are numbered and sequential
- [ ] Logical ordering (most important information first)
- [ ] Decision points are clearly marked
- [ ] Conditional logic is explicit with examples

#### Completeness
- [ ] Error handling is addressed
- [ ] Edge cases are considered
- [ ] Feedback loops included for quality-critical tasks
- [ ] Exit conditions are clear

#### Degrees of Freedom
- [ ] Appropriate level of specificity for task fragility
- [ ] High freedom (text) for flexible tasks
- [ ] Medium freedom (pseudocode) for preferred patterns
- [ ] Low freedom (specific scripts) for fragile operations

**Scoring Guide:**
- 5: Excellent - Clear workflow with appropriate detail level
- 4: Good - Well-structured, minor clarity improvements possible
- 3: Functional - Basic workflow present, some steps unclear
- 2: Significant gaps - Workflow hard to follow or incomplete
- 1: Critical issues - No clear workflow or severely broken

---

### 5. Structure and Organization (Score: 1-5)

#### Essential Sections
- [ ] Quick start section near the top
- [ ] Overview/purpose clearly stated
- [ ] Workflow or usage instructions
- [ ] Examples provided where helpful

#### Logical Flow
- [ ] Sections in logical order
- [ ] Related content grouped together
- [ ] Easy to scan and navigate
- [ ] Important information is prominent

#### Supporting Resources
- [ ] Scripts solve problems rather than punt to Claude (if applicable)
- [ ] Reference files are well-organized (if applicable)
- [ ] Assets are properly documented (if applicable)

**Scoring Guide:**
- 5: Excellent - Intuitive structure, easy to navigate
- 4: Good - Well-organized, minor improvements possible
- 3: Functional - Basic structure present, could be more intuitive
- 2: Significant gaps - Confusing organization or missing key sections
- 1: Critical issues - No clear structure or severely disorganized

---

### 6. Invocation Control (Score: 1-5)

#### Appropriate Settings
- [ ] disable-model-invocation: true for side-effect operations (deploy, commit, etc.)
- [ ] user-invocable: false for background knowledge (if applicable)
- [ ] context: fork used when isolation is needed (if applicable)
- [ ] Invocation method matches skill purpose

#### Consistency
- [ ] Description matches actual invocation behavior
- [ ] Frontmatter fields align with documented workflow
- [ ] No conflicting settings

**Scoring Guide:**
- 5: Excellent - Perfect invocation control for the use case
- 4: Good - Appropriate settings, minor optimization possible
- 3: Functional - Reasonable settings, but could be optimized
- 2: Significant gaps - Settings don't match use case well
- 1: Critical issues - Incorrect settings causing problems

---

## Overall Assessment

After scoring each dimension, calculate:

**Total Score**: Sum of all 6 dimensions (max 30)

**Assessment**:
- 26-30: Excellent skill following best practices
- 21-25: Good skill with minor improvements possible
- 16-20: Functional skill with room for improvement
- 11-15: Significant gaps requiring improvements
- 6-10: Major issues requiring substantial rework

## Priority of Improvements

When identifying improvements, prioritize by impact:

1. **Critical (fix immediately)**:
   - Invalid frontmatter format
   - Broken file references
   - Description doesn't match functionality
   - Workflow fundamentally broken

2. **High (address soon)**:
   - Missing trigger phrases in description
   - No progressive disclosure (everything in SKILL.md)
   - Confusing workflow or unclear steps
   - Inconsistent terminology

3. **Medium (improve when convenient)**:
   - Verbose content that could be condensed
   - Missing examples or edge cases
   - Suboptimal invocation control settings
   - Minor organizational issues

4. **Low (nice to have)**:
   - Additional trigger phrases for edge cases
   - More examples
   - Minor formatting improvements
   - Documentation enhancements

## Common Issues by Dimension

### Frontmatter Issues
- Description too vague or generic
- Missing trigger phrases
- Not written in third person
- Name doesn't follow conventions

### Content Issues
- Over-explaining well-known concepts
- Inconsistent terminology
- Verbose without adding value
- Time-sensitive information

### Progressive Disclosure Issues
- Everything crammed into SKILL.md
- No use of reference files
- Deeply nested references
- Poor file organization

### Workflow Issues
- Steps not numbered
- Decision points unclear
- No error handling
- Missing feedback loops

### Structure Issues
- No quick start section
- Illogical ordering
- Hard to scan
- Missing examples

### Invocation Control Issues
- Manual-only skill without disable-model-invocation: true
- Background knowledge without user-invocable: false
- context: fork when not needed
- Settings don't match purpose
