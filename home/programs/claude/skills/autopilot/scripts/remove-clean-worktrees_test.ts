import { assert, assertEquals, assertMatch } from "@std/assert";
import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../../../agents/lib/proc.ts";

const SCRIPT = join(import.meta.dirname, "remove-clean-worktrees.ts");
const BUN_FLAGS = ["--no-env-file", "--no-install", "--config=/dev/null"];
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

type Cli = (args: string[]) => ReturnType<typeof run>;

const cliIn = (cwd: string): Cli => (args) =>
  run(process.execPath, [...BUN_FLAGS, SCRIPT, ...args], { cwd, env: GIT_ENV });

async function git(cwd: string, ...args: string[]) {
  const r = await run("git", ["-C", cwd, ...args], { env: GIT_ENV });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

type Repo = {
  base: string;
  main: string;
  add: (name: string) => Promise<string>;
  /** The script run from the main worktree, as the controller runs it. */
  cli: Cli;
};

async function withRepo(fn: (repo: Repo) => Promise<void>): Promise<void> {
  const base = await realpath(
    await mkdtemp(join(tmpdir(), "remove-clean-worktrees-")),
  );
  const main = join(base, "main");
  try {
    await git(base, "init", "-q", "-b", "main", main);
    await writeFile(join(main, ".gitignore"), "build/\n");
    await writeFile(join(main, "a.txt"), "a\n");
    await git(main, "add", ".");
    await git(main, "commit", "-q", "-m", "init");
    const add = async (name: string) => {
      const path = join(base, name);
      await git(main, "worktree", "add", "-q", "-b", name, path);
      return path;
    };
    await fn({ base, main, add, cli: cliIn(main) });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

const lockOf = async (main: string, path: string) => {
  const list = await git(main, "worktree", "list", "--porcelain");
  const block = list.split("\n\n").find((b) =>
    b.startsWith(`worktree ${path}\n`)
  );
  return block?.split("\n").find((l) => l.startsWith("locked")) ?? null;
};

test("a worktree with no uncommitted work is removed and its branch kept", async () => {
  await withRepo(async ({ cli, main, add }) => {
    const wt = await add("clean");
    const r = await cli([wt]);
    assertEquals(r.code, 0);
    assertEquals(r.stdout, `removed ${wt}\n`);
    assert(!existsSync(wt));
    assertEquals(
      (await git(main, "branch", "--list", "clean")).trim(),
      "clean",
    );
  });
});

test("a worktree with a modified tracked file is kept and listed", async () => {
  await withRepo(async ({ cli, add }) => {
    const wt = await add("modified");
    await writeFile(join(wt, "a.txt"), "changed\n");
    const r = await cli([wt]);
    assertEquals(r.code, 0);
    assertEquals(r.stdout, `kept ${wt}: 1 uncommitted ( M a.txt)\n`);
    assert(existsSync(join(wt, "a.txt")));
  });
});

test("a worktree with an untracked file is kept and listed", async () => {
  await withRepo(async ({ cli, add }) => {
    const wt = await add("untracked");
    await writeFile(join(wt, "new.txt"), "n\n");
    const r = await cli([wt]);
    assertEquals(r.stdout, `kept ${wt}: 1 uncommitted (?? new.txt)\n`);
    assert(existsSync(join(wt, "new.txt")));
  });
});

test("ignored files alone do not keep a worktree", async () => {
  await withRepo(async ({ cli, add }) => {
    const wt = await add("ignored");
    await mkdir(join(wt, "build"));
    await writeFile(join(wt, "build", "out"), "o\n");
    const r = await cli([wt]);
    assertEquals(r.stdout, `removed ${wt}\n`);
    assert(!existsSync(wt));
  });
});

test("a locked worktree with no uncommitted work is unlocked and removed", async () => {
  await withRepo(async ({ cli, main, add }) => {
    const wt = await add("locked-clean");
    await git(
      main,
      "worktree",
      "lock",
      "--reason",
      "claude agent x (pid 1)",
      wt,
    );
    const r = await cli([wt]);
    assertEquals(r.stdout, `removed ${wt}\n`);
    assert(!existsSync(wt));
  });
});

test("a locked worktree with uncommitted work stays locked", async () => {
  await withRepo(async ({ cli, main, add }) => {
    const wt = await add("locked-dirty");
    await git(main, "worktree", "lock", "--reason", "claude agent y", wt);
    await writeFile(join(wt, "new.txt"), "n\n");
    const r = await cli([wt]);
    assertEquals(r.stdout, `kept ${wt}: 1 uncommitted (?? new.txt)\n`);
    assertEquals(await lockOf(main, wt), "locked claude agent y");
  });
});

test("a locked worktree that git refuses to remove gets its lock back", async () => {
  await withRepo(async ({ cli, base, main, add }) => {
    const other = join(base, "other");
    await git(base, "init", "-q", "-b", "main", other);
    await git(other, "commit", "-q", "--allow-empty", "-m", "o");
    const wt = await add("with-submodule");
    await git(
      wt,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "-q",
      other,
      "sub",
    );
    await git(wt, "commit", "-q", "-m", "sub");
    await git(main, "worktree", "lock", "--reason", " claude agent z ", wt);
    const r = await cli([wt]);
    assertMatch(
      r.stdout,
      new RegExp(`^kept ${wt}: git worktree remove refused: .*submodules`),
    );
    assert(existsSync(wt));
    const lockFile = await git(
      wt,
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "locked",
    );
    assertEquals(await readFile(lockFile.trim(), "utf8"), " claude agent z \n");
  });
});

test("an untracked file keeps a worktree even when the config hides untracked files", async () => {
  await withRepo(async ({ cli, main, add }) => {
    await git(main, "config", "status.showUntrackedFiles", "no");
    const wt = await add("hidden-untracked");
    await writeFile(join(wt, "notes.txt"), "n\n");
    const r = await cli([wt]);
    assertEquals(r.stdout, `kept ${wt}: 1 uncommitted (?? notes.txt)\n`);
  });
});

test("a change to a skip-worktree file keeps the worktree", async () => {
  await withRepo(async ({ cli, add }) => {
    const wt = await add("skip");
    await git(wt, "update-index", "--skip-worktree", "a.txt");
    await writeFile(join(wt, "a.txt"), "changed\n");
    const r = await cli([wt]);
    assertEquals(
      r.stdout,
      `kept ${wt}: 1 files git status does not compare (S a.txt)\n`,
    );
  });
});

test("a worktree holding another worktree under an ignored directory is kept", async () => {
  await withRepo(async ({ cli, main, add }) => {
    const wt = await add("parent");
    const inner = join(wt, "build", "child");
    await git(main, "worktree", "add", "-q", "-b", "child", inner);
    await writeFile(join(inner, "wip.txt"), "w\n");
    const r = await cli([wt]);
    assertEquals(r.stdout, `kept ${wt}: holds the worktree ${inner}\n`);
    assert(existsSync(join(inner, "wip.txt")));
  });
});

test("a worktree of a repository other than the current directory's is kept", async () => {
  await withRepo(async ({ base, add }) => {
    const wt = await add("elsewhere");
    const other = join(base, "other");
    await git(base, "init", "-q", "-b", "main", other);
    const r = await cliIn(other)([wt]);
    assertEquals(
      r.stdout,
      `kept ${wt}: a worktree of another repository than the current directory's\n`,
    );
    assert(existsSync(wt));
  });
});

test("a detached HEAD whose commits no ref contains is kept", async () => {
  await withRepo(async ({ cli, add }) => {
    const wt = await add("detached-lost");
    await git(wt, "switch", "-q", "--detach");
    await git(wt, "commit", "-q", "--allow-empty", "-m", "only here");
    const r = await cli([wt]);
    assertEquals(
      r.stdout,
      `kept ${wt}: detached HEAD with commits no ref contains\n`,
    );
    assert(existsSync(wt));
  });
});

test("a detached HEAD on a commit a branch contains is removed", async () => {
  await withRepo(async ({ cli, add }) => {
    const wt = await add("detached-safe");
    await git(wt, "switch", "-q", "--detach");
    const r = await cli([wt]);
    assertEquals(r.stdout, `removed ${wt}\n`);
  });
});

test("a paused rebase is kept even with a clean status", async () => {
  await withRepo(async ({ cli, add }) => {
    const wt = await add("rebasing");
    await git(wt, "commit", "-q", "--allow-empty", "-m", "one");
    await git(wt, "commit", "-q", "--allow-empty", "-m", "two");
    const r0 = await run(
      "git",
      ["-C", wt, "rebase", "-q", "--keep-empty", "-i", "HEAD~1"],
      { env: { ...GIT_ENV, GIT_SEQUENCE_EDITOR: "sed -i.bak s/^pick/edit/" } },
    );
    assertEquals(r0.code, 0, r0.stderr);
    assertEquals((await git(wt, "status", "--porcelain")).trim(), "");
    const r = await cli([wt]);
    assertEquals(r.stdout, `kept ${wt}: rebase-merge in progress\n`);
  });
});

test("a cherry-pick sequence with picks left is kept after one stop is resolved", async () => {
  await withRepo(async ({ cli, main, add }) => {
    await git(main, "switch", "-q", "-c", "src");
    for (const n of ["1", "2", "3"]) {
      await writeFile(join(main, "a.txt"), `${n}\n`);
      await git(main, "commit", "-q", "-am", n);
    }
    await git(main, "switch", "-q", "main");
    const wt = await add("picking");
    await writeFile(join(wt, "a.txt"), "x\n");
    await git(wt, "commit", "-q", "-am", "x");
    const pick = await run("git", ["-C", wt, "cherry-pick", "src~3..src"], {
      env: GIT_ENV,
    });
    assert(pick.code !== 0);
    await writeFile(join(wt, "a.txt"), "1\n");
    await git(wt, "add", "a.txt");
    await git(wt, "-c", "core.editor=true", "commit", "-q", "--no-edit");
    assertEquals((await git(wt, "status", "--porcelain")).trim(), "");
    const r = await cli([wt]);
    assertEquals(r.stdout, `kept ${wt}: sequencer in progress\n`);
  });
});

test("the main worktree, a subdirectory, and a missing path are kept", async () => {
  await withRepo(async ({ cli, base, main, add }) => {
    const wt = await add("sub-dir");
    const inner = join(wt, "inner");
    await mkdir(inner);
    const missing = join(base, "gone");
    const r = await cli([main, inner, missing]);
    assertEquals(
      r.stdout,
      [
        `kept ${main}: the main worktree`,
        `kept ${inner}: not the top of a worktree (that is ${wt})`,
        `kept ${missing}: no such directory`,
        "",
      ].join("\n"),
    );
    assert(existsSync(main) && existsSync(wt));
  });
});

test("each path is handled in turn and the output lists every one", async () => {
  await withRepo(async ({ cli, add }) => {
    const clean = await add("one");
    const dirty = await add("two");
    await writeFile(join(dirty, "new.txt"), "n\n");
    const r = await cli([clean, dirty]);
    assertEquals(
      r.stdout,
      `removed ${clean}\nkept ${dirty}: 1 uncommitted (?? new.txt)\n`,
    );
  });
});

test("no path, or an option, is a usage error", async () => {
  const cli = cliIn(tmpdir());
  assertEquals((await cli([])).code, 2);
  assertEquals((await cli(["--force"])).code, 2);
});
