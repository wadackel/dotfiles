# Code Review with Codex CLI - Examples

## Example 1: Plan review

```bash
# 1. Collect file paths (not contents)
#    - Plan file: ./plan.md
#    - Guidelines: ./CLAUDE.md
#    - Related source: src/auth/middleware.ts, src/auth/types.ts

# 2. Start review (read-only sandbox, Codex reads files locally)
codex exec -s read-only "
You are an experienced senior architect. Review the implementation plan below.

## Files to read
- Implementation plan: ./plan.md
- Project guidelines: ./CLAUDE.md
- Related source code: src/auth/middleware.ts, src/auth/types.ts

## Review criteria
- Approach validity
- Technology selection appropriateness
- Risks and alternatives
- Guideline compliance
- Scalability and maintainability

Provide your review in this format:
1. Overall assessment (Approved / Conditionally Approved / Needs Rework)
2. Strengths (good design decisions)
3. Concerns (areas needing improvement)
4. Alternatives (if any)
5. Recommended actions
"

# 3. Analyze and report results to user
```

## Example 2: Code review with auto-fix loop

```bash
# 1a. Standard review (default criteria, Codex auto-reads uncommitted changes)
codex exec review --uncommitted --full-auto

# 1b. OR: Custom criteria review (use `codex exec` to combine scope + criteria)
codex exec --full-auto "
You are a strict senior code reviewer.
Review the uncommitted changes (run git diff to see them).

## Reference files
- Project guidelines: ./CLAUDE.md

## Review criteria
- Code quality (readability, maintainability, naming conventions)
- Security (OWASP Top 10, input validation)
- Performance (algorithm efficiency, async patterns)
- Guideline compliance
- Test coverage
- Error handling

For each issue, include:
1. File name and line number
2. Problem description
3. Severity (Critical/High/Medium/Low)
4. Suggested fix
"

# 2. Apply fixes based on review feedback
# (Use Edit/Write tools to fix issues identified by Codex)

# 3. Follow-up review (max 5 iterations)
codex exec resume --last --full-auto "
Applied fixes for the identified issues. Please re-review.
"

# 4. Repeat steps 2-3 until no issues remain or max iterations reached
# If same issues persist after 3 attempts, stop and ask user for guidance
```

## Example 3: Security-focused review

```bash
# Security review with focused criteria (use `codex exec` for custom prompt)
codex exec --full-auto "
Conduct a security review of the uncommitted changes.
Run git diff to see the changes.

## Reference files
- Project guidelines: ./CLAUDE.md

## Security checklist (priority order)
1. **OWASP Top 10**: SQL injection, XSS, CSRF, authentication flaws
2. **Input validation**: Sanitization and validation of all external inputs
3. **Sensitive data**: Safe handling of passwords, tokens, API keys
4. **Auth/authz**: Proper permission checks and session management
5. **Encryption**: Encryption in transit and at rest
6. **Error handling**: Prevent leakage of sensitive information
7. **Dependencies**: Use of libraries with known vulnerabilities

Report Critical/High severity issues first.
"
```
