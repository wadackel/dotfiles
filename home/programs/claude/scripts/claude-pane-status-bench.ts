#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

// Times one PreToolUse run of claude-pane-status.ts against a pane of an
// isolated tmux server, so the user's own panes are never written. Prints the
// median of the runs and exits 1 when it is above --max-ms.

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "../../agents/lib/proc.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const n = Number(args[i + 1]);
  if (!(n > 0)) throw new Error(`${name} needs a positive number`);
  return n;
};
const maxMs = flag("--max-ms", Number.POSITIVE_INFINITY);
const runs = flag("--runs", 15);
const script = resolve(import.meta.dir, "claude-pane-status.ts");
const server = `pane-status-bench-${process.pid}`;

async function tmux(...argv: string[]): Promise<string> {
  const r = await run("tmux", ["-L", server, ...argv]);
  if (r.code !== 0) throw new Error(`tmux ${argv.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function once(env: Record<string, string>, payload: string): Promise<number> {
  return new Promise((done, fail) => {
    const started = performance.now();
    const child = spawn(script, ["PreToolUse"], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", fail);
    child.on("close", () => done(performance.now() - started));
    child.stdin.end(payload);
  });
}

// A temporary HOME keeps the runs out of the user's claude-pane-status.log.
const home = await mkdtemp(join(tmpdir(), "pane-status-bench-"));
try {
  await tmux("-f", "/dev/null", "new-session", "-d", "-s", "bench");
  const pane = await tmux("display", "-p", "-t", "bench", "#{pane_id}");
  const socket = await tmux("display", "-p", "#{socket_path}");
  const env = {
    TMUX: `${socket},0,0`,
    TMUX_PANE: pane,
    HOME: home,
  };
  const payload = JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: "bench",
    tool_name: "Bash",
    tool_input: { command: "ls" },
    cwd: process.cwd(),
  });
  await once(env, payload);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) times.push(await once(env, payload));
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const tool = await tmux("show", "-p", "-t", pane, "-v", "@pane_current_tool");
  console.log(
    `median ${median.toFixed(1)} ms over ${runs} runs (min ${
      times[0].toFixed(1)
    }, max ${times.at(-1)!.toFixed(1)}); @pane_current_tool=${tool}`,
  );
  process.exitCode = median <= maxMs && tool === "Bash" ? 0 : 1;
} finally {
  await run("tmux", ["-L", server, "kill-server"]);
  await rm(home, { recursive: true, force: true });
}
