## Codex Delegation

Keep routine exploration, implementation, tests, audit, and simplification in the main session. Apply this policy across models, including automatic delegation recommendations in shared skills. Skill loading, file extensions, diff size, and task counts alone do not justify spawning agents.

Use subagents for a concrete independent review, or a bounded, substantial investigation whose intermediate output benefits from a separate context. Follow the risk selection in `$plan` and `$impl`; otherwise explain the specific benefit before dispatch. Honor explicit user requests for independent review, named agents, or parallel work without asking again. Do not interpret automatic skill selection as such a request.

Start with the smallest useful set of roles. Additional reviewers need a distinct question that the existing review does not cover. Apply specialist checklists in the main session or existing reviewer before adding another agent. Reuse an existing agent for related questions; do not duplicate its investigation.

For independent review, start with a fresh context (`fork_turns: "none"` when supported). Supply the original request, constraints, acceptance criteria, artifact, and necessary references; omit the main session's history and conclusions. If that isolation is unavailable, disclose the limitation rather than claiming independent review. Reuse the reviewer after fixes while requiring a new result for the current artifact. Keep exchanges concise, and prohibit nested subagents.
