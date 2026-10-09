// Startup phase marks for agentower-bench.ts, which matches on the mark names
// verbatim and reads them from stderr.

import { writeSync } from "node:fs";

const TRACE_ENABLED = (process.env.AGENTOWER_TRACE ?? "") !== "";

// `value` carries a duration instead of a timestamp; agentower-bench.ts knows
// which marks are which. Omitted, the mark is the milliseconds since process
// start, which keeps marks comparable across builds that import this module at
// different points in their graph.
export function trace(mark: string, value?: number): void {
  if (!TRACE_ENABLED) return;
  try {
    writeSync(
      2,
      new TextEncoder().encode(
        `AGT ${mark} ${Math.round(value ?? performance.now())}\n`,
      ),
    );
  } catch {
    // stderr closed under the popup; a lost mark must not take the frame down
  }
}
