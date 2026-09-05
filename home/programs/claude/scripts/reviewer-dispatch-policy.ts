#!/usr/bin/env -S deno run --no-prompt

// PreToolUse hook: guard reviewer subagent dispatches.
// Rejects an Agent/Task dispatch to a reviewer subagent whose prompt does not
// carry the verdict rule. Measured over 774 recorded reviewer dispatches, only
// 24% carried the rule, and reviewers that were not told it returned PASS while
// listing blocker-severity findings in 45% of cases — the gate then advanced
// past findings that were never fixed.
//
// The prose instruction in subagent-review/SKILL.md is what failed to land, so
// a stronger prose instruction is not the fix; this check is.

interface HookInput {
  tool_name: string;
  tool_input: { subagent_type?: string; prompt?: string };
}

const TEMPLATE =
  "~/.claude/skills/subagent-review/references/domain-reviewer-prompt.md";

/**
 * The reviewers /subagent-review dispatches, listed explicitly. A `-reviewer$`
 * pattern would also catch `architect-reviewer` and `skill-guide-reviewer`,
 * which belong to other workflows and have no template to satisfy the check.
 */
const GUARDED = new Set([
  "code-reviewer",
  "security-auditor",
  "rust-reviewer",
  "go-reviewer",
  "dart-reviewer",
  "nix-reviewer",
  "typescript-reviewer",
  "react-reviewer",
  "a11y-reviewer",
  "database-reviewer",
  "deno-reviewer",
  "cloud-architecture-reviewer",
  "comment-reviewer",
]);

// Guarded reviewers whose agent definition has no Bash: they cannot run the
// `git diff` line the template shows, so the dispatch must carry the diff as a
// file path or inline hunks. Hand-copied from the `tools:` line of each
// home/programs/claude/agents/<name>.md; update both when an agent gains Bash.
const NO_BASH = new Set([
  "code-reviewer",
  "security-auditor",
  "comment-reviewer",
]);
type Missing = "a diff file path" | "the read-only sentence";
const READ_ONLY_SENTENCE = /do not create, modify, or delete files/i;
const DIFF_REFERENCE = /\.gate\.diff\b|^diff --git /m;

/** Subagent types whose dispatch must carry a verdict rule. */
export function isReviewerAgent(subagentType: string | undefined): boolean {
  if (!subagentType) return false;
  return GUARDED.has(subagentType);
}

/**
 * Two output contracts are in use. The /subagent-review templates end their
 * VERDICT line with "FAIL otherwise"; /santa-loop dispatches `code-reviewer`
 * with a JSON contract carrying a `"verdict"` field and its own verdict rules.
 * Accepting either keeps the guard on both without forcing one workflow's
 * output format onto the other.
 */
export function hasVerdictRule(prompt: string | undefined): boolean {
  if (!prompt) return false;
  return /FAIL otherwise/i.test(prompt) ||
    /"verdict"\s*:\s*"PASS"/.test(prompt);
}

/**
 * Second requirement, applied only to the /subagent-review contract ("FAIL
 * otherwise"): a reviewer without Bash needs the diff in the prompt, a reviewer
 * with Bash needs the template's read-only sentence. The santa-loop JSON
 * contract is left to its own reviewer-prompt.
 */
export function missingRequirement(
  subagentType: string,
  prompt: string | undefined,
): Missing | null {
  if (!prompt || !/FAIL otherwise/i.test(prompt)) return null;
  if (NO_BASH.has(subagentType)) {
    return DIFF_REFERENCE.test(prompt) ? null : "a diff file path";
  }
  return READ_ONLY_SENTENCE.test(prompt) ? null : "the read-only sentence";
}

export function requirementMessage(
  subagentType: string,
  missing: Missing,
): string {
  const line = missing === "a diff file path"
    ? "  Diff file: ~/.claude/plans/<plan-slug>.gate.diff   (or paste the diff so a `diff --git` hunk is in the prompt)"
    : "  Read-only: run only commands that read (git diff / show / log, rg, sed -n, cat, ls); do not create, modify, or delete files.";
  return [
    `[reviewer-dispatch-policy] ${subagentType} dispatched without ${missing}.`,
    "",
    "Add this line to the prompt (it comes from the /subagent-review template):",
    line,
  ].join("\n");
}

export function denialMessage(subagentType: string): string {
  return [
    `[reviewer-dispatch-policy] ${subagentType} dispatched without the verdict rule.`,
    "",
    "The prompt must state how PASS and FAIL are decided. For /subagent-review,",
    "load the template and paste its `## Template` block verbatim — do not",
    "summarise it and do not rewrite the VERDICT line:",
    `  ${TEMPLATE}`,
    "For a SHOULD_FIX-only re-review, use rereview-diagnostic-prompt.md instead.",
    'A JSON output contract carrying a `"verdict"` field also satisfies this.',
  ].join("\n");
}

// --- Entry point ---

if (import.meta.main) {
  const input: HookInput = JSON.parse(
    await new Response(Deno.stdin.readable).text(),
  );

  if (input.tool_name !== "Agent" && input.tool_name !== "Task") Deno.exit(0);

  const subagentType = input.tool_input?.subagent_type;
  if (!subagentType || !isReviewerAgent(subagentType)) Deno.exit(0);
  const prompt = input.tool_input?.prompt;
  if (!hasVerdictRule(prompt)) {
    console.error(denialMessage(subagentType));
    Deno.exit(2);
  }
  const missing = missingRequirement(subagentType, prompt);
  if (missing !== null) {
    console.error(requirementMessage(subagentType, missing));
    Deno.exit(2);
  }
  Deno.exit(0);
}
