import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { cwdHash, cwdMarkerPath } from "./plan-gate.ts";
import { isApprovalPrompt, promote } from "./plan-approval-tracker.ts";

// --- Test helpers ---

function pendingPath(hash: string): string {
  const home = Deno.env.get("HOME") ?? "";
  return `${home}/.claude/plans/.pending-${hash}`;
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
  await Deno.mkdir(pending.substring(0, pending.lastIndexOf("/")), { recursive: true });
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
    await withTempPending(cwd, "/path/to/plan.md\n", -1000, async () => {
      const result = await promote(cwd);
      assertEquals(result.promoted, true);
      assertEquals(result.reason, "promoted");
      const hash = await cwdHash(cwd);
      const active = await Deno.readTextFile(cwdMarkerPath(hash));
      assertEquals(active, "/path/to/plan.md\n");
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
      await withTempPending(cwd, "new-pending", -1000, async () => {
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
    await withTempPending(cwd, "stale", -25 * 60 * 60 * 1000, async () => {
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

// --- Automated end-to-end: spawn the script as a subprocess ---

Deno.test("e2e: subprocess with /impl prompt promotes pending → active", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  try {
    const hash = await cwdHash(cwd);
    const pending = pendingPath(hash);
    const active = cwdMarkerPath(hash);
    await Deno.mkdir(pending.substring(0, pending.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(pending, "e2e-plan-path");

    try {
      const scriptPath = new URL("./plan-approval-tracker.ts", import.meta.url).pathname;
      const cmd = new Deno.Command(scriptPath, {
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      });
      const child = cmd.spawn();
      const writer = child.stdin.getWriter();
      const payload = JSON.stringify({ prompt: "/impl", cwd });
      await writer.write(new TextEncoder().encode(payload));
      await writer.close();
      const output = await child.output();

      assertEquals(output.code, 0);

      const activeContent = await Deno.readTextFile(active);
      assertEquals(activeContent, "e2e-plan-path");

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
    }
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("e2e: subprocess with non-approval prompt → no promotion", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  try {
    const hash = await cwdHash(cwd);
    const pending = pendingPath(hash);
    const active = cwdMarkerPath(hash);
    await Deno.mkdir(pending.substring(0, pending.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(pending, "should-not-promote");

    try {
      const scriptPath = new URL("./plan-approval-tracker.ts", import.meta.url).pathname;
      const cmd = new Deno.Command(scriptPath, {
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      });
      const child = cmd.spawn();
      const writer = child.stdin.getWriter();
      const payload = JSON.stringify({ prompt: "what is the weather?", cwd });
      await writer.write(new TextEncoder().encode(payload));
      await writer.close();
      const output = await child.output();

      assertEquals(output.code, 0);

      let activeExists = true;
      try {
        await Deno.stat(active);
      } catch {
        activeExists = false;
      }
      assertEquals(activeExists, false);

      const pendingContent = await Deno.readTextFile(pending);
      assertStringIncludes(pendingContent, "should-not-promote");
    } finally {
      for (const p of [pending, active]) {
        try {
          await Deno.remove(p);
        } catch {
          /* already cleaned */
        }
      }
    }
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});
