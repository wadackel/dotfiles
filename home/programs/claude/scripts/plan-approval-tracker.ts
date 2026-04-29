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

import { canonical, cwdHash, cwdMarkerPath } from "./plan-gate.ts";

// --- Constants ---

const PENDING_TTL_MS = 24 * 60 * 60 * 1000; // 24h, mirrors plan-gate.ts

// `/impl` must be the very first slash command of the prompt:
// - allowed: "/impl", "/impl foo", "/impl\nfoo" (newline counts as whitespace)
// - rejected: "please /impl", "/implementation", "foo\n/impl"
const APPROVAL_REGEX = /^\/impl(\s|$)/;

// --- Types ---

export interface HookInput {
  prompt?: string;
  cwd?: string;
}

export interface PromoteResult {
  promoted: boolean;
  reason: "promoted" | "no-pending" | "expired" | "already-active" | "io-error";
}

// --- Helpers ---

export function isApprovalPrompt(prompt: string): boolean {
  return APPROVAL_REGEX.test(prompt);
}

function pendingMarkerPath(hash: string): string {
  const home = Deno.env.get("HOME") ?? "";
  return `${home}/.claude/plans/.pending-${hash}`;
}

// --- Promote (testable) ---

export async function promote(cwd: string): Promise<PromoteResult> {
  const real = await canonical(cwd);
  const hash = await cwdHash(real);
  const pending = pendingMarkerPath(hash);
  const active = cwdMarkerPath(hash);

  let pendingStat: Deno.FileInfo;
  try {
    pendingStat = await Deno.stat(pending);
  } catch {
    return { promoted: false, reason: "no-pending" };
  }

  const mtime = pendingStat.mtime?.getTime() ?? 0;
  if (Date.now() - mtime >= PENDING_TTL_MS) {
    return { promoted: false, reason: "expired" };
  }

  try {
    await Deno.stat(active);
    return { promoted: false, reason: "already-active" };
  } catch {
    // active not present → proceed
  }

  try {
    const content = await Deno.readTextFile(pending);
    await Deno.writeTextFile(active, content);
    await Deno.remove(pending);
    return { promoted: true, reason: "promoted" };
  } catch (err) {
    console.error(`[plan-approval-tracker] promote failed: ${err}`);
    return { promoted: false, reason: "io-error" };
  }
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

    await promote(cwd);
  } catch (err) {
    console.error(`[plan-approval-tracker] hook error: ${err}`);
  }
  Deno.exit(0);
}
