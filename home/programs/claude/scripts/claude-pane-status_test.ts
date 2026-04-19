import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALL_PANE_OPTIONS,
  eventToOps,
  formatElapsed,
  maskPrompt,
  parseCount,
  selfHealOps,
} from "./claude-pane-status.ts";

// --- maskPrompt ---

Deno.test("maskPrompt: empty string stays empty", () => {
  assertEquals(maskPrompt(""), "");
});

Deno.test("maskPrompt: non-string input → empty", () => {
  assertEquals(maskPrompt(undefined), "");
  assertEquals(maskPrompt(null), "");
  assertEquals(maskPrompt(123), "");
});

Deno.test("maskPrompt: short string preserved verbatim", () => {
  assertEquals(maskPrompt("hello"), "hello");
});

Deno.test("maskPrompt: exactly 40 chars not truncated", () => {
  const s = "x".repeat(40);
  assertEquals(maskPrompt(s), s);
});

Deno.test("maskPrompt: 41 chars truncated with ellipsis", () => {
  const s = "x".repeat(41);
  const out = maskPrompt(s);
  assertEquals(out.length, 41); // 40 x + single '…'
  assertStringIncludes(out, "…");
  assertEquals(out.slice(0, 40), "x".repeat(40));
});

Deno.test("maskPrompt: TAB / CR / LF collapsed to single space", () => {
  assertEquals(maskPrompt("a\tb\nc\rd"), "a b c d");
});

Deno.test("maskPrompt: multi whitespace runs collapsed", () => {
  assertEquals(maskPrompt("a   b"), "a b");
});

// --- formatElapsed ---

Deno.test("formatElapsed: negative → -", () => {
  assertEquals(formatElapsed(-1), "-");
});

Deno.test("formatElapsed: 0..59 → Ns", () => {
  assertEquals(formatElapsed(0), "0s");
  assertEquals(formatElapsed(59), "59s");
});

Deno.test("formatElapsed: 60..3599 → Nm", () => {
  assertEquals(formatElapsed(60), "1m");
  assertEquals(formatElapsed(3599), "59m");
});

Deno.test("formatElapsed: >=3600 → Nh", () => {
  assertEquals(formatElapsed(3600), "1h");
  assertEquals(formatElapsed(7200), "2h");
});

// --- parseCount ---

Deno.test("parseCount: empty / whitespace → 0", () => {
  assertEquals(parseCount(""), 0);
  assertEquals(parseCount("   "), 0);
  assertEquals(parseCount(undefined), 0);
  assertEquals(parseCount(null), 0);
});

Deno.test("parseCount: non-numeric → 0", () => {
  assertEquals(parseCount("abc"), 0);
});

Deno.test("parseCount: negative normalized to 0", () => {
  assertEquals(parseCount("-3"), 0);
});

Deno.test("parseCount: valid number", () => {
  assertEquals(parseCount("3"), 3);
  assertEquals(parseCount(" 5 "), 5);
});

// --- eventToOps ---

const emptyState = { subagentsCount: 0, pendingTeardown: false };

Deno.test("eventToOps: SessionStart sets agent / status / session_id / cwd + unsets stale", () => {
  const ops = eventToOps(
    "SessionStart",
    { session_id: "sess-1", cwd: "/tmp/x" },
    emptyState,
  );
  // stale unsets + 4 sets
  const unsets = ops.filter((o) => o.kind === "unset").map((o) => o.key);
  const sets = ops.filter((o) => o.kind === "set");
  assertStringIncludes(unsets.join(","), "@pane_prompt");
  assertStringIncludes(unsets.join(","), "@pane_attention");
  assertEquals(sets.find((s) => s.kind === "set" && s.key === "@pane_agent")?.value, "claude");
  assertEquals(sets.find((s) => s.kind === "set" && s.key === "@pane_status")?.value, "idle");
  assertEquals(sets.find((s) => s.kind === "set" && s.key === "@pane_cwd")?.value, "/tmp/x");
});

Deno.test("eventToOps: SessionStart clears @pane_started_at (prevent elapsed bleed from prior session)", () => {
  const ops = eventToOps(
    "SessionStart",
    { session_id: "sess-new" },
    emptyState,
  );
  const startedAtOp = ops.find((o) => o.key === "@pane_started_at");
  assertEquals(startedAtOp?.kind, "unset");
});

Deno.test("eventToOps: SessionEnd with count 0 → unset all @pane_*", () => {
  const ops = eventToOps("SessionEnd", {}, emptyState);
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
});

Deno.test("eventToOps: SessionEnd with live subagents → pending teardown", () => {
  const ops = eventToOps("SessionEnd", {}, {
    subagentsCount: 2,
    pendingTeardown: false,
  });
  assertEquals(ops, [{
    kind: "set",
    key: "@pane_pending_teardown",
    value: "1",
  }]);
});

Deno.test("eventToOps: UserPromptSubmit masks prompt + sets running", () => {
  const longPrompt = "x".repeat(100);
  const ops = eventToOps(
    "UserPromptSubmit",
    { prompt: longPrompt },
    emptyState,
  );
  const statusOp = ops.find((o) => o.kind === "set" && o.key === "@pane_status");
  assertEquals(statusOp?.kind === "set" ? statusOp.value : "", "running");
  const promptOp = ops.find((o) => o.kind === "set" && o.key === "@pane_prompt");
  const maskedValue = promptOp?.kind === "set" ? promptOp.value : "";
  assertEquals(maskedValue.length, 41); // 40 chars + ellipsis
});

Deno.test("eventToOps: UserPromptSubmit with empty prompt → unset @pane_prompt", () => {
  const ops = eventToOps("UserPromptSubmit", {}, emptyState);
  const promptOp = ops.find((o) => o.key === "@pane_prompt");
  assertEquals(promptOp?.kind, "unset");
});

Deno.test("eventToOps: Stop with count 0 → idle", () => {
  const ops = eventToOps("Stop", {}, emptyState);
  assertEquals(ops, [{ kind: "set", key: "@pane_status", value: "idle" }]);
});

Deno.test("eventToOps: Stop with live subagents → defer (empty)", () => {
  const ops = eventToOps("Stop", {}, {
    subagentsCount: 1,
    pendingTeardown: false,
  });
  assertEquals(ops, []);
});

Deno.test("eventToOps: StopFailure → error + wait_reason", () => {
  const ops = eventToOps("StopFailure", { message: "boom" }, emptyState);
  assertEquals(
    ops.find((o) => o.key === "@pane_status" && o.kind === "set")?.kind === "set"
      ? (ops.find((o) => o.key === "@pane_status") as { value: string }).value
      : "",
    "error",
  );
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind === "set" ? reason.value : "", "boom");
});

Deno.test("eventToOps: Notification → waiting + attention", () => {
  const ops = eventToOps(
    "Notification",
    { message: "please approve" },
    emptyState,
  );
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "waiting");
  const attn = ops.find((o) => o.key === "@pane_attention");
  assertEquals(attn?.kind === "set" ? attn.value : "", "notification");
});

Deno.test("eventToOps: PermissionDenied → waiting + permission-denied", () => {
  const ops = eventToOps("PermissionDenied", {}, emptyState);
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind === "set" ? reason.value : "", "permission-denied");
});

Deno.test("eventToOps: CwdChanged with cwd → set @pane_cwd", () => {
  const ops = eventToOps("CwdChanged", { cwd: "/new" }, emptyState);
  assertEquals(ops, [{ kind: "set", key: "@pane_cwd", value: "/new" }]);
});

Deno.test("eventToOps: CwdChanged without cwd → no-op", () => {
  const ops = eventToOps("CwdChanged", {}, emptyState);
  assertEquals(ops, []);
});

Deno.test("eventToOps: SubagentStart increments counter", () => {
  const ops = eventToOps("SubagentStart", {}, {
    subagentsCount: 3,
    pendingTeardown: false,
  });
  assertEquals(ops, [{
    kind: "set",
    key: "@pane_subagents_count",
    value: "4",
  }]);
});

Deno.test("eventToOps: SubagentStop decrements; floors at 0", () => {
  const from1 = eventToOps("SubagentStop", {}, {
    subagentsCount: 1,
    pendingTeardown: false,
  });
  assertEquals(from1, [{
    kind: "set",
    key: "@pane_subagents_count",
    value: "0",
  }]);
  const from0 = eventToOps("SubagentStop", {}, {
    subagentsCount: 0,
    pendingTeardown: false,
  });
  assertEquals(from0, [{
    kind: "set",
    key: "@pane_subagents_count",
    value: "0",
  }]);
});

Deno.test("eventToOps: SubagentStop drains pending teardown when count hits 0", () => {
  const ops = eventToOps("SubagentStop", {}, {
    subagentsCount: 1,
    pendingTeardown: true,
  });
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
});

Deno.test("eventToOps: WorktreeCreate with branch + path", () => {
  const ops = eventToOps(
    "WorktreeCreate",
    { branch: "feat/foo", path: "/tmp/wt" },
    emptyState,
  );
  assertEquals(ops.length, 2);
  const br = ops.find((o) => o.key === "@pane_worktree_branch");
  assertEquals(br?.kind === "set" ? br.value : "", "feat/foo");
});

Deno.test("eventToOps: WorktreeRemove unsets both worktree keys", () => {
  const ops = eventToOps("WorktreeRemove", {}, emptyState);
  assertEquals(ops.length, 2);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
});

Deno.test("eventToOps: unknown event → no-op", () => {
  assertEquals(eventToOps("NotARealEvent", {}, emptyState), []);
  assertEquals(eventToOps("", {}, emptyState), []);
});

// --- selfHealOps ---

Deno.test("selfHealOps: with session_id returns agent + session_id (+ cwd)", () => {
  const ops = selfHealOps({ session_id: "sess-1", cwd: "/tmp/x" });
  assertEquals(ops.length, 3);
  assertEquals(ops[0], { kind: "set", key: "@pane_agent", value: "claude" });
  assertEquals(ops[1], { kind: "set", key: "@pane_session_id", value: "sess-1" });
  assertEquals(ops[2], { kind: "set", key: "@pane_cwd", value: "/tmp/x" });
});

Deno.test("selfHealOps: with session_id only (no cwd) returns agent + session_id", () => {
  const ops = selfHealOps({ session_id: "sess-2" });
  assertEquals(ops.length, 2);
  assertEquals(ops[0], { kind: "set", key: "@pane_agent", value: "claude" });
  assertEquals(ops[1], { kind: "set", key: "@pane_session_id", value: "sess-2" });
});

Deno.test("selfHealOps: without session_id returns empty", () => {
  assertEquals(selfHealOps({}), []);
  assertEquals(selfHealOps({ cwd: "/tmp" }), []);
});

// --- eventToOps self-heal behavior ---

Deno.test("eventToOps: UserPromptSubmit with session_id prefixes self-heal ops", () => {
  const ops = eventToOps(
    "UserPromptSubmit",
    { session_id: "sess-3", cwd: "/work", prompt: "hi" },
    emptyState,
  );
  // self-heal 3 ops (agent + session_id + cwd) come first
  assertEquals(ops[0], { kind: "set", key: "@pane_agent", value: "claude" });
  assertEquals(ops[1], { kind: "set", key: "@pane_session_id", value: "sess-3" });
  assertEquals(ops[2], { kind: "set", key: "@pane_cwd", value: "/work" });
  // body ops follow (status=running is in the body)
  const statusOp = ops.find((o) => o.kind === "set" && o.key === "@pane_status");
  assertEquals(statusOp?.kind === "set" ? statusOp.value : "", "running");
});

Deno.test("eventToOps: CwdChanged without session_id does NOT set @pane_agent (phantom prevention)", () => {
  const ops = eventToOps("CwdChanged", { cwd: "/new" }, emptyState);
  // body sets @pane_cwd; self-heal is skipped because session_id is absent
  assertEquals(
    ops.some((o) => o.kind === "set" && o.key === "@pane_agent"),
    false,
  );
  assertEquals(
    ops.some((o) => o.kind === "set" && o.key === "@pane_session_id"),
    false,
  );
  // body still emits @pane_cwd set
  const cwdOp = ops.find((o) => o.kind === "set" && o.key === "@pane_cwd");
  assertEquals(cwdOp?.kind === "set" ? cwdOp.value : "", "/new");
});

Deno.test("eventToOps: SessionEnd drain (count 0) does NOT include self-heal", () => {
  const ops = eventToOps("SessionEnd", { session_id: "sess-4" }, emptyState);
  // drain: all unsets, no set ops at all (self-heal skipped)
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
});

Deno.test("eventToOps: SubagentStop drain (next=0 + pendingTeardown) does NOT include self-heal", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "sess-5" },
    { subagentsCount: 1, pendingTeardown: true },
  );
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
});

Deno.test("eventToOps: Stop with live subagents (defer) stays empty — self-heal skipped", () => {
  const ops = eventToOps(
    "Stop",
    { session_id: "sess-6" },
    { subagentsCount: 2, pendingTeardown: false },
  );
  // body is [] for defer → eventToOps short-circuits without self-heal
  assertEquals(ops, []);
});
