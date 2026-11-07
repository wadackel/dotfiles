import { test } from "bun:test";
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { run } from "../lib/proc.ts";
import { readSessionSummary, summaryPaths } from "./summary-cache.ts";
import {
  beginSummaryPublication,
  publishSummary,
} from "./summary-publisher.ts";

test("summary publisher: reverse completions keep the newer successful ticket", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "summary-write-"));
  const id = { homeDir, agent: "claude", sessionId: "session-a" };
  try {
    const older = await beginSummaryPublication(id);
    assert(older);
    assertEquals(await readSessionSummary(id), null);
    const newer = await beginSummaryPublication(id);
    assert(newer);
    assertEquals(newer.generation, older.generation + 1);
    await publishSummary(newer, "新しい要約");
    await publishSummary(older, "古い要約");
    assertEquals(await readSessionSummary(id), "新しい要約");
    const pending = await beginSummaryPublication(id);
    assert(pending);
    assertEquals(await readSessionSummary(id), "新しい要約");
    await publishSummary(pending, "\n\x1b[0m");
    assertEquals(await readSessionSummary(id), "新しい要約");
    const paths = summaryPaths(id)!;
    assertEquals((await stat(paths.file)).mode & 0o777, 0o600);
    assertEquals((await stat(paths.directory)).mode & 0o777, 0o700);
    const raw = JSON.parse(await readFile(paths.file, "utf8"));
    assertEquals(raw.summary, "新しい要約");
    assertEquals(raw.publishedGeneration, newer.generation);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("summary publisher: reset epochs and distinct identities cannot overwrite each other", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "summary-epoch-"));
  const id = { homeDir, agent: "codex", sessionId: "prefix-a" };
  try {
    const old = await beginSummaryPublication(id);
    assert(old);
    await writeFile(summaryPaths(id)!.file, "broken");
    const fresh = await beginSummaryPublication(id);
    assert(fresh);
    assertNotEquals(old.epoch, fresh.epoch);
    await publishSummary(fresh, "現在");
    await publishSummary(old, "過去");
    assertEquals(await readSessionSummary(id), "現在");
    const other = { ...id, sessionId: "prefix-b" };
    const ticket = await beginSummaryPublication(other);
    assert(ticket);
    await publishSummary(ticket, "別のセッション");
    assertEquals(await readSessionSummary(id), "現在");
    assertEquals(await readSessionSummary(other), "別のセッション");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("summary publisher: cross-process reservation is serialized", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "summary-process-"));
  const id = { homeDir, agent: "opencode", sessionId: "ses_test" };
  try {
    const module = new URL("./summary-publisher.ts", import.meta.url).href;
    const code = `import {beginSummaryPublication} from ${
      JSON.stringify(module)
    }; console.log(JSON.stringify(await beginSummaryPublication(JSON.parse(process.argv.at(-1)))));`;
    const outputs = await Promise.all(
      Array.from({ length: 6 }, () =>
        run(process.execPath, [
          "--no-env-file",
          "--no-install",
          "--config=/dev/null",
          "-e",
          code,
          JSON.stringify(id),
        ])),
    );
    for (const out of outputs) assertEquals(out.code, 0, out.stderr);
    const generations = outputs.map((o) => JSON.parse(o.stdout)?.generation)
      .sort((a, b) => a - b);
    assertEquals(generations, [1, 2, 3, 4, 5, 6]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("summary publisher: contention times out and process death releases the lock", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "summary-crash-"));
  const id = { homeDir, agent: "claude", sessionId: "crash" };
  const module = new URL("./summary-publisher.ts", import.meta.url).href;
  const code = `import {withSummaryLock} from ${
    JSON.stringify(module)
  }; await withSummaryLock(JSON.parse(process.argv.at(-1)),async()=>{console.log('LOCKED');await new Promise(()=>{});});`;
  const child = spawn(process.execPath, [
    "--no-env-file",
    "--no-install",
    "--config=/dev/null",
    "-e",
    code,
    JSON.stringify(id),
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise((resolve) => child.on("close", resolve));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("lock holder did not start")),
        3000,
      );
      child.stdout.on("data", (chunk) => {
        if (String(chunk).includes("LOCKED")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        reject(new Error(`holder exited ${code}`));
      });
    });
    const errors: string[] = [];
    assertEquals(
      await beginSummaryPublication(id, (msg) => {
        errors.push(msg);
      }),
      null,
    );
    assertEquals(errors.length, 1);
    child.kill("SIGKILL");
    await closed;
    assert(await beginSummaryPublication(id));
  } finally {
    child.kill("SIGKILL");
    await closed;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("summary publisher: invalid paths and failing error handlers fail open", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "summary-failure-"));
  const id = { homeDir, agent: "claude", sessionId: "id" };
  try {
    await writeFile(join(homeDir, "outside"), "untouched");
    await symlink(join(homeDir, "outside"), join(homeDir, ".cache"));
    assertEquals(
      await beginSummaryPublication(id, () => {
        throw new Error("logger");
      }),
      null,
    );
    assertEquals(await readFile(join(homeDir, "outside"), "utf8"), "untouched");
    assertEquals(await beginSummaryPublication({ ...id, homeDir: "" }), null);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
