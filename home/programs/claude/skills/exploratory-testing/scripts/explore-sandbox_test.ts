import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { test } from "bun:test";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../../../agents/lib/proc.ts";
import {
  addEnv,
  initSandbox,
  loadSandbox,
  resetState,
  sandboxEnv,
  sandboxProcesses,
  snapshotState,
} from "./explore-sandbox.ts";

const SCRIPT = join(import.meta.dirname, "explore-sandbox.ts");
const BUN_FLAGS = ["--no-env-file", "--no-install", "--config=/dev/null"];

const cli = (args: string[]) =>
  run(process.execPath, [...BUN_FLAGS, SCRIPT, ...args]);

async function withSandbox(fn: (root: string) => Promise<void>): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "explore-sandbox-test-"));
  const root = join(base, "sb");
  await initSandbox(root);
  try {
    await fn(root);
  } finally {
    await cli(["destroy", root]);
    await rm(base, { recursive: true, force: true });
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

test("init lays out the state and refuses a root that is not empty", async () => {
  await withSandbox(async (root) => {
    const sb = await loadSandbox(root);
    for (
      const dir of ["home", "xdg/config", "xdg/data", "xdg/state", "xdg/cache"]
    ) {
      assert(await exists(join(sb.state, dir)), dir);
    }
    assert(sb.shortDir.length < 40, `shortDir is ${sb.shortDir}`);
    await assertRejects(() => initSandbox(root), Error, "not empty");
  });
});

test("the environment drops the user's agent, tmux and tokens and swaps home", async () => {
  await withSandbox(async (root) => {
    const sb = await loadSandbox(root);
    const env = sandboxEnv(sb, {
      PATH: "/usr/bin:/bin",
      SSH_AUTH_SOCK: "/private/tmp/agent.sock",
      TMUX: "/private/tmp/tmux-501/default,1,0",
      GH_TOKEN: "secret",
      LANG: "ja_JP.UTF-8",
    });
    assertEquals(env.SSH_AUTH_SOCK, undefined);
    assertEquals(env.TMUX, undefined);
    assertEquals(env.GH_TOKEN, undefined);
    assertEquals(env.HOME, join(sb.state, "home"));
    assertEquals(env.TMUX_TMPDIR, sb.shortDir);
    assertEquals(env.GIT_CONFIG_NOSYSTEM, "1");
    assertEquals(env.LANG, "ja_JP.UTF-8");
    assert(env.PATH!.startsWith(join(sb.shortDir, "bin")));
  });
});

test("exec hides the system credential helper and puts the ssh shim first", async () => {
  await withSandbox(async (root) => {
    const helper = await cli([
      "exec",
      root,
      "--",
      "git",
      "config",
      "--get-all",
      "credential.helper",
    ]);
    assertEquals(helper.code, 1);
    assertEquals(helper.stdout, "");
    const ssh = await cli(["exec", root, "--", "sh", "-c", "command -v ssh"]);
    assertEquals(
      ssh.stdout.trim(),
      join((await loadSandbox(root)).shortDir, "bin", "ssh"),
    );
  });
});

test(
  "exec stops the whole process group at the timeout and exits 124",
  async () => {
    await withSandbox(async (root) => {
      const started = Date.now();
      const result = await cli([
        "exec",
        root,
        "--timeout",
        "1",
        "--",
        "sh",
        "-c",
        "sleep 30 & sleep 30",
      ]);
      assertEquals(result.code, 124);
      assertStringIncludes(result.stderr, "timed out after 1s");
      assert(Date.now() - started < 8000);
      await new Promise((r) => setTimeout(r, 500));
      assertEquals(
        await sandboxProcesses([(await loadSandbox(root)).root]),
        [],
      );
    });
  },
  20000,
);

test(
  "clone points origin at a bare repository, so a push never reaches the source",
  async () => {
    await withSandbox(async (root) => {
      const src = await mkdtemp(join(tmpdir(), "explore-src-"));
      try {
        const g = (args: string[], cwd: string) =>
          run("git", [
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.invalid",
            ...args,
          ], { cwd });
        await g(["init", "-q", "-b", "main"], src);
        await writeFile(join(src, "f"), "a\n");
        await g(["add", "f"], src);
        await g(["commit", "-qm", "init"], src);
        const cloned = JSON.parse(
          (await cli(["clone", root, src, "repo"])).stdout,
        ) as { clone: string; origin: string };
        assertEquals(
          (await run("git", [
            "-C",
            cloned.clone,
            "remote",
            "get-url",
            "origin",
          ])).stdout.trim(),
          cloned.origin,
        );
        assertEquals(
          (await run("git", ["-C", cloned.origin, "remote"])).stdout.trim(),
          "",
        );
        await writeFile(join(cloned.clone, "f"), "b\n");
        const push = await cli([
          "exec",
          root,
          "--cwd",
          "repo",
          "--",
          "sh",
          "-c",
          "git commit -qam second && git push -q origin main",
        ]);
        assertEquals(push.code, 0, push.stderr);
        assertEquals(
          (await run("git", ["-C", src, "rev-list", "--count", "main"])).stdout
            .trim(),
          "1",
        );
        assertEquals(
          (await run("git", [
            "-C",
            cloned.origin,
            "rev-list",
            "--count",
            "main",
          ])).stdout.trim(),
          "2",
        );
      } finally {
        await rm(src, { recursive: true, force: true });
      }
    });
  },
  20000,
);

test("git inside the sandbox does not find a repository above it", async () => {
  const outer = await mkdtemp(join(tmpdir(), "explore-outer-"));
  try {
    await run("git", ["init", "-q"], { cwd: outer });
    const root = join(outer, "sb");
    await initSandbox(root);
    const found = await cli([
      "exec",
      root,
      "--",
      "git",
      "rev-parse",
      "--show-toplevel",
    ]);
    assert(found.code !== 0, found.stdout);
    await cli(["destroy", root]);
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
});

test("reset restores the state saved by snapshot", async () => {
  await withSandbox(async (root) => {
    const sb = await loadSandbox(root);
    const file = join(sb.state, "home", "data.txt");
    await writeFile(file, "before\n");
    await snapshotState(sb);
    await writeFile(file, "after\n");
    await writeFile(join(sb.state, "home", "extra.txt"), "x\n");
    await resetState(sb);
    assertEquals(await readFile(file, "utf8"), "before\n");
    assert(!(await exists(join(sb.state, "home", "extra.txt"))));
  });
});

test("env-add refuses isolation keys and needs a reason", async () => {
  await withSandbox(async (root) => {
    const sb = await loadSandbox(root);
    await assertRejects(
      () => addEnv(sb, "HOME=/Users/x", "need it"),
      Error,
      "isolation",
    );
    await assertRejects(() => addEnv(sb, "FOO=1", " "), Error, "--reason");
    await addEnv(sb, "FOO=1", "the CLI reads FOO");
    assertEquals(sandboxEnv(await loadSandbox(root)).FOO, "1");
    for (
      const key of [
        "GIT_DIR=/repo/.git",
        "GIT_CONFIG_COUNT=1",
        "GH_CONFIG_DIR=/x",
        "SSH_ASKPASS=/x",
        "TMUX_PANE=%1",
      ]
    ) {
      await assertRejects(
        () => addEnv(sb, key, "reason"),
        Error,
        "isolation",
        key,
      );
    }
    await addEnv(sb, "PATH=/opt/tool/bin:/usr/bin:/bin", "the product's tools");
    const env = sandboxEnv(await loadSandbox(root));
    assert(
      env.PATH!.startsWith(join(sb.shortDir, "bin") + ":/opt/tool/bin"),
      env.PATH,
    );
  });
});

test(
  "tmux started inside lives under the short directory and destroy stops it",
  async () => {
    const base = await mkdtemp(join(tmpdir(), "explore-sandbox-test-"));
    const root = join(base, "sb");
    try {
      const sb = await initSandbox(root);
      const started = await cli([
        "exec",
        root,
        "--",
        "tmux",
        "-f",
        "/dev/null",
        "new",
        "-d",
        "-s",
        "t",
        "sleep 60",
      ]);
      assertEquals(started.code, 0, started.stderr);
      const socket = join(sb.shortDir, `tmux-${process.getuid!()}`, "default");
      const who = await run("tmux", [
        "-S",
        socket,
        "display",
        "-p",
        "#{socket_path}",
      ]);
      assertEquals(who.stdout.trim(), socket);
      const destroyed = await cli(["destroy", root]);
      assertStringIncludes(destroyed.stdout, "killed tmux server");
      assert(!(await exists(sb.shortDir)));
      assert(!(await exists(root)));
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  },
  20000,
);

test("a sandbox.json rewritten from inside cannot move the paths or undo the isolation", async () => {
  await withSandbox(async (root) => {
    const meta = join(root, "sandbox.json");
    const original = JSON.parse(await readFile(meta, "utf8"));
    await writeFile(
      meta,
      JSON.stringify({
        ...original,
        root: "/",
        state: "/",
        env: { HOME: { value: "/", reason: "x" } },
      }),
    );
    const sb = await loadSandbox(root);
    assertEquals(sb.state, join(sb.root, "state"));
    assertEquals(sandboxEnv(sb).HOME, join(sb.state, "home"));
    await writeFile(meta, JSON.stringify({ ...original, shortDir: tmpdir() }));
    await assertRejects(() => loadSandbox(root), Error, "shortDir");
    const link = `/private/tmp/xs-link-${process.pid}`;
    await symlink("/private/tmp", link);
    try {
      await writeFile(meta, JSON.stringify({ ...original, shortDir: link }));
      await assertRejects(() => loadSandbox(root), Error, "shortDir");
    } finally {
      await rm(link, { force: true });
    }
    await writeFile(meta, JSON.stringify(original));
  });
});

test("exec refuses a working directory outside the sandbox", async () => {
  await withSandbox(async (root) => {
    for (const cwd of ["/", "../..", tmpdir()]) {
      const result = await cli(["exec", root, "--cwd", cwd, "--", "pwd"]);
      assertEquals(result.code, 2, `${cwd}: ${result.stdout}`);
      assertStringIncludes(result.stderr, "outside the sandbox");
    }
    assertEquals(
      (await cli(["exec", root, "--cwd", "home", "--", "true"])).code,
      0,
    );
  });
});

test("scp and sftp go through the key-less ssh shim", async () => {
  await withSandbox(async (root) => {
    const sb = await loadSandbox(root);
    for (const name of ["scp", "sftp"]) {
      const body = await readFile(join(sb.shortDir, "bin", name), "utf8");
      assertStringIncludes(body, `-S ${join(sb.shortDir, "bin", "ssh")}`);
    }
    assertStringIncludes(
      await readFile(join(sb.shortDir, "bin", "ssh"), "utf8"),
      "UserKnownHostsFile=",
    );
  });
});

test(
  "a background process the product leaves survives a normal exit and destroy stops it",
  async () => {
    const base = await mkdtemp(join(tmpdir(), "explore-sandbox-test-"));
    const root = join(base, "sb");
    try {
      await initSandbox(root);
      const result = await cli([
        "exec",
        root,
        "--",
        "sh",
        "-c",
        "sleep 30 >/dev/null 2>&1 &",
      ]);
      assertEquals(result.code, 0, result.stderr);
      await new Promise((r) => setTimeout(r, 300));
      const sb = await loadSandbox(root);
      assert(
        (await sandboxProcesses([sb.root])).some((p) => p.command === "sleep"),
      );
      const pid = (await sandboxProcesses([sb.root])).find((p) =>
        p.command === "sleep"
      )!.pid;
      const destroyed = await cli(["destroy", root]);
      assertStringIncludes(destroyed.stdout, "stopped sleep");
      assertEquals(alive(pid), false);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  },
  20000,
);

test("a shell started inside keeps the ssh shim first on PATH", async () => {
  await withSandbox(async (root) => {
    const shim = join((await loadSandbox(root)).shortDir, "bin", "ssh");
    for (
      const cmd of [["sh", "-c", 'exec "$SHELL" -c "command -v ssh"'], [
        "zsh",
        "-c",
        "command -v ssh",
      ]]
    ) {
      const result = await cli(["exec", root, "--", ...cmd]);
      assertEquals(result.stdout.trim(), shim, cmd.join(" "));
    }
  });
});

test("snapshot skips sockets and reset restores the saved state", async () => {
  await withSandbox(async (root) => {
    const sb = await loadSandbox(root);
    await writeFile(join(sb.state, "home", "data.txt"), "kept\n");
    const bound = await run("python3", [
      "-c",
      "import socket; socket.socket(socket.AF_UNIX).bind('s.sock')",
    ], {
      cwd: join(sb.state, "home"),
    });
    assertEquals(bound.code, 0, bound.stderr);
    assertEquals((await cli(["snapshot", root])).code, 0);
    await writeFile(join(sb.state, "home", "data.txt"), "changed\n");
    assertEquals((await cli(["reset", root])).code, 0);
    assertEquals(
      await readFile(join(sb.state, "home", "data.txt"), "utf8"),
      "kept\n",
    );
  });
});

test("exec refuses a timeout setTimeout cannot hold", async () => {
  await withSandbox(async (root) => {
    const result = await cli([
      "exec",
      root,
      "--timeout",
      "2147484",
      "--",
      "true",
    ]);
    assertEquals(result.code, 2);
  });
});

test("destroy stops a daemon that left the sandbox's directory", async () => {
  const base = await mkdtemp(join(tmpdir(), "explore-sandbox-test-"));
  const root = join(base, "sb");
  try {
    await initSandbox(root);
    const daemon =
      "import os,time\nif os.fork()==0:\n os.setsid(); os.chdir('/')\n if os.fork()==0:\n  time.sleep(60)\n os._exit(0)\n";
    const started = await cli([
      "exec",
      root,
      "--",
      "sh",
      "-c",
      `python3 -c "$0" >/dev/null 2>&1`,
      daemon,
    ]);
    assertEquals(started.code, 0, started.stderr);
    await new Promise((r) => setTimeout(r, 500));
    const sb = await loadSandbox(root);
    const found = await sandboxProcesses([sb.root, sb.shortDir]);
    assert(found.length > 0, "the daemon is found through its environment");
    const destroyed = await cli(["destroy", root]);
    assertStringIncludes(destroyed.stdout, "stopped");
    for (const p of found) {
      assertEquals(alive(p.pid), false, `${p.pid} ${p.command}`);
    }
  } finally {
    await cli(["destroy", root]);
    await rm(base, { recursive: true, force: true });
  }
}, 20000);
