<!-- Mirror of the comment rules in home/programs/claude/CLAUDE.md (Design Principles) — update both together. -->

## Code Comment Conventions

- Comments must document "Why not" only — why an obvious alternative was rejected, or why the seemingly natural approach is a trap. Do not write comments that explain what the code does, restate obvious why, or describe current behavior.
- Do not prefix comments with `Why-Not:`, `Why:`, `Note:`, or similar machine-like labels. The comment body itself is the explanation; a label only adds noise.
- Do not preserve conversational context in comments: phrases like "as the user requested", "per the conversation", "added for the task", "fix from the feedback", references to PR/Issue numbers, individual names, or descriptions of the revision history all belong in the commit message or PR body, not in code.
- Good vs bad example:
  - Bad: `// Why-Not: regex was suggested by the user but it does not handle escaped quotes, so use the JSON parser instead.`
  - Good: `// Regex matching breaks on escaped quotes inside string literals; rely on the JSON parser for correct token boundaries.`
