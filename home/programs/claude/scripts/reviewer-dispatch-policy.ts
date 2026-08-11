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
  if (hasVerdictRule(input.tool_input?.prompt)) Deno.exit(0);

  console.error(denialMessage(subagentType));
  Deno.exit(2);
}
