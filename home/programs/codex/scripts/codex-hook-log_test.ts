import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildLogEntry,
  rotateIfNeeded,
  sanitizePayload,
} from "./codex-hook-log.ts";

test("sanitizePayload: truncates long strings and redacts content body length", () => {
  const payload = sanitizePayload({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { content: "x".repeat(3000), file_path: "/tmp/a" },
    prompt: "y".repeat(3001),
  });
  assertEquals(
    (payload.tool_input as Record<string, unknown>).content_length,
    3000,
  );
  assertEquals(typeof payload.prompt, "string");
  assertEquals((payload.prompt as string).length, 2000);
});

test("sanitizePayload: total size guard keeps identifying fields", () => {
  const payload = sanitizePayload({
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    session_id: "s1",
    cwd: "/tmp/project",
    ...Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`big_${i}`, "x".repeat(2000)]),
    ),
  });
  assertEquals(payload._truncated, true);
  assertEquals(payload.tool_name, "Bash");
  assertEquals(payload.session_id, "s1");
});

test("buildLogEntry: prefers argv event and preserves hook metadata", () => {
  const entry = buildLogEntry("PermissionRequest", {
    hook_event_name: "Other",
    session_id: "s1",
    cwd: "/repo",
    tool_name: "Bash",
  }, new Date("2026-05-04T00:00:00Z"));
  assertEquals(entry.event, "PermissionRequest");
  assertEquals(entry.session_id, "s1");
  assertEquals(entry.cwd, "/repo");
  assertEquals(entry.tool_name, "Bash");
  assertEquals(entry.ts, "2026-05-04T00:00:00.000Z");
});

test("rotateIfNeeded: keeps valid jsonl tail for oversized file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmp-"));
  const file = `${dir}/hooks.jsonl`;
  await writeFile(
    file,
    Array.from(
      { length: 60_100 },
      (_, i) => JSON.stringify({ i, text: "x".repeat(100) }),
    ).join("\n") + "\n",
  );
  rotateIfNeeded(file);
  const content = await readFile(file, "utf8");
  assert(content.split("\n").filter(Boolean).length <= 50_000);
  assertStringIncludes(content, '"i":60099');
});
