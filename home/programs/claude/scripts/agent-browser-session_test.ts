import { test } from "bun:test";
import { assertEquals } from "@std/assert";
import { existsSync, realpathSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../agents/lib/proc.ts";
import { ownedSessions, socketDir } from "./agent-browser-session.ts";

const HOOK = join(import.meta.dirname, "agent-browser-session.ts");

test("ownedSessions keeps this process's session and its derived names only", () => {
  const files = [
    "claude-123.pid",
    "claude-123-explore-a.pid",
    "claude-1234.pid",
    "claude-12.pid",
    "claude-123.config",
    "claude-123.sock",
    "qa-kakeibo-3.pid",
  ];
  assertEquals(ownedSessions(files, "123"), [
    "claude-123",
    "claude-123-explore-a",
  ]);
});

test("socketDir follows agent-browser's lookup order", () => {
  assertEquals(
    socketDir({ AGENT_BROWSER_SOCKET_DIR: "/s", XDG_RUNTIME_DIR: "/x" }, "/h"),
    "/s",
  );
  assertEquals(socketDir({ XDG_RUNTIME_DIR: "/x" }, "/h"), "/x/agent-browser");
  assertEquals(
    socketDir({ AGENT_BROWSER_SOCKET_DIR: "", XDG_RUNTIME_DIR: "" }, "/h"),
    "/h/.agent-browser",
  );
});

test("SessionStart writes the session name into CLAUDE_ENV_FILE", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ab-session-"));
  try {
    const envFile = join(dir, "env.sh");
    const r = await run(HOOK, ["SessionStart"], {
      env: { CLAUDE_PID: "4242", CLAUDE_ENV_FILE: envFile },
    });
    assertEquals(r.code, 0);
    assertEquals(
      await readFile(envFile, "utf8"),
      "export AGENT_BROWSER_SESSION=claude-4242\n",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SessionEnd closes the live owned sessions from the socket dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ab-session-"));
  try {
    const sockets = join(dir, "sockets");
    const bin = join(dir, "bin");
    const clone = join(dir, "clone");
    const log = join(dir, "calls.log");
    await mkdir(sockets);
    await mkdir(bin);
    await mkdir(clone);
    const live = String(process.pid);
    const dead = (await run("sh", ["-c", "echo $$"])).stdout.trim();
    const pids: Record<string, string> = {
      "claude-77": live,
      "claude-77-explore-b": live,
      "claude-77-stale": dead,
      "claude-777": live,
      "brk375": live,
    };
    for (const [name, pid] of Object.entries(pids)) {
      await writeFile(join(sockets, `${name}.pid`), `${pid}\n`);
    }
    // A config in the cwd the session ended in must not reach the close.
    await writeFile(join(clone, "agent-browser.json"), "{}");
    const fake = join(bin, "agent-browser");
    await writeFile(
      fake,
      `#!/bin/sh\necho "$(pwd -P) $@" >> ${JSON.stringify(log)}\n`,
    );
    await chmod(fake, 0o755);
    const r = await run(HOOK, ["SessionEnd"], {
      cwd: clone,
      env: {
        CLAUDE_PID: "77",
        AGENT_BROWSER_SOCKET_DIR: sockets,
        PATH: `${bin}:${process.env.PATH}`,
      },
    });
    assertEquals(r.code, 0);
    const where = realpathSync(sockets);
    // The closes run detached and may land after the hook has exited.
    let calls: string[] = [];
    for (let i = 0; i < 50 && calls.length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      calls = existsSync(log)
        ? (await readFile(log, "utf8")).trim().split("\n").sort()
        : [];
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    calls = (await readFile(log, "utf8")).trim().split("\n").sort();
    assertEquals(calls, [
      `${where} --session claude-77 close`,
      `${where} --session claude-77-explore-b close`,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("without CLAUDE_PID the hook does nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ab-session-"));
  try {
    const envFile = join(dir, "env.sh");
    const r = await run(HOOK, ["SessionStart"], {
      env: { CLAUDE_PID: "", CLAUDE_ENV_FILE: envFile },
    });
    assertEquals(r.code, 0);
    assertEquals(existsSync(envFile), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
