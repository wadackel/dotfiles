#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

// The session name goes through $CLAUDE_ENV_FILE rather than `claude-$PPID` in each
// command: inside a script $PPID is that script's shell, so every script started a
// browser of its own. SessionEnd closes only browsers named after this process; one
// that was SIGKILLed or given a self-made name is left to the idle timeout set in
// ~/.agent-browser/config.json (home/programs/agent-browser).

import { spawn } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const sessionName = (pid: string) => `claude-${pid}`;

/**
 * The directory where agent-browser keeps `<session>.pid`, in its own lookup order.
 * AGENT_BROWSER_NAMESPACE is not followed: this environment does not set it, and a
 * namespaced daemon is left to the idle timeout.
 */
export function socketDir(
  env: Record<string, string | undefined>,
  home: string,
): string {
  if (env.AGENT_BROWSER_SOCKET_DIR) return env.AGENT_BROWSER_SOCKET_DIR;
  if (env.XDG_RUNTIME_DIR) return join(env.XDG_RUNTIME_DIR, "agent-browser");
  return join(home, ".agent-browser");
}

/** Sessions named `claude-<pid>` or derived from it as `claude-<pid>-<label>`. */
export function ownedSessions(files: string[], pid: string): string[] {
  const own = sessionName(pid);
  return files
    .filter((file) => file.endsWith(".pid"))
    .map((file) => file.slice(0, -".pid".length))
    .filter((name) => name === own || name.startsWith(`${own}-`));
}

// A .pid left by a SIGKILLed daemon would make `close` start a daemon only to stop it.
function daemonAlive(pidFile: string): boolean {
  try {
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function main(event: string | undefined): void {
  const pid = process.env.CLAUDE_PID;
  if (!pid) return;
  if (event === "SessionStart") {
    const envFile = process.env.CLAUDE_ENV_FILE;
    if (envFile) {
      appendFileSync(
        envFile,
        `export AGENT_BROWSER_SESSION=${sessionName(pid)}\n`,
      );
    }
    return;
  }
  if (event === "SessionEnd") {
    const dir = socketDir(process.env, homedir());
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      return;
    }
    const live = ownedSessions(files, pid).filter((name) =>
      daemonAlive(join(dir, `${name}.pid`))
    );
    for (const name of live) {
      // Detached: a close queued behind a command still running in the daemon (a long
      // wait the user interrupted) outlives the 1.5 s SessionEnd budget, after which
      // Claude Code kills the hook's process group. Not the hook's cwd: agent-browser
      // merges ./agent-browser.json from its cwd, which may be an untrusted clone; with
      // the socket dir as cwd, a relative AGENT_BROWSER_SOCKET_DIR is passed on as ".".
      spawn("agent-browser", ["--session", name, "close"], {
        cwd: dir,
        env: process.env.AGENT_BROWSER_SOCKET_DIR
          ? { ...process.env, AGENT_BROWSER_SOCKET_DIR: "." }
          : process.env,
        detached: true,
        stdio: "ignore",
      })
        .on("error", () => {})
        .unref();
    }
  }
}

if (import.meta.main) main(process.argv[2]);
