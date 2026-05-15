import { assertEquals, assertMatch } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { checkGate, type HookInput } from "../../scripts/plan-gate.ts";

const scriptPath = fromFileUrl(
  new URL("./plan-marker-grant.ts", import.meta.url),
);

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  home: string,
  args: string[],
): Promise<RunResult> {
  const cmd = new Deno.Command(scriptPath, {
    args,
    env: { HOME: home, NO_COLOR: "1" },
    clearEnv: false,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function withTempEnv<T>(
  run: (home: string, cwd: string) => Promise<T>,
): Promise<T> {
  const home = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "plan-marker-grant-cli-home-",
  });
  const cwd = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "plan-marker-grant-cli-cwd-",
  });
  try {
    return await run(home, cwd);
  } finally {
    await Deno.remove(home, { recursive: true });
    await Deno.remove(cwd, { recursive: true });
  }
}

Deno.test("CLI: activate writes marker and returns JSON", async () => {
  await withTempEnv(async (home, cwd) => {
    const result = await runCli(home, ["activate", cwd, "session-1"]);
    assertEquals(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assertEquals(parsed.status, "activated");
    assertMatch(
      parsed.marker.path,
      /\/\.bypass-plan-gate-[0-9a-f]{16}-[0-9a-f]{32}\.json$/,
    );
    const markerExists = await Deno.stat(parsed.marker.path);
    assertEquals(markerExists.isFile, true);
  });
});

Deno.test("CLI: empty subcommand defaults to activate", async () => {
  await withTempEnv(async (home, cwd) => {
    const result = await runCli(home, ["", cwd, "session-1"]);
    assertEquals(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assertEquals(parsed.status, "activated");
  });
});

Deno.test("CLI: missing cwd → exit 1", async () => {
  await withTempEnv(async (home) => {
    const result = await runCli(home, ["activate", "", "session-1"]);
    assertEquals(result.code, 1);
    assertMatch(result.stderr, /cwd is required/);
  });
});

Deno.test("CLI: missing session_id → exit 1", async () => {
  await withTempEnv(async (home, cwd) => {
    const result = await runCli(home, ["activate", cwd, ""]);
    assertEquals(result.code, 1);
    assertMatch(result.stderr, /session_id is required/);
  });
});

Deno.test("CLI: unknown subcommand → exit 1", async () => {
  await withTempEnv(async (home, cwd) => {
    const result = await runCli(home, ["explode", cwd, "session-1"]);
    assertEquals(result.code, 1);
    assertMatch(result.stderr, /unknown subcommand/);
  });
});

Deno.test("CLI: status after activate → valid:true", async () => {
  await withTempEnv(async (home, cwd) => {
    const activate = await runCli(home, ["activate", cwd, "session-1"]);
    assertEquals(activate.code, 0);
    const status = await runCli(home, ["status", cwd, "session-1"]);
    assertEquals(status.code, 0);
    const parsed = JSON.parse(status.stdout);
    assertEquals(parsed.valid, true);
  });
});

Deno.test("CLI: status without activate → valid:false", async () => {
  await withTempEnv(async (home, cwd) => {
    const status = await runCli(home, ["status", cwd, "session-1"]);
    assertEquals(status.code, 0);
    const parsed = JSON.parse(status.stdout);
    assertEquals(parsed.valid, false);
  });
});

Deno.test("CLI: clear removes marker", async () => {
  await withTempEnv(async (home, cwd) => {
    const activate = await runCli(home, ["activate", cwd, "session-1"]);
    const activatePayload = JSON.parse(activate.stdout);
    const markerPath = activatePayload.marker.path as string;

    const clear = await runCli(home, ["clear", cwd, "session-1"]);
    assertEquals(clear.code, 0);
    const parsed = JSON.parse(clear.stdout);
    assertEquals(parsed.status, "cleared");

    let stillExists = true;
    try {
      await Deno.stat(markerPath);
    } catch {
      stillExists = false;
    }
    assertEquals(stillExists, false);
  });
});

Deno.test("CLI: clear when absent → status:absent", async () => {
  await withTempEnv(async (home, cwd) => {
    const clear = await runCli(home, ["clear", cwd, "session-1"]);
    assertEquals(clear.code, 0);
    const parsed = JSON.parse(clear.stdout);
    assertEquals(parsed.status, "absent");
  });
});

Deno.test("CLI: dangerous session_id does not leak into path", async () => {
  await withTempEnv(async (home, cwd) => {
    const danger = "session/with/../slashes && $(echo unsafe)";
    const result = await runCli(home, ["activate", cwd, danger]);
    assertEquals(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    const path = parsed.marker.path as string;
    const basename = path.slice(path.lastIndexOf("/") + 1);
    assertMatch(
      basename,
      /^\.bypass-plan-gate-[0-9a-f]{16}-[0-9a-f]{32}\.json$/,
    );
    assertEquals(path.includes("session/with"), false);
    assertEquals(path.includes("unsafe"), false);
  });
});

Deno.test("CLI integration: activate then checkGate returns bypass-valid", async () => {
  await withTempEnv(async (home, cwd) => {
    const activate = await runCli(home, ["activate", cwd, "session-1"]);
    assertEquals(activate.code, 0);

    const originalHome = Deno.env.get("HOME");
    Deno.env.set("HOME", home);
    try {
      const file = `${cwd}/touched.ts`;
      await Deno.writeTextFile(file, "");
      const input: HookInput = {
        tool_input: { file_path: file },
        cwd,
        session_id: "session-1",
      };
      const decision = await checkGate(input);
      assertEquals(decision.kind, "allow");
      if (decision.kind === "allow") {
        assertEquals(decision.reason, "bypass-valid");
      }
    } finally {
      if (originalHome !== undefined) {
        Deno.env.set("HOME", originalHome);
      } else {
        Deno.env.delete("HOME");
      }
    }
  });
});
