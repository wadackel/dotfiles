# Gemini Research Prompt Templates

This file contains effective prompt templates for different research scenarios using Gemini CLI.

## Repository Analysis Prompts

### Large Codebase Structure Analysis
```
Analyze the structure and architecture of this codebase:

Directory: [TARGET_DIRECTORY]

Focus on:
- Overall architecture and design patterns
- Key components and their relationships
- Technology stack and frameworks used
- Testing strategy and coverage
- Build and deployment setup

Provide a concise summary that helps understand the codebase organization.
```

### Test Framework Assessment
```
Analyze the testing infrastructure in this repository:

Directory: [TARGET_DIRECTORY]

Examine:
- Test frameworks and libraries currently used
- Test file organization and naming conventions
- Test coverage and quality
- Testing patterns and best practices
- Areas that need improvement

Summarize the current state and suggest migration/improvement strategies if needed.
```

### Dependency Analysis
```
Analyze the dependencies in this project:

Files to examine: package.json, Cargo.toml, requirements.txt, etc.

For each major dependency:
- Current version and latest stable version
- Known security issues or deprecations
- Migration considerations for updates
- Alternative libraries if applicable

Prioritize findings by impact and urgency.
```

## Library Research Prompts

### Library Selection and Comparison
```
Research and compare libraries for [SPECIFIC_USE_CASE]:

Requirements:
- [REQUIREMENT_1]
- [REQUIREMENT_2]
- [REQUIREMENT_3]

For each candidate library, provide:
- Current adoption and community support
- Key features and limitations
- Integration complexity
- Performance characteristics
- Known issues or concerns

Recommend the best option with rationale.
```

### Library Usage and Best Practices
```
Research how to effectively use [LIBRARY_NAME] (version [VERSION]):

Focus areas:
- Getting started guide
- Common usage patterns and examples
- Best practices and anti-patterns
- Integration with [EXISTING_STACK]
- Gotchas and known issues

Provide practical guidance for implementation.
```

### Library Migration Guide
```
Research migration path from [OLD_LIBRARY] to [NEW_LIBRARY]:

Context:
- Current usage: [DESCRIBE_CURRENT_USAGE]
- Target version: [NEW_LIBRARY_VERSION]

Analyze:
- Breaking changes and API differences
- Migration steps and strategies
- Code patterns that need updating
- Testing considerations
- Common pitfalls during migration

Provide actionable migration plan.
```

## Error Investigation Prompts

### Error Message Resolution
```
Investigate this error and find solutions:

Error message:
[FULL_ERROR_MESSAGE]

Context:
- Language/Framework: [CONTEXT]
- Environment: [OS, VERSION, etc.]
- What was attempted: [DESCRIPTION]

Search for:
- Root cause of the error
- Known issues in GitHub/Stack Overflow
- Proven solutions and workarounds
- Related error patterns

Provide concrete steps to resolve.
```

### Build/Deployment Issue Research
```
Research solutions for this build/deployment issue:

Issue description:
[DETAILED_DESCRIPTION]

Environment:
- Build tool: [TOOL_NAME]
- Target platform: [PLATFORM]
- Recent changes: [CHANGES_IF_ANY]

Investigate:
- Similar issues reported online
- Configuration problems
- Environment-specific gotchas
- Known bugs or limitations

Suggest debugging steps and fixes.
```

### Performance Issue Investigation
```
Research performance optimization for:

Symptom:
[PERFORMANCE_ISSUE_DESCRIPTION]

Metrics:
- [METRIC_1]: [VALUE]
- [METRIC_2]: [VALUE]

Stack:
- [TECHNOLOGY_STACK]

Find:
- Common performance bottlenecks in this stack
- Profiling and debugging techniques
- Optimization strategies and benchmarks
- Success stories and case studies

Provide optimization roadmap.
```

## Documentation and API Research

### API Usage Research
```
Research how to use this API:

API: [API_NAME]
Documentation: [URL_IF_AVAILABLE]

Needed functionality:
- [FUNCTIONALITY_1]
- [FUNCTIONALITY_2]

Find:
- Official API documentation
- Code examples and tutorials
- Authentication and setup
- Rate limits and best practices
- Common issues and solutions

Provide implementation guide.
```

### Framework Feature Research
```
Research [FEATURE_NAME] in [FRAMEWORK]:

Requirements:
- [SPECIFIC_REQUIREMENT]

Investigate:
- Official documentation and guides
- Community best practices
- Code examples from real projects
- Performance considerations
- Compatibility and limitations

Summarize with actionable insights.
```

## Web Search Best Practices

When using Gemini CLI with Google Search integration:

1. **Be specific**: Include version numbers, error codes, and exact terminology
2. **Use structured queries**: Frame as questions or targeted searches
3. **Request recent information**: Specify "latest" or "2026" for current best practices
4. **Ask for comparisons**: "Compare X vs Y" yields rich insights
5. **Seek community consensus**: Ask for "common solutions" or "best practices"
6. **Include context**: Mention your stack/environment for relevant results

## Output Format Preferences

For JSON output (when using `--output-format json`):

```bash
gemini -p "YOUR_PROMPT" --output-format json
```

This allows Claude Code to parse results programmatically and extract key findings efficiently.
