#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --no-prompt

// Agentower entry point. agentower.tsx holds the app and exports main(); it is
// reached through the dynamic import below rather than a static one because ES
// module evaluation is hoisted — a static `npm:ink` import anywhere in this
// graph would run before setRaw, and bytes typed during those ~100ms land in
// the tty's canonical queue where Deno's node-compat stdin (kqueue readiness)
// never sees them until the next byte arrives.

import { trace } from "./trace.ts";

trace("entry-start");

// cbreak, not full raw: ICANON and ECHO go away (which is what makes the
// buffered bytes readable) but ISIG stays, so Ctrl+C still kills the popup
// while main() is awaiting tmux. Ink upgrades this to full raw when it mounts
// and restores the terminal on unmount, so nothing is restored here — main()
// exits through Deno.exit, which skips finally blocks.
try {
  if (Deno.stdin.isTerminal()) Deno.stdin.setRaw(true, { cbreak: true });
} catch {
  // not a tty (activation warm-up, piped stdin): nothing to switch
}
trace("raw-on");

const { main } = await import("./agentower.tsx");

try {
  await main();
  // One-shot CLI: force exit so popup closes deterministically (avoid
  // event-loop drain stall after jumpTo / Ink unmount).
  Deno.exit(0);
} catch (e) {
  console.error(e);
  Deno.exit(1);
}
