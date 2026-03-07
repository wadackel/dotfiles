# Troubleshooting

## WebFetch fails for authoritative sources

**Solution:** Read [references/specification-summary.md](specification-summary.md) as fallback. Inform user that local cached specifications are being used.

## Skill not found

**Solution:**
- Check spelling of skill name
- Verify skill location (personal vs. project)
- List available skills again

## User wants to improve skill-improver itself

**Solution:** This is valid! Use the same workflow on this skill. Reference the evaluation checklist and apply improvements. This is a good integration test.

## Improvements break existing functionality

**Solution:**
- Revert the changes
- Analyze what went wrong
- Apply more conservative improvements
- Test incrementally

## User disagrees with evaluation

**Solution:**
- Explain rationale citing best practices
- Respect user's judgment on subjective matters
- Skip improvements they don't want
- Focus on objective criteria (format requirements, best practices)
