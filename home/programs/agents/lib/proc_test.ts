import { test } from "bun:test";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { run } from "./proc.ts";

test("run: returns the exit code with stdout and stderr kept apart", async () => {
  const r = await run("sh", ["-c", "echo out; echo err >&2; exit 3"]);
  assertEquals(r, { code: 3, signal: null, stdout: "out\n", stderr: "err\n" });
});

test("run: args default to none", async () => {
  const r = await run("true");
  assertEquals(r.code, 0);
});

test("run: output larger than 1 MiB arrives whole", async () => {
  const bytes = 3 * 1024 * 1024;
  const r = await run("sh", [
    "-c",
    `head -c ${bytes} /dev/zero | tr '\\0' 'a'`,
  ]);
  assertEquals(r.code, 0);
  assertEquals(r.stdout.length, bytes);
});

test("run: env is layered over the parent environment", async () => {
  process.env.PROC_TEST_PARENT = "parent";
  try {
    const r = await run("sh", [
      "-c",
      'echo "$PROC_TEST_PARENT:$PROC_TEST_CHILD"',
    ], {
      env: { PROC_TEST_CHILD: "child" },
    });
    assertEquals(r.stdout, "parent:child\n");
  } finally {
    delete process.env.PROC_TEST_PARENT;
  }
});

test("run: clearEnv drops the parent environment", async () => {
  process.env.PROC_TEST_PARENT = "parent";
  try {
    const r = await run("/bin/sh", [
      "-c",
      'echo "${PROC_TEST_PARENT:-unset}:$PROC_TEST_CHILD"',
    ], {
      env: { PROC_TEST_CHILD: "child" },
      clearEnv: true,
    });
    assertEquals(r.stdout, "unset:child\n");
  } finally {
    delete process.env.PROC_TEST_PARENT;
  }
});

test("run: stdin text reaches the child and is closed", async () => {
  const r = await run("cat", [], { stdin: "from stdin" });
  assertEquals(r.stdout, "from stdin");
});

test("run: without stdin the child reads end of input", async () => {
  const r = await run("cat");
  assertEquals(r, { code: 0, signal: null, stdout: "", stderr: "" });
});

test("run: a child that never reads its stdin does not fail the call", async () => {
  const r = await run("true", [], { stdin: "x".repeat(1024 * 1024) });
  assertEquals(r.code, 0);
});

test("run: cwd sets the working directory", async () => {
  const dir = await realpath(tmpdir());
  const r = await run("pwd", ["-P"], { cwd: dir });
  assertEquals(r.stdout.trim(), dir);
});

test("run: a command that cannot be started rejects with ENOENT", async () => {
  const err = await assertRejects(() =>
    run("definitely-not-a-command-proc-test")
  );
  assertEquals((err as NodeJS.ErrnoException).code, "ENOENT");
});

test("run: death by signal reports the signal and 128 + its number", async () => {
  const r = await run("sh", ["-c", "kill -TERM $$"]);
  assertEquals(r.signal, "SIGTERM");
  assertEquals(r.code, 143);
});

test("run: output is decoded as UTF-8 across chunk boundaries", async () => {
  const r = await run("sh", ["-c", "printf 'あ%.0s' $(seq 1 100000)"]);
  assert(!r.stdout.includes("�"));
  assertEquals(r.stdout.length, 100000);
});
