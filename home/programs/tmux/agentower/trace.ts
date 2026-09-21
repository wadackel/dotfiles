// Startup phase marks for agentower-bench.ts, which matches on the mark names
// verbatim. stderr rather than a file, so the shipped binary needs no
// --allow-write.

const TRACE_ENABLED = (Deno.env.get("AGENTOWER_TRACE") ?? "") !== "";

// `value` carries a duration instead of a timestamp; agentower-bench.ts knows
// which marks are which. Omitted, the mark is the milliseconds since process
// start, which keeps marks comparable across builds that import this module at
// different points in their graph.
export function trace(mark: string, value?: number): void {
  if (!TRACE_ENABLED) return;
  try {
    Deno.stderr.writeSync(
      new TextEncoder().encode(
        `AGT ${mark} ${Math.round(value ?? performance.now())}\n`,
      ),
    );
  } catch {
    // stderr closed under the popup; a lost mark must not take the frame down
  }
}
