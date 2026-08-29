---
name: leave-no-trace
description: "Removes conversation residue — prompt echoes ('As requested…'), constraint disclosures, revision traces — so deliverables read as written for their audience. NOT readability editing (writing-clarity), NOT review-time detection (comment-reviewer), unrelated to Claude Artifacts. Triggers: '成果物を整えて', '会話の痕跡を消して', 'leave no trace'. Covers docs, README, PR bodies, code comments."
---

# Leave No Trace

Revise a deliverable so it reads as if written directly for its audience, with no trace of the conversation that produced it. The conversation is production context, not content.

## Classification

Judge every conversation-derived statement in the deliverable by one question: **would this read naturally to someone who never saw the conversation?** Then classify:

1. **Audience content** — information the reader genuinely needs. Keep it.
2. **Production guidance** — instructions and constraints that shaped the work. Reflect them indirectly through structure, tone, scope, and defaults; never state them.
3. **Residue** — echoes of prompts, feedback, or revision history. Remove or relocate.

Only category 1 appears in the final deliverable.

## Conversion, not deletion

Convert residue into design instead of merely deleting it:

- Conversion changes where information lives and how it is phrased. It NEVER changes technical content or the meaning of any step.
- Conversation-derived information has three destinations: delete it; move it to the commit message or PR body; or — only when it stands as a legitimate why-not — rewrite it into the technical reason and keep it in place.
- PR bodies and commit messages are the legitimate destination for conversational context. There, change rationale, review history, and issue references (`closes #123`) are audience content — protect them. Residue in a PR body is only prompt echoes ("as requested during the session") and production constraints irrelevant to the reviewer.

Example (document):

> Bad: This script is implemented in Deno as required (Bash is not used).
>
> Good: Running it requires Deno 2.x.

The constraint stops being a disclosure and becomes the prerequisite the reader actually needs. Deleting the sentence alone is not enough when the constraint still governs the content — apply it invisibly, then remove the announcement.

## Code comments

Same test, one guard above all: **legitimate why-not comments — a rejected alternative, a non-obvious invariant, a workaround for a known bug — must survive untouched.** Words like "user" or "request" alone do not make a comment residue; judge the content, not the surface vocabulary.

> Bad: `// Uses the JSON parser instead of regex, as the user requested`
>
> Good: `// Regex matching breaks on escaped quotes inside string literals; rely on the JSON parser for correct token boundaries.`

The conversational attribution converts into the technical reason behind it — only when that reason is verifiable from the code at hand; never invent one. When it is not verifiable, delete the comment: its context belongs in the commit message, and writing that message is the author's call, not this skill's.

## Output rules

- Output only the revised deliverable. Do not prefix it with process commentary ("I removed…", "Here is the cleaned version").
- Do not report what was sanitized unless asked. When both the revision and a change summary are requested, the revision comes first.
- When in doubt, keep: destroying rationale the audience needed is worse than leaving one residue phrase.
