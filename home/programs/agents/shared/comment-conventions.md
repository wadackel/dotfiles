<!-- Mirror of the comment rules in home/programs/claude/global-instructions.md (## Code) — update both together. -->

## Code Comment Conventions

- Comments must document "Why not" only — why an obvious alternative was rejected, or why the seemingly natural approach is a trap. Do not write comments that explain what the code does, restate obvious why, or describe current behavior.
- Do not prefix comments with `Why-Not:`, `Why:`, `Note:`, or similar machine-like labels. The comment body itself is the explanation; a label only adds noise.
- A comment block is at most six lines (docstrings excepted). A longer one is split, or cut to the rejected alternative and the reason; narration goes.
- When the code a comment explains changes, change the reason with it. A reason that is no longer true is misinformation, not history.
- Do not preserve conversational context in comments: phrases like "as the user requested", "per the conversation", "added for the task", "fix from the feedback", references to PR/Issue numbers, individual names, or descriptions of the revision history all belong in the commit message or PR body, not in code.
- Good vs bad example:
  - Bad: `// Why-Not: regex was suggested by the user but it does not handle escaped quotes, so use the JSON parser instead.`
  - Good: `// Regex matching breaks on escaped quotes inside string literals; rely on the JSON parser for correct token boundaries.`
