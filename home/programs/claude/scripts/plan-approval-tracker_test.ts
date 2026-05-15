import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { fromFileUrl } from "jsr:@std/path@1.1.4/from-file-url";
import { markerPaths } from "./plan-gate.ts";
import { isApprovalPrompt, promote } from "./plan-approval-tracker.ts";

// --- Test helpers ---

const testHome = await Deno.makeTempDir({
  dir: "/tmp",
  prefix: "claude-approval-home-",
});
const originalHome = Deno.env.get("HOME");
Deno.env.set("HOME", testHome);

const DEFAULT_SESSION = "session-A";

const createdPlans = new Set<string>();

async function pathsFor(
  cwd: string,
  sessionId: string = DEFAULT_SESSION,
): Promise<{ activePath: string; pendingPath: string }> {
  const p = await markerPaths(cwd, sessionId);
  return { activePath: p.activePath, pendingPath: p.pendingPath };
}

async function writePlan(name = "plan.md"): Promise<string> {
  const home = Deno.env.get("HOME") ?? "";
  const path = `${home}/.claude/plans/${name}`;
  await Deno.mkdir(`${home}/.claude/plans`, { recursive: true });
  await Deno.writeTextFile(path, "# Plan\n");
  const real = await Deno.realPath(path);
  createdPlans.add(real);
  return real;
}

async function cleanupCreatedPlans(): Promise<void> {
  for (const path of createdPlans) {
    try {
      await Deno.remove(path);
    } catch {
      // already removed
    }
  }
  createdPlans.clear();
}

async function withTempPending<T>(
  cwd: string,
  sessionId: string,
  content: string,
  mtimeOffsetMs: number,
  run: () => Promise<T>,
): Promise<T> {
  const { activePath, pendingPath } = await pathsFor(cwd, sessionId);
  await Deno.mkdir(pendingPath.substring(0, pendingPath.lastIndexOf("/")), {
    recursive: true,
  });
  await Deno.writeTextFile(pendingPath, content);
  const t = new Date(Date.now() + mtimeOffsetMs);
  await Deno.utime(pendingPath, t, t);
  try {
    return await run();
  } finally {
    for (const p of [pendingPath, activePath]) {
      try {
        await Deno.remove(p);
      } catch {
        /* already cleaned */
      }
    }
    await cleanupCreatedPlans();
  }
}

// --- isApprovalPrompt: pure ---

Deno.test("isApprovalPrompt: bare /impl → true", () => {
  assertEquals(isApprovalPrompt("/impl"), true);
});

Deno.test("isApprovalPrompt: /impl with args → true", () => {
  assertEquals(isApprovalPrompt("/impl foo bar"), true);
});

Deno.test("isApprovalPrompt: /impl followed by newline → true", () => {
  assertEquals(isApprovalPrompt("/impl\nfoo"), true);
});

Deno.test("isApprovalPrompt: please /impl → false (not at head)", () => {
  assertEquals(isApprovalPrompt("please /impl this"), false);
});

Deno.test("isApprovalPrompt: /implementation → false (word boundary)", () => {
  assertEquals(isApprovalPrompt("/implementation"), false);
});

Deno.test("isApprovalPrompt: middle-line /impl → false (no multiline flag)", () => {
  assertEquals(isApprovalPrompt("foo\n/impl"), false);
});

Deno.test("isApprovalPrompt: empty string → false", () => {
  assertEquals(isApprovalPrompt(""), false);
});

Deno.test("isApprovalPrompt: leading whitespace before /impl → false (no trim)", () => {
  assertEquals(isApprovalPrompt(" /impl"), false);
});

// --- promote: side effects ---

Deno.test("promote: pending exists with content + active absent → active created with same content + pending removed", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  try {
    const plan = await writePlan();
    await withTempPending(cwd, DEFAULT_SESSION, `${plan}\n`, -1000, async () => {
      const result = await promote(cwd, DEFAULT_SESSION);
      assertEquals(result.promoted, true);
      assertEquals(result.reason, "promoted");
      const { activePath, pendingPath } = await pathsFor(cwd);
      const active = await Deno.readTextFile(activePath);
      assertEquals(active, `${plan}\n`);
      let pendingStillExists = true;
      try {
        await Deno.stat(pendingPath);
      } catch {
        pendingStillExists = false;
      }
      assertEquals(pendingStillExists, false);
    });
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("promote: active already exists → no-op (idempotent)", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  try {
    const { activePath } = await pathsFor(cwd);
    await Deno.mkdir(activePath.substring(0, activePath.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.writeTextFile(activePath, "existing-active");
    try {
      const plan = await writePlan();
      await withTempPending(
        cwd,
        DEFAULT_SESSION,
        `${plan}\n`,
        -1000,
        async () => {
          const result = await promote(cwd, DEFAULT_SESSION);
          assertEquals(result.promoted, false);
          assertEquals(result.reason, "already-active");
          const active = await Deno.readTextFile(activePath);
          assertEquals(active, "existing-active");
        },
      );
    } finally {
      try {
        await Deno.remove(activePath);
      } catch {
        /* already cleaned */
      }
    }
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("promote: pending absent → no-op", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  try {
    const result = await promote(cwd, DEFAULT_SESSION);
    assertEquals(result.promoted, false);
    assertEquals(result.reason, "no-pending");
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("promote: pending mtime > 24h → no-op (expired)", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  try {
    const plan = await writePlan();
    await withTempPending(
      cwd,
      DEFAULT_SESSION,
      `${plan}\n`,
      -25 * 60 * 60 * 1000,
      async () => {
        const result = await promote(cwd, DEFAULT_SESSION);
        assertEquals(result.promoted, false);
        assertEquals(result.reason, "expired");
        const { activePath } = await pathsFor(cwd);
        let activeExists = true;
        try {
          await Deno.stat(activePath);
        } catch {
          activeExists = false;
        }
        assertEquals(activeExists, false);
      },
    );
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

// --- Entry-gate behavior without subprocess permissions ---

Deno.test("entry gate: /impl prompt promotes pending → active", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  try {
    const { activePath, pendingPath } = await pathsFor(cwd);
    await Deno.mkdir(pendingPath.substring(0, pendingPath.lastIndexOf("/")), {
      recursive: true,
    });
    const plan = await writePlan("e2e.md");
    await Deno.writeTextFile(pendingPath, plan);

    try {
      if (isApprovalPrompt("/impl")) {
        await promote(cwd, DEFAULT_SESSION);
      }

      const activeContent = await Deno.readTextFile(activePath);
      assertEquals(activeContent, `${plan}\n`);

      let pendingStillExists = true;
      try {
        await Deno.stat(pendingPath);
      } catch {
        pendingStillExists = false;
      }
      assertEquals(pendingStillExists, false);
    } finally {
      for (const p of [pendingPath, activePath]) {
        try {
          await Deno.remove(p);
        } catch {
          /* already cleaned */
        }
      }
      await cleanupCreatedPlans();
    }
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("entry gate: non-approval prompt does not promote", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  try {
    const { activePath, pendingPath } = await pathsFor(cwd);
    await Deno.mkdir(pendingPath.substring(0, pendingPath.lastIndexOf("/")), {
      recursive: true,
    });
    const plan = await writePlan("reject.md");
    await Deno.writeTextFile(pendingPath, plan);

    try {
      if (isApprovalPrompt("what is the weather?")) {
        await promote(cwd, DEFAULT_SESSION);
      }

      let activeExists = true;
      try {
        await Deno.stat(activePath);
      } catch {
        activeExists = false;
      }
      assertEquals(activeExists, false);

      const pendingContent = await Deno.readTextFile(pendingPath);
      assertStringIncludes(pendingContent, plan);
    } finally {
      for (const p of [pendingPath, activePath]) {
        try {
          await Deno.remove(p);
        } catch {
          /* already cleaned */
        }
      }
      await cleanupCreatedPlans();
    }
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("subprocess entrypoint promotes only approval prompts when session_id and run permission are present", async () => {
  const scriptPath = fromFileUrl(
    new URL("./plan-approval-tracker.ts", import.meta.url),
  );
  const runPermission = await Deno.permissions.query({
    name: "run",
    command: scriptPath,
  });
  if (runPermission.state !== "granted") {
    console.log("skipping subprocess assertions; run permission not granted");
    return;
  }

  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  try {
    const { activePath, pendingPath } = await pathsFor(cwd);
    await Deno.mkdir(pendingPath.substring(0, pendingPath.lastIndexOf("/")), {
      recursive: true,
    });

    try {
      const approvedPlan = await writePlan("subprocess.md");
      await Deno.writeTextFile(pendingPath, approvedPlan);
      const approve = new Deno.Command(scriptPath, {
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const approveWriter = approve.stdin.getWriter();
      await approveWriter.write(
        new TextEncoder().encode(
          JSON.stringify({
            prompt: "/impl",
            cwd,
            session_id: DEFAULT_SESSION,
          }),
        ),
      );
      await approveWriter.close();
      const approveOutput = await approve.output();
      assertEquals(approveOutput.code, 0);
      assertEquals(await Deno.readTextFile(activePath), `${approvedPlan}\n`);

      await Deno.remove(activePath);
      const rejectedPlan = await writePlan("subprocess-reject.md");
      await Deno.writeTextFile(pendingPath, rejectedPlan);
      const reject = new Deno.Command(scriptPath, {
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const rejectWriter = reject.stdin.getWriter();
      await rejectWriter.write(
        new TextEncoder().encode(
          JSON.stringify({
            prompt: "please /impl",
            cwd,
            session_id: DEFAULT_SESSION,
          }),
        ),
      );
      await rejectWriter.close();
      const rejectOutput = await reject.output();
      assertEquals(rejectOutput.code, 0);

      let activeExists = true;
      try {
        await Deno.stat(activePath);
      } catch {
        activeExists = false;
      }
      assertEquals(activeExists, false);
      assertEquals(await Deno.readTextFile(pendingPath), rejectedPlan);
    } finally {
      for (const p of [pendingPath, activePath]) {
        try {
          await Deno.remove(p);
        } catch {
          /* already cleaned */
        }
      }
      await cleanupCreatedPlans();
    }
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("subprocess entrypoint: missing session_id → fail-open silent (no promote)", async () => {
  const scriptPath = fromFileUrl(
    new URL("./plan-approval-tracker.ts", import.meta.url),
  );
  const runPermission = await Deno.permissions.query({
    name: "run",
    command: scriptPath,
  });
  if (runPermission.state !== "granted") {
    console.log("skipping subprocess assertions; run permission not granted");
    return;
  }

  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  try {
    const { activePath, pendingPath } = await pathsFor(cwd);
    await Deno.mkdir(pendingPath.substring(0, pendingPath.lastIndexOf("/")), {
      recursive: true,
    });
    const plan = await writePlan("no-session.md");
    await Deno.writeTextFile(pendingPath, plan);

    try {
      const proc = new Deno.Command(scriptPath, {
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const writer = proc.stdin.getWriter();
      await writer.write(
        new TextEncoder().encode(JSON.stringify({ prompt: "/impl", cwd })),
      );
      await writer.close();
      const out = await proc.output();
      // fail-open silent: exit 0 で副作用なし
      assertEquals(out.code, 0);

      let activeExists = true;
      try {
        await Deno.stat(activePath);
      } catch {
        activeExists = false;
      }
      assertEquals(activeExists, false);

      // pending は触らない
      assertEquals(await Deno.readTextFile(pendingPath), plan);
    } finally {
      for (const p of [pendingPath, activePath]) {
        try {
          await Deno.remove(p);
        } catch {
          /* already cleaned */
        }
      }
      await cleanupCreatedPlans();
    }
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("cross-session: /impl in session B does not promote session A's pending", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  try {
    const plan = await writePlan("cross-session.md");
    const sessionAPaths = await pathsFor(cwd, "session-A");
    await Deno.mkdir(
      sessionAPaths.pendingPath.substring(
        0,
        sessionAPaths.pendingPath.lastIndexOf("/"),
      ),
      { recursive: true },
    );
    await Deno.writeTextFile(sessionAPaths.pendingPath, plan);

    try {
      // session B が /impl 入力 → session B の pending を探すが、無いので no-op
      const result = await promote(cwd, "session-B");
      assertEquals(result.promoted, false);
      assertEquals(result.reason, "no-pending");

      // session A の pending は残っている
      assertEquals(await Deno.readTextFile(sessionAPaths.pendingPath), plan);
      // session A の active も作られない
      let sessionAActiveExists = true;
      try {
        await Deno.stat(sessionAPaths.activePath);
      } catch {
        sessionAActiveExists = false;
      }
      assertEquals(sessionAActiveExists, false);
    } finally {
      for (const p of [sessionAPaths.pendingPath, sessionAPaths.activePath]) {
        try {
          await Deno.remove(p);
        } catch {
          /* already cleaned */
        }
      }
      await cleanupCreatedPlans();
    }
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("cleanup plan approval tracker temp HOME", async () => {
  await cleanupCreatedPlans();
  if (originalHome === undefined) {
    Deno.env.delete("HOME");
  } else {
    Deno.env.set("HOME", originalHome);
  }
  await Deno.remove(testHome, { recursive: true });
});
