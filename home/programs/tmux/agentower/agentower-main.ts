#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

// Agentower entry point. agentower.tsx holds the app and exports main(); it is
// reached through the dynamic import below rather than a static one because ES
// module evaluation is hoisted — a static `ink` import anywhere in this graph
// would run before setRawMode, and a key typed during startup would be lost.

import { trace } from "./trace.ts";

trace("entry-start");

// Measured under Bun 1.4.2: with this early switch, keys sent to the tty
// before exec arrive 2 ms after ink mounts; without it they never arrive.
// ISIG is off from here on, so a Ctrl+C typed during startup is delivered to
// ink as input once it mounts rather than as a signal. Ink restores the
// terminal on unmount, so nothing is restored here — main() exits through
// process.exit, which skips finally blocks.
try {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
} catch {
  // not a tty (activation warm-up, piped stdin): nothing to switch
}
trace("raw-on");

const { main } = await import("./agentower.tsx");

try {
  await main();
  // One-shot CLI: force exit so popup closes deterministically (avoid
  // event-loop drain stall after jumpTo / Ink unmount).
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
