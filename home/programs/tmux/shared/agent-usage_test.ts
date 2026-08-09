import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
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
  const home = await Deno.makeTempDir({ prefix: "agent-usage-test-" });
  try {
    await fn(home);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
}

Deno.test("writeAgentUsage → readAgentUsage round-trips", async () => {
  await withHome(async (home) => {
    const usage = sample("claude");
    await writeAgentUsage(home, "claude", usage);
    assertEquals(await readAgentUsage(home, "claude"), usage);
  });
});

Deno.test("writeAgentUsage creates the state dir when absent", async () => {
  await withHome(async (home) => {
    await writeAgentUsage(home, "codex", sample("codex"));
    assert((await Deno.stat(usageDir(home))).isDirectory);
  });
});

Deno.test("writeAgentUsage leaves no temp file behind", async () => {
  await withHome(async (home) => {
    await writeAgentUsage(home, "claude", sample("claude"));
    const names: string[] = [];
    for await (const e of Deno.readDir(usageDir(home))) names.push(e.name);
    assertEquals(names, ["claude.json"]);
  });
});

Deno.test("concurrent writes for different agents do not clobber", async () => {
  await withHome(async (home) => {
    await Promise.all([
      writeAgentUsage(home, "claude", sample("claude")),
      writeAgentUsage(home, "codex", sample("codex")),
    ]);
    assertEquals(await readAgentUsage(home, "claude"), sample("claude"));
    assertEquals(await readAgentUsage(home, "codex"), sample("codex"));
  });
});

Deno.test("readAgentUsage: missing file → null", async () => {
  await withHome(async (home) => {
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

Deno.test("readAgentUsage: malformed JSON → null", async () => {
  await withHome(async (home) => {
    await Deno.mkdir(usageDir(home), { recursive: true });
    await Deno.writeTextFile(usageFilePath(home, "claude"), "{not json");
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

Deno.test("readAgentUsage: valid JSON missing windows → null", async () => {
  await withHome(async (home) => {
    await Deno.mkdir(usageDir(home), { recursive: true });
    await Deno.writeTextFile(
      usageFilePath(home, "claude"),
      JSON.stringify({ agent: "claude", updatedAt: NOW }),
    );
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

Deno.test("readAgentUsage: window element with wrong field types → null", async () => {
  await withHome(async (home) => {
    await Deno.mkdir(usageDir(home), { recursive: true });
    await Deno.writeTextFile(
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

Deno.test("readAgentUsage: top-level array → null", async () => {
  await withHome(async (home) => {
    await Deno.mkdir(usageDir(home), { recursive: true });
    await Deno.writeTextFile(usageFilePath(home, "claude"), "[]");
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

Deno.test("readAgentUsage: non-numeric updatedAt → null", async () => {
  await withHome(async (home) => {
    await Deno.mkdir(usageDir(home), { recursive: true });
    await Deno.writeTextFile(
      usageFilePath(home, "claude"),
      JSON.stringify({ agent: "claude", updatedAt: "recent", windows: [] }),
    );
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

Deno.test("readAgentUsage: overflowing numeric literal → null", async () => {
  await withHome(async (home) => {
    await Deno.mkdir(usageDir(home), { recursive: true });
    // 1e999 parses to Infinity rather than failing, so typeof alone would let
    // it through and the footer would render "Infinity%".
    await Deno.writeTextFile(
      usageFilePath(home, "claude"),
      '{"agent":"claude","updatedAt":1e999,"windows":[]}',
    );
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

Deno.test("readAgentUsage: unreadable path (dir where file expected) → null", async () => {
  await withHome(async (home) => {
    await Deno.mkdir(usageFilePath(home, "claude"), { recursive: true });
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

Deno.test("isWindowExpired: boundary is inclusive at resetsAt", () => {
  const w = { label: "5h", usedPct: 40, resetsAt: NOW };
  assert(isWindowExpired(w, NOW));
  assert(isWindowExpired(w, NOW + 1));
  assertFalse(isWindowExpired(w, NOW - 1));
});

Deno.test("isUsageStale: boundary at STALE_AFTER_SEC", () => {
  const usage = sample("claude", NOW - STALE_AFTER_SEC);
  assert(isUsageStale(usage, NOW));
  assertFalse(isUsageStale(sample("claude", NOW - STALE_AFTER_SEC + 1), NOW));
  assertFalse(isUsageStale(sample("claude", NOW), NOW));
});

Deno.test("labelFromWindowMinutes maps the two known windows", () => {
  assertEquals(labelFromWindowMinutes(300), "5h");
  assertEquals(labelFromWindowMinutes(10080), "7d");
  assertEquals(labelFromWindowMinutes(60), "60m");
});

Deno.test("usageFilePath is HOME-rooted and agent-scoped", () => {
  assertEquals(
    usageFilePath("/tmp/h", "codex"),
    "/tmp/h/.local/state/agent-usage/codex.json",
  );
});

// --- Source guards ---

Deno.test("module source has no import statements", async () => {
  const src = await Deno.readTextFile(
    new URL("./agent-usage.ts", import.meta.url),
  );
  assertEquals(src.match(/^import\s/gm), null);
});

Deno.test("module source does not use makeTempFile or XDG_STATE_HOME", async () => {
  const src = await Deno.readTextFile(
    new URL("./agent-usage.ts", import.meta.url),
  );
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assertFalse(/makeTempFile/.test(stripped));
  assertFalse(/XDG_STATE_HOME/.test(stripped));
});

Deno.test("usageTempPath: temp sits in the same directory as its target", () => {
  const target = usageFilePath("/tmp/h", "claude");
  const temp = usageTempPath("/tmp/h", "claude", 4242);
  const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
  // rename is only atomic within one filesystem, and codex-pane-status.ts
  // cannot reach $TMPDIR at all, so a temp anywhere else breaks both.
  assertEquals(dirOf(temp), dirOf(target));
  assertEquals(dirOf(temp), usageDir("/tmp/h"));
});

Deno.test("usageTempPath: distinct pids never collide on one target", () => {
  const a = usageTempPath("/tmp/h", "claude", 1);
  const b = usageTempPath("/tmp/h", "claude", 2);
  assertEquals(a === b, false);
  assertEquals(a.startsWith(usageFilePath("/tmp/h", "claude")), true);
  assertEquals(b.startsWith(usageFilePath("/tmp/h", "claude")), true);
});

Deno.test("readAgentUsage: body naming a different agent → null", async () => {
  await withHome(async (home) => {
    await Deno.mkdir(usageDir(home), { recursive: true });
    await Deno.writeTextFile(
      usageFilePath(home, "claude"),
      JSON.stringify(sample("codex")),
    );
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

Deno.test("readAgentUsage: label carrying a newline → null", async () => {
  await withHome(async (home) => {
    await Deno.mkdir(usageDir(home), { recursive: true });
    // A newline here would render the footer two rows tall and break the
    // layout arithmetic that reserves exactly one.
    await Deno.writeTextFile(
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

Deno.test("readAgentUsage: percentage outside 0-100 → null", async () => {
  await withHome(async (home) => {
    await Deno.mkdir(usageDir(home), { recursive: true });
    for (const usedPct of [-1, 412]) {
      await Deno.writeTextFile(
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

Deno.test("readAgentUsage: boundary percentages are accepted", async () => {
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

Deno.test("readAgentUsage: oversized file → null", async () => {
  await withHome(async (home) => {
    await Deno.mkdir(usageDir(home), { recursive: true });
    // Padding inside a valid document: the size ceiling has to fire before the
    // parse, since the picker re-reads this on every tick.
    await Deno.writeTextFile(
      usageFilePath(home, "claude"),
      JSON.stringify({ ...sample("claude"), pad: "x".repeat(70 * 1024) }),
    );
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

Deno.test("readAgentUsage: more windows than the ceiling → null", async () => {
  await withHome(async (home) => {
    await Deno.mkdir(usageDir(home), { recursive: true });
    await Deno.writeTextFile(
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
