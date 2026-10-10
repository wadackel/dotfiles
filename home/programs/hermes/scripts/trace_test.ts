import { test } from "bun:test";
import { assert, assertEquals, assertMatch } from "@std/assert";
import { closeSync, openSync, renameSync, writeFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../agents/lib/proc.ts";
import { logPath, rotateIfOver, trace } from "./trace.ts";

const TRACE = JSON.stringify(join(import.meta.dirname, "trace.ts"));

async function withHome(
  fn: (home: string, log: string) => Promise<void> | void,
  { logsDir = true } = {},
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "tmp-"));
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  if (logsDir) await mkdir(`${home}/Library/Logs`, { recursive: true });
  try {
    await fn(home, `${home}/Library/Logs/hermes-scripts.log`);
  } finally {
    if (prevHome) process.env.HOME = prevHome;
    await rm(home, { recursive: true });
  }
}

// The cache is turned off so that Bun writes nothing under the temporary HOME.
const runChild = (child: string, home: string) =>
  run(process.execPath, [
    "--no-env-file",
    "--no-install",
    "--config=/dev/null",
    child,
  ], { env: { HOME: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" } });

test("trace appends one stamped line per call, whitespace collapsed", async () => {
  await withHome(async (_home, log) => {
    assertEquals(logPath(), log);
    // `bun test` leaves the first test file of the run in argv, whichever
    // file is executing.
    const entry = process.argv[1];
    process.argv[1] = import.meta.filename;
    try {
      trace("first");
      trace("second\n  line\twith   gaps\n");
    } finally {
      process.argv[1] = entry;
    }
    const lines = (await readFile(log, "utf8")).split("\n");
    assertEquals(lines.length, 3);
    assertEquals(lines[2], "");
    assertMatch(
      lines[0],
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} trace_test\[\d+\] first$/,
    );
    assert(lines[1].endsWith(`[${process.pid}] second line with gaps`));
    assertEquals((await stat(log)).mode & 0o777, 0o600);
  });
});

test("trace drops URL queries and control characters", async () => {
  await withHome(async (_home, log) => {
    trace(
      "fetch failed for https://script.googleusercontent.com/macros/echo?user_content_key=SECRETKEY&lib=x (reset) \x1b[2K\x1b[1Afake",
    );
    const text = await readFile(log, "utf8");
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

test("trace never throws when the log cannot be written", async () => {
  await withHome(async (home) => {
    trace("dropped");
    assertEquals(
      await stat(`${home}/Library`).then(() => true, () => false),
      false,
    );
  }, { logsDir: false });
});

test("trace moves a log over the limit to .1 and starts a new one", async () => {
  await withHome(async (_home, log) => {
    await writeFile(log, "x".repeat(100) + "\n");
    trace("after rotation", { limit: 50 });
    assertEquals(await readFile(`${log}.1`, "utf8"), "x".repeat(100) + "\n");
    assert((await readFile(log, "utf8")).endsWith("after rotation\n"));
  });
});

test("rotateIfOver leaves a log another process already replaced", async () => {
  await withHome(async (_home, log) => {
    await writeFile(log, "x".repeat(100));
    const fd = openSync(log, "a");
    try {
      // Another process rotated first: the path now names a fresh file.
      renameSync(log, `${log}.1`);
      writeFileSync(log, "fresh\n");
      assertEquals(rotateIfOver(fd, log, 50), false);
      assertEquals(await readFile(log, "utf8"), "fresh\n");
      assertEquals(await readFile(`${log}.1`, "utf8"), "x".repeat(100));
    } finally {
      closeSync(fd);
    }
  });
});

test("startTrace logs start and the exit code of the script", async () => {
  await withHome(async (home, log) => {
    const child = `${home}/child.ts`;
    await writeFile(
      child,
      `import { startTrace } from ${TRACE};\nstartTrace();\nprocess.exit(3);\n`,
    );
    const { code, stderr } = await runChild(child, home);
    assertEquals(code, 3, stderr);
    const lines = (await readFile(log, "utf8")).trim().split("\n");
    assertEquals(lines.length, 2);
    assertMatch(lines[0], / child\[\d+\] start$/);
    assertMatch(lines[1], / child\[\d+\] exit 3 after \d+ms$/);
  });
});

test("an uncaught exception leaves an exit 1 line", async () => {
  await withHome(async (home, log) => {
    const child = `${home}/child.ts`;
    await writeFile(
      child,
      `import { startTrace } from ${TRACE};\nstartTrace();\nthrow new Error("boom");\n`,
    );
    const { code, stderr } = await runChild(child, home);
    assertEquals(code, 1, stderr);
    const lines = (await readFile(log, "utf8")).trim().split("\n");
    assertEquals(lines.length, 2);
    assertMatch(lines[0], / child\[\d+\] start$/);
    assertMatch(lines[1], / child\[\d+\] exit 1 after \d+ms$/);
  });
});

test("tracing into a log directory that refuses writes leaves the script running", async () => {
  await withHome(async (home, log) => {
    await chmod(`${home}/Library/Logs`, 0o555);
    const child = `${home}/child.ts`;
    await writeFile(
      child,
      `import { startTrace, trace } from ${TRACE};\nstartTrace();\ntrace("x");\nconsole.log("still running");\n`,
    );
    const { code, stdout, stderr } = await runChild(child, home);
    assertEquals(code, 0, stderr);
    assertEquals(stdout, "still running\n");
    assertEquals(await stat(log).then(() => true, () => false), false);
  });
});
