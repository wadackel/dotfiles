import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { fromFileUrl } from "jsr:@std/path@1.1.4/from-file-url";
import { cwdHash, cwdMarkerPath } from "./plan-gate.ts";
import { isApprovalPrompt, promote } from "./plan-approval-tracker.ts";

// --- Test helpers ---

const testHome = await Deno.makeTempDir({
  dir: "/tmp",
  prefix: "claude-approval-home-",
});
const originalHome = Deno.env.get("HOME");
Deno.env.set("HOME", testHome);

const createdPlans = new Set<string>();

function pendingPath(hash: string): string {
  const home = Deno.env.get("HOME") ?? "";
  return `${home}/.claude/plans/.pending-${hash}`;
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
  content: string,
  mtimeOffsetMs: number,
  run: () => Promise<T>,
): Promise<T> {
  const hash = await cwdHash(cwd);
  const pending = pendingPath(hash);
  const active = cwdMarkerPath(hash);
  await Deno.mkdir(pending.substring(0, pending.lastIndexOf("/")), {
    recursive: true,
  });
  await Deno.writeTextFile(pending, content);
  const t = new Date(Date.now() + mtimeOffsetMs);
  await Deno.utime(pending, t, t);
  try {
    return await run();
  } finally {
    for (const p of [pending, active]) {
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
    await withTempPending(cwd, `${plan}\n`, -1000, async () => {
      const result = await promote(cwd);
      assertEquals(result.promoted, true);
      assertEquals(result.reason, "promoted");
      const hash = await cwdHash(cwd);
      const active = await Deno.readTextFile(cwdMarkerPath(hash));
      assertEquals(active, `${plan}\n`);
      let pendingStillExists = true;
      try {
        await Deno.stat(pendingPath(hash));
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
    const hash = await cwdHash(cwd);
    await Deno.writeTextFile(cwdMarkerPath(hash), "existing-active");
    try {
      const plan = await writePlan();
      await withTempPending(cwd, `${plan}\n`, -1000, async () => {
        const result = await promote(cwd);
        assertEquals(result.promoted, false);
        assertEquals(result.reason, "already-active");
        const active = await Deno.readTextFile(cwdMarkerPath(hash));
        assertEquals(active, "existing-active");
      });
    } finally {
      try {
        await Deno.remove(cwdMarkerPath(hash));
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
    const result = await promote(cwd);
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
    await withTempPending(cwd, `${plan}\n`, -25 * 60 * 60 * 1000, async () => {
      const result = await promote(cwd);
      assertEquals(result.promoted, false);
      assertEquals(result.reason, "expired");
      const hash = await cwdHash(cwd);
      let activeExists = true;
      try {
        await Deno.stat(cwdMarkerPath(hash));
      } catch {
        activeExists = false;
      }
      assertEquals(activeExists, false);
    });
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

// --- Entry-gate behavior without subprocess permissions ---

Deno.test("entry gate: /impl prompt promotes pending → active", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  try {
    const hash = await cwdHash(cwd);
    const pending = pendingPath(hash);
    const active = cwdMarkerPath(hash);
    await Deno.mkdir(pending.substring(0, pending.lastIndexOf("/")), {
      recursive: true,
    });
    const plan = await writePlan("e2e.md");
    await Deno.writeTextFile(pending, plan);

    try {
      if (isApprovalPrompt("/impl")) {
        await promote(cwd);
      }

      const activeContent = await Deno.readTextFile(active);
      assertEquals(activeContent, `${plan}\n`);

      let pendingStillExists = true;
      try {
        await Deno.stat(pending);
      } catch {
        pendingStillExists = false;
      }
      assertEquals(pendingStillExists, false);
    } finally {
      for (const p of [pending, active]) {
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
    const hash = await cwdHash(cwd);
    const pending = pendingPath(hash);
    const active = cwdMarkerPath(hash);
    await Deno.mkdir(pending.substring(0, pending.lastIndexOf("/")), {
      recursive: true,
    });
    const plan = await writePlan("reject.md");
    await Deno.writeTextFile(pending, plan);

    try {
      if (isApprovalPrompt("what is the weather?")) {
        await promote(cwd);
      }

      let activeExists = true;
      try {
        await Deno.stat(active);
      } catch {
        activeExists = false;
      }
      assertEquals(activeExists, false);

      const pendingContent = await Deno.readTextFile(pending);
      assertStringIncludes(pendingContent, plan);
    } finally {
      for (const p of [pending, active]) {
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

Deno.test("subprocess entrypoint promotes only approval prompts when run permission is granted", async () => {
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
    const hash = await cwdHash(cwd);
    const pending = pendingPath(hash);
    const active = cwdMarkerPath(hash);
    await Deno.mkdir(pending.substring(0, pending.lastIndexOf("/")), {
      recursive: true,
    });

    try {
      const approvedPlan = await writePlan("subprocess.md");
      await Deno.writeTextFile(pending, approvedPlan);
      const approve = new Deno.Command(scriptPath, {
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const approveWriter = approve.stdin.getWriter();
      await approveWriter.write(
        new TextEncoder().encode(JSON.stringify({ prompt: "/impl", cwd })),
      );
      await approveWriter.close();
      const approveOutput = await approve.output();
      assertEquals(approveOutput.code, 0);
      assertEquals(await Deno.readTextFile(active), `${approvedPlan}\n`);

      await Deno.remove(active);
      const rejectedPlan = await writePlan("subprocess-reject.md");
      await Deno.writeTextFile(pending, rejectedPlan);
      const reject = new Deno.Command(scriptPath, {
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const rejectWriter = reject.stdin.getWriter();
      await rejectWriter.write(
        new TextEncoder().encode(
          JSON.stringify({ prompt: "please /impl", cwd }),
        ),
      );
      await rejectWriter.close();
      const rejectOutput = await reject.output();
      assertEquals(rejectOutput.code, 0);

      let activeExists = true;
      try {
        await Deno.stat(active);
      } catch {
        activeExists = false;
      }
      assertEquals(activeExists, false);
      assertEquals(await Deno.readTextFile(pending), rejectedPlan);
    } finally {
      for (const p of [pending, active]) {
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
