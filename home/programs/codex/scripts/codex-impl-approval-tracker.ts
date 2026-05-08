#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

// UserPromptSubmit hook for Codex CLI:
// Promotes ~/.codex/plans/.pending-<cwd-hash> → ~/.codex/plans/.active-<cwd-hash>
// when the user types `$impl` as the first non-whitespace token of their
// prompt. Mirrors ~/.claude/scripts/plan-approval-tracker.ts but adapted for
// Codex's hook contract:
//   - argv[0] = "UserPromptSubmit"
//   - stdin = JSON payload with { hook_event_name, prompt, cwd, ... }
//   - exit 0 on every path: this hook NEVER blocks the user prompt; it merely
//     observes it and performs the promote side effect when applicable.
//
// User-typed approval is the only signal because Codex hooks fire only on
// genuine user prompts, not on AI's internal skill invocations. If the AI
// chains $plan → $impl inside a single turn, no UserPromptSubmit
// fires for the synthetic invocation, so promote is never triggered.
//
// Defensive on conflict: if `.active-<hash>` already exists when the hook runs,
// we do NOT overwrite it. $plan Phase 6 removes any prior `.active-`
// before writing `.pending-`, so the both-exist state is only reachable via
// races or manual tampering. Overwriting could silently invalidate an
// in-progress impl session.

import { promote, type PromoteResult } from "./codex-plan-marker.ts";

export { promote };
export type { PromoteResult };

// `$impl` must be the first non-whitespace token:
//   accepted: "$impl", "  $impl", "$impl foo"
//   rejected: "$impl-extra", "/impl", "please $impl"
const APPROVAL_REGEX = /^\s*\$impl(\s|$)/;

export interface HookInput {
  prompt?: string;
  cwd?: string;
}

export function isApprovalPrompt(prompt: string): boolean {
  return APPROVAL_REGEX.test(prompt);
}

function homeDir(): string {
  return Deno.env.get("HOME") ?? "";
}

// HOME is re-resolved per call so test setups that mutate Deno.env after
// module load are reflected (the constant pattern would silently log to the
// developer's real $HOME during tests).
async function appendLog(line: string): Promise<void> {
  try {
    const dir = `${homeDir()}/.codex/logs`;
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/codex-impl-approval-tracker.log`,
      `${new Date().toISOString()} ${line}\n`,
      { append: true },
    );
  } catch {
    // logging must never break the hook
  }
}

if (import.meta.main) {
  try {
    const raw = await new Response(Deno.stdin.readable).text();
    if (!raw.trim()) {
      Deno.exit(0);
    }
    const input: HookInput = JSON.parse(raw);
    const prompt = input.prompt ?? "";
    const cwd = input.cwd ?? "";

    if (!cwd || !isApprovalPrompt(prompt)) {
      Deno.exit(0);
    }

    const result = await promote(cwd);
    const errSuffix = result.error ? ` error=${result.error}` : "";
    await appendLog(
      `cwd=${cwd} result=${result.reason} promoted=${result.promoted}${errSuffix}`,
    );
  } catch (err) {
    await appendLog(`hook-error: ${(err as Error).message}`);
  }
  Deno.exit(0);
}
