import { test } from "bun:test";
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "../lib/proc.ts";
import {
  readSessionSummary,
  summaryPaths,
  type SummaryState,
} from "./summary-cache.ts";

const epoch = "11111111-1111-4111-8111-111111111111";
function state(sessionId = "session-a"): SummaryState {
  return {
    version: 2,
    agent: "claude",
    sessionId,
    epoch,
    nextGeneration: 2,
    publishedGeneration: 1,
    updatedAt: 1000,
    summary: "要約",
  };
}

test("summary cache: full identity determines paths without accepting a relative home", () => {
  const paths = summaryPaths({
    homeDir: "/tmp/home",
    agent: "claude",
    sessionId: "prefix-aaaa",
  });
  assert(paths);
  assertNotEquals(
    paths.file,
    summaryPaths({
      homeDir: "/tmp/home",
      agent: "claude",
      sessionId: "prefix-bbbb",
    })?.file,
  );
  assertNotEquals(
    paths.file,
    summaryPaths({
      homeDir: "/tmp/home",
      agent: "codex",
      sessionId: "prefix-aaaa",
    })?.file,
  );
  const traversal = summaryPaths({
    homeDir: "/tmp/home",
    agent: "claude",
    sessionId: "../../escape",
  });
  assert(
    traversal?.file.startsWith("/tmp/home/.cache/agentower/summaries/claude/"),
  );
  assertEquals(
    summaryPaths({ homeDir: "", agent: "claude", sessionId: "id" }),
    null,
  );
  assertEquals(
    summaryPaths({ homeDir: "/tmp/home", agent: "../bad", sessionId: "id" }),
    null,
  );
});

test("summary cache: validates state and strips terminal controls", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "summary-read-"));
  const id = { homeDir, agent: "claude", sessionId: "session-a" };
  try {
    const paths = summaryPaths(id)!;
    await mkdir(dirname(paths.file), { recursive: true });
    assertEquals(await readSessionSummary(id), null);
    await writeFile(
      paths.file,
      JSON.stringify({
        ...state(),
        summary: "\x1b[31m修正\x1b[0m\n完了\x1b]0;bad\x07\x85",
      }),
    );
    assertEquals(await readSessionSummary(id), "修正 完了");
    for (
      const value of [
        { ...state(), version: 1 },
        { ...state(), sessionId: "other" },
        { ...state(), agent: "codex" },
        { ...state(), summary: "" },
        { ...state(), nextGeneration: 1 },
        { ...state(), publishedGeneration: -1 },
        { ...state(), updatedAt: "now" },
        { ...state(), epoch: "bad" },
      ]
    ) {
      await writeFile(paths.file, JSON.stringify(value));
      assertEquals(await readSessionSummary(id), null, JSON.stringify(value));
    }
    await writeFile(paths.file, "{");
    assertEquals(await readSessionSummary(id), null);
    await writeFile(paths.file, " ".repeat(16385));
    assertEquals(await readSessionSummary(id), null);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("summary cache: rejects FIFOs, file symlinks and parent symlinks", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "summary-path-"));
  const id = { homeDir, agent: "claude", sessionId: "session-a" };
  try {
    const paths = summaryPaths(id)!;
    await mkdir(paths.directory, { recursive: true });
    const outside = join(homeDir, "outside.json");
    await writeFile(outside, JSON.stringify(state()));
    await symlink(outside, paths.file);
    assertEquals(await readSessionSummary(id), null);
    await rm(paths.file);
    assertEquals((await run("mkfifo", [paths.file])).code, 0);
    assertEquals(await readSessionSummary(id), null);
    await rm(paths.file);
    await rm(paths.directory, { recursive: true });
    const elsewhere = join(homeDir, "elsewhere");
    await mkdir(elsewhere);
    await symlink(elsewhere, paths.directory);
    assertEquals(await readSessionSummary(id), null);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
