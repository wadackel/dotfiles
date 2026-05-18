#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

// UserPromptSubmit hook:
// Promotes ~/.claude/plans/.pending-<session-hash> →
//          ~/.claude/plans/.active-<session-hash>
// when the user types `/impl` as the first slash command of their prompt.
//
// - Only the user's actual keystroke fires UserPromptSubmit; AI Skill-tool
//   invocations do not. This is the only mechanical way to distinguish
//   user-typed approval from AI self-invocation.
// - fail-open silent: any I/O / parse error → log to stderr and exit 0
//   (matches plan-gate.ts policy; never blocks the user prompt itself).
// - session_id missing → silent no-op. We cannot identify which session's
//   pending marker to promote, and blocking the prompt would be UX-hostile.
//   The plan-gate (fail-closed on missing session_id) is the safety net
//   for the edit side; this hook only forfeits the promote step.

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
  session_id?: string;
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
    const sessionId =
      (typeof input.session_id === "string" ? input.session_id : "").trim();

    // cwd 条件は defensive: hook payload に cwd が来ていない異常入力では promote を試みない。
    // promote 自体は sessionId だけで動くため、cwd は識別キーではなく sanity check。
    if (!cwd || !sessionId || !isApprovalPrompt(prompt)) {
      Deno.exit(0);
    }

    const result = await promote(sessionId);
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
