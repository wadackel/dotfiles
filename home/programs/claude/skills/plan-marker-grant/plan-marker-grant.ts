#!/usr/bin/env -S deno run --allow-env=HOME --allow-read --allow-write --no-prompt

// /plan-marker-grant skill implementation.
//
// Writes / reads / deletes a session+cwd scoped plan-gate marker so the plan-gate
// allows Edit/Write/MultiEdit even without an active /plan marker. Invoked from
// SKILL.md via `!` preprocessing — the skill body passes argv as
//   [subcommand, cwd, sessionId]
// with subcommand expanded from `$ARGUMENTS`. Empty / missing subcommand is
// treated as "activate".
//
// Internal naming note: this script imports `activateBypassMarker`,
// `bypassMarkerInfo`, `hasValidBypassMarker` from plan-gate.ts. The internal
// symbols + marker basename retain the original `bypass-plan-gate` identifier
// intentionally — see SKILL.md for the rationale.

import {
  activateBypassMarker,
  bypassMarkerInfo,
  hasValidBypassMarker,
} from "../../scripts/plan-gate.ts";

type Subcommand = "activate" | "status" | "clear";

function parseSubcommand(raw: string | undefined): Subcommand {
  const value = (raw ?? "").trim();
  if (value === "" || value === "activate") return "activate";
  if (value === "status") return "status";
  if (value === "clear") return "clear";
  throw new Error(`unknown subcommand: ${value}`);
}

function requireArg(value: string | undefined, name: string): string {
  if (!value || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function runActivate(cwd: string, sessionId: string): Promise<unknown> {
  const marker = await activateBypassMarker({
    cwd,
    session_id: sessionId,
  });
  return {
    status: "activated",
    marker: {
      path: marker.path,
      cwdHash: marker.cwdHash,
      sessionHash: marker.sessionHash,
    },
  };
}

async function runStatus(cwd: string, sessionId: string): Promise<unknown> {
  const info = await bypassMarkerInfo(cwd, sessionId);
  const valid = await hasValidBypassMarker(cwd, sessionId);
  return {
    valid,
    path: info.path,
    cwdHash: info.cwdHash,
    sessionHash: info.sessionHash,
  };
}

async function runClear(cwd: string, sessionId: string): Promise<unknown> {
  const info = await bypassMarkerInfo(cwd, sessionId);
  try {
    await Deno.remove(info.path);
    return { status: "cleared", path: info.path };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return { status: "absent", path: info.path };
    }
    throw err;
  }
}

if (import.meta.main) {
  try {
    const [rawSubcommand, rawCwd, rawSessionId] = Deno.args;
    const subcommand = parseSubcommand(rawSubcommand);
    const cwd = requireArg(rawCwd, "cwd");
    const sessionId = requireArg(rawSessionId, "session_id");

    let result: unknown;
    if (subcommand === "activate") {
      result = await runActivate(cwd, sessionId);
    } else if (subcommand === "status") {
      result = await runStatus(cwd, sessionId);
    } else {
      result = await runClear(cwd, sessionId);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`[plan-marker-grant] ${(err as Error).message}`);
    Deno.exit(1);
  }
}
