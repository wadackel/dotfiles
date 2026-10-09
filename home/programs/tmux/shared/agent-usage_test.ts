import { test } from "bun:test";
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentUsage,
  isUsageStale,
  isWindowExpired,
  labelFromWindowMinutes,
  readAgentUsage,
  STALE_AFTER_SEC,
  usageDir,
  usageFilePath,
  usageTempPath,
  writeAgentUsage,
} from "./agent-usage.ts";

const NOW = 1786248126;

function sample(agent: string, updatedAt = NOW): AgentUsage {
  return {
    agent,
    updatedAt,
    windows: [
      { label: "5h", usedPct: 95, resetsAt: NOW + 6000 },
      { label: "7d", usedPct: 13, resetsAt: NOW + 500000 },
    ],
  };
}

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "agent-usage-test-"));
  try {
    await fn(home);
  } finally {
    await rm(home, { recursive: true });
  }
}

test("writeAgentUsage → readAgentUsage round-trips", async () => {
  await withHome(async (home) => {
    const usage = sample("claude");
    await writeAgentUsage(home, "claude", usage);
    assertEquals(await readAgentUsage(home, "claude"), usage);
  });
});

test("writeAgentUsage creates the state dir when absent", async () => {
  await withHome(async (home) => {
    await writeAgentUsage(home, "codex", sample("codex"));
    assert((await stat(usageDir(home))).isDirectory());
  });
});

test("writeAgentUsage leaves no temp file behind", async () => {
  await withHome(async (home) => {
    await writeAgentUsage(home, "claude", sample("claude"));
    assertEquals(await readdir(usageDir(home)), ["claude.json"]);
  });
});

test("concurrent writes for different agents do not clobber", async () => {
  await withHome(async (home) => {
    await Promise.all([
      writeAgentUsage(home, "claude", sample("claude")),
      writeAgentUsage(home, "codex", sample("codex")),
    ]);
    assertEquals(await readAgentUsage(home, "claude"), sample("claude"));
    assertEquals(await readAgentUsage(home, "codex"), sample("codex"));
  });
});

test("readAgentUsage: missing file → null", async () => {
  await withHome(async (home) => {
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

test("readAgentUsage: malformed JSON → null", async () => {
  await withHome(async (home) => {
    await mkdir(usageDir(home), { recursive: true });
    await writeFile(usageFilePath(home, "claude"), "{not json");
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

test("readAgentUsage: valid JSON missing windows → null", async () => {
  await withHome(async (home) => {
    await mkdir(usageDir(home), { recursive: true });
    await writeFile(
      usageFilePath(home, "claude"),
      JSON.stringify({ agent: "claude", updatedAt: NOW }),
    );
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

test("readAgentUsage: window element with wrong field types → null", async () => {
  await withHome(async (home) => {
    await mkdir(usageDir(home), { recursive: true });
    await writeFile(
      usageFilePath(home, "claude"),
      JSON.stringify({
        agent: "claude",
        updatedAt: NOW,
        windows: [{ label: "5h", usedPct: "95", resetsAt: NOW }],
      }),
    );
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

test("readAgentUsage: top-level array → null", async () => {
  await withHome(async (home) => {
    await mkdir(usageDir(home), { recursive: true });
    await writeFile(usageFilePath(home, "claude"), "[]");
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

test("readAgentUsage: non-numeric updatedAt → null", async () => {
  await withHome(async (home) => {
    await mkdir(usageDir(home), { recursive: true });
    await writeFile(
      usageFilePath(home, "claude"),
      JSON.stringify({ agent: "claude", updatedAt: "recent", windows: [] }),
    );
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

test("readAgentUsage: overflowing numeric literal → null", async () => {
  await withHome(async (home) => {
    await mkdir(usageDir(home), { recursive: true });
    // 1e999 parses to Infinity rather than failing, so typeof alone would let
    // it through and the footer would render "Infinity%".
    await writeFile(
      usageFilePath(home, "claude"),
      '{"agent":"claude","updatedAt":1e999,"windows":[]}',
    );
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

test("readAgentUsage: unreadable path (dir where file expected) → null", async () => {
  await withHome(async (home) => {
    await mkdir(usageFilePath(home, "claude"), { recursive: true });
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

test("isWindowExpired: boundary is inclusive at resetsAt", () => {
  const w = { label: "5h", usedPct: 40, resetsAt: NOW };
  assert(isWindowExpired(w, NOW));
  assert(isWindowExpired(w, NOW + 1));
  assertFalse(isWindowExpired(w, NOW - 1));
});

test("isUsageStale: boundary at STALE_AFTER_SEC", () => {
  const usage = sample("claude", NOW - STALE_AFTER_SEC);
  assert(isUsageStale(usage, NOW));
  assertFalse(isUsageStale(sample("claude", NOW - STALE_AFTER_SEC + 1), NOW));
  assertFalse(isUsageStale(sample("claude", NOW), NOW));
});

test("labelFromWindowMinutes maps the two known windows", () => {
  assertEquals(labelFromWindowMinutes(300), "5h");
  assertEquals(labelFromWindowMinutes(10080), "7d");
  assertEquals(labelFromWindowMinutes(60), "60m");
});

test("usageFilePath is HOME-rooted and agent-scoped", () => {
  assertEquals(
    usageFilePath("/tmp/h", "codex"),
    "/tmp/h/.local/state/agent-usage/codex.json",
  );
});

// --- Source guards ---

test("module source imports nothing but node:* modules", async () => {
  const src = await readFile(
    join(import.meta.dirname, "agent-usage.ts"),
    "utf8",
  );
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const specifiers = [
    ...stripped.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g),
  ].map((m) => m[1]);
  assert(specifiers.length > 0);
  assertEquals(specifiers.filter((s) => !s.startsWith("node:")), []);
});

test("module source does not use the system temp dir or XDG_STATE_HOME", async () => {
  const src = await readFile(
    join(import.meta.dirname, "agent-usage.ts"),
    "utf8",
  );
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assertFalse(/tmpdir|mkdtemp|TMPDIR|node:os/.test(stripped));
  assertFalse(/XDG_STATE_HOME/.test(stripped));
});

test("usageTempPath: temp sits in the same directory as its target", () => {
  const target = usageFilePath("/tmp/h", "claude");
  const temp = usageTempPath("/tmp/h", "claude", 4242);
  const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
  // rename is only atomic within one filesystem, and codex-pane-status.ts
  // cannot reach $TMPDIR at all, so a temp anywhere else breaks both.
  assertEquals(dirOf(temp), dirOf(target));
  assertEquals(dirOf(temp), usageDir("/tmp/h"));
});

test("usageTempPath: distinct pids never collide on one target", () => {
  const a = usageTempPath("/tmp/h", "claude", 1);
  const b = usageTempPath("/tmp/h", "claude", 2);
  assertEquals(a === b, false);
  assertEquals(a.startsWith(usageFilePath("/tmp/h", "claude")), true);
  assertEquals(b.startsWith(usageFilePath("/tmp/h", "claude")), true);
});

test("readAgentUsage: body naming a different agent → null", async () => {
  await withHome(async (home) => {
    await mkdir(usageDir(home), { recursive: true });
    await writeFile(
      usageFilePath(home, "claude"),
      JSON.stringify(sample("codex")),
    );
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

test("readAgentUsage: label carrying a newline → null", async () => {
  await withHome(async (home) => {
    await mkdir(usageDir(home), { recursive: true });
    // A newline here would render the footer two rows tall and break the
    // layout arithmetic that reserves exactly one.
    await writeFile(
      usageFilePath(home, "claude"),
      JSON.stringify({
        agent: "claude",
        updatedAt: NOW,
        windows: [{ label: "5h\nx", usedPct: 42, resetsAt: NOW + 60 }],
      }),
    );
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

test("readAgentUsage: percentage outside 0-100 → null", async () => {
  await withHome(async (home) => {
    await mkdir(usageDir(home), { recursive: true });
    for (const usedPct of [-1, 412]) {
      await writeFile(
        usageFilePath(home, "claude"),
        JSON.stringify({
          agent: "claude",
          updatedAt: NOW,
          windows: [{ label: "5h", usedPct, resetsAt: NOW + 60 }],
        }),
      );
      assertEquals(await readAgentUsage(home, "claude"), null);
    }
  });
});

test("readAgentUsage: boundary percentages are accepted", async () => {
  await withHome(async (home) => {
    for (const usedPct of [0, 100]) {
      await writeAgentUsage(home, "claude", {
        agent: "claude",
        updatedAt: NOW,
        windows: [{ label: "5h", usedPct, resetsAt: NOW + 60 }],
      });
      const usage = await readAgentUsage(home, "claude");
      assertEquals(usage?.windows[0].usedPct, usedPct);
    }
  });
});

test("readAgentUsage: oversized file → null", async () => {
  await withHome(async (home) => {
    await mkdir(usageDir(home), { recursive: true });
    // Padding inside a valid document: the size ceiling has to fire before the
    // parse, since Agentower re-reads this on every tick.
    await writeFile(
      usageFilePath(home, "claude"),
      JSON.stringify({ ...sample("claude"), pad: "x".repeat(70 * 1024) }),
    );
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

test("readAgentUsage: more windows than the ceiling → null", async () => {
  await withHome(async (home) => {
    await mkdir(usageDir(home), { recursive: true });
    await writeFile(
      usageFilePath(home, "claude"),
      JSON.stringify({
        agent: "claude",
        updatedAt: NOW,
        windows: Array.from({ length: 9 }, () => ({
          label: "5h",
          usedPct: 1,
          resetsAt: NOW + 60,
        })),
      }),
    );
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});
