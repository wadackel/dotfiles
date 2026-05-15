#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=HOME

// UserPromptSubmit hook for Codex CLI:
// Creates a session/cwd scoped plan-gate marker when the user types
// `$plan-marker-grant` as the first non-whitespace token of their prompt.
// The hook never blocks the prompt; it only observes and records state.
//
// Internal naming note: the marker disk basename + `BYPASS_REGEX` constant +
// `activateBypass` / `isBypassPrompt` / `BypassResult` symbols + the imported
// `activateBypassMarker` / `BypassMarkerInfo` from codex-plan-gate.ts all
// retain the original `bypass` identifier. The rename targets only the
// user-facing prompt token, the skill name, the tracker filename, and the
// log basename. See ../skills/plan-marker-grant/SKILL.md for the rationale.

import {
  activateBypassMarker,
  type BypassMarkerInfo,
} from "./codex-plan-gate.ts";

const BYPASS_REGEX = /^\s*\$plan-marker-grant(\s|$)/;

export interface HookInput {
  prompt?: string;
  cwd?: string;
  session_id?: string;
}

export interface BypassResult {
  activated: boolean;
  reason: "activated" | "missing-fields" | "io-error";
  marker?: BypassMarkerInfo;
  error?: string;
}

export function isBypassPrompt(prompt: string): boolean {
  return BYPASS_REGEX.test(prompt);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

export function normalizeHookInput(value: unknown): HookInput {
  if (!isRecord(value)) {
    return {};
  }
  return {
    prompt: stringField(value, "prompt"),
    cwd: stringField(value, "cwd"),
    session_id: stringField(value, "session_id"),
  };
}

function homeDir(): string {
  return Deno.env.get("HOME") ?? "";
}

async function appendLog(line: string): Promise<void> {
  try {
    const dir = `${homeDir()}/.codex/logs`;
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/codex-plan-marker-grant-tracker.log`,
      `${new Date().toISOString()} ${line}\n`,
      { append: true },
    );
  } catch {
    // logging must never break the hook
  }
}

export async function activateBypass(input: HookInput): Promise<BypassResult> {
  const cwd = input.cwd ?? "";
  const sessionId = input.session_id ?? "";
  if (!cwd || !sessionId) {
    return { activated: false, reason: "missing-fields" };
  }
  try {
    const marker = await activateBypassMarker({
      cwd,
      session_id: sessionId,
      prompt: input.prompt ?? "",
    });
    return { activated: true, reason: "activated", marker };
  } catch (err) {
    return {
      activated: false,
      reason: "io-error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

if (import.meta.main) {
  try {
    const raw = await new Response(Deno.stdin.readable).text();
    if (!raw.trim()) {
      Deno.exit(0);
    }
    const input = normalizeHookInput(JSON.parse(raw));
    const prompt = input.prompt ?? "";
    if (!isBypassPrompt(prompt)) {
      Deno.exit(0);
    }

    const result = await activateBypass(input);
    const markerSuffix = result.marker ? ` marker=${result.marker.path}` : "";
    const errSuffix = result.error ? ` error=${result.error}` : "";
    await appendLog(
      `cwd=${input.cwd ?? ""} session_id=${input.session_id ?? ""} result=${result.reason} activated=${result.activated}${markerSuffix}${errSuffix}`,
    );
  } catch (err) {
    await appendLog(`hook-error: ${(err as Error).message}`);
  }
  Deno.exit(0);
}
