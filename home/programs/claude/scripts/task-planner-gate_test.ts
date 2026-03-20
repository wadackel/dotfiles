import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { checkGate, cleanupMarker } from "./task-planner-gate.ts";

// --- checkGate ---

Deno.test("checkGate: returns allowed when marker exists", async () => {
  const dir = await Deno.makeTempDir();
  const sessionId = `test-${Date.now()}`;
  const markerPath = `${dir}/claude-task-planner-ready-${sessionId}`;

  // Temporarily override MARKER_PREFIX by creating the file at the expected path
  // Instead, create the marker at the real /tmp path and clean up after
  const realMarkerPath = `/tmp/claude-task-planner-ready-${sessionId}`;
  await Deno.writeTextFile(realMarkerPath, "");

  try {
    const result = await checkGate(sessionId);
    assertEquals(result.allowed, true);
    assertEquals(result.markerPath, realMarkerPath);
    assertEquals(result.denyMessage, undefined);
  } finally {
    try {
      await Deno.remove(realMarkerPath);
    } catch { /* already cleaned */ }
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("checkGate: returns denied when marker does not exist", async () => {
  const sessionId = `nonexistent-${Date.now()}`;
  const result = await checkGate(sessionId);

  assertEquals(result.allowed, false);
  assertEquals(result.markerPath, `/tmp/claude-task-planner-ready-${sessionId}`);
  assertEquals(typeof result.denyMessage, "string");
});

Deno.test("checkGate: deny message contains touch command with session id", async () => {
  const sessionId = `msg-test-${Date.now()}`;
  const result = await checkGate(sessionId);

  assertStringIncludes(result.denyMessage!, `touch /tmp/claude-task-planner-ready-${sessionId}`);
});

Deno.test("checkGate: deny message contains task-planner instruction", async () => {
  const sessionId = `instr-test-${Date.now()}`;
  const result = await checkGate(sessionId);

  assertStringIncludes(result.denyMessage!, "task-planner");
});

// --- cleanupMarker ---

Deno.test("cleanupMarker: removes existing marker file", async () => {
  const path = `/tmp/claude-task-planner-ready-cleanup-test-${Date.now()}`;
  await Deno.writeTextFile(path, "");

  await cleanupMarker(path);

  let exists = true;
  try {
    await Deno.stat(path);
  } catch {
    exists = false;
  }
  assertEquals(exists, false);
});

Deno.test("cleanupMarker: does not throw for non-existent file", async () => {
  const path = `/tmp/claude-task-planner-ready-nonexistent-${Date.now()}`;
  // Should not throw
  await cleanupMarker(path);
});
