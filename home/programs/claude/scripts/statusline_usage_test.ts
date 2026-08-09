// Round-trip guard for the one schema that exists twice: agent-usage.ts writes
// it from TypeScript, statusline.sh builds it with jq. Nothing else ties the
// two together, so a typo in the jq expression would otherwise surface only in
// the picker footer at runtime.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { readAgentUsage } from "../../tmux/shared/agent-usage.ts";

const STATUSLINE = new URL("./statusline.sh", import.meta.url).pathname;

async function runStatusline(
  home: string,
  stdin: string,
): Promise<{ code: number; stderr: string }> {
  const child = new Deno.Command("bash", {
    args: [STATUSLINE],
    // clearEnv stays off so PATH reaches the script without this test needing
    // env-read permission — the documented invocation is --allow-env=HOME.
    // TMUX_PANE is blanked instead of inherited: statusline.sh writes a tmux
    // pane option whenever it is set, and a test must not touch the
    // developer's live pane.
    env: { HOME: home, TMUX_PANE: "" },
    stdin: "piped",
    stdout: "null",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(stdin));
  await writer.close();
  const { code, stderr } = await child.output();
  return { code, stderr: new TextDecoder().decode(stderr) };
}

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const home = await Deno.makeTempDir({ prefix: "statusline-usage-test-" });
  try {
    await fn(home);
  } finally {
    await Deno.remove(home, { recursive: true });
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

Deno.test("statusline.sh writes a file readAgentUsage accepts", async () => {
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

Deno.test("statusline.sh leaves no temp file behind", async () => {
  await withHome(async (home) => {
    await runStatusline(home, input({ rate_limits: RATE_LIMITS }));
    const names: string[] = [];
    for await (
      const e of Deno.readDir(`${home}/.local/state/agent-usage`)
    ) names.push(e.name);
    assertEquals(names, ["claude.json"]);
  });
});

Deno.test("statusline.sh writes nothing when rate_limits is absent", async () => {
  await withHome(async (home) => {
    const { code } = await runStatusline(home, input({}));
    assertEquals(code, 0);
    assertEquals(await readAgentUsage(home, "claude"), null);
  });
});

Deno.test("statusline.sh emits only the window that is present", async () => {
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

Deno.test("statusline.sh skips a window missing used_percentage", async () => {
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

Deno.test("statusline.sh still succeeds when rate_limits is malformed", async () => {
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

Deno.test("statusline.sh clamps an out-of-range percentage", async () => {
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
