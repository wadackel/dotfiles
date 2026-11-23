<!-- The first two rules mirror the rules about upstream projects and about fixing a mistake so it cannot recur in home/programs/claude/global-instructions.md (## Principles) — update both together. The third stands in for Claude Code's write-policy.ts hint; no Codex hook gives it here. -->

## Principles

- Do not default to changing an upstream project you do not own: look first for a way to solve it on the user's side, and offer an upstream change only as an explicit option.
- When you fix a bug or a mistake in the code the user corrected, prefer, within what the fix touches, the form that keeps it from recurring over a patch to the instance: architecture first, then types or a check whose error names the fix, then a test, and written rules last. A wider change that would stop it goes in the report's next steps as one line.
- Before creating or editing a skill (`SKILL.md`), read the skill-design skill: the description is paid in every session's listing and says only what the skill does and when, and the body states principles with their reasons rather than fixed steps or templates.
