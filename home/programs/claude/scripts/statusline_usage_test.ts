// Round-trip guard for the one schema that exists twice: agent-usage.ts writes
// it from TypeScript, statusline.sh builds it with jq. Nothing else ties the
// two together, so a typo in the jq expression would otherwise surface only in
// Agentower footer at runtime.
//
// The rendered-line assertions at the bottom pin the join logic only. The
// fixture spells the effort path itself, so a renamed payload field would still
// satisfy them — that drift is only observable against a captured live payload.

import { test } from "bun:test";
import { assert, assertEquals } from "@std/assert";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../agents/lib/proc.ts";
import { readAgentUsage } from "../../tmux/shared/agent-usage.ts";

const STATUSLINE = join(import.meta.dirname, "statusline.sh");
// A child started with a replaced HOME would otherwise put Bun's transpiler
// cache inside the fixture directory.
const TRANSPILER_CACHE = `${process.env.HOME}/Library/Caches/bun/@t@`;

async function runStatusline(
  home: string,
  stdin: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { code, stdout, stderr } = await run("bash", [STATUSLINE], {
    // TMUX_PANE is blanked instead of inherited: statusline.sh writes a tmux
    // pane option whenever it is set, and a test must not touch the
    // developer's live pane.
    env: {
      HOME: home,
      TMUX_PANE: "",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: TRANSPILER_CACHE,
    },
    stdin,
  });
  return { code, stdout, stderr };
}

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "statusline-usage-test-"));
  try {
    await fn(home);
  } finally {
    await rm(home, { recursive: true });
  }
}

function input(extra: Record<string, unknown>): string {
  return JSON.stringify({
    model: { display_name: "Opus 5" },
    workspace: { current_dir: "/tmp" },
    context_window: { used_percentage: 15, context_window_size: 1000000 },
    ...extra,
  });
}

const RATE_LIMITS = {
  five_hour: { used_percentage: 95, resets_at: 1786254600 },
  seven_day: { used_percentage: 13, resets_at: 1786809600 },
};

test("statusline.sh writes a file readAgentUsage accepts", async () => {
  await withHome(async (home) => {
    const { code, stderr } = await runStatusline(
      home,
      input({ rate_limits: RATE_LIMITS }),
    );
    assertEquals(code, 0, `statusline.sh failed: ${stderr}`);

    const usage = await readAgentUsage(home, "claude");
    assert(usage !== null, "readAgentUsage rejected the jq-built file");
    assertEquals(usage.agent, "claude");
    assertEquals(usage.windows, [
      { label: "5h", usedPct: 95, resetsAt: 1786254600 },
      { label: "7d", usedPct: 13, resetsAt: 1786809600 },
    ]);
    assert(
      Math.abs(usage.updatedAt - Math.floor(Date.now() / 1000)) < 60,
      `updatedAt is not a current unix second: ${usage.updatedAt}`,
    );
  });
});

test("statusline.sh leaves no temp file behind", async () => {
  await withHome(async (home) => {
    await runStatusline(home, input({ rate_limits: RATE_LIMITS }));
    const names = await readdir(`${home}/.local/state/agent-usage`);
    assertEquals(names, ["claude.json"]);
  });
});

test("statusline.sh writes nothing when rate_limits is absent", async () => {
  await withHome(async (home) => {
    const { code } = await runStatusline(home, input({}));
    assertEquals(code, 0);
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

test("statusline.sh emits only the window that is present", async () => {
  await withHome(async (home) => {
    await runStatusline(
      home,
      input({ rate_limits: { five_hour: RATE_LIMITS.five_hour } }),
    );
    const usage = await readAgentUsage(home, "claude");
    assert(usage !== null);
    assertEquals(usage.windows, [
      { label: "5h", usedPct: 95, resetsAt: 1786254600 },
    ]);
  });
});

test("statusline.sh skips a window missing used_percentage", async () => {
  await withHome(async (home) => {
    await runStatusline(
      home,
      input({
        rate_limits: {
          five_hour: { resets_at: 1786254600 },
          seven_day: RATE_LIMITS.seven_day,
        },
      }),
    );
    const usage = await readAgentUsage(home, "claude");
    assert(usage !== null);
    assertEquals(usage.windows, [
      { label: "7d", usedPct: 13, resetsAt: 1786809600 },
    ]);
  });
});

test("statusline.sh still succeeds when rate_limits is malformed", async () => {
  await withHome(async (home) => {
    const { code } = await runStatusline(
      home,
      input({ rate_limits: "not-an-object" }),
    );
    // A jq failure must not take the statusline down with it.
    assertEquals(code, 0);
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

test("statusline.sh clamps an out-of-range percentage", async () => {
  await withHome(async (home) => {
    // The reader discards the whole file on an out-of-range percentage, so an
    // unclamped writer would make the claude segment vanish without a trace.
    await runStatusline(
      home,
      input({
        rate_limits: {
          five_hour: { used_percentage: 412, resets_at: 1786254600 },
          seven_day: { used_percentage: -3, resets_at: 1786809600 },
        },
      }),
    );
    const usage = await readAgentUsage(home, "claude");
    assert(usage !== null, "clamping should keep the file schema-valid");
    assertEquals(usage.windows.map((w) => w.usedPct), [100, 0]);
  });
});

test("statusline.sh appends the effort level to the model name", async () => {
  await withHome(async (home) => {
    const { code, stdout } = await runStatusline(
      home,
      input({ effort: { level: "high" } }),
    );
    assertEquals(code, 0);
    assert(
      stdout.includes("Opus 5 · high"),
      `effort should be joined to the model name, got: ${stdout}`,
    );
  });
});

test("statusline.sh renders the model alone when effort is absent", async () => {
  await withHome(async (home) => {
    // Models without an effort parameter omit the field entirely, so the model
    // segment has to survive the absence rather than render a dangling separator.
    const { code, stdout } = await runStatusline(home, input({}));
    assertEquals(code, 0);
    assert(
      stdout.includes("Opus 5"),
      `the model name should still render, got: ${stdout}`,
    );
    assert(
      !stdout.includes("·"),
      `no separator should be emitted without effort, got: ${stdout}`,
    );
  });
});
