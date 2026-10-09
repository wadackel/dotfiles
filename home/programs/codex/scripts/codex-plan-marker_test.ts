import { test } from "bun:test";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { randomUUID } from "node:crypto";
import fs, {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { run as runCommand } from "../../agents/lib/proc.ts";
import {
  activatePending,
  clearActive,
  clearMatching,
  cwdHash,
  getStatus,
  promote,
  requireActive,
  resolvePlan,
  run,
} from "./codex-plan-marker.ts";

const SCRIPT = join(import.meta.dirname, "codex-plan-marker.ts");

async function withHome<T>(
  run: (ctx: { home: string; cwd: string; hash: string }) => Promise<T>,
): Promise<T> {
  const originalHome = process.env.HOME;
  const home = await mkdtemp(join("/tmp", "codex-marker-home-"));
  const cwd = await mkdtemp(join("/tmp", "codex-marker-cwd-"));
  process.env.HOME = home;
  const hash = await cwdHash(cwd);
  try {
    return await run({ home, cwd, hash });
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(home, { recursive: true });
    await rm(cwd, { recursive: true });
  }
}

function pendingPath(home: string, hash: string): string {
  return `${home}/.codex/plans/.pending-${hash}`;
}

test("marker mutations cannot replace a pointer during matching cleanup", async () => {
  await withHome(async ({ home, cwd, hash }) => {
    const first = await writePlan(home);
    const second = await writePlan(home, "second.md");
    await activatePending(first, cwd);
    await resolvePlan(first, cwd);
    const read = fs.readFile;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let paused = false;
    fs.readFile = (async (
      path: Parameters<typeof read>[0],
      options: Parameters<typeof read>[1],
    ) => {
      const result = await read(path, options);
      if (String(path) === activePath(home, hash) && !paused) {
        paused = true;
        entered.resolve();
        await release.promise;
      }
      return result;
    }) as typeof fs.readFile;
    const clearing = clearMatching(first, cwd);
    try {
      await entered.promise;
      for (
        const operation of [
          () => activatePending(second, cwd),
          () => resolvePlan(second, cwd),
          () => clearActive(cwd),
        ]
      ) {
        await assertRejects(operation, Error, "locked");
      }
      assertEquals((await promote(cwd)).reason, "io-error");
    } finally {
      release.resolve();
      fs.readFile = read;
      await clearing;
    }
    await activatePending(second, cwd);
    assertEquals(await clearMatching(first, cwd), false);
    assertEquals((await getStatus(cwd)).planPath, second);
  });
});

test("resolve accepts expired markers and pins explicit plans across another run", async () => {
  await withHome(async ({ home, cwd, hash }) => {
    const plan = await writePlan(home);
    await activatePending(plan, cwd);
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(pendingPath(home, hash), stale, stale);
    assertEquals(await resolvePlan(undefined, cwd), plan);
    assertEquals((await getStatus(cwd)).state, "active");
    const other = await writePlan(home, "other.md");
    await activatePending(other, cwd);
    assertEquals(await resolvePlan(plan, cwd), plan);
    assertEquals((await getStatus(cwd)).planPath, other);
    await resolvePlan(undefined, cwd);
    assertEquals(await clearMatching(plan, cwd), false);
    assertEquals(await clearMatching(other, cwd), true);
  });
});

test("resolve rejects ambiguous plans and explicit symlinks", async () => {
  await withHome(async ({ home, cwd, hash }) => {
    const first = await writePlan(home);
    const second = await writePlan(home, "second.md");
    await writeFile(activePath(home, hash), first);
    await writeFile(pendingPath(home, hash), second);
    await assertRejects(() => resolvePlan(undefined, cwd), Error, "ambiguous");
    const link = `${home}/.codex/plans/link.md`;
    await symlink(first, link);
    await assertRejects(() => resolvePlan(link, cwd), Error, "regular file");
  });
});

function activePath(home: string, hash: string): string {
  return `${home}/.codex/plans/.active-${hash}`;
}

test("explicit resolution promotes its own pending marker and clears completion", async () => {
  await withHome(async ({ home, cwd }) => {
    const plan = await writePlan(home);
    await activatePending(plan, cwd);
    assertEquals(await resolvePlan(plan, cwd), plan);
    assertEquals((await getStatus(cwd)).state, "active");
    assertEquals(await clearMatching(plan, cwd), true);
    assertEquals((await getStatus(cwd)).state, "absent");
    await activatePending(plan, cwd);
    assertEquals(await clearMatching(plan, cwd), true);
    assertEquals((await getStatus(cwd)).state, "absent");
  });
});

async function writePlan(home: string, name = "plan.md"): Promise<string> {
  const path = `${home}/.codex/plans/${name}`;
  await mkdir(`${home}/.codex/plans`, { recursive: true });
  await writeFile(path, "# Plan\n");
  return await realpath(path);
}

test("activatePending writes pending marker and removes existing active marker", async () => {
  await withHome(async ({ home, cwd, hash }) => {
    const oldPlan = await writePlan(home, "old.md");
    const newPlan = await writePlan(home, "new.md");
    await writeFile(activePath(home, hash), `${oldPlan}\n`);

    const paths = await activatePending(newPlan, cwd);

    assertEquals(paths.pendingPath, pendingPath(home, hash));
    assertEquals(
      await readFile(pendingPath(home, hash), "utf8"),
      `${newPlan}\n`,
    );
    let activeExists = true;
    try {
      await stat(activePath(home, hash));
    } catch {
      activeExists = false;
    }
    assertEquals(activeExists, false);
  });
});

test("activatePending rejects relative plan paths", async () => {
  await withHome(async ({ cwd }) => {
    let message = "";
    try {
      await activatePending("relative-plan.md", cwd);
    } catch (err) {
      message = (err as Error).message;
    }
    assertStringIncludes(message, "absolute");
  });
});

test("getStatus reports pending, active, expired active, and absent states", async () => {
  await withHome(async ({ home, cwd, hash }) => {
    const plan = await writePlan(home);
    assertEquals((await getStatus(cwd)).state, "absent");

    await activatePending(plan, cwd);
    const pending = await getStatus(cwd);
    assertEquals(pending.state, "pending");
    assertEquals(pending.planPath, plan);

    const result = await promote(cwd);
    assertEquals(result.reason, "promoted");
    const active = await getStatus(cwd);
    assertEquals(active.state, "active");
    assertEquals(active.planPath, plan);

    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(activePath(home, hash), stale, stale);
    assertEquals((await getStatus(cwd)).state, "active-expired");
  });
});

test("requireActive prints only valid active plan path", async () => {
  await withHome(async ({ home, cwd }) => {
    const plan = await writePlan(home);
    await activatePending(plan, cwd);
    await promote(cwd);
    assertEquals(await requireActive(cwd), plan);
  });
});

test("requireActive rejects pending-only marker", async () => {
  await withHome(async ({ home, cwd }) => {
    const plan = await writePlan(home);
    await activatePending(plan, cwd);
    let message = "";
    try {
      await requireActive(cwd);
    } catch (err) {
      message = (err as Error).message;
    }
    assertStringIncludes(message, "not promoted");
  });
});

test("clearActive is idempotent", async () => {
  await withHome(async ({ home, cwd }) => {
    const plan = await writePlan(home);
    await activatePending(plan, cwd);
    await promote(cwd);
    assertEquals(await clearActive(cwd), true);
    assertEquals(await clearActive(cwd), false);
    assertEquals((await getStatus(cwd)).state, "absent");
  });
});

test("an active marker left as an empty directory is removed", async () => {
  await withHome(async ({ home, cwd, hash }) => {
    const active = `${home}/.codex/plans/.active-${hash}`;
    await mkdir(active, { recursive: true });
    assertEquals(await clearActive(cwd), true);
    await mkdir(active);
    await activatePending(await writePlan(home), cwd);
    assertEquals((await getStatus(cwd)).state, "pending");
  });
});

test("promote preserves active marker when one already exists", async () => {
  await withHome(async ({ home, cwd, hash }) => {
    const oldPlan = await writePlan(home, "old.md");
    const newPlan = await writePlan(home, "new.md");
    await writeFile(activePath(home, hash), `${oldPlan}\n`);
    await writeFile(pendingPath(home, hash), `${newPlan}\n`);

    const result = await promote(cwd);

    assertEquals(result.promoted, false);
    assertEquals(result.reason, "already-active");
    assertEquals(
      await readFile(activePath(home, hash), "utf8"),
      `${oldPlan}\n`,
    );
    assertEquals(
      await readFile(pendingPath(home, hash), "utf8"),
      `${newPlan}\n`,
    );
  });
});

test("promote rejects expired pending marker", async () => {
  await withHome(async ({ home, cwd, hash }) => {
    const plan = await writePlan(home);
    const pending = pendingPath(home, hash);
    await writeFile(pending, `${plan}\n`);
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(pending, stale, stale);

    const result = await promote(cwd);

    assertEquals(result.promoted, false);
    assertEquals(result.reason, "expired");
    assertEquals((await getStatus(cwd)).state, "pending-expired");
  });
});

test("run command parser activates, requires, and clears markers", async () => {
  await withHome(async ({ home, cwd }) => {
    const plan = await writePlan(home);
    await run(["activate-pending", plan, cwd]);

    let pendingError = "";
    try {
      await run(["require-active", cwd]);
    } catch (err) {
      pendingError = (err as Error).message;
    }
    assertStringIncludes(pendingError, "not promoted");

    const promoted = await promote(cwd);
    assertEquals(promoted.reason, "promoted");

    await run(["require-active", cwd]);
    await run(["clear-active", cwd]);
    assertEquals((await getStatus(cwd)).state, "absent");
  });
});

test("subprocess require-active validates absent, pending, active, and expired states", async () => {
  await withHome(async ({ home, cwd, hash }) => {
    const plan = await writePlan(home);
    const requireActive = () => runCommand(SCRIPT, ["require-active", cwd]);

    const absent = await requireActive();
    assertEquals(absent.code, 1);
    assertStringIncludes(absent.stderr, "no plan marker");

    const activate = await runCommand(SCRIPT, ["activate-pending", plan, cwd]);
    assertEquals(activate.code, 0);

    const pending = await requireActive();
    assertEquals(pending.code, 1);
    assertStringIncludes(pending.stderr, "not promoted");

    assertEquals((await promote(cwd)).reason, "promoted");
    const active = await requireActive();
    assertEquals(active.code, 0);
    assertEquals(active.stdout, `${plan}\n`);

    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(activePath(home, hash), stale, stale);
    const expired = await requireActive();
    assertEquals(expired.code, 1);
    assertStringIncludes(
      expired.stderr,
      "active plan marker for this cwd is expired",
    );
  });
});

test("getStatus rejects symlinked markers", async () => {
  await withHome(async ({ home, cwd, hash }) => {
    const plan = await writePlan(home);
    await symlink(plan, activePath(home, hash));

    let message = "";
    try {
      await getStatus(cwd);
    } catch (err) {
      message = (err as Error).message;
    }
    assertStringIncludes(message, "regular file");
  });
});

test("activatePending rejects plan paths outside the plans directory", async () => {
  await withHome(async ({ cwd }) => {
    const outside = join("/tmp", `${randomUUID()}.md`);
    await writeFile(outside, "", { flag: "wx" });
    let message = "";
    try {
      await activatePending(outside, cwd);
    } catch (err) {
      message = (err as Error).message;
    } finally {
      await rm(outside);
    }
    assertStringIncludes(message, "under");
  });
});

test("activatePending rejects a symlinked plans directory", async () => {
  await withHome(async ({ home, cwd }) => {
    const target = await mkdtemp(join("/tmp", "codex-marker-plans-target-"));
    await mkdir(`${home}/.codex`, { recursive: true });
    await symlink(target, `${home}/.codex/plans`);
    const plan = `${home}/.codex/plans/plan.md`;
    await writeFile(plan, "# Plan\n");

    let message = "";
    try {
      await activatePending(plan, cwd);
    } catch (err) {
      message = (err as Error).message;
    } finally {
      await rm(target, { recursive: true });
    }

    assertStringIncludes(message, "regular directory");
  });
});

test("subprocess promote command promotes a pending marker to active", async () => {
  await withHome(async ({ home, cwd }) => {
    const plan = await writePlan(home);

    // No pending marker yet → promote reports no-pending.
    const noPending = await runCommand(SCRIPT, ["promote", cwd]);
    assertEquals(noPending.code, 0);
    assertStringIncludes(noPending.stdout, "no-pending");

    await run(["activate-pending", plan, cwd]);

    const promoted = await runCommand(SCRIPT, ["promote", cwd]);
    assertEquals(promoted.code, 0);
    assertStringIncludes(promoted.stdout, "promoted");
    assertEquals((await getStatus(cwd)).state, "active");
  });
});
