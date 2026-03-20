#!/usr/bin/env -S deno run --allow-read --allow-write

// PreToolUse hook (matcher: "ExitPlanMode"):
// Gates ExitPlanMode on task-planner subagent execution.
// If the marker file exists, allows the tool call and cleans up.
// If not, blocks with a message instructing Claude to run task-planner first.

// --- Constants ---

const MARKER_PREFIX = "/tmp/claude-task-planner-ready-";

// --- Types ---

export interface GateResult {
  allowed: boolean;
  markerPath: string;
  denyMessage?: string;
}

interface HookInput {
  session_id?: string;
  tool_name?: string;
}

// --- Exported functions (testable) ---

/** Check if the task-planner marker file exists for this session. */
export async function checkGate(sessionId: string): Promise<GateResult> {
  const markerPath = `${MARKER_PREFIX}${sessionId}`;
  try {
    await Deno.stat(markerPath);
    return { allowed: true, markerPath };
  } catch {
    const denyMessage = [
      "task-planner サブエージェントがまだ実行されていません。",
      "plan ファイルを task-planner に渡してタスク分解を行い、完了後に",
      `\`touch ${markerPath}\` を実行してから ExitPlanMode を再試行してください。`,
    ].join("\n");
    return { allowed: false, markerPath, denyMessage };
  }
}

/** Remove the marker file so the next plan cycle is gated again. */
export async function cleanupMarker(markerPath: string): Promise<void> {
  try {
    await Deno.remove(markerPath);
  } catch {
    // File already removed or never existed — safe to ignore
  }
}

// --- Entry point ---

if (import.meta.main) {
  const input: HookInput = JSON.parse(
    await new Response(Deno.stdin.readable).text(),
  );

  const sessionId = input.session_id ?? "";
  if (!sessionId) Deno.exit(0);

  const result = await checkGate(sessionId);

  if (result.allowed) {
    await cleanupMarker(result.markerPath);
    // No stdout — pass through
  } else {
    console.log(
      JSON.stringify({ decision: "block", reason: result.denyMessage }),
    );
  }
}
