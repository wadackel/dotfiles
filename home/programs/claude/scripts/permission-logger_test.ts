import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deriveProject,
  rotateIfNeeded,
  sanitizeInput,
} from "./permission-logger.ts";

// --- sanitizeInput ---

Deno.test("sanitizeInput: Bash command under limit is preserved", () => {
  const result = sanitizeInput("Bash", { command: "git status" });
  assertEquals(result, { command: "git status" });
});

Deno.test("sanitizeInput: Bash command over 2000 chars is truncated", () => {
  const longCmd = "x".repeat(3000);
  const result = sanitizeInput("Bash", { command: longCmd });
  assertEquals(typeof result.command, "string");
  assertEquals((result.command as string).length, 2000);
  assertEquals(result.truncated, 3000);
});

Deno.test("sanitizeInput: Write content replaced with content_length", () => {
  const result = sanitizeInput("Write", {
    file_path: "/tmp/test.ts",
    content: "hello world",
  });
  assertEquals(result.content_length, 11);
  assertEquals(result.content, undefined);
  assertEquals(result.file_path, "/tmp/test.ts");
});

Deno.test("sanitizeInput: Edit strings truncated to 500", () => {
  const long = "a".repeat(1000);
  const result = sanitizeInput("Edit", {
    file_path: "/tmp/test.ts",
    old_string: long,
    new_string: long,
  });
  assertEquals((result.old_string as string).length, 500);
  assertEquals((result.new_string as string).length, 500);
});

Deno.test("sanitizeInput: WebFetch prompt truncated to 500", () => {
  const long = "q".repeat(800);
  const result = sanitizeInput("WebFetch", {
    url: "https://example.com",
    prompt: long,
  });
  assertEquals((result.prompt as string).length, 500);
  assertEquals(result.url, "https://example.com");
});

Deno.test("sanitizeInput: unknown tool truncates string fields to 2000", () => {
  const long = "z".repeat(3000);
  const result = sanitizeInput("mcp__foo__bar", { data: long, num: 42 });
  assertEquals((result.data as string).length, 2000);
  assertEquals(result.num, 42);
});

Deno.test("sanitizeInput: total size guard triggers at 4000 chars", () => {
  // Create input that will exceed 4000 chars after sanitization
  const fields: Record<string, unknown> = {};
  for (let i = 0; i < 5; i++) {
    fields[`field_${i}`] = "x".repeat(1000);
  }
  const result = sanitizeInput("mcp__test__tool", fields);
  assertEquals(result._truncated, true);
  assertEquals(result.tool, "mcp__test__tool");
  assertEquals(Array.isArray(result.keys), true);
});

// --- deriveProject ---

Deno.test("deriveProject: extracts basename", () => {
  assertEquals(deriveProject("/Users/wadackel/projects/my-app"), "my-app");
});

Deno.test("deriveProject: handles root path", () => {
  assertEquals(deriveProject("/"), "unknown");
});

Deno.test("deriveProject: handles single segment", () => {
  assertEquals(deriveProject("myproject"), "myproject");
});

// --- rotateIfNeeded ---

Deno.test("rotateIfNeeded: no-op when file does not exist", () => {
  // Should not throw
  rotateIfNeeded("/tmp/nonexistent-permission-log-test.jsonl");
});

Deno.test("rotateIfNeeded: no-op when file is under size limit", async () => {
  const tmpFile = await Deno.makeTempFile({ suffix: ".jsonl" });
  try {
    await Deno.writeTextFile(tmpFile, '{"test":true}\n'.repeat(10));
    rotateIfNeeded(tmpFile);
    const content = await Deno.readTextFile(tmpFile);
    assertEquals(content.split("\n").filter((l) => l.trim()).length, 10);
  } finally {
    await Deno.remove(tmpFile);
  }
});

Deno.test("rotateIfNeeded: truncates to MAX_LINES_KEEP when over size", async () => {
  const tmpFile = await Deno.makeTempFile({ suffix: ".jsonl" });
  try {
    // Create a file larger than 5MB
    // Each line is about 100 chars, so 60000 lines ~= 6MB
    const line = JSON.stringify({ ts: "2026-01-01T00:00:00Z", data: "x".repeat(80) });
    const lines = Array(60000).fill(line).join("\n") + "\n";
    await Deno.writeTextFile(tmpFile, lines);

    rotateIfNeeded(tmpFile);

    const content = await Deno.readTextFile(tmpFile);
    const remaining = content.split("\n").filter((l) => l.trim()).length;
    assertEquals(remaining, 50000);
  } finally {
    await Deno.remove(tmpFile);
  }
});
