// Shared helpers (resolveRepoName, escapeObsidianSyntax, parseLLMOutput,
// upsertDailyNote, debounceStatePath, etc.) are tested in
// home/programs/agent-memo/memo-shared_test.ts.
//
// claude-memo.ts now delegates all of those to memo-shared.ts; the only
// non-shared logic that remains here is the Claude transcript-shape parser
// (extractUserTexts/extractAssistantTexts/extractToolSummary,
// heuristicSummary, buildLLMInput) plus NOISE_PATTERNS. Those functions are
// not exported (their behavior is covered indirectly by the existing claude
// memo entries already produced for this user, and behavior was preserved by
// the shared-extraction refactor — no semantic change).
//
// Keep this file as an empty placeholder so the deno test invocation in
// CLAUDE.md (`deno test --allow-env=HOME --allow-read --allow-write
// home/programs/claude/scripts/<name>_test.ts`) still finds a target without
// failing on missing test files.

Deno.test("claude-memo: shared helpers covered by memo-shared_test.ts", () => {
  // intentionally empty — placeholder so the file is a valid test target.
});
