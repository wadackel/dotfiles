import { assertEquals } from "jsr:@std/assert@1";
import {
  eventToOps,
  maskPrompt,
  type Op,
  type PaneState,
  selfHealOps,
} from "./plugin_logic.ts";

const STATE: PaneState = { status: "idle", currentTool: "" };

// Helpers to assert without time-dependent fields. eventToOps stamps
// `@pane_started_at` / `@pane_last_activity_at` with the wall-clock second,
// so tests strip them before comparing the structural Op set.
function stripTimestamps(ops: Op[]): Op[] {
  return ops.filter((o) =>
    o.key !== "@pane_started_at" && o.key !== "@pane_last_activity_at"
  );
}

function findSet(ops: Op[], key: string): string | undefined {
  for (const o of ops) {
    if (o.kind === "set" && o.key === key) return o.value;
  }
  return undefined;
}

function findUnset(ops: Op[], key: string): boolean {
  return ops.some((o) => o.kind === "unset" && o.key === key);
}

// --- maskPrompt ---

Deno.test("maskPrompt: empty string stays empty", () => {
  assertEquals(maskPrompt(""), "");
  assertEquals(maskPrompt(undefined), "");
  assertEquals(maskPrompt(null), "");
  assertEquals(maskPrompt(42), "");
});

Deno.test("maskPrompt: control bytes stripped, whitespace collapsed", () => {
  // Only the C0/C1 control bytes themselves are stripped; ASCII payload
  // bytes like the `[2J` that follow ESC remain — that is the documented
  // contract (and matches claude-pane-status.ts:maskPrompt).
  assertEquals(maskPrompt("hello\x1bworld"), "hello world");
  assertEquals(maskPrompt("a\x00b\x07c"), "a b c");
  assertEquals(maskPrompt("a    b   c"), "a b c");
});

Deno.test("maskPrompt: 40+ chars truncated with ellipsis", () => {
  const long = "x".repeat(50);
  const masked = maskPrompt(long);
  assertEquals(masked.length, 41); // 40 chars + "…"
  assertEquals(masked.endsWith("…"), true);
});

// --- selfHealOps ---

Deno.test("selfHealOps: missing sessionID → empty", () => {
  assertEquals(selfHealOps({}), []);
  assertEquals(selfHealOps({ cwd: "/tmp" }), []);
});

Deno.test("selfHealOps: sessionID set → @pane_agent=opencode + session_id", () => {
  const ops = selfHealOps({ sessionID: "abc-123" });
  assertEquals(findSet(ops, "@pane_agent"), "opencode");
  assertEquals(findSet(ops, "@pane_session_id"), "abc-123");
});

Deno.test("selfHealOps: snake_case session_id also accepted", () => {
  const ops = selfHealOps({ session_id: "snake-123" });
  assertEquals(findSet(ops, "@pane_session_id"), "snake-123");
});

Deno.test("selfHealOps: cwd from properties.info.directory", () => {
  const ops = selfHealOps({
    sessionID: "x",
    properties: { info: { directory: "/work/proj" } },
  });
  assertEquals(findSet(ops, "@pane_cwd"), "/work/proj");
});

// --- eventToOps ---

Deno.test("eventToOps: session.created → status=idle + started_at + activity", () => {
  const ops = eventToOps("session.created", { sessionID: "s1" }, STATE);
  assertEquals(findSet(ops, "@pane_agent"), "opencode");
  assertEquals(findSet(ops, "@pane_status"), "idle");
  // started_at and last_activity_at are present (timestamp values not asserted)
  assertEquals(typeof findSet(ops, "@pane_started_at"), "string");
  assertEquals(typeof findSet(ops, "@pane_last_activity_at"), "string");
});

Deno.test("eventToOps: chat.message → status=running + prompt masked", () => {
  const ops = eventToOps(
    "chat.message",
    { sessionID: "s1", prompt: "hello\x1bworld" },
    STATE,
  );
  assertEquals(findSet(ops, "@pane_status"), "running");
  // ESC byte → space (regex strips control bytes only); whitespace runs are
  // collapsed to a single space.
  assertEquals(findSet(ops, "@pane_prompt"), "hello world");
});

Deno.test("eventToOps: chat.message with empty prompt → @pane_prompt unset", () => {
  const ops = eventToOps("chat.message", { sessionID: "s1" }, STATE);
  assertEquals(findUnset(ops, "@pane_prompt"), true);
});

Deno.test("eventToOps: chat.message reads prompt from output.parts text", () => {
  const ops = eventToOps(
    "chat.message",
    {
      sessionID: "s1",
      output: {
        message: { role: "user" },
        parts: [
          { type: "text", text: "what is 2+2" },
          { type: "image", url: "ignore" },
        ],
      },
    },
    STATE,
  );
  assertEquals(findSet(ops, "@pane_prompt"), "what is 2+2");
});

Deno.test("eventToOps: permission.ask → waiting + reason=permission", () => {
  const ops = eventToOps("permission.ask", { sessionID: "s1" }, STATE);
  assertEquals(findSet(ops, "@pane_status"), "waiting");
  assertEquals(findSet(ops, "@pane_wait_reason"), "permission");
});

Deno.test("eventToOps: tool.execute.before string tool → set current_tool", () => {
  const ops = eventToOps(
    "tool.execute.before",
    { sessionID: "s1", tool: "bash" },
    STATE,
  );
  assertEquals(findSet(ops, "@pane_current_tool"), "bash");
});

Deno.test("eventToOps: tool.execute.before structured tool → JSON-truncated fallback", () => {
  const ops = eventToOps(
    "tool.execute.before",
    { sessionID: "s1", tool: { name: "edit", id: "x" } },
    STATE,
  );
  const v = findSet(ops, "@pane_current_tool");
  assertEquals(typeof v, "string");
  assertEquals(v!.startsWith("{"), true);
});

Deno.test("eventToOps: tool.execute.after → unset current + set last + activity", () => {
  const stateMid: PaneState = { status: "running", currentTool: "bash" };
  const ops = eventToOps(
    "tool.execute.after",
    { sessionID: "s1", tool: "bash" },
    stateMid,
  );
  assertEquals(findUnset(ops, "@pane_current_tool"), true);
  assertEquals(findSet(ops, "@pane_last_tool"), "bash");
  assertEquals(typeof findSet(ops, "@pane_last_activity_at"), "string");
});

Deno.test("eventToOps: tool.execute.after when tool != currentTool → keep current_tool", () => {
  const stateMid: PaneState = { status: "running", currentTool: "edit" };
  const ops = eventToOps(
    "tool.execute.after",
    { sessionID: "s1", tool: "bash" },
    stateMid,
  );
  // Different tool finished → don't unset @pane_current_tool (last-wins for
  // concurrent tools, mirrors claude-pane-status.ts:PostToolUse behavior).
  assertEquals(findUnset(ops, "@pane_current_tool"), false);
  assertEquals(findSet(ops, "@pane_last_tool"), "bash");
});

Deno.test("eventToOps: session.idle → status=idle", () => {
  const ops = eventToOps("session.idle", { sessionID: "s1" }, STATE);
  assertEquals(findSet(ops, "@pane_status"), "idle");
});

Deno.test("eventToOps: session.status busy → running", () => {
  const ops = eventToOps(
    "session.status",
    { sessionID: "s1", properties: { type: "busy" } },
    STATE,
  );
  assertEquals(findSet(ops, "@pane_status"), "running");
});

Deno.test("eventToOps: session.status idle → idle", () => {
  const ops = eventToOps(
    "session.status",
    { sessionID: "s1", properties: { type: "idle" } },
    STATE,
  );
  assertEquals(findSet(ops, "@pane_status"), "idle");
});

Deno.test("eventToOps: session.error → status=error + wait_reason", () => {
  const ops = eventToOps(
    "session.error",
    { sessionID: "s1", properties: { error: "rate_limit" } },
    STATE,
  );
  assertEquals(findSet(ops, "@pane_status"), "error");
  assertEquals(findSet(ops, "@pane_wait_reason"), "rate_limit");
});

Deno.test("eventToOps: session.deleted → drain all options", () => {
  const ops = eventToOps("session.deleted", { sessionID: "s1" }, STATE);
  // Drain emits unset for every ALL_PANE_OPTIONS entry.
  assertEquals(ops.every((o) => o.kind === "unset"), true);
  assertEquals(findUnset(ops, "@pane_agent"), true);
  assertEquals(findUnset(ops, "@pane_status"), true);
  assertEquals(findUnset(ops, "@pane_session_id"), true);
});

Deno.test("eventToOps: unknown event → empty Op[]", () => {
  const ops = eventToOps(
    "session.totally-new-event",
    { sessionID: "s1" },
    STATE,
  );
  assertEquals(ops, []);
});

Deno.test("eventToOps: missing sessionID → no selfHeal prefix on body", () => {
  // session.idle still emits its body but selfHealOps prepends nothing
  // when sessionID is absent. The single body op survives.
  const ops = eventToOps("session.idle", {}, STATE);
  assertEquals(ops.length, 1);
  assertEquals(findSet(ops, "@pane_status"), "idle");
});

// Sanity: stripTimestamps usage is exercised in at least one place to keep
// the helper from rotting silently. Same body as session.created but asserts
// the structural Op set after stripping.
Deno.test("eventToOps: session.created structural op set (timestamps stripped)", () => {
  const ops = eventToOps("session.created", { sessionID: "s1" }, STATE);
  const stripped = stripTimestamps(ops);
  assertEquals(
    stripped.some((o) => o.kind === "set" && o.key === "@pane_agent"),
    true,
  );
  assertEquals(
    stripped.some((o) =>
      o.kind === "set" && o.key === "@pane_status" && o.value === "idle"
    ),
    true,
  );
});
