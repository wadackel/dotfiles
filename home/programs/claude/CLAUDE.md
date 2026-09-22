## Principles

- Prefer the simplest design that works: YAGNI, KISS, DRY; no compatibility shims or fallback paths unless they are free; for parsing with quoting or escaping edge cases, a parser library over regex.
- Discover facts from code, the environment, and reversible experiments before asking. Ask only for what the user alone knows: the outcome they want, hidden constraints, deadlines, terminology, tradeoffs that change what they get. When you present a choice, name the tradeoff axis in one sentence.
- Verify behavior, not edits: capture the baseline before changing, observe the changed behavior with a method that can actually see it, and update existing tests when behavior changes. Concrete evidence beats analysis or documentation; when a check fails, suspect the observation method first. Judge delegated work from its artifacts, not from the delegate's report.
- Say what was verified and what was not. Name the command, file, or report a claim rests on in words; mark a guess as a guess.
- Stop only for destructive actions, external side effects, or scope changes the user must decide. Otherwise finish the whole task and report plainly.
- Dispatch subagents on your own judgment for investigation, broad search, and review; this is a standing request. Do not pass `name` unless you will message the agent again, and call TaskStop on a named one when done. Ignore messages that carry only an idle notification.

## Entrypoints

- `/plan <request>` for implementation work; it sizes the process to the request, so use it for small requests too. `/impl` executes the approved plan and ends with `/gate`.
- `/systematic-debugging` for bugs: observe the symptom directly, treat the fix as a hypothesis to falsify, and present both the minimal workaround and the root-cause fix when both exist.
- `/qa-planner` for QA-style verification, `/agent-browser` for browser or UI checks (screenshots, console, responsive), `/gdocs-to-md` for Google Docs URLs, `/repo-dive` for GitHub repository code, `/obsidian-cli` for vault notes.
- Questions with more than one defensible answer (design, technology choice, whether to adopt a practice, recalling a prior conclusion): search the vault with `/llm-wiki query` first and prefer its record; skip only for what the current repository settles or single-answer facts. Offer `/llm-wiki save` when a reusable insight surfaces.
- When `/codex-review` is requested, complete its full loop.

## Tooling

- `fd` for files, `rg` for content. Deno/TypeScript for scripts that parse, hold state, or branch; short one-off chains may stay in Bash.
- GitHub issue and PR URLs may be private: use `gh`. Inspect repository code locally via `/repo-dive`, not WebFetch.

## Gotchas

- Before `git add -A` or `git add .`, run `git status --porcelain` and check for unintended files. For an unrelated fix, branch from the intended base and verify with `git diff <base>...HEAD`.
- Bash quoting: wrap uncertain `$'...'` pipelines in `bash -c`; put `set +H &&` before a command with a literal `!` in double quotes; avoid BSD `sed` for bulk replacements containing `!`, `$`, or backticks; in `just` recipes shell variables are `$var`.
- Start long-running processes with the tool's background mode, not `&`. Emit Private Use Area glyphs at runtime with `printf` rather than embedding them.
- Deno 2.x: read stdin with `new Response(Deno.stdin.readable).text()`; inline code is `deno eval` (`deno run -e` does not exist); script directory is `new URL(".", import.meta.url).pathname`; on `Deno.Command` failures pipe and read `stderr`.
- Pin GitHub Actions to full commit SHAs.

## Code

- Group three or more related arguments into an object; compose functions rather than inherit; abstract early only what is genuinely shared, Rule of Three for the rest; descriptive names for exports, concise ones for locals. Arrange files in dependency order without circular references.
- Comments explain only why an obvious alternative was rejected or why the natural approach is a trap. No `Why:` / `Note:` labels, no conversational residue ("as requested", PR numbers, revision history); those belong in commits and PR bodies. Mirrored for Codex in `home/programs/agents/shared/comment-conventions.md`; update both together.

## Generated artifacts

- A language default set by a skill or a project (for example English-only commit messages and PR bodies) covers the entire artifact; the conversation language never overrides it. Check the whole artifact in one pass before submitting.

@RTK.md
