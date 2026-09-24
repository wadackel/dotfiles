import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { logPath, rotateIfOver, trace } from "./trace.ts";

async function withHome(
  fn: (home: string, log: string) => Promise<void> | void,
  { logsDir = true } = {},
): Promise<void> {
  const home = await Deno.makeTempDir();
  const prevHome = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  if (logsDir) await Deno.mkdir(`${home}/Library/Logs`, { recursive: true });
  try {
    await fn(home, `${home}/Library/Logs/hermes-scripts.log`);
  } finally {
    if (prevHome) Deno.env.set("HOME", prevHome);
    await Deno.remove(home, { recursive: true });
  }
}

Deno.test("trace appends one stamped line per call, whitespace collapsed", async () => {
  await withHome(async (_home, log) => {
    assertEquals(logPath(), log);
    trace("first");
    trace("second\n  line\twith   gaps\n");
    const lines = (await Deno.readTextFile(log)).split("\n");
    assertEquals(lines.length, 3);
    assertEquals(lines[2], "");
    assertMatch(
      lines[0],
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} trace_test\[\d+\] first$/,
    );
    assert(lines[1].endsWith(`[${Deno.pid}] second line with gaps`));
    assertEquals((await Deno.stat(log)).mode! & 0o777, 0o600);
  });
});

Deno.test("trace drops URL queries and control characters", async () => {
  await withHome(async (_home, log) => {
    trace(
      "fetch failed for https://script.googleusercontent.com/macros/echo?user_content_key=SECRETKEY&lib=x (reset) \x1b[2K\x1b[1Afake",
    );
    const text = await Deno.readTextFile(log);
    assert(!text.includes("SECRETKEY"), text);
    assert(!text.includes("\x1b"), text);
    assert(
      text.includes(
        "fetch failed for https://script.googleusercontent.com/macros/echo (reset)",
      ),
      text,
    );
  });
});

Deno.test("trace never throws when the log cannot be written", async () => {
  await withHome(async (home) => {
    trace("dropped");
    assertEquals(
      await Deno.stat(`${home}/Library`).then(() => true, () => false),
      false,
    );
  }, { logsDir: false });
});

Deno.test("trace moves a log over the limit to .1 and starts a new one", async () => {
  await withHome(async (_home, log) => {
    await Deno.writeTextFile(log, "x".repeat(100) + "\n");
    trace("after rotation", { limit: 50 });
    assertEquals(await Deno.readTextFile(`${log}.1`), "x".repeat(100) + "\n");
    assert((await Deno.readTextFile(log)).endsWith("after rotation\n"));
  });
});

Deno.test("rotateIfOver leaves a log another process already replaced", async () => {
  await withHome(async (_home, log) => {
    await Deno.writeTextFile(log, "x".repeat(100));
    const file = Deno.openSync(log, { append: true });
    try {
      // Another process rotated first: the path now names a fresh file.
      Deno.renameSync(log, `${log}.1`);
      Deno.writeTextFileSync(log, "fresh\n");
      assertEquals(rotateIfOver(file, log, 50), false);
      assertEquals(await Deno.readTextFile(log), "fresh\n");
      assertEquals(await Deno.readTextFile(`${log}.1`), "x".repeat(100));
    } finally {
      file.close();
    }
  });
});

Deno.test("startTrace logs start and the exit code of the script", async () => {
  await withHome(async (home, log) => {
    const child = `${home}/child.ts`;
    await Deno.writeTextFile(
      child,
      `import { startTrace } from ${
        JSON.stringify(new URL("./trace.ts", import.meta.url).href)
      };\nstartTrace();\nDeno.exit(3);\n`,
    );
    const { code, stderr } = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-prompt",
        "--allow-env=HOME",
        `--allow-read=${home}`,
        `--allow-write=${home}`,
        child,
      ],
      env: { HOME: home },
      stdout: "null",
      stderr: "piped",
    }).output();
    assertEquals(code, 3, new TextDecoder().decode(stderr));
    const lines = (await Deno.readTextFile(log)).trim().split("\n");
    assertEquals(lines.length, 2);
    assertMatch(lines[0], / child\[\d+\] start$/);
    assertMatch(lines[1], / child\[\d+\] exit 3 after \d+ms$/);
  });
});

Deno.test("tracing without any log permission leaves the script running", async () => {
  await withHome(async (home, log) => {
    const child = `${home}/child.ts`;
    await Deno.writeTextFile(
      child,
      `import { startTrace, trace } from ${
        JSON.stringify(new URL("./trace.ts", import.meta.url).href)
      };\nstartTrace();\ntrace("x");\nconsole.log("still running");\n`,
    );
    const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--no-prompt", child],
      env: { HOME: home },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(code, 0, new TextDecoder().decode(stderr));
    assertEquals(new TextDecoder().decode(stdout), "still running\n");
    assertEquals(await Deno.stat(log).then(() => true, () => false), false);
  });
});
