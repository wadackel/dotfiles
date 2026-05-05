import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALL_PANE_OPTIONS,
  appendSubagent,
  buildLogRecord,
  count,
  eventToOps,
  extractToolError,
  extractToolSubject,
  formatElapsed,
  maskPrompt,
  type Op,
  type PaneState,
  removeSubagent,
  type RunContext,
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

// --- subagent list helpers ---

Deno.test("appendSubagent: to empty list", () => {
  assertEquals(appendSubagent("", "Explore", "a1"), "Explore:a1");
});

Deno.test("appendSubagent: to non-empty list", () => {
  assertEquals(
    appendSubagent("Explore:a1", "Plan", "b2"),
    "Explore:a1|Plan:b2",
  );
});

Deno.test("appendSubagent: sanitizes '|' and ':' in type / id", () => {
  // '|' and ':' are reserved list delimiters → replaced with '-'
  assertEquals(appendSubagent("", "Ex|plore", "a:1"), "Ex-plore:a-1");
});

Deno.test("removeSubagent: removes first matching id", () => {
  assertEquals(
    removeSubagent("Explore:a1|Plan:b2", "a1"),
    "Plan:b2",
  );
});

Deno.test("removeSubagent: removes middle entry preserving order", () => {
  assertEquals(
    removeSubagent("A:1|B:2|C:3", "2"),
    "A:1|C:3",
  );
});

Deno.test("removeSubagent: last entry → empty string", () => {
  assertEquals(removeSubagent("Explore:a1", "a1"), "");
});

Deno.test("removeSubagent: id not found → list unchanged", () => {
  assertEquals(
    removeSubagent("Explore:a1|Plan:b2", "nope"),
    "Explore:a1|Plan:b2",
  );
});

Deno.test("removeSubagent: empty list → empty string", () => {
  assertEquals(removeSubagent("", "anything"), "");
});

Deno.test("count: empty → 0", () => {
  assertEquals(count(""), 0);
});

Deno.test("count: single entry → 1", () => {
  assertEquals(count("Explore:a1"), 1);
});

Deno.test("count: multiple entries → N", () => {
  assertEquals(count("A:1|B:2|C:3"), 3);
});

// --- eventToOps ---

const emptyState: PaneState = {
  subagents: "",
  pendingTeardown: false,
  currentTool: "",
  status: "",
  mainStopped: false,
};

function stateWithSubagents(list: string): PaneState {
  return {
    subagents: list,
    pendingTeardown: false,
    currentTool: "",
    status: "",
    mainStopped: false,
  };
}

function stateWith(overrides: Partial<PaneState>): PaneState {
  return { ...emptyState, ...overrides };
}

Deno.test("eventToOps: SessionStart sets agent / status / session_id / cwd + unsets stale", () => {
  const ops = eventToOps(
    "SessionStart",
    { session_id: "sess-1", cwd: "/tmp/x" },
    emptyState,
  );
  const unsets = ops.filter((o) => o.kind === "unset").map((o) => o.key);
  const sets = ops.filter((o) => o.kind === "set");
  assertStringIncludes(unsets.join(","), "@pane_prompt");
  assertStringIncludes(unsets.join(","), "@pane_current_tool");
  assertStringIncludes(unsets.join(","), "@pane_subagents");
  assertEquals(
    sets.find((s) => s.kind === "set" && s.key === "@pane_agent")?.value,
    "claude",
  );
  assertEquals(
    sets.find((s) => s.kind === "set" && s.key === "@pane_status")?.value,
    "idle",
  );
  assertEquals(
    sets.find((s) => s.kind === "set" && s.key === "@pane_cwd")?.value,
    "/tmp/x",
  );
});

Deno.test("eventToOps: SessionStart clears @pane_started_at (prevent elapsed bleed)", () => {
  const ops = eventToOps(
    "SessionStart",
    { session_id: "sess-new" },
    emptyState,
  );
  const startedAtOp = ops.find((o) => o.key === "@pane_started_at");
  assertEquals(startedAtOp?.kind, "unset");
});

Deno.test("eventToOps: SessionEnd with no subagents → unset all @pane_*", () => {
  const ops = eventToOps("SessionEnd", {}, emptyState);
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
  // drain completeness: new pane options must be unset too
  const keys = ops.map((o) => o.key);
  assertEquals(keys.includes("@pane_current_tool"), true);
  assertEquals(keys.includes("@pane_subagents"), true);
});

Deno.test("eventToOps: SessionEnd with live subagents → pending teardown", () => {
  const ops = eventToOps("SessionEnd", {}, stateWithSubagents("A:1|B:2"));
  // No session_id → self-heal is empty, body has 1 op
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
  const statusOp = ops.find((o) =>
    o.kind === "set" && o.key === "@pane_status"
  );
  assertEquals(statusOp?.kind === "set" ? statusOp.value : "", "running");
  const promptOp = ops.find((o) =>
    o.kind === "set" && o.key === "@pane_prompt"
  );
  const maskedValue = promptOp?.kind === "set" ? promptOp.value : "";
  assertEquals(maskedValue.length, 41); // 40 chars + ellipsis
});

Deno.test("eventToOps: UserPromptSubmit with empty prompt → unset @pane_prompt", () => {
  const ops = eventToOps("UserPromptSubmit", {}, emptyState);
  const promptOp = ops.find((o) => o.key === "@pane_prompt");
  assertEquals(promptOp?.kind, "unset");
});

Deno.test("eventToOps: Stop with no subagents → idle + defensive unset @pane_main_stopped", () => {
  const ops = eventToOps("Stop", {}, emptyState);
  assertEquals(ops, [
    { kind: "set", key: "@pane_status", value: "idle" },
    { kind: "unset", key: "@pane_main_stopped" },
  ]);
});

Deno.test("eventToOps: Stop with live subagents → sets @pane_main_stopped (no status change)", () => {
  // main stopped but subagents still running. Status must stay `running`;
  // @pane_main_stopped=1 is set so that when the last subagent stops we can
  // transition to idle. No session_id → selfHeal adds nothing.
  const ops = eventToOps("Stop", {}, stateWithSubagents("Explore:x1"));
  assertEquals(ops, [{ kind: "set", key: "@pane_main_stopped", value: "1" }]);
});

Deno.test("eventToOps: Stop with no subagents also unsets @pane_main_stopped defensively", () => {
  const ops = eventToOps("Stop", {}, emptyState);
  const statusOp = ops.find((o) => o.key === "@pane_status");
  assertEquals(statusOp?.kind === "set" ? statusOp.value : "", "idle");
  const flagOp = ops.find((o) => o.key === "@pane_main_stopped");
  assertEquals(flagOp?.kind, "unset");
});

Deno.test("eventToOps: StopFailure with error_type → error + wait_reason=<error_type>", () => {
  const ops = eventToOps(
    "StopFailure",
    { error_type: "rate_limit" },
    emptyState,
  );
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "error");
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind === "set" ? reason.value : "", "rate_limit");
});

Deno.test("eventToOps: StopFailure without error_type → error + wait_reason='error'", () => {
  const ops = eventToOps("StopFailure", {}, emptyState);
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "error");
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind === "set" ? reason.value : "", "error");
});

Deno.test("eventToOps: StopFailure ignores legacy data.message field", () => {
  // Pre-existing code read `data.message` but schema does not provide it.
  // The new code must not regress to picking it up.
  const ops = eventToOps(
    "StopFailure",
    { message: "boom", error_type: "server_error" },
    emptyState,
  );
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind === "set" ? reason.value : "", "server_error");
});

Deno.test("eventToOps: Notification(permission_prompt) → waiting + 'permission'", () => {
  const ops = eventToOps(
    "Notification",
    { notification_type: "permission_prompt" },
    emptyState,
  );
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "waiting");
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind === "set" ? reason.value : "", "permission");
});

Deno.test("eventToOps: Notification(idle_prompt) → waiting + 'idle prompt'", () => {
  const ops = eventToOps(
    "Notification",
    { notification_type: "idle_prompt" },
    emptyState,
  );
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "waiting");
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind === "set" ? reason.value : "", "idle prompt");
});

Deno.test("eventToOps: Notification(elicitation_dialog) → waiting + 'elicitation'", () => {
  const ops = eventToOps(
    "Notification",
    { notification_type: "elicitation_dialog" },
    emptyState,
  );
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "waiting");
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind === "set" ? reason.value : "", "elicitation");
});

Deno.test("eventToOps: Notification(elicitation_complete) → unset wait_reason only (status preserved)", () => {
  const ops = eventToOps(
    "Notification",
    { notification_type: "elicitation_complete" },
    emptyState,
  );
  // No status op — the running/idle decision belongs to the next event.
  assertEquals(ops.some((o) => o.key === "@pane_status"), false);
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind, "unset");
});

Deno.test("eventToOps: Notification(elicitation_response) → unset wait_reason only", () => {
  const ops = eventToOps(
    "Notification",
    { notification_type: "elicitation_response" },
    emptyState,
  );
  assertEquals(ops.some((o) => o.key === "@pane_status"), false);
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind, "unset");
});

Deno.test("eventToOps: Notification(auth_success) → no-op (status not flipped to waiting)", () => {
  // Latent bug fixed: the prior implementation read `data.message` (absent
  // per schema), defaulted wait_reason to "notification", and unconditionally
  // flipped status to "waiting" — including for auth_success.
  const ops = eventToOps(
    "Notification",
    { notification_type: "auth_success", session_id: "s1" },
    emptyState,
  );
  assertEquals(ops, []);
});

Deno.test("eventToOps: Notification with unknown notification_type → no-op", () => {
  const ops = eventToOps(
    "Notification",
    { notification_type: "future_event_kind" },
    emptyState,
  );
  assertEquals(ops, []);
});

Deno.test("eventToOps: Notification ignores legacy data.message field", () => {
  // Pre-existing code read `data.message` but schema does not provide it.
  // Without notification_type the handler must produce no ops, regardless of
  // a stray legacy `message` field.
  const ops = eventToOps(
    "Notification",
    { message: "please approve" },
    emptyState,
  );
  assertEquals(ops, []);
});

Deno.test("eventToOps: Notification @pane_attention never appears in any branch", () => {
  for (
    const nt of [
      "permission_prompt",
      "idle_prompt",
      "elicitation_dialog",
      "elicitation_complete",
      "elicitation_response",
      "auth_success",
      "future_event_kind",
    ]
  ) {
    const ops = eventToOps(
      "Notification",
      { notification_type: nt },
      emptyState,
    );
    assertEquals(
      ops.some((o) => o.key === "@pane_attention"),
      false,
      `@pane_attention must not appear for notification_type=${nt}`,
    );
  }
});

Deno.test("eventToOps: PermissionDenied → waiting + permission-denied", () => {
  const ops = eventToOps("PermissionDenied", {}, emptyState);
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind === "set" ? reason.value : "", "permission-denied");
});

// --- PostToolUseFailure ---
// Schema: tool_name, tool_input, error (string), tool_use_id, agent_id?,
// agent_type?. Fires for tool failures. Replaces the older inference path
// in PostToolUse where a string-shape `tool_response` (`"Error: ..."`) was
// parsed to detect failure.

Deno.test("eventToOps: PostToolUseFailure (Bash) sets last_tool_error from data.error", () => {
  const ops = eventToOps(
    "PostToolUseFailure",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "false" },
      error: "command failed: exit 1",
      tool_use_id: "tu1",
    },
    stateWith({ currentTool: "Bash", status: "running" }),
  );
  const lastTool = ops.find((o) => o.key === "@pane_last_tool");
  assertEquals(lastTool?.kind === "set" ? lastTool.value : "", "Bash");
  const lastErr = ops.find((o) => o.key === "@pane_last_tool_error");
  assertEquals(
    lastErr?.kind === "set" ? lastErr.value : "",
    "command failed: exit 1",
  );
  // current_tool cleared because tool name matches
  const cur = ops.find((o) => o.key === "@pane_current_tool");
  assertEquals(cur?.kind, "unset");
  // last_activity_at refreshed
  const act = ops.find((o) => o.key === "@pane_last_activity_at");
  assertEquals(act?.kind, "set");
});

Deno.test("eventToOps: PostToolUseFailure with empty error → unsets last_tool_error", () => {
  const ops = eventToOps(
    "PostToolUseFailure",
    {
      session_id: "s1",
      tool_name: "Read",
      tool_input: { file_path: "/x" },
      error: "",
    },
    stateWith({ status: "running" }),
  );
  const lastErr = ops.find((o) => o.key === "@pane_last_tool_error");
  assertEquals(lastErr?.kind, "unset");
  const lastTool = ops.find((o) => o.key === "@pane_last_tool");
  assertEquals(lastTool?.kind === "set" ? lastTool.value : "", "Read");
});

Deno.test("eventToOps: PostToolUseFailure error is truncated", () => {
  const longError = "x".repeat(200);
  const ops = eventToOps(
    "PostToolUseFailure",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: {},
      error: longError,
    },
    stateWith({ status: "running" }),
  );
  const lastErr = ops.find((o) => o.key === "@pane_last_tool_error");
  const value = lastErr?.kind === "set" ? lastErr.value : "";
  // Truncated to TOOL_ERROR_MAX_CHARS=40 + ellipsis
  assertEquals(value.length <= 41, true);
  assertEquals(value.endsWith("…"), true);
});

Deno.test("eventToOps: PostToolUseFailure (subagent-origin, agent_id set) → no resume", () => {
  const ops = eventToOps(
    "PostToolUseFailure",
    {
      session_id: "s1",
      agent_id: "a1",
      agent_type: "Explore",
      tool_name: "Bash",
      tool_input: {},
      error: "boom",
    },
    stateWith({
      status: "waiting",
      subagents: "Explore:a1",
      currentTool: "Bash",
    }),
  );
  // Resume must NOT fire (subagent attribution)
  assertEquals(hasResumeOps(ops), false);
  // last_tool / last_tool_error still update (display is intentionally
  // last-wins across main and subagent — same as PostToolUse).
  const lastTool = ops.find((o) => o.key === "@pane_last_tool");
  assertEquals(lastTool?.kind === "set" ? lastTool.value : "", "Bash");
  const lastErr = ops.find((o) => o.key === "@pane_last_tool_error");
  assertEquals(lastErr?.kind === "set" ? lastErr.value : "", "boom");
});

Deno.test("eventToOps: PostToolUseFailure (main-origin) + status=waiting → resume", () => {
  const ops = eventToOps(
    "PostToolUseFailure",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: {},
      error: "boom",
    },
    stateWith({ status: "waiting", currentTool: "Bash" }),
  );
  assertEquals(hasResumeOps(ops), true);
});

Deno.test("eventToOps: PostToolUseFailure without tool_name updates only activity_at", () => {
  const ops = eventToOps(
    "PostToolUseFailure",
    { session_id: "s1", error: "stray" },
    stateWith({ status: "running" }),
  );
  const lastTool = ops.find((o) => o.key === "@pane_last_tool");
  assertEquals(lastTool, undefined);
  const lastErr = ops.find((o) => o.key === "@pane_last_tool_error");
  assertEquals(lastErr, undefined);
  const act = ops.find((o) => o.key === "@pane_last_activity_at");
  assertEquals(act?.kind, "set");
});

Deno.test("eventToOps: PostToolUseFailure on non-matching tool keeps current_tool", () => {
  // Concurrent tools: failure on tool A while tool B is in flight as current.
  const ops = eventToOps(
    "PostToolUseFailure",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: {},
      error: "fail",
    },
    stateWith({ currentTool: "Read", status: "running" }),
  );
  // current_tool NOT cleared (mismatch)
  assertEquals(ops.some((o) => o.key === "@pane_current_tool"), false);
  const lastTool = ops.find((o) => o.key === "@pane_last_tool");
  assertEquals(lastTool?.kind === "set" ? lastTool.value : "", "Bash");
});

Deno.test("eventToOps: CwdChanged with cwd → set @pane_cwd", () => {
  const ops = eventToOps("CwdChanged", { cwd: "/new" }, emptyState);
  assertEquals(ops, [{ kind: "set", key: "@pane_cwd", value: "/new" }]);
});

Deno.test("eventToOps: CwdChanged without cwd → no-op", () => {
  const ops = eventToOps("CwdChanged", {}, emptyState);
  assertEquals(ops, []);
});

// --- PreToolUse / PostToolUse ---

Deno.test("eventToOps: PreToolUse with tool_name → set @pane_current_tool", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Bash" },
    emptyState,
  );
  const toolOp = ops.find((o) => o.key === "@pane_current_tool");
  assertEquals(toolOp?.kind === "set" ? toolOp.value : "", "Bash");
});

Deno.test("eventToOps: PreToolUse without tool_name → no-op", () => {
  const ops = eventToOps("PreToolUse", { session_id: "s1" }, emptyState);
  assertEquals(ops, []);
});

Deno.test("eventToOps: PostToolUse → unset @pane_current_tool (last-wins)", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    { subagents: "", pendingTeardown: false, currentTool: "Bash", status: "", mainStopped: false },
  );
  const toolOp = ops.find((o) => o.key === "@pane_current_tool");
  assertEquals(toolOp?.kind, "unset");
});

Deno.test("eventToOps: PostToolUse (concurrent tools) keeps current_tool when payload tool_name differs", () => {
  // Pre(A)→current=A, Pre(B)→current=B, Post(A): tool_name='A' != state.currentTool='B'.
  // current_tool must stay 'B' because B is still running.
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "ToolA" },
    { subagents: "", pendingTeardown: false, currentTool: "ToolB", status: "", mainStopped: false },
  );
  const currentOp = ops.find((o) => o.key === "@pane_current_tool");
  assertEquals(currentOp, undefined, "current_tool must not be touched when a parallel tool is still running");
  const lastOp = ops.find((o) => o.key === "@pane_last_tool");
  assertEquals(lastOp?.kind === "set" ? lastOp.value : "", "ToolA");
});

Deno.test("eventToOps: PostToolUse (Bash) clears stale @pane_last_edit_file", () => {
  // Non-edit tool completion must clear any stale basename so row 2 never
  // shows `last: Bash · old-file.ts` after a prior Edit.
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    { subagents: "", pendingTeardown: false, currentTool: "Bash", status: "", mainStopped: false },
  );
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind, "unset");
});

Deno.test("eventToOps: PostToolUse (Edit, missing file_path) clears stale @pane_last_edit_file", () => {
  // Edit-family tool without a usable file_path must also clear the stale
  // basename rather than leaving a previous Edit's value on display.
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Edit" },
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "", mainStopped: false },
  );
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind, "unset");
});

Deno.test("eventToOps: PreToolUse → PostToolUse round trip on current_tool", () => {
  const preOps = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Edit" },
    emptyState,
  );
  const preToolOp = preOps.find((o) => o.key === "@pane_current_tool");
  assertEquals(preToolOp?.kind === "set" ? preToolOp.value : "", "Edit");

  const postOps = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Edit" },
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "", mainStopped: false },
  );
  const postToolOp = postOps.find((o) => o.key === "@pane_current_tool");
  assertEquals(postToolOp?.kind, "unset");
});

Deno.test("eventToOps: PostToolUse (Edit) moves current_tool → last_tool + stores raw file_path + activity_at", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Edit",
      tool_input: { file_path: "/x/y.ts" },
    },
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "", mainStopped: false },
  );
  const currentUnset = ops.find((o) => o.key === "@pane_current_tool");
  assertEquals(currentUnset?.kind, "unset");
  const lastTool = ops.find((o) => o.key === "@pane_last_tool");
  assertEquals(lastTool?.kind === "set" ? lastTool.value : "", "Edit");
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind === "set" ? lastFile.value : "", "/x/y.ts");
  const activity = ops.find((o) => o.key === "@pane_last_activity_at");
  assertEquals(activity?.kind, "set");
  assertEquals(/^\d+$/.test(activity?.kind === "set" ? activity.value : ""), true);
});

Deno.test("eventToOps: PostToolUse (Write) stores file_path", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Write",
      tool_input: { file_path: "/a/b/new.md" },
    },
    { subagents: "", pendingTeardown: false, currentTool: "Write", status: "", mainStopped: false },
  );
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind === "set" ? lastFile.value : "", "/a/b/new.md");
});

Deno.test("eventToOps: PostToolUse (MultiEdit) stores file_path", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "MultiEdit",
      tool_input: { file_path: "/a/b/multi.ts" },
    },
    { subagents: "", pendingTeardown: false, currentTool: "MultiEdit", status: "", mainStopped: false },
  );
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind === "set" ? lastFile.value : "", "/a/b/multi.ts");
});

Deno.test("eventToOps: PostToolUse (Bash) sets last_tool and clears last_edit_file", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    { subagents: "", pendingTeardown: false, currentTool: "Bash", status: "", mainStopped: false },
  );
  const lastTool = ops.find((o) => o.key === "@pane_last_tool");
  assertEquals(lastTool?.kind === "set" ? lastTool.value : "", "Bash");
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind, "unset");
});

Deno.test("eventToOps: PostToolUse with empty tool_name is attribution-safe (no last_*)", () => {
  // Degraded payload: only activity_at is updated — last_tool / last_edit_file
  // / current_tool are left untouched because attributing the completion via
  // state.currentTool would mis-label when parallel tools are in flight.
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1" },
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "", mainStopped: false },
  );
  assertEquals(
    ops.filter((o) => o.key === "@pane_last_tool").length,
    0,
    "last_tool must not be set via ambiguous fallback",
  );
  assertEquals(
    ops.filter((o) => o.key === "@pane_last_edit_file").length,
    0,
  );
  assertEquals(
    ops.filter((o) => o.key === "@pane_current_tool").length,
    0,
  );
  const activity = ops.find((o) => o.key === "@pane_last_activity_at");
  assertEquals(activity?.kind, "set");
});

Deno.test("eventToOps: PostToolUse (Edit) strips TAB/CR/LF from file_path", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Edit",
      tool_input: { file_path: "/x/y\n.ts\twith\rctrl" },
    },
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "", mainStopped: false },
  );
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(
    lastFile?.kind === "set" ? lastFile.value : "",
    "/x/y .ts with ctrl",
  );
});

Deno.test("eventToOps: PostToolUse (Edit) with non-string file_path clears last_edit_file", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Edit",
      tool_input: { file_path: 42 },
    },
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "", mainStopped: false },
  );
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind, "unset");
});

Deno.test("eventToOps: UserPromptSubmit sets @pane_last_activity_at", () => {
  const ops = eventToOps(
    "UserPromptSubmit",
    { session_id: "s1", prompt: "hello" },
    emptyState,
  );
  const activity = ops.find((o) => o.key === "@pane_last_activity_at");
  assertEquals(activity?.kind, "set");
  assertEquals(/^\d+$/.test(activity?.kind === "set" ? activity.value : ""), true);
});

Deno.test("eventToOps: SessionStart sets @pane_last_activity_at (fresh-session idle seed)", () => {
  const ops = eventToOps(
    "SessionStart",
    { session_id: "s-new" },
    emptyState,
  );
  const activity = ops.find((o) =>
    o.kind === "set" && o.key === "@pane_last_activity_at"
  );
  assertEquals(activity?.kind, "set");
  assertEquals(/^\d+$/.test(activity?.kind === "set" ? activity.value : ""), true);
});

Deno.test("eventToOps: SessionStart clears new last_* options (stale-session cleanup)", () => {
  const ops = eventToOps(
    "SessionStart",
    { session_id: "s-new" },
    emptyState,
  );
  const unsetKeys = ops.filter((o) => o.kind === "unset").map((o) => o.key);
  assertEquals(unsetKeys.includes("@pane_last_tool"), true);
  assertEquals(unsetKeys.includes("@pane_last_edit_file"), true);
  // last_activity_at is set (seeded) at SessionStart, not unset — it is
  // semantically established by the stale clear passing through then the
  // seed `set` below. Order in the returned array: unsets first, then sets.
});

Deno.test("eventToOps: SessionEnd drain includes new last_* options", () => {
  const ops = eventToOps("SessionEnd", {}, emptyState);
  const keys = ops.map((o) => o.key);
  assertEquals(keys.includes("@pane_last_tool"), true);
  assertEquals(keys.includes("@pane_last_edit_file"), true);
  assertEquals(keys.includes("@pane_last_activity_at"), true);
});

// --- SubagentStart / SubagentStop (list encoding) ---

Deno.test("eventToOps: SubagentStart appends Type:id to list", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Explore", agent_id: "a1" },
    emptyState,
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Explore:a1");
});

Deno.test("eventToOps: SubagentStart fallback type = 'subagent' when missing", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_id: "x" },
    emptyState,
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "subagent:x");
});

Deno.test("eventToOps: SubagentStart appends to existing list", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Plan", agent_id: "b2" },
    stateWithSubagents("Explore:a1"),
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(
    listOp?.kind === "set" ? listOp.value : "",
    "Explore:a1|Plan:b2",
  );
});

Deno.test("eventToOps: SubagentStart sanitizes '|' in agent_type", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Bad|Type", agent_id: "x" },
    emptyState,
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Bad-Type:x");
});

Deno.test("eventToOps: SubagentStop removes matching id from list", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWithSubagents("Explore:a1|Plan:b2"),
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Plan:b2");
});

Deno.test("eventToOps: SubagentStop last remaining → unset @pane_subagents", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWithSubagents("Explore:a1"),
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind, "unset");
});

Deno.test("eventToOps: SubagentStop drains pending teardown when list becomes empty", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    { subagents: "Explore:a1", pendingTeardown: true, currentTool: "", status: "", mainStopped: false },
  );
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
});

Deno.test("eventToOps: WorktreeCreate with branch + path", () => {
  const ops = eventToOps(
    "WorktreeCreate",
    { branch: "feat/foo", path: "/tmp/wt", session_id: "s1" },
    emptyState,
  );
  const br = ops.find((o) => o.key === "@pane_worktree_branch");
  assertEquals(br?.kind === "set" ? br.value : "", "feat/foo");
  const pa = ops.find((o) => o.key === "@pane_worktree_path");
  assertEquals(pa?.kind === "set" ? pa.value : "", "/tmp/wt");
});

Deno.test("eventToOps: WorktreeRemove unsets both worktree keys", () => {
  const ops = eventToOps("WorktreeRemove", { session_id: "s1" }, emptyState);
  const br = ops.find((o) => o.key === "@pane_worktree_branch");
  assertEquals(br?.kind, "unset");
  const pa = ops.find((o) => o.key === "@pane_worktree_path");
  assertEquals(pa?.kind, "unset");
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
  assertEquals(ops[1], {
    kind: "set",
    key: "@pane_session_id",
    value: "sess-1",
  });
  assertEquals(ops[2], { kind: "set", key: "@pane_cwd", value: "/tmp/x" });
});

Deno.test("selfHealOps: with session_id only (no cwd) returns agent + session_id", () => {
  const ops = selfHealOps({ session_id: "sess-2" });
  assertEquals(ops.length, 2);
  assertEquals(ops[0], { kind: "set", key: "@pane_agent", value: "claude" });
  assertEquals(ops[1], {
    kind: "set",
    key: "@pane_session_id",
    value: "sess-2",
  });
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
  assertEquals(ops[1], {
    kind: "set",
    key: "@pane_session_id",
    value: "sess-3",
  });
  assertEquals(ops[2], { kind: "set", key: "@pane_cwd", value: "/work" });
  const statusOp = ops.find((o) =>
    o.kind === "set" && o.key === "@pane_status"
  );
  assertEquals(statusOp?.kind === "set" ? statusOp.value : "", "running");
});

Deno.test("eventToOps: CwdChanged without session_id does NOT set @pane_agent (phantom prevention)", () => {
  const ops = eventToOps("CwdChanged", { cwd: "/new" }, emptyState);
  assertEquals(
    ops.some((o) => o.kind === "set" && o.key === "@pane_agent"),
    false,
  );
  assertEquals(
    ops.some((o) => o.kind === "set" && o.key === "@pane_session_id"),
    false,
  );
  const cwdOp = ops.find((o) => o.kind === "set" && o.key === "@pane_cwd");
  assertEquals(cwdOp?.kind === "set" ? cwdOp.value : "", "/new");
});

Deno.test("eventToOps: SessionEnd drain (no subagents) does NOT include self-heal", () => {
  const ops = eventToOps("SessionEnd", { session_id: "sess-4" }, emptyState);
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
});

Deno.test("eventToOps: SubagentStop drain does NOT include self-heal", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "sess-5", agent_id: "a1" },
    { subagents: "Explore:a1", pendingTeardown: true, currentTool: "", status: "", mainStopped: false },
  );
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
});

Deno.test("eventToOps: Stop with live subagents + session_id → self-heal + main_stopped=1", () => {
  // Body is non-empty (main_stopped set), so selfHealOps is prepended.
  const ops = eventToOps(
    "Stop",
    { session_id: "sess-6" },
    stateWithSubagents("A:1|B:2"),
  );
  const flagOp = ops.find((o) => o.key === "@pane_main_stopped");
  assertEquals(flagOp?.kind === "set" ? flagOp.value : "", "1");
  const agentOp = ops.find((o) => o.key === "@pane_agent");
  assertEquals(agentOp?.kind === "set" ? agentOp.value : "", "claude");
  const sessionOp = ops.find((o) => o.key === "@pane_session_id");
  assertEquals(sessionOp?.kind === "set" ? sessionOp.value : "", "sess-6");
  // Status must NOT be touched.
  assertEquals(ops.some((o) => o.key === "@pane_status"), false);
});

// --- resumeOpsIfStuck: waiting/error → running recovery on activity events ---
// Each event × each status exercises the helper from a different call site.

function hasResumeOps(ops: { kind: string; key: string; value?: string }[]): boolean {
  const setRunning = ops.some(
    (o) => o.kind === "set" && o.key === "@pane_status" &&
      (o as { value: string }).value === "running",
  );
  const unsetReason = ops.some(
    (o) => o.kind === "unset" && o.key === "@pane_wait_reason",
  );
  return setRunning && unsetReason;
}

Deno.test("resume: PreToolUse with status=waiting → flips to running + clears wait_reason", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "waiting" }),
  );
  assertEquals(hasResumeOps(ops), true);
  const toolOp = ops.find((o) => o.key === "@pane_current_tool");
  assertEquals(toolOp?.kind === "set" ? toolOp.value : "", "Bash");
});

Deno.test("resume: PreToolUse with status=error → flips to running", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "error" }),
  );
  assertEquals(hasResumeOps(ops), true);
});

Deno.test("resume: PreToolUse with status=running → no resume ops (no-op)", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "running" }),
  );
  assertEquals(hasResumeOps(ops), false);
  // still sets current_tool
  const toolOp = ops.find((o) => o.key === "@pane_current_tool");
  assertEquals(toolOp?.kind === "set" ? toolOp.value : "", "Bash");
});

Deno.test("resume: PreToolUse with status=idle → no resume ops", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "idle" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

Deno.test("resume: PostToolUse with status=waiting → flips to running", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "waiting", currentTool: "Bash" }),
  );
  assertEquals(hasResumeOps(ops), true);
});

Deno.test("resume: PostToolUse with status=error → flips to running", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "error", currentTool: "Bash" }),
  );
  assertEquals(hasResumeOps(ops), true);
});

Deno.test("resume: PostToolUse with status=running → no resume ops", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "running", currentTool: "Bash" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

Deno.test("resume: PostToolUse with status=idle → no resume ops", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "idle", currentTool: "Bash" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

// Resume gating is now payload-attribution-based, not state-based:
//   data.agent_id absent (main-origin)  → resume IF status is waiting/error
//   data.agent_id present (subagent-origin) → never resume (subagent activity
//     is not main-attributable, so resume would falsely flip waiting→running)
// The previous gate (`state.subagents === ""`) over-blocked main resume
// whenever any subagent was alive — this is the bug the rewrite fixes.

Deno.test("resume: PreToolUse main-origin + status=waiting + active subagent → resume", () => {
  // Main-origin event = no agent_id in payload. Even with a subagent alive,
  // the main agent's PreToolUse resumes status from waiting/error.
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "waiting", subagents: "Explore:a1" }),
  );
  assertEquals(hasResumeOps(ops), true);
  const toolOp = ops.find((o) => o.key === "@pane_current_tool");
  assertEquals(toolOp?.kind === "set" ? toolOp.value : "", "Bash");
});

Deno.test("resume: PreToolUse main-origin + status=error + active subagent → resume", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "error", subagents: "Explore:a1" }),
  );
  assertEquals(hasResumeOps(ops), true);
});

Deno.test("resume: PreToolUse subagent-origin (agent_id set) + status=waiting → NO resume", () => {
  // agent_id present = subagent invoked the tool. Resume must not fire.
  const ops = eventToOps(
    "PreToolUse",
    {
      session_id: "s1",
      agent_id: "a1",
      agent_type: "Explore",
      tool_name: "Bash",
    },
    stateWith({ status: "waiting", subagents: "Explore:a1" }),
  );
  assertEquals(hasResumeOps(ops), false);
  // current_tool is still recorded (tool display is intentionally last-wins
  // across main and subagent — see Notes in claude-pane-status.ts).
  const toolOp = ops.find((o) => o.key === "@pane_current_tool");
  assertEquals(toolOp?.kind === "set" ? toolOp.value : "", "Bash");
});

Deno.test("resume: PreToolUse subagent-origin + status=error → NO resume", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", agent_id: "a1", tool_name: "Bash" },
    stateWith({ status: "error", subagents: "Explore:a1" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

Deno.test("resume: PostToolUse main-origin + status=waiting + active subagent → resume", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({
      status: "waiting",
      currentTool: "Bash",
      subagents: "Explore:a1",
    }),
  );
  assertEquals(hasResumeOps(ops), true);
});

Deno.test("resume: PostToolUse main-origin + status=error + active subagent → resume", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({
      status: "error",
      currentTool: "Bash",
      subagents: "Explore:a1",
    }),
  );
  assertEquals(hasResumeOps(ops), true);
});

Deno.test("resume: PostToolUse subagent-origin + status=waiting → NO resume", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      agent_id: "a1",
      agent_type: "Explore",
      tool_name: "Bash",
    },
    stateWith({
      status: "waiting",
      currentTool: "Bash",
      subagents: "Explore:a1",
    }),
  );
  assertEquals(hasResumeOps(ops), false);
});

Deno.test("resume: PostToolUse subagent-origin + status=error → NO resume", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", agent_id: "a1", tool_name: "Bash" },
    stateWith({
      status: "error",
      currentTool: "Bash",
      subagents: "Explore:a1",
    }),
  );
  assertEquals(hasResumeOps(ops), false);
});

Deno.test("resume: SubagentStart with status=waiting → NO resume (subagent activity is not main-attributable)", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Explore", agent_id: "a1" },
    stateWith({ status: "waiting" }),
  );
  assertEquals(hasResumeOps(ops), false);
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Explore:a1");
});

Deno.test("resume: SubagentStart with status=error → NO resume", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Explore", agent_id: "a1" },
    stateWith({ status: "error" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

Deno.test("resume: SubagentStart with status=running → no resume ops", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Explore", agent_id: "a1" },
    stateWith({ status: "running" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

Deno.test("resume: SubagentStart with status=idle → no resume ops", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Explore", agent_id: "a1" },
    stateWith({ status: "idle" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

Deno.test("resume: SubagentStop (non-drain) with status=waiting → NO resume (subagent activity is not main-attributable)", () => {
  // Non-drain: pendingTeardown=false, list still has another entry after removal
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWith({ subagents: "Explore:a1|Plan:b2", status: "waiting" }),
  );
  assertEquals(hasResumeOps(ops), false);
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Plan:b2");
});

Deno.test("resume: SubagentStop (non-drain) with status=error → NO resume", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWith({ subagents: "Explore:a1|Plan:b2", status: "error" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

Deno.test("resume: SubagentStop (non-drain) with status=running → no resume ops", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWith({ subagents: "Explore:a1|Plan:b2", status: "running" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

Deno.test("resume: SubagentStop (non-drain) with status=idle → no resume ops", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWith({ subagents: "Explore:a1|Plan:b2", status: "idle" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

// --- @pane_main_stopped: Stop-with-subagents → drain → idle transition ---

Deno.test("main_stopped: SubagentStop drains to empty with mainStopped=true → idle + unset flag", () => {
  // Scenario: main hit Stop while subagents were still running (main_stopped=1 set).
  // Now the last subagent stops. Status must transition from running to idle,
  // and @pane_main_stopped must be cleared so the next UserPromptSubmit starts clean.
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWith({
      subagents: "Explore:a1",
      status: "running",
      mainStopped: true,
    }),
  );
  const statusOp = ops.find((o) => o.key === "@pane_status");
  assertEquals(statusOp?.kind === "set" ? statusOp.value : "", "idle");
  const flagOp = ops.find((o) => o.key === "@pane_main_stopped");
  assertEquals(flagOp?.kind, "unset");
  const subagentsOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(subagentsOp?.kind, "unset");
});

Deno.test("main_stopped: SubagentStop drains to empty with mainStopped=false → no idle transition", () => {
  // No prior main Stop → status must stay as-is; only subagents is unset.
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWith({
      subagents: "Explore:a1",
      status: "running",
      mainStopped: false,
    }),
  );
  const statusOp = ops.find((o) => o.key === "@pane_status");
  assertEquals(statusOp, undefined, "status must not change without mainStopped");
  const flagOp = ops.find((o) => o.key === "@pane_main_stopped");
  assertEquals(flagOp, undefined);
});

Deno.test("main_stopped: SubagentStop non-drain (next still non-empty) with mainStopped=true → no idle transition yet", () => {
  // One subagent stopped but another is still running. Don't transition.
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWith({
      subagents: "Explore:a1|Plan:b2",
      status: "running",
      mainStopped: true,
    }),
  );
  const statusOp = ops.find((o) => o.key === "@pane_status");
  assertEquals(statusOp, undefined);
  const flagOp = ops.find((o) => o.key === "@pane_main_stopped");
  assertEquals(flagOp, undefined);
});

Deno.test("main_stopped: UserPromptSubmit unsets @pane_main_stopped (fresh main invocation)", () => {
  const ops = eventToOps(
    "UserPromptSubmit",
    { session_id: "s1", prompt: "hi" },
    stateWith({ status: "idle", mainStopped: true }),
  );
  const flagOp = ops.find((o) => o.key === "@pane_main_stopped");
  assertEquals(flagOp?.kind, "unset");
});

Deno.test("main_stopped: SessionStart clears @pane_main_stopped (STALE_AT_SESSION_START)", () => {
  const ops = eventToOps(
    "SessionStart",
    { session_id: "sess-1" },
    stateWith({ mainStopped: true }),
  );
  const flagOp = ops.find((o) => o.key === "@pane_main_stopped");
  assertEquals(flagOp?.kind, "unset");
});

Deno.test("main_stopped: ALL_PANE_OPTIONS includes @pane_main_stopped (drain completeness)", () => {
  assertEquals(ALL_PANE_OPTIONS.includes("@pane_main_stopped" as never), true);
});

Deno.test("context_used_pct: ALL_PANE_OPTIONS includes @pane_context_used_pct (drain completeness)", () => {
  assertEquals(ALL_PANE_OPTIONS.includes("@pane_context_used_pct" as never), true);
});

Deno.test("main_stopped: SubagentStop drain path (pendingTeardown=true + last subagent) still ALL_PANE_OPTIONS unset only", () => {
  // Even with mainStopped=true, drain path must short-circuit before the
  // SubagentStop body and emit only the ALL_PANE_OPTIONS unset bulk — not
  // the idle-transition ops — so teardown wins.
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    {
      subagents: "Explore:a1",
      pendingTeardown: true,
      currentTool: "",
      status: "running",
      mainStopped: true,
    },
  );
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
});

Deno.test("resume: SubagentStop drain with status=waiting still returns ALL_PANE_OPTIONS unset only (no resume leakage)", () => {
  // drain path (pendingTeardown=true + last subagent) short-circuits before
  // the switch body, so resume op must NOT be prepended.
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    {
      subagents: "Explore:a1",
      pendingTeardown: true,
      currentTool: "",
      status: "waiting",
      mainStopped: false,
    },
  );
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
  // resume op (which includes `set @pane_status running`) must be absent
  const anySet = ops.some((o) => o.kind === "set");
  assertEquals(anySet, false);
});

// --- extractToolSubject ---

Deno.test("extractToolSubject: non-object tool_input → empty", () => {
  assertEquals(extractToolSubject("Bash", null), "");
  assertEquals(extractToolSubject("Bash", undefined), "");
  assertEquals(extractToolSubject("Bash", "string"), "");
  assertEquals(extractToolSubject("Bash", []), "");
});

Deno.test("extractToolSubject: Bash takes command", () => {
  assertEquals(
    extractToolSubject("Bash", { command: "pnpm test" }),
    "pnpm test",
  );
});

Deno.test("extractToolSubject: Bash truncates at 24 chars with ellipsis", () => {
  const out = extractToolSubject("Bash", {
    command: "x".repeat(30),
  });
  assertEquals(out.length, 25); // 24 x + single '…'
  assertStringIncludes(out, "…");
});

Deno.test("extractToolSubject: Bash collapses TAB/CR/LF to space", () => {
  assertEquals(
    extractToolSubject("Bash", { command: "echo\tfoo\nbar" }),
    "echo foo bar",
  );
});

Deno.test("extractToolSubject: Edit-family returns empty (delegates to @pane_last_edit_file)", () => {
  assertEquals(
    extractToolSubject("Edit", { file_path: "/x/y.ts" }),
    "",
  );
  assertEquals(
    extractToolSubject("Write", { file_path: "/x/y.ts" }),
    "",
  );
  assertEquals(
    extractToolSubject("MultiEdit", { file_path: "/x/y.ts" }),
    "",
  );
});

Deno.test("extractToolSubject: Read extracts basename from file_path", () => {
  assertEquals(
    extractToolSubject("Read", { file_path: "/a/b/c.md" }),
    "c.md",
  );
  assertEquals(extractToolSubject("Read", { file_path: "plain.txt" }), "plain.txt");
  assertEquals(extractToolSubject("Read", { file_path: "" }), "");
});

Deno.test("extractToolSubject: Grep takes pattern", () => {
  assertEquals(
    extractToolSubject("Grep", { pattern: "foo.*bar" }),
    "foo.*bar",
  );
});

Deno.test("extractToolSubject: Glob takes pattern", () => {
  assertEquals(
    extractToolSubject("Glob", { pattern: "**/*.ts" }),
    "**/*.ts",
  );
});

Deno.test("extractToolSubject: WebFetch extracts host from url", () => {
  assertEquals(
    extractToolSubject("WebFetch", { url: "https://example.com/path?q=1" }),
    "example.com",
  );
});

Deno.test("extractToolSubject: WebFetch invalid url → empty", () => {
  assertEquals(
    extractToolSubject("WebFetch", { url: "not a url" }),
    "",
  );
});

Deno.test("extractToolSubject: Task joins subagent_type / description with /", () => {
  assertEquals(
    extractToolSubject("Task", {
      subagent_type: "qa-planner",
      description: "test the foo",
    }),
    "qa-planner/test the foo",
  );
});

Deno.test("extractToolSubject: Task with only subagent_type", () => {
  assertEquals(
    extractToolSubject("Task", { subagent_type: "Explore" }),
    "Explore",
  );
});

Deno.test("extractToolSubject: Task with only description", () => {
  assertEquals(
    extractToolSubject("Task", { description: "research X" }),
    "research X",
  );
});

Deno.test("extractToolSubject: Skill takes skill name", () => {
  assertEquals(
    extractToolSubject("Skill", { skill: "plan" }),
    "plan",
  );
});

Deno.test("extractToolSubject: MCP extracts server from tool_name", () => {
  assertEquals(
    extractToolSubject("mcp__claude_ai_Gmail__search_threads", {}),
    "mcp: claude_ai_Gmail",
  );
});

Deno.test("extractToolSubject: malformed MCP tool_name (no third segment) → empty", () => {
  assertEquals(extractToolSubject("mcp__only", {}), "");
});

Deno.test("extractToolSubject: unknown tool → empty", () => {
  assertEquals(extractToolSubject("UnknownTool", { foo: "bar" }), "");
});

// --- extractToolError ---

Deno.test("extractToolError: undefined / null → empty", () => {
  assertEquals(extractToolError(undefined), "");
  assertEquals(extractToolError(null), "");
});

Deno.test("extractToolError: success object (Bash) → empty", () => {
  assertEquals(
    extractToolError({
      stdout: "ok",
      stderr: "",
      interrupted: false,
      isImage: false,
      noOutputExpected: false,
    }),
    "",
  );
});

Deno.test("extractToolError: success object (Edit) → empty", () => {
  assertEquals(
    extractToolError({
      type: "update",
      filePath: "/x/y.ts",
      content: "...",
      structuredPatch: [],
      originalFile: null,
    }),
    "",
  );
});

Deno.test("extractToolError: Bash failure string strips 'Error: ' prefix", () => {
  assertEquals(
    extractToolError("Error: Exit code 2\nerr-to-stderr"),
    "Exit code 2 err-to-stderr",
  );
});

Deno.test("extractToolError: Edit failure string strips 'Error: ' prefix", () => {
  assertEquals(
    extractToolError("Error: String to replace not found in file."),
    "String to replace not found in file.",
  );
});

Deno.test("extractToolError: long failure string truncated to 40 chars with ellipsis", () => {
  const raw = "Error: " + "x".repeat(60);
  const out = extractToolError(raw);
  assertEquals(out.length, 41); // 40 x + single '…'
  assertStringIncludes(out, "…");
});

Deno.test("extractToolError: object with interrupted=true → 'interrupted'", () => {
  assertEquals(
    extractToolError({
      stdout: "partial",
      stderr: "",
      interrupted: true,
      isImage: false,
      noOutputExpected: false,
    }),
    "interrupted",
  );
});

Deno.test("extractToolError: empty string → empty", () => {
  assertEquals(extractToolError(""), "");
});

Deno.test("extractToolError: array → empty (defensive)", () => {
  assertEquals(extractToolError([1, 2, 3]), "");
});

Deno.test("extractToolError: strips ESC/NUL/BEL control bytes (terminal-escape injection defense)", () => {
  // A Bash command like `echo $'\x1b[2J'` produces failure output containing
  // the raw ESC byte. Without stripping, picker rendering would execute the
  // escape sequence (clear screen, title change, etc).
  const raw = "Error: \x1b[2Jmalicious\x07text\x00here";
  const out = extractToolError(raw);
  assertEquals(out.includes("\x1b"), false, "ESC must be stripped");
  assertEquals(out.includes("\x07"), false, "BEL must be stripped");
  assertEquals(out.includes("\x00"), false, "NUL must be stripped");
});

Deno.test("extractToolSubject: strips control bytes (terminal-escape injection defense)", () => {
  const out = extractToolSubject("Bash", {
    command: "echo \x1b[2Jfoo\x07",
  });
  assertEquals(out.includes("\x1b"), false);
  assertEquals(out.includes("\x07"), false);
});

// --- PreToolUse subject set/unset ---

Deno.test("eventToOps: PreToolUse (Bash) sets @pane_current_tool_subject", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Bash", tool_input: { command: "pnpm test" } },
    emptyState,
  );
  const subject = ops.find((o) => o.key === "@pane_current_tool_subject");
  assertEquals(subject?.kind === "set" ? subject.value : "", "pnpm test");
});

Deno.test("eventToOps: PreToolUse (Edit) unsets @pane_current_tool_subject (Edit-family empty)", () => {
  const ops = eventToOps(
    "PreToolUse",
    {
      session_id: "s1",
      tool_name: "Edit",
      tool_input: { file_path: "/x/y.ts" },
    },
    emptyState,
  );
  const subject = ops.find((o) => o.key === "@pane_current_tool_subject");
  assertEquals(subject?.kind, "unset");
});

Deno.test("eventToOps: PreToolUse with no tool_input unsets @pane_current_tool_subject", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Bash" },
    emptyState,
  );
  const subject = ops.find((o) => o.key === "@pane_current_tool_subject");
  assertEquals(subject?.kind, "unset");
});

// --- PostToolUse subject + error set/unset ---

Deno.test("eventToOps: PostToolUse (Bash) sets last_tool_subject, unsets last_tool_error on success", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
      tool_response: { stdout: "ok", stderr: "", interrupted: false },
    },
    { subagents: "", pendingTeardown: false, currentTool: "Bash", status: "", mainStopped: false },
  );
  const subject = ops.find((o) => o.key === "@pane_last_tool_subject");
  assertEquals(subject?.kind === "set" ? subject.value : "", "pnpm test");
  const error = ops.find((o) => o.key === "@pane_last_tool_error");
  assertEquals(error?.kind, "unset");
});

Deno.test("eventToOps: PostToolUse (Bash failure) sets last_tool_error from string response", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "false" },
      tool_response: "Error: Exit code 1",
    },
    { subagents: "", pendingTeardown: false, currentTool: "Bash", status: "", mainStopped: false },
  );
  const error = ops.find((o) => o.key === "@pane_last_tool_error");
  assertEquals(error?.kind === "set" ? error.value : "", "Exit code 1");
});

Deno.test("eventToOps: PostToolUse (Edit-family) unsets last_tool_subject (delegates to last_edit_file)", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Edit",
      tool_input: { file_path: "/x/y.ts" },
      tool_response: { type: "update", filePath: "/x/y.ts", content: "..." },
    },
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "", mainStopped: false },
  );
  const subject = ops.find((o) => o.key === "@pane_last_tool_subject");
  assertEquals(subject?.kind, "unset");
  // last_edit_file is still set via existing path
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind === "set" ? lastFile.value : "", "/x/y.ts");
});

Deno.test("eventToOps: PostToolUse matching current tool also unsets @pane_current_tool_subject", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "echo ok" },
      tool_response: { stdout: "ok", stderr: "", interrupted: false },
    },
    { subagents: "", pendingTeardown: false, currentTool: "Bash", status: "", mainStopped: false },
  );
  const currentSubject = ops.find(
    (o) => o.key === "@pane_current_tool_subject",
  );
  assertEquals(currentSubject?.kind, "unset");
});

Deno.test("eventToOps: PostToolUse NOT matching current tool leaves @pane_current_tool_subject untouched", () => {
  // parallel-tool case: Pre(Bash) → Pre(Edit) → Post(Bash). state.currentTool
  // is "Edit" (last-wins from Pre(Edit)), so Post(Bash) must not unset Edit's
  // subject.
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "echo ok" },
      tool_response: { stdout: "ok", stderr: "", interrupted: false },
    },
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "", mainStopped: false },
  );
  const currentSubjectOps = ops.filter(
    (o) => o.key === "@pane_current_tool_subject",
  );
  assertEquals(currentSubjectOps.length, 0);
});

// --- SessionStart / SessionEnd drain includes new options ---

Deno.test("eventToOps: SessionStart unsets new 3 options (current/last subject + last error)", () => {
  const ops = eventToOps(
    "SessionStart",
    { session_id: "s-new" },
    emptyState,
  );
  const unsetKeys = ops.filter((o) => o.kind === "unset").map((o) => o.key);
  assertEquals(unsetKeys.includes("@pane_current_tool_subject"), true);
  assertEquals(unsetKeys.includes("@pane_last_tool_subject"), true);
  assertEquals(unsetKeys.includes("@pane_last_tool_error"), true);
});

Deno.test("eventToOps: SessionEnd drain includes new 3 options", () => {
  const ops = eventToOps("SessionEnd", { session_id: "s1" }, {
    subagents: "",
    pendingTeardown: false,
    currentTool: "",
    status: "",
    mainStopped: false,
  });
  const keys = ops.map((o) => o.key);
  assertEquals(keys.includes("@pane_current_tool_subject"), true);
  assertEquals(keys.includes("@pane_last_tool_subject"), true);
  assertEquals(keys.includes("@pane_last_tool_error"), true);
  // All new options drained via unset
  const newOptsOps = ops.filter((o) =>
    o.key === "@pane_current_tool_subject" ||
    o.key === "@pane_last_tool_subject" ||
    o.key === "@pane_last_tool_error"
  );
  assertEquals(newOptsOps.every((o) => o.kind === "unset"), true);
});

// --- buildLogRecord (observability JSONL) ---

function baseCtx(): RunContext {
  return {
    argv_event: "SessionStart",
    stdin_event: null,
    session_id: null,
    agent_id: null,
    tmux_pane: null,
    cwd: null,
    pre_state: null,
    ops: [],
    apply_results: [],
    early_exit: null,
    stdin_event_mismatch: false,
  };
}

const FIXED_NOW = new Date("2026-04-20T12:34:56.789Z");

Deno.test("buildLogRecord: minimal early-exit (no-event) is fully null-safe", () => {
  const ctx = baseCtx();
  ctx.argv_event = "";
  ctx.early_exit = "no-event";
  const rec = buildLogRecord(ctx, FIXED_NOW, 4242);
  assertEquals(rec.ts, "2026-04-20T12:34:56.789Z");
  assertEquals(rec.pid, 4242);
  assertEquals(rec.argv_event, "");
  assertEquals(rec.stdin_event, null);
  assertEquals(rec.session_id, null);
  assertEquals(rec.agent_id, null);
  assertEquals(rec.tmux_pane, null);
  assertEquals(rec.cwd, null);
  assertEquals(rec.pre_state, null);
  assertEquals(rec.ops, []);
  assertEquals(rec.apply_results, []);
  assertEquals(rec.early_exit, "no-event");
  assertEquals(rec.stdin_event_mismatch, false);
});

Deno.test("buildLogRecord: agent_id captured verbatim for subagent-origin events", () => {
  // Production verifiability: log inspection (rg agent_id) must be able to
  // surface the resumeOpsIfStuck attribution invariant from real traffic.
  const ctx = baseCtx();
  ctx.argv_event = "PreToolUse";
  ctx.agent_id = "explore-1234";
  const rec = buildLogRecord(ctx, FIXED_NOW, 1);
  assertEquals(rec.agent_id, "explore-1234");
});

Deno.test("buildLogRecord: agent_id null for main-origin events", () => {
  const ctx = baseCtx();
  ctx.argv_event = "PreToolUse";
  // ctx.agent_id stays null (default)
  const rec = buildLogRecord(ctx, FIXED_NOW, 1);
  assertEquals(rec.agent_id, null);
});

Deno.test("buildLogRecord: ops are stripped of value (PII safety)", () => {
  const ctx = baseCtx();
  ctx.argv_event = "UserPromptSubmit";
  ctx.tmux_pane = "%42";
  ctx.session_id = "sess-abc";
  ctx.ops = [
    { kind: "set", key: "@pane_prompt", value: "secret prompt content" },
    { kind: "set", key: "@pane_status", value: "running" },
    { kind: "unset", key: "@pane_wait_reason" },
  ];
  const rec = buildLogRecord(ctx, FIXED_NOW, 1);
  assertEquals(rec.ops.length, 3);
  for (const op of rec.ops) {
    assertEquals(Object.hasOwn(op, "value"), false);
  }
  assertEquals(rec.ops[0], { kind: "set", key: "@pane_prompt" });
  assertEquals(rec.ops[2], { kind: "unset", key: "@pane_wait_reason" });
});

Deno.test("buildLogRecord: apply_results pass through verbatim incl. stderr", () => {
  const ctx = baseCtx();
  ctx.apply_results = [
    { key: "@pane_agent", code: 0 },
    { key: "@pane_status", code: 1, stderr: "can't find pane: %99" },
  ];
  const rec = buildLogRecord(ctx, FIXED_NOW, 1);
  assertEquals(rec.apply_results, [
    { key: "@pane_agent", code: 0 },
    { key: "@pane_status", code: 1, stderr: "can't find pane: %99" },
  ]);
});

Deno.test("buildLogRecord: pre_state and stdin_event_mismatch preserved", () => {
  const ctx = baseCtx();
  ctx.argv_event = "PreToolUse";
  ctx.stdin_event = "PostToolUse";
  ctx.stdin_event_mismatch = true;
  const state: PaneState = {
    subagents: "Explore:a1",
    pendingTeardown: false,
    currentTool: "Bash",
    status: "running",
    mainStopped: false,
  };
  ctx.pre_state = state;
  const rec = buildLogRecord(ctx, FIXED_NOW, 1);
  assertEquals(rec.stdin_event, "PostToolUse");
  assertEquals(rec.stdin_event_mismatch, true);
  assertEquals(rec.pre_state, state);
});

Deno.test("buildLogRecord: output is JSON-serializable (no cycles/undefined)", () => {
  const ctx = baseCtx();
  ctx.argv_event = "Stop";
  ctx.tmux_pane = "%7";
  ctx.session_id = "sid";
  ctx.cwd = "/tmp";
  ctx.ops = [{ kind: "set", key: "@pane_status", value: "idle" }];
  ctx.apply_results = [{ key: "@pane_status", code: 0 }];
  const rec = buildLogRecord(ctx, FIXED_NOW, 1);
  const line = JSON.stringify(rec);
  const parsed: unknown = JSON.parse(line);
  assertEquals(
    (parsed as { tmux_pane: string }).tmux_pane,
    "%7",
  );
});
// === Phase B.1: fixture-based op-array baselines ===
// Locked-in current behavior so Phase B.2 (import-substitution)
// and Phase C (transition-builder migration) can prove bit-
// identical Op[] output. Generated from capture-claude-fixtures.ts.
// Identifiers are b1-prefixed to avoid collision with existing helpers.

const B1_TS_KEYS = new Set(["@pane_started_at", "@pane_last_activity_at"]);

function b1Normalize(ops: Op[]): Op[] {
  return ops.map((op) =>
    op.kind === "set" && B1_TS_KEYS.has(op.key)
      ? { kind: "set" as const, key: op.key, value: "<NORMALIZED>" }
      : op
  );
}

const b1State: PaneState = {
  subagents: "",
  pendingTeardown: false,
  currentTool: "",
  status: "",
  mainStopped: false,
};

Deno.test("Phase B.1 fixture: SessionStart with cwd", () => {
  const ops = b1Normalize(eventToOps("SessionStart", { session_id: "test-sid", cwd: "/repo" }, b1State));
  assertEquals(ops, [
      { kind: "set", key: "@pane_agent", value: "claude" },
      { kind: "set", key: "@pane_session_id", value: "test-sid" },
      { kind: "set", key: "@pane_cwd", value: "/repo" },
      { kind: "unset", key: "@pane_started_at" },
      { kind: "unset", key: "@pane_subagents" },
      { kind: "unset", key: "@pane_pending_teardown" },
      { kind: "unset", key: "@pane_worktree_branch" },
      { kind: "unset", key: "@pane_worktree_path" },
      { kind: "unset", key: "@pane_prompt" },
      { kind: "unset", key: "@pane_wait_reason" },
      { kind: "unset", key: "@pane_current_tool" },
      { kind: "unset", key: "@pane_last_tool" },
      { kind: "unset", key: "@pane_last_edit_file" },
      { kind: "unset", key: "@pane_last_activity_at" },
      { kind: "unset", key: "@pane_current_tool_subject" },
      { kind: "unset", key: "@pane_last_tool_subject" },
      { kind: "unset", key: "@pane_last_tool_error" },
      { kind: "unset", key: "@pane_main_stopped" },
      { kind: "unset", key: "@pane_context_used_pct" },
      { kind: "set", key: "@pane_status", value: "idle" },
      { kind: "set", key: "@pane_last_activity_at", value: "<NORMALIZED>" },
    ]);
});

Deno.test("Phase B.1 fixture: UserPromptSubmit with prompt", () => {
  const ops = b1Normalize(eventToOps("UserPromptSubmit", { session_id: "test-sid", cwd: "/repo", prompt: "do the thing" }, b1State));
  assertEquals(ops, [
      { kind: "set", key: "@pane_agent", value: "claude" },
      { kind: "set", key: "@pane_session_id", value: "test-sid" },
      { kind: "set", key: "@pane_cwd", value: "/repo" },
      { kind: "set", key: "@pane_status", value: "running" },
      { kind: "set", key: "@pane_started_at", value: "<NORMALIZED>" },
      { kind: "set", key: "@pane_last_activity_at", value: "<NORMALIZED>" },
      { kind: "unset", key: "@pane_main_stopped" },
      { kind: "set", key: "@pane_prompt", value: "do the thing" },
    ]);
});

Deno.test("Phase B.1 fixture: PreToolUse Bash with subject", () => {
  const ops = b1Normalize(eventToOps("PreToolUse", { session_id: "test-sid", cwd: "/repo", tool_name: "Bash", tool_input: { command: "ls -la" } }, b1State));
  assertEquals(ops, [
      { kind: "set", key: "@pane_agent", value: "claude" },
      { kind: "set", key: "@pane_session_id", value: "test-sid" },
      { kind: "set", key: "@pane_cwd", value: "/repo" },
      { kind: "set", key: "@pane_current_tool", value: "Bash" },
      { kind: "set", key: "@pane_current_tool_subject", value: "ls -la" },
    ]);
});

Deno.test("Phase B.1 fixture: PostToolUse Bash success", () => {
  const ops = b1Normalize(eventToOps("PostToolUse", { session_id: "test-sid", cwd: "/repo", tool_name: "Bash", tool_input: { command: "ls -la" }, tool_response: { stdout: "out", exit_code: 0 } }, { ...b1State, currentTool: "Bash" }));
  assertEquals(ops, [
      { kind: "set", key: "@pane_agent", value: "claude" },
      { kind: "set", key: "@pane_session_id", value: "test-sid" },
      { kind: "set", key: "@pane_cwd", value: "/repo" },
      { kind: "set", key: "@pane_last_activity_at", value: "<NORMALIZED>" },
      { kind: "unset", key: "@pane_current_tool" },
      { kind: "unset", key: "@pane_current_tool_subject" },
      { kind: "set", key: "@pane_last_tool", value: "Bash" },
      { kind: "set", key: "@pane_last_tool_subject", value: "ls -la" },
      { kind: "unset", key: "@pane_last_tool_error" },
      { kind: "unset", key: "@pane_last_edit_file" },
    ]);
});

Deno.test("Phase B.1 fixture: PostToolUse Bash error", () => {
  const ops = b1Normalize(eventToOps("PostToolUse", { session_id: "test-sid", cwd: "/repo", tool_name: "Bash", tool_input: { command: "false" }, tool_response: "Error: command failed" }, { ...b1State, currentTool: "Bash" }));
  assertEquals(ops, [
      { kind: "set", key: "@pane_agent", value: "claude" },
      { kind: "set", key: "@pane_session_id", value: "test-sid" },
      { kind: "set", key: "@pane_cwd", value: "/repo" },
      { kind: "set", key: "@pane_last_activity_at", value: "<NORMALIZED>" },
      { kind: "unset", key: "@pane_current_tool" },
      { kind: "unset", key: "@pane_current_tool_subject" },
      { kind: "set", key: "@pane_last_tool", value: "Bash" },
      { kind: "set", key: "@pane_last_tool_subject", value: "false" },
      { kind: "set", key: "@pane_last_tool_error", value: "command failed" },
      { kind: "unset", key: "@pane_last_edit_file" },
    ]);
});

Deno.test("Phase B.1 fixture: Stop with no subagents", () => {
  const ops = b1Normalize(eventToOps("Stop", { session_id: "test-sid", cwd: "/repo" }, b1State));
  assertEquals(ops, [
      { kind: "set", key: "@pane_agent", value: "claude" },
      { kind: "set", key: "@pane_session_id", value: "test-sid" },
      { kind: "set", key: "@pane_cwd", value: "/repo" },
      { kind: "set", key: "@pane_status", value: "idle" },
      { kind: "unset", key: "@pane_main_stopped" },
    ]);
});

Deno.test("Phase B.1 fixture: SessionEnd drain", () => {
  const ops = b1Normalize(eventToOps("SessionEnd", { session_id: "test-sid", cwd: "/repo" }, b1State));
  assertEquals(ops, [
      { kind: "unset", key: "@pane_agent" },
      { kind: "unset", key: "@pane_status" },
      { kind: "unset", key: "@pane_session_id" },
      { kind: "unset", key: "@pane_started_at" },
      { kind: "unset", key: "@pane_cwd" },
      { kind: "unset", key: "@pane_worktree_branch" },
      { kind: "unset", key: "@pane_worktree_path" },
      { kind: "unset", key: "@pane_subagents" },
      { kind: "unset", key: "@pane_pending_teardown" },
      { kind: "unset", key: "@pane_prompt" },
      { kind: "unset", key: "@pane_wait_reason" },
      { kind: "unset", key: "@pane_current_tool" },
      { kind: "unset", key: "@pane_last_tool" },
      { kind: "unset", key: "@pane_last_edit_file" },
      { kind: "unset", key: "@pane_last_activity_at" },
      { kind: "unset", key: "@pane_current_tool_subject" },
      { kind: "unset", key: "@pane_last_tool_subject" },
      { kind: "unset", key: "@pane_last_tool_error" },
      { kind: "unset", key: "@pane_main_stopped" },
      { kind: "unset", key: "@pane_context_used_pct" },
    ]);
});

Deno.test("Phase B.1 fixture: Notification permission_prompt", () => {
  const ops = b1Normalize(eventToOps("Notification", { session_id: "test-sid", cwd: "/repo", notification_type: "permission_prompt" }, b1State));
  assertEquals(ops, [
      { kind: "set", key: "@pane_agent", value: "claude" },
      { kind: "set", key: "@pane_session_id", value: "test-sid" },
      { kind: "set", key: "@pane_cwd", value: "/repo" },
      { kind: "set", key: "@pane_status", value: "waiting" },
      { kind: "set", key: "@pane_wait_reason", value: "permission" },
    ]);
});

Deno.test("Phase B.1 fixture: SubagentStart with fixed agent_id", () => {
  const ops = b1Normalize(eventToOps("SubagentStart", { session_id: "test-sid", cwd: "/repo", agent_id: "test-agent-id", subagent_type: "Plan" }, b1State));
  assertEquals(ops, [
      { kind: "set", key: "@pane_agent", value: "claude" },
      { kind: "set", key: "@pane_session_id", value: "test-sid" },
      { kind: "set", key: "@pane_cwd", value: "/repo" },
      { kind: "set", key: "@pane_subagents", value: "subagent:test-agent-id" },
    ]);
});

Deno.test("Phase B.1 fixture: StopFailure rate_limit", () => {
  const ops = b1Normalize(eventToOps("StopFailure", { session_id: "test-sid", cwd: "/repo", error_type: "rate_limit" }, b1State));
  assertEquals(ops, [
      { kind: "set", key: "@pane_agent", value: "claude" },
      { kind: "set", key: "@pane_session_id", value: "test-sid" },
      { kind: "set", key: "@pane_cwd", value: "/repo" },
      { kind: "set", key: "@pane_status", value: "error" },
      { kind: "set", key: "@pane_wait_reason", value: "rate_limit" },
    ]);
});
