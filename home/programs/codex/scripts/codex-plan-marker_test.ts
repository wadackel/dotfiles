import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { fromFileUrl } from "jsr:@std/path@1.1.4/from-file-url";
import {
  activatePending,
  clearActive,
  getStatus,
  promote,
  requireActive,
  run,
} from "./codex-plan-marker.ts";
import { cwdHash } from "./codex-plan-gate.ts";

async function withHome<T>(
  run: (ctx: { home: string; cwd: string; hash: string }) => Promise<T>,
): Promise<T> {
  const originalHome = Deno.env.get("HOME");
  const home = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "codex-marker-home-",
  });
  const cwd = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "codex-marker-cwd-",
  });
  Deno.env.set("HOME", home);
  const hash = await cwdHash(cwd);
  try {
    return await run({ home, cwd, hash });
  } finally {
    if (originalHome === undefined) {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", originalHome);
    }
    await Deno.remove(home, { recursive: true });
    await Deno.remove(cwd, { recursive: true });
  }
}

function pendingPath(home: string, hash: string): string {
  return `${home}/.codex/plans/.pending-${hash}`;
}

function activePath(home: string, hash: string): string {
  return `${home}/.codex/plans/.active-${hash}`;
}

async function writePlan(home: string, name = "plan.md"): Promise<string> {
  const path = `${home}/.codex/plans/${name}`;
  await Deno.mkdir(`${home}/.codex/plans`, { recursive: true });
  await Deno.writeTextFile(path, "# Plan\n");
  return await Deno.realPath(path);
}

Deno.test("activatePending writes pending marker and removes existing active marker", async () => {
  await withHome(async ({ home, cwd, hash }) => {
    const oldPlan = await writePlan(home, "old.md");
    const newPlan = await writePlan(home, "new.md");
    await Deno.writeTextFile(activePath(home, hash), `${oldPlan}\n`);

    const paths = await activatePending(newPlan, cwd);

    assertEquals(paths.pendingPath, pendingPath(home, hash));
    assertEquals(
      await Deno.readTextFile(pendingPath(home, hash)),
      `${newPlan}\n`,
    );
    let activeExists = true;
    try {
      await Deno.stat(activePath(home, hash));
    } catch {
      activeExists = false;
    }
    assertEquals(activeExists, false);
  });
});

Deno.test("activatePending rejects relative plan paths", async () => {
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

Deno.test("getStatus reports pending, active, expired active, and absent states", async () => {
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
    await Deno.utime(activePath(home, hash), stale, stale);
    assertEquals((await getStatus(cwd)).state, "active-expired");
  });
});

Deno.test("requireActive prints only valid active plan path", async () => {
  await withHome(async ({ home, cwd }) => {
    const plan = await writePlan(home);
    await activatePending(plan, cwd);
    await promote(cwd);
    assertEquals(await requireActive(cwd), plan);
  });
});

Deno.test("requireActive rejects pending-only marker", async () => {
  await withHome(async ({ home, cwd }) => {
    const plan = await writePlan(home);
    await activatePending(plan, cwd);
    let message = "";
    try {
      await requireActive(cwd);
    } catch (err) {
      message = (err as Error).message;
    }
    assertStringIncludes(message, "not approved");
  });
});

Deno.test("clearActive is idempotent", async () => {
  await withHome(async ({ home, cwd }) => {
    const plan = await writePlan(home);
    await activatePending(plan, cwd);
    await promote(cwd);
    assertEquals(await clearActive(cwd), true);
    assertEquals(await clearActive(cwd), false);
    assertEquals((await getStatus(cwd)).state, "absent");
  });
});

Deno.test("promote preserves active marker when one already exists", async () => {
  await withHome(async ({ home, cwd, hash }) => {
    const oldPlan = await writePlan(home, "old.md");
    const newPlan = await writePlan(home, "new.md");
    await Deno.writeTextFile(activePath(home, hash), `${oldPlan}\n`);
    await Deno.writeTextFile(pendingPath(home, hash), `${newPlan}\n`);

    const result = await promote(cwd);

    assertEquals(result.promoted, false);
    assertEquals(result.reason, "already-active");
    assertEquals(
      await Deno.readTextFile(activePath(home, hash)),
      `${oldPlan}\n`,
    );
    assertEquals(
      await Deno.readTextFile(pendingPath(home, hash)),
      `${newPlan}\n`,
    );
  });
});

Deno.test("promote rejects expired pending marker", async () => {
  await withHome(async ({ home, cwd, hash }) => {
    const plan = await writePlan(home);
    const pending = pendingPath(home, hash);
    await Deno.writeTextFile(pending, `${plan}\n`);
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await Deno.utime(pending, stale, stale);

    const result = await promote(cwd);

    assertEquals(result.promoted, false);
    assertEquals(result.reason, "expired");
    assertEquals((await getStatus(cwd)).state, "pending-expired");
  });
});

Deno.test("run command parser activates, requires, and clears markers", async () => {
  await withHome(async ({ home, cwd }) => {
    const plan = await writePlan(home);
    await run(["activate-pending", plan, cwd]);

    let pendingError = "";
    try {
      await run(["require-active", cwd]);
    } catch (err) {
      pendingError = (err as Error).message;
    }
    assertStringIncludes(pendingError, "not approved");

    const promoted = await promote(cwd);
    assertEquals(promoted.reason, "promoted");

    await run(["require-active", cwd]);
    await run(["clear-active", cwd]);
    assertEquals((await getStatus(cwd)).state, "absent");
  });
});

Deno.test("subprocess require-active validates absent, pending, active, and expired states", async () => {
  const scriptPath = fromFileUrl(
    new URL("./codex-plan-marker.ts", import.meta.url),
  );
  const runPermission = await Deno.permissions.query({
    name: "run",
    command: scriptPath,
  });
  if (runPermission.state !== "granted") {
    console.log("skipping subprocess assertions; run permission not granted");
    return;
  }

  await withHome(async ({ home, cwd, hash }) => {
    const plan = await writePlan(home);
    const requireActive = () =>
      new Deno.Command(scriptPath, {
        args: ["require-active", cwd],
        stdout: "piped",
        stderr: "piped",
      }).output();

    const absent = await requireActive();
    assertEquals(absent.code, 1);
    assertStringIncludes(
      new TextDecoder().decode(absent.stderr),
      "No active plan",
    );

    const activate = await new Deno.Command(scriptPath, {
      args: ["activate-pending", plan, cwd],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(activate.code, 0);

    const pending = await requireActive();
    assertEquals(pending.code, 1);
    assertStringIncludes(
      new TextDecoder().decode(pending.stderr),
      "not approved",
    );

    assertEquals((await promote(cwd)).reason, "promoted");
    const active = await requireActive();
    assertEquals(active.code, 0);
    assertEquals(new TextDecoder().decode(active.stdout), `${plan}\n`);

    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await Deno.utime(activePath(home, hash), stale, stale);
    const expired = await requireActive();
    assertEquals(expired.code, 1);
    assertStringIncludes(
      new TextDecoder().decode(expired.stderr),
      "active marker expired",
    );
  });
});

Deno.test("getStatus rejects symlinked markers", async () => {
  await withHome(async ({ home, cwd, hash }) => {
    const plan = await writePlan(home);
    await Deno.symlink(plan, activePath(home, hash));

    let message = "";
    try {
      await getStatus(cwd);
    } catch (err) {
      message = (err as Error).message;
    }
    assertStringIncludes(message, "regular file");
  });
});

Deno.test("activatePending rejects plan paths outside the plans directory", async () => {
  await withHome(async ({ cwd }) => {
    const outside = await Deno.makeTempFile({ dir: "/tmp", suffix: ".md" });
    let message = "";
    try {
      await activatePending(outside, cwd);
    } catch (err) {
      message = (err as Error).message;
    } finally {
      await Deno.remove(outside);
    }
    assertStringIncludes(message, "under");
  });
});

Deno.test("activatePending rejects a symlinked plans directory", async () => {
  await withHome(async ({ home, cwd }) => {
    const target = await Deno.makeTempDir({
      dir: "/tmp",
      prefix: "codex-marker-plans-target-",
    });
    await Deno.mkdir(`${home}/.codex`, { recursive: true });
    await Deno.symlink(target, `${home}/.codex/plans`);
    const plan = `${home}/.codex/plans/plan.md`;
    await Deno.writeTextFile(plan, "# Plan\n");

    let message = "";
    try {
      await activatePending(plan, cwd);
    } catch (err) {
      message = (err as Error).message;
    } finally {
      await Deno.remove(target, { recursive: true });
    }

    assertStringIncludes(message, "regular directory");
  });
});

Deno.test("subprocess promote command is not exposed", async () => {
  const scriptPath = fromFileUrl(
    new URL("./codex-plan-marker.ts", import.meta.url),
  );
  const runPermission = await Deno.permissions.query({
    name: "run",
    command: scriptPath,
  });
  if (runPermission.state !== "granted") {
    console.log("skipping subprocess assertions; run permission not granted");
    return;
  }

  await withHome(async ({ cwd }) => {
    const output = await new Deno.Command(scriptPath, {
      args: ["promote", cwd],
      stdout: "piped",
      stderr: "piped",
    }).output();

    assertEquals(output.code, 1);
    assertStringIncludes(new TextDecoder().decode(output.stderr), "Usage:");
  });
});
