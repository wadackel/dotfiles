import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../../../agents/lib/proc.ts";
import {
  destroySandbox,
  initSandbox,
  type Sandbox,
} from "./explore-sandbox.ts";
import { check, pathForms, takeBaseline } from "./explore-leak-check.ts";

type Fixture = { base: string; real: string; sb: Sandbox; paths: string[] };

async function withFixture(fn: (f: Fixture) => Promise<void>): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "explore-leak-test-"));
  const real = join(base, "real");
  await mkdir(real);
  const g = (args: string[]) =>
    run("git", [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      ...args,
    ], { cwd: real });
  await g(["init", "-q", "-b", "main"]);
  await writeFile(join(real, "f"), "a\n");
  await g(["add", "f"]);
  await g(["commit", "-qm", "init"]);
  const sb = await initSandbox(join(base, "sb"));
  try {
    await fn({ base, real, sb, paths: [sb.root, sb.shortDir] });
  } finally {
    await destroySandbox(sb);
    await rm(base, { recursive: true, force: true });
  }
}

test("a session that leaves the real side alone reports nothing", async () => {
  await withFixture(async ({ real, paths }) => {
    const baseline = await takeBaseline(real, []);
    const report = await check(baseline, {
      sandboxPaths: paths,
      tmuxSocket: "/nonexistent/sock",
    });
    assertEquals(report.stop, false);
    assertEquals(report.leaks, []);
    assertEquals(report.git, {});
    assertEquals(report.processes, []);
  });
}, 20000);

test(
  "a worktree of the real repository inside the sandbox stops the run",
  async () => {
    await withFixture(async ({ real, sb, paths }) => {
      const baseline = await takeBaseline(real, []);
      await run("git", [
        "-C",
        real,
        "worktree",
        "add",
        "-q",
        "-b",
        "leaked",
        join(sb.state, "wt"),
      ]);
      const report = await check(baseline, {
        sandboxPaths: paths,
        tmuxSocket: "/nonexistent/sock",
      });
      assertEquals(report.stop, true);
      assert(
        report.leaks.some((l) =>
          l.startsWith("worktree of the real repository")
        ),
        JSON.stringify(report.leaks),
      );
      assert(
        report.git.refs?.added.some((l) => l.startsWith("refs/heads/leaked")),
        JSON.stringify(report.git),
      );
    });
  },
  20000,
);

test(
  "a push from the real repository shows up as a moved remote-tracking ref",
  async () => {
    await withFixture(async ({ base, real, paths }) => {
      const remote = join(base, "remote.git");
      await run("git", ["init", "-q", "--bare", remote]);
      await run("git", ["-C", real, "remote", "add", "origin", remote]);
      const baseline = await takeBaseline(real, []);
      await run("git", [
        "-C",
        real,
        "push",
        "-q",
        "origin",
        "HEAD:refs/heads/x",
      ]);
      const report = await check(baseline, {
        sandboxPaths: paths,
        tmuxSocket: "/nonexistent/sock",
      });
      assert(
        report.git.refs?.added.some((l) =>
          l.startsWith("refs/remotes/origin/x")
        ),
        JSON.stringify(report.git),
      );
    });
  },
  20000,
);

test(
  "a tmux pane whose directory is in the sandbox stops the run",
  async () => {
    await withFixture(async ({ base, real, sb, paths }) => {
      const socket = join(base, "t.sock");
      const baseline = await takeBaseline(real, []);
      await run("tmux", [
        "-S",
        socket,
        "-f",
        "/dev/null",
        "new",
        "-d",
        "-s",
        "leak",
        "-c",
        sb.state,
        "sleep 60",
      ]);
      try {
        const report = await check(baseline, {
          sandboxPaths: paths,
          tmuxSocket: socket,
        });
        assertEquals(report.stop, true);
        assert(
          report.leaks.some((l) => l.startsWith("tmux pane")),
          JSON.stringify(report.leaks),
        );
      } finally {
        await run("tmux", ["-S", socket, "kill-server"]);
      }
    });
  },
  20000,
);

test(
  "untracked files, watched files and processes left in the sandbox are reported without stopping",
  async () => {
    await withFixture(async ({ base, real, sb, paths }) => {
      const watched = join(base, "watched");
      await mkdir(watched);
      await writeFile(join(watched, "config"), "a\n");
      const baseline = await takeBaseline(real, [watched]);
      await writeFile(join(real, "new.txt"), "x\n");
      await writeFile(join(watched, "config"), "b\n");
      const child = spawn("sleep", ["30"], { cwd: sb.state, stdio: "ignore" });
      try {
        await new Promise((r) => setTimeout(r, 300));
        const report = await check(baseline, {
          sandboxPaths: paths,
          tmuxSocket: "/nonexistent/sock",
        });
        assertEquals(report.stop, false);
        assertEquals(report.git.status?.added, ["?? new.txt"]);
        assertEquals(report.watch[watched]?.changed, ["config"]);
        assert(
          report.processes.some((p) => p.pid === child.pid),
          JSON.stringify(report.processes),
        );
      } finally {
        child.kill();
      }
    });
  },
  20000,
);

test("sandbox paths are searched in their logical form too", () => {
  const forms = pathForms([
    "/private/var/folders/x/T/explore.1",
    "/private/tmp/xs-a",
  ]);
  for (
    const p of ["/var/folders/x/T/explore.1", "/tmp/xs-a", "/private/tmp/xs-a"]
  ) assert(forms.includes(p), p);
});

test(
  "check without tmux on PATH still reports a leak and exits 3",
  async () => {
    await withFixture(async ({ base, real, sb }) => {
      const script = join(import.meta.dirname, "explore-leak-check.ts");
      const bunFlags = ["--no-env-file", "--no-install", "--config=/dev/null"];
      const baselinePath = join(base, "baseline.json");
      const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: base };
      const snap = await run(process.execPath, [
        ...bunFlags,
        script,
        "snapshot",
        "--real",
        real,
        "--out",
        baselinePath,
      ], { env, clearEnv: true });
      assertEquals(snap.code, 0, snap.stderr);
      await run("git", [
        "-C",
        real,
        "worktree",
        "add",
        "-q",
        "-b",
        "leaked",
        join(sb.state, "wt"),
      ]);
      const result = await run(process.execPath, [
        ...bunFlags,
        script,
        "check",
        "--baseline",
        baselinePath,
        "--sandbox",
        sb.root,
      ], { env, clearEnv: true });
      assertEquals(result.code, 3, result.stderr);
      assertStringIncludes(result.stdout, "tmux not searched");
    });
  },
  20000,
);

test(
  "a watched directory past the file limit is named in the notes",
  async () => {
    await withFixture(async ({ base, real, paths }) => {
      const watched = join(base, "big");
      await mkdir(watched);
      for (let i = 0; i < 2001; i++) {
        await writeFile(join(watched, `f${i}`), "x");
      }
      const baseline = await takeBaseline(real, [watched]);
      const report = await check(baseline, {
        sandboxPaths: paths,
        tmuxSocket: "/nonexistent/sock",
      });
      assert(
        report.notes.some((n) => n.includes("more than 2000 files")),
        JSON.stringify(report.notes),
      );
    });
  },
  30000,
);
