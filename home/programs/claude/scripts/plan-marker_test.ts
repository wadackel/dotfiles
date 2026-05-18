import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { fromFileUrl } from "jsr:@std/path@1.1.4/from-file-url";
import {
  activatePending,
  clearActive,
  getStatus,
  promote,
  requireActive,
  run,
} from "./plan-marker.ts";
import { markerPaths } from "./plan-gate.ts";

const DEFAULT_SESSION = "session-A";

async function withHome<T>(
  runTest: (
    ctx: {
      home: string;
      sessionId: string;
      activePath: string;
      pendingPath: string;
    },
  ) => Promise<T>,
  sessionId: string = DEFAULT_SESSION,
): Promise<T> {
  const originalHome = Deno.env.get("HOME");
  const home = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "claude-marker-home-",
  });
  Deno.env.set("HOME", home);
  const paths = await markerPaths(sessionId);
  try {
    return await runTest({
      home,
      sessionId,
      activePath: paths.activePath,
      pendingPath: paths.pendingPath,
    });
  } finally {
    if (originalHome === undefined) {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", originalHome);
    }
    await Deno.remove(home, { recursive: true });
  }
}

async function writePlan(home: string, name = "plan.md"): Promise<string> {
  const path = `${home}/.claude/plans/${name}`;
  await Deno.mkdir(`${home}/.claude/plans`, { recursive: true });
  await Deno.writeTextFile(path, "# Plan\n");
  return await Deno.realPath(path);
}

Deno.test("activatePending writes pending marker and removes existing active marker", async () => {
  await withHome(async ({ home, sessionId, activePath, pendingPath }) => {
    const oldPlan = await writePlan(home, "old.md");
    const newPlan = await writePlan(home, "new.md");
    await Deno.writeTextFile(activePath, `${oldPlan}\n`);

    const paths = await activatePending(newPlan, sessionId);

    assertEquals(paths.pendingPath, pendingPath);
    assertEquals(await Deno.readTextFile(pendingPath), `${newPlan}\n`);
    let activeExists = true;
    try {
      await Deno.stat(activePath);
    } catch {
      activeExists = false;
    }
    assertEquals(activeExists, false);
  });
});

Deno.test("activatePending rejects relative plan paths", async () => {
  await withHome(async ({ sessionId }) => {
    let message = "";
    try {
      await activatePending("relative-plan.md", sessionId);
    } catch (err) {
      message = (err as Error).message;
    }
    assertStringIncludes(message, "absolute");
  });
});

Deno.test("getStatus reports pending, active, expired active, and absent states", async () => {
  await withHome(async ({ home, sessionId, activePath }) => {
    const plan = await writePlan(home);
    assertEquals((await getStatus(sessionId)).state, "absent");

    await activatePending(plan, sessionId);
    const pending = await getStatus(sessionId);
    assertEquals(pending.state, "pending");
    assertEquals(pending.planPath, plan);

    const result = await promote(sessionId);
    assertEquals(result.reason, "promoted");
    const active = await getStatus(sessionId);
    assertEquals(active.state, "active");
    assertEquals(active.planPath, plan);

    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await Deno.utime(activePath, stale, stale);
    assertEquals((await getStatus(sessionId)).state, "active-expired");
  });
});

Deno.test("requireActive prints only valid active plan path", async () => {
  await withHome(async ({ home, sessionId }) => {
    const plan = await writePlan(home);
    await activatePending(plan, sessionId);
    await promote(sessionId);
    assertEquals(await requireActive(sessionId), plan);
  });
});

Deno.test("requireActive rejects pending-only marker", async () => {
  await withHome(async ({ home, sessionId }) => {
    const plan = await writePlan(home);
    await activatePending(plan, sessionId);
    let message = "";
    try {
      await requireActive(sessionId);
    } catch (err) {
      message = (err as Error).message;
    }
    assertStringIncludes(message, "not approved");
  });
});

Deno.test("clearActive is idempotent", async () => {
  await withHome(async ({ home, sessionId }) => {
    const plan = await writePlan(home);
    await activatePending(plan, sessionId);
    await promote(sessionId);
    assertEquals(await clearActive(sessionId), true);
    assertEquals(await clearActive(sessionId), false);
    assertEquals((await getStatus(sessionId)).state, "absent");
  });
});

Deno.test("promote preserves active marker when one already exists", async () => {
  await withHome(async ({ home, sessionId, activePath, pendingPath }) => {
    const oldPlan = await writePlan(home, "old.md");
    const newPlan = await writePlan(home, "new.md");
    await Deno.writeTextFile(activePath, `${oldPlan}\n`);
    await Deno.writeTextFile(pendingPath, `${newPlan}\n`);

    const result = await promote(sessionId);

    assertEquals(result.promoted, false);
    assertEquals(result.reason, "already-active");
    assertEquals(await Deno.readTextFile(activePath), `${oldPlan}\n`);
    assertEquals(await Deno.readTextFile(pendingPath), `${newPlan}\n`);
  });
});

Deno.test("promote rejects expired pending marker", async () => {
  await withHome(async ({ home, sessionId, pendingPath }) => {
    const plan = await writePlan(home);
    await Deno.writeTextFile(pendingPath, `${plan}\n`);
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await Deno.utime(pendingPath, stale, stale);

    const result = await promote(sessionId);

    assertEquals(result.promoted, false);
    assertEquals(result.reason, "expired");
    assertEquals((await getStatus(sessionId)).state, "pending-expired");
  });
});

Deno.test("run command parser activates, requires, and clears markers", async () => {
  await withHome(async ({ home, sessionId }) => {
    const plan = await writePlan(home);
    await run(["activate-pending", plan, sessionId]);

    let pendingError = "";
    try {
      await run(["require-active", sessionId]);
    } catch (err) {
      pendingError = (err as Error).message;
    }
    assertStringIncludes(pendingError, "not approved");

    const promoted = await promote(sessionId);
    assertEquals(promoted.reason, "promoted");

    await run(["require-active", sessionId]);
    await run(["clear-active", sessionId]);
    assertEquals((await getStatus(sessionId)).state, "absent");
  });
});

Deno.test("subprocess require-active validates absent, pending, active, and expired states", async () => {
  const scriptPath = fromFileUrl(new URL("./plan-marker.ts", import.meta.url));
  const runPermission = await Deno.permissions.query({
    name: "run",
    command: scriptPath,
  });
  if (runPermission.state !== "granted") {
    console.log("skipping subprocess assertions; run permission not granted");
    return;
  }

  await withHome(async ({ home, sessionId, activePath }) => {
    const plan = await writePlan(home);
    const requireActiveCmd = () =>
      new Deno.Command(scriptPath, {
        args: ["require-active", sessionId],
        stdout: "piped",
        stderr: "piped",
      }).output();

    const absent = await requireActiveCmd();
    assertEquals(absent.code, 1);
    assertStringIncludes(
      new TextDecoder().decode(absent.stderr),
      "No active plan",
    );

    const activate = await new Deno.Command(scriptPath, {
      args: ["activate-pending", plan, sessionId],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(activate.code, 0);

    const pending = await requireActiveCmd();
    assertEquals(pending.code, 1);
    assertStringIncludes(
      new TextDecoder().decode(pending.stderr),
      "not approved",
    );

    assertEquals((await promote(sessionId)).reason, "promoted");
    const active = await requireActiveCmd();
    assertEquals(active.code, 0);
    assertEquals(new TextDecoder().decode(active.stdout), `${plan}\n`);

    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await Deno.utime(activePath, stale, stale);
    const expired = await requireActiveCmd();
    assertEquals(expired.code, 1);
    assertStringIncludes(
      new TextDecoder().decode(expired.stderr),
      "active marker expired",
    );
  });
});

Deno.test("getStatus rejects symlinked markers", async () => {
  await withHome(async ({ home, sessionId, activePath }) => {
    const plan = await writePlan(home);
    await Deno.symlink(plan, activePath);

    let message = "";
    try {
      await getStatus(sessionId);
    } catch (err) {
      message = (err as Error).message;
    }
    assertStringIncludes(message, "regular file");
  });
});

Deno.test("activatePending rejects plan paths outside the plans directory", async () => {
  await withHome(async ({ sessionId }) => {
    const outside = await Deno.makeTempFile({ dir: "/tmp", suffix: ".md" });
    let message = "";
    try {
      await activatePending(outside, sessionId);
    } catch (err) {
      message = (err as Error).message;
    } finally {
      await Deno.remove(outside);
    }
    assertStringIncludes(message, "under");
  });
});

Deno.test("activatePending rejects a symlinked plans directory", async () => {
  await withHome(async ({ home, sessionId }) => {
    const target = await Deno.makeTempDir({
      dir: "/tmp",
      prefix: "claude-marker-plans-target-",
    });
    await Deno.mkdir(`${home}/.claude`, { recursive: true });
    await Deno.symlink(target, `${home}/.claude/plans`);
    const plan = `${home}/.claude/plans/plan.md`;
    await Deno.writeTextFile(plan, "# Plan\n");

    let message = "";
    try {
      await activatePending(plan, sessionId);
    } catch (err) {
      message = (err as Error).message;
    } finally {
      await Deno.remove(target, { recursive: true });
    }

    assertStringIncludes(message, "regular directory");
  });
});

Deno.test("subprocess promote command is not exposed", async () => {
  const scriptPath = fromFileUrl(new URL("./plan-marker.ts", import.meta.url));
  const runPermission = await Deno.permissions.query({
    name: "run",
    command: scriptPath,
  });
  if (runPermission.state !== "granted") {
    console.log("skipping subprocess assertions; run permission not granted");
    return;
  }

  await withHome(async ({ sessionId }) => {
    const output = await new Deno.Command(scriptPath, {
      args: ["promote", sessionId],
      stdout: "piped",
      stderr: "piped",
    }).output();

    assertEquals(output.code, 1);
    assertStringIncludes(new TextDecoder().decode(output.stderr), "Usage:");
  });
});

// --- Cross-session isolation: 本修正の invariant ---

Deno.test("cross-session: session A の pending は session B からは absent", async () => {
  const originalHome = Deno.env.get("HOME");
  const home = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "claude-marker-cross-home-",
  });
  Deno.env.set("HOME", home);
  try {
    const plan = await writePlan(home);
    await activatePending(plan, "session-A");
    const statusA = await getStatus("session-A");
    assertEquals(statusA.state, "pending");

    const statusB = await getStatus("session-B");
    assertEquals(statusB.state, "absent");
  } finally {
    if (originalHome === undefined) {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", originalHome);
    }
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("cross-session: session A の active marker (promote 後) は session B から require-active で absent エラー", async () => {
  const originalHome = Deno.env.get("HOME");
  const home = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "claude-marker-cross-home-",
  });
  Deno.env.set("HOME", home);
  try {
    const plan = await writePlan(home);
    await activatePending(plan, "session-A");
    await promote("session-A");
    // session A は active 状態
    assertEquals(await requireActive("session-A"), plan);

    // session B からは absent
    let messageB = "";
    try {
      await requireActive("session-B");
    } catch (err) {
      messageB = (err as Error).message;
    }
    assertStringIncludes(messageB, "No active plan");
  } finally {
    if (originalHome === undefined) {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", originalHome);
    }
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("cross-session: session A の clear-active は session B の active marker に影響しない", async () => {
  const originalHome = Deno.env.get("HOME");
  const home = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "claude-marker-cross-home-",
  });
  Deno.env.set("HOME", home);
  try {
    const plan = await writePlan(home);
    // 両セッションを active 化
    await activatePending(plan, "session-A");
    await promote("session-A");
    await activatePending(plan, "session-B");
    await promote("session-B");
    assertEquals((await getStatus("session-A")).state, "active");
    assertEquals((await getStatus("session-B")).state, "active");

    // session A だけクリア
    assertEquals(await clearActive("session-A"), true);
    assertEquals((await getStatus("session-A")).state, "absent");
    // session B は影響なし
    assertEquals((await getStatus("session-B")).state, "active");
  } finally {
    if (originalHome === undefined) {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", originalHome);
    }
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("CLI: activate-pending without session_id → exit 1 usage", async () => {
  const scriptPath = fromFileUrl(new URL("./plan-marker.ts", import.meta.url));
  const runPermission = await Deno.permissions.query({
    name: "run",
    command: scriptPath,
  });
  if (runPermission.state !== "granted") {
    console.log("skipping subprocess assertions; run permission not granted");
    return;
  }

  await withHome(async ({ home }) => {
    const plan = await writePlan(home);
    const output = await new Deno.Command(scriptPath, {
      args: ["activate-pending", plan], // session-id omitted
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 1);
    assertStringIncludes(
      new TextDecoder().decode(output.stderr),
      "session-id is required",
    );
  });
});

Deno.test("CLI: require-active without session_id → exit 1 usage", async () => {
  const scriptPath = fromFileUrl(new URL("./plan-marker.ts", import.meta.url));
  const runPermission = await Deno.permissions.query({
    name: "run",
    command: scriptPath,
  });
  if (runPermission.state !== "granted") {
    console.log("skipping subprocess assertions; run permission not granted");
    return;
  }

  await withHome(async () => {
    const output = await new Deno.Command(scriptPath, {
      args: ["require-active"], // session-id omitted
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 1);
    assertStringIncludes(
      new TextDecoder().decode(output.stderr),
      "session-id is required",
    );
  });
});
