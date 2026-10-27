import { test } from "bun:test";
import { assertEquals } from "@std/assert";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "../../agents/lib/proc.ts";

const GUARD = resolve(import.meta.dir, "../hooks/rtk-worktree-guard.sh");

/** A temporary HOME whose Claude settings allow `git status` and `npm` / `bun`. */
async function fixtureHome(): Promise<string> {
  const home = await realpath(await mkdtemp(join(tmpdir(), "rtk-guard-")));
  await mkdir(join(home, ".claude"));
  await writeFile(
    join(home, ".claude", "settings.json"),
    JSON.stringify({
      permissions: {
        allow: [
          "Bash(git status *)",
          "Bash(npm *)",
          "Bash(bun *)",
          "Bash(cd *)",
        ],
      },
    }),
  );
  return home;
}

function runGuard(
  home: string,
  command: string,
  cwd: string,
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((done, fail) => {
    const child = spawn(GUARD, [], {
      cwd,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home,
        CLAUDE_CONFIG_DIR: join(home, ".claude"),
        RTK_DB_PATH: join(home, "rtk.db"),
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", fail);
    child.on(
      "close",
      (code) => done({ code, stdout: Buffer.concat(chunks).toString("utf8") }),
    );
    child.stdin.end(JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
      cwd,
      session_id: "test",
      permission_mode: "auto",
    }));
  });
}

function hookOutput(stdout: string): Record<string, unknown> | null {
  if (stdout.trim() === "") return null;
  return JSON.parse(stdout).hookSpecificOutput;
}

test("an allow-listed command keeps rtk's allow decision", async () => {
  const home = await fixtureHome();
  try {
    const out = hookOutput((await runGuard(home, "git status", home)).stdout);
    assertEquals(out?.updatedInput, { command: "rtk git status" });
    assertEquals(out?.permissionDecision, "allow");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a package-manager command is rewritten without a decision", async () => {
  const home = await fixtureHome();
  try {
    assertEquals(
      hookOutput((await runGuard(home, "npm run build", home)).stdout)
        ?.updatedInput,
      { command: "rtk npm run build" },
    );
    // A form rtk leaves alone prints nothing, which carries no decision either.
    for (
      const command of [
        "npm run build",
        "bun test x",
        "cd . && npm run build",
        "FOO=1 npm run build",
        "cd .\nnpm run build",
        "timeout 5 npm run build",
        "/opt/homebrew/bin/npm test",
      ]
    ) {
      const out = hookOutput((await runGuard(home, command, home)).stdout);
      assertEquals("permissionDecision" in (out ?? {}), false, command);
      assertEquals("permissionDecisionReason" in (out ?? {}), false);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("git is left unrewritten in a linked worktree", async () => {
  const home = await fixtureHome();
  try {
    const repo = join(home, "repo");
    const tree = join(home, "tree");
    await mkdir(repo);
    for (
      const args of [
        ["init", "-q"],
        ["config", "commit.gpgsign", "false"],
        [
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@t",
          "commit",
          "-q",
          "--allow-empty",
          "-m",
          "i",
        ],
        ["worktree", "add", "-q", tree],
      ]
    ) {
      assertEquals((await run("git", args, { cwd: repo })).code, 0);
    }
    const result = await runGuard(home, "git status", tree);
    assertEquals(result.code, 0);
    assertEquals(result.stdout.trim(), "");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
