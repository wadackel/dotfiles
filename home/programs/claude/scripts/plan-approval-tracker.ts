#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

// UserPromptSubmit hook:
// Promotes ~/.claude/plans/.pending-<cwd-hash> → ~/.claude/plans/.active-<cwd-hash>
// when the user types `/impl` as the first slash command of their prompt.
//
// - Only the user's actual keystroke fires UserPromptSubmit; AI Skill-tool
//   invocations do not. This is the only mechanical way to distinguish
//   user-typed approval from AI self-invocation.
// - fail-open silent: any I/O / parse error → log to stderr and exit 0
//   (matches plan-gate.ts policy; never blocks the user prompt itself).

import { promote, type PromoteResult } from "./plan-marker.ts";

export { promote };
export type { PromoteResult };

// `/impl` must be the very first slash command of the prompt:
// - allowed: "/impl", "/impl foo", "/impl\nfoo" (newline counts as whitespace)
// - rejected: "please /impl", "/implementation", "foo\n/impl"
const APPROVAL_REGEX = /^\/impl(\s|$)/;

// --- Types ---

export interface HookInput {
  prompt?: string;
  cwd?: string;
}

// --- Helpers ---

export function isApprovalPrompt(prompt: string): boolean {
  return APPROVAL_REGEX.test(prompt);
}

// --- Entry point ---

if (import.meta.main) {
  try {
    const raw = await new Response(Deno.stdin.readable).text();
    const input: HookInput = JSON.parse(raw);
    const prompt = input.prompt ?? "";
    const cwd = input.cwd ?? "";

    if (!cwd || !isApprovalPrompt(prompt)) {
      Deno.exit(0);
    }

    const result = await promote(cwd);
    if (result.reason === "io-error") {
      console.error(
        `[plan-approval-tracker] promote failed: ${
          result.error ?? "unknown error"
        }`,
      );
    }
  } catch (err) {
    console.error(`[plan-approval-tracker] hook error: ${err}`);
  }
  Deno.exit(0);
}
