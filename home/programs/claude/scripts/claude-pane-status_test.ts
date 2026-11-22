import { test } from "bun:test";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { run } from "../../agents/lib/proc.ts";
import {
  appendSubagent,
  BACKGROUND_SHELL_CAP_SECONDS,
  backgroundWait,
  buildLogRecord,
  chainSetArgs,
  commandKey,
  count,
  eventToOps,
  extractToolError,
  extractToolSubject,
  formatElapsed,
  hasSubagent,
  matchShells,
  NO_PROBE,
  type PaneState,
  parseEtime,
  parseListeners,
  parseProcRows,
  parseShowOptions,
  removeSubagent,
  type RunContext,
  selfHealOps,
  type ShellProbe,
} from "./claude-pane-status.ts";
import {
  ALL_PANE_OPTIONS_FOR_CLAUDE as ALL_PANE_OPTIONS,
  maskPrompt,
  type Op,
} from "../../tmux/shared/pane-shared.ts";

// --- maskPrompt ---

test("maskPrompt: empty string stays empty", () => {
  assertEquals(maskPrompt(""), "");
});

test("maskPrompt: non-string input → empty", () => {
  assertEquals(maskPrompt(undefined), "");
  assertEquals(maskPrompt(null), "");
  assertEquals(maskPrompt(123), "");
});

test("maskPrompt: short string preserved verbatim", () => {
  assertEquals(maskPrompt("hello"), "hello");
});

test("maskPrompt: exactly 40 chars not truncated", () => {
  const s = "x".repeat(40);
  assertEquals(maskPrompt(s), s);
});

test("maskPrompt: 41 chars truncated with ellipsis", () => {
  const s = "x".repeat(41);
  const out = maskPrompt(s);
  assertEquals(out.length, 41); // 40 x + single '…'
  assertStringIncludes(out, "…");
  assertEquals(out.slice(0, 40), "x".repeat(40));
});

test("maskPrompt: TAB / CR / LF collapsed to single space", () => {
  assertEquals(maskPrompt("a\tb\nc\rd"), "a b c d");
});

test("maskPrompt: multi whitespace runs collapsed", () => {
  assertEquals(maskPrompt("a   b"), "a b");
});

// --- formatElapsed ---

test("formatElapsed: negative → -", () => {
  assertEquals(formatElapsed(-1), "-");
});

test("formatElapsed: 0..59 → Ns", () => {
  assertEquals(formatElapsed(0), "0s");
  assertEquals(formatElapsed(59), "59s");
});

test("formatElapsed: 60..3599 → Nm", () => {
  assertEquals(formatElapsed(60), "1m");
  assertEquals(formatElapsed(3599), "59m");
});

test("formatElapsed: >=3600 → Nh", () => {
  assertEquals(formatElapsed(3600), "1h");
  assertEquals(formatElapsed(7200), "2h");
});

// --- subagent list helpers ---

test("appendSubagent: to empty list", () => {
  assertEquals(appendSubagent("", "Explore", "a1"), "Explore:a1");
});

test("appendSubagent: to non-empty list", () => {
  assertEquals(
    appendSubagent("Explore:a1", "Plan", "b2"),
    "Explore:a1|Plan:b2",
  );
});

test("appendSubagent: sanitizes '|' and ':' in type / id", () => {
  // '|' and ':' are reserved list delimiters → replaced with '-'
  assertEquals(appendSubagent("", "Ex|plore", "a:1"), "Ex-plore:a-1");
});

test("appendSubagent: dedupes by id (same type)", () => {
  assertEquals(appendSubagent("Explore:a1", "Explore", "a1"), "Explore:a1");
});

test("appendSubagent: dedupes by id even when type differs", () => {
  // SubagentStart and tool-event self-heal may register the same agent under
  // different types; a second entry would survive removeSubagent forever.
  assertEquals(appendSubagent("subagent:a1", "Explore", "a1"), "subagent:a1");
});

test("hasSubagent: matches id at any position regardless of type", () => {
  assertEquals(hasSubagent("A:1|B:2|C:3", "2"), true);
  assertEquals(hasSubagent("A:1|B:2", "3"), false);
  assertEquals(hasSubagent("", "1"), false);
  assertEquals(hasSubagent("A:1", ""), false);
});

test("removeSubagent: removes first matching id", () => {
  assertEquals(
    removeSubagent("Explore:a1|Plan:b2", "a1"),
    "Plan:b2",
  );
});

test("removeSubagent: removes middle entry preserving order", () => {
  assertEquals(
    removeSubagent("A:1|B:2|C:3", "2"),
    "A:1|C:3",
  );
});

test("removeSubagent: last entry → empty string", () => {
  assertEquals(removeSubagent("Explore:a1", "a1"), "");
});

test("removeSubagent: id not found → list unchanged", () => {
  assertEquals(
    removeSubagent("Explore:a1|Plan:b2", "nope"),
    "Explore:a1|Plan:b2",
  );
});

test("removeSubagent: empty list → empty string", () => {
  assertEquals(removeSubagent("", "anything"), "");
});

test("count: empty → 0", () => {
  assertEquals(count(""), 0);
});

test("count: single entry → 1", () => {
  assertEquals(count("Explore:a1"), 1);
});

test("count: multiple entries → N", () => {
  assertEquals(count("A:1|B:2|C:3"), 3);
});

// --- eventToOps ---

const emptyState: PaneState = {
  subagents: "",
  pendingTeardown: false,
  currentTool: "",
  status: "",
  mainStopped: false,
  waitReason: "",
  lastActivityAt: "",
  background: "",
  backgroundUntil: "",
  permissionAgents: "",
};

function stateWithSubagents(list: string): PaneState {
  return {
    subagents: list,
    pendingTeardown: false,
    currentTool: "",
    status: "",
    mainStopped: false,
    waitReason: "",
    lastActivityAt: "",
    background: "",
    backgroundUntil: "",
    permissionAgents: "",
  };
}

function stateWith(overrides: Partial<PaneState>): PaneState {
  return { ...emptyState, ...overrides };
}

test("eventToOps: SessionStart sets agent / status / session_id / cwd + unsets stale", () => {
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

test("eventToOps: SessionStart clears @pane_started_at (prevent elapsed bleed)", () => {
  const ops = eventToOps(
    "SessionStart",
    { session_id: "sess-new" },
    emptyState,
  );
  const startedAtOp = ops.find((o) => o.key === "@pane_started_at");
  assertEquals(startedAtOp?.kind, "unset");
});

test("eventToOps: SessionEnd with no subagents → unset all @pane_*", () => {
  const ops = eventToOps("SessionEnd", {}, emptyState);
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
  // drain completeness: new pane options must be unset too
  const keys = ops.map((o) => o.key);
  assertEquals(keys.includes("@pane_current_tool"), true);
  assertEquals(keys.includes("@pane_subagents"), true);
});

test("eventToOps: SessionEnd with live subagents → pending teardown", () => {
  const ops = eventToOps("SessionEnd", {}, stateWithSubagents("A:1|B:2"));
  // No session_id → self-heal is empty, body has 1 op
  assertEquals(ops, [{
    kind: "set",
    key: "@pane_pending_teardown",
    value: "1",
  }]);
});

test("eventToOps: UserPromptSubmit masks prompt + sets running", () => {
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

test("eventToOps: UserPromptSubmit with empty prompt → unset @pane_prompt", () => {
  const ops = eventToOps("UserPromptSubmit", {}, emptyState);
  const promptOp = ops.find((o) => o.key === "@pane_prompt");
  assertEquals(promptOp?.kind, "unset");
});

test("eventToOps: Stop with no subagents → idle + defensive unset @pane_main_stopped", () => {
  const ops = eventToOps("Stop", {}, emptyState);
  assertEquals(ops, [
    { kind: "unset", key: "@pane_background" },
    { kind: "unset", key: "@pane_background_until" },
    { kind: "set", key: "@pane_status", value: "idle" },
    { kind: "unset", key: "@pane_main_stopped" },
  ]);
});

test("eventToOps: Stop with live subagents → sets @pane_main_stopped (no status change)", () => {
  // main stopped but subagents still running. Status must stay `running`;
  // @pane_main_stopped=1 is set so that when the last subagent stops we can
  // transition to idle. No session_id → selfHeal adds nothing.
  const ops = eventToOps("Stop", {}, stateWithSubagents("Explore:x1"));
  assertEquals(ops, [
    { kind: "set", key: "@pane_main_stopped", value: "1" },
    { kind: "unset", key: "@pane_background" },
    { kind: "unset", key: "@pane_background_until" },
  ]);
});

test("eventToOps: Stop with no subagents also unsets @pane_main_stopped defensively", () => {
  const ops = eventToOps("Stop", {}, emptyState);
  const statusOp = ops.find((o) => o.key === "@pane_status");
  assertEquals(statusOp?.kind === "set" ? statusOp.value : "", "idle");
  const flagOp = ops.find((o) => o.key === "@pane_main_stopped");
  assertEquals(flagOp?.kind, "unset");
});

test("eventToOps: StopFailure with error_type → error + wait_reason=<error_type>", () => {
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

test("eventToOps: StopFailure without error_type → error + wait_reason='error'", () => {
  const ops = eventToOps("StopFailure", {}, emptyState);
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "error");
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind === "set" ? reason.value : "", "error");
});

test("eventToOps: StopFailure ignores legacy data.message field", () => {
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

test("eventToOps: Notification(permission_prompt) → waiting + 'permission'", () => {
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

test("eventToOps: Notification(idle_prompt) → waiting + 'idle prompt'", () => {
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

test("eventToOps: Notification(idle_prompt) + live subagents + fresh activity → no-op (defer like Stop)", () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const ops = eventToOps(
    "Notification",
    { notification_type: "idle_prompt", session_id: "s1" },
    stateWith({
      subagents: "Explore:a1",
      status: "running",
      mainStopped: true,
      lastActivityAt: String(nowSec - 10),
    }),
  );
  assertEquals(ops, []);
});

test("eventToOps: Notification(idle_prompt) + subagents but stale activity → ghost cleanup + waiting", () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const ops = eventToOps(
    "Notification",
    { notification_type: "idle_prompt" },
    stateWith({
      subagents: "Ghost:zz",
      status: "running",
      mainStopped: true,
      lastActivityAt: String(nowSec - 600),
    }),
  );
  assertEquals(ops, [
    { kind: "unset", key: "@pane_subagents" },
    { kind: "unset", key: "@pane_main_stopped" },
    { kind: "set", key: "@pane_status", value: "waiting" },
    { kind: "set", key: "@pane_wait_reason", value: "idle prompt" },
  ]);
});

// idle_prompt arrives about 60 s after Stop (observed 60–66 s), so a ghost
// must already count as stale at that point or the cleanup never runs.
test("eventToOps: Notification(idle_prompt) 60 s after last activity → ghost cleanup", () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const ops = eventToOps(
    "Notification",
    { notification_type: "idle_prompt" },
    stateWith({
      subagents: "web-fetch:zz",
      status: "running",
      mainStopped: true,
      lastActivityAt: String(nowSec - 60),
    }),
  );
  assertEquals(ops.find((o) => o.key === "@pane_subagents")?.kind, "unset");
});

test("eventToOps: Notification(idle_prompt) + subagents + empty lastActivityAt → treated as stale", () => {
  const ops = eventToOps(
    "Notification",
    { notification_type: "idle_prompt" },
    stateWith({ subagents: "Ghost:zz", status: "running" }),
  );
  assertEquals(ops, [
    { kind: "unset", key: "@pane_subagents" },
    { kind: "unset", key: "@pane_main_stopped" },
    { kind: "set", key: "@pane_status", value: "waiting" },
    { kind: "set", key: "@pane_wait_reason", value: "idle prompt" },
  ]);
});

test("eventToOps: Notification(permission_prompt) + live subagents → still waiting (user-blocking wins)", () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const ops = eventToOps(
    "Notification",
    { notification_type: "permission_prompt" },
    stateWith({
      subagents: "Explore:a1",
      status: "running",
      lastActivityAt: String(nowSec - 5),
    }),
  );
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "waiting");
});

test("eventToOps: Notification(elicitation_dialog) → waiting + 'elicitation'", () => {
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

test("eventToOps: Notification(elicitation_complete) → unset wait_reason only (status preserved)", () => {
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

test("eventToOps: Notification(elicitation_response) → unset wait_reason only", () => {
  const ops = eventToOps(
    "Notification",
    { notification_type: "elicitation_response" },
    emptyState,
  );
  assertEquals(ops.some((o) => o.key === "@pane_status"), false);
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind, "unset");
});

test("eventToOps: Notification(auth_success) → no-op (status not flipped to waiting)", () => {
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

test("eventToOps: Notification with unknown notification_type → no-op", () => {
  const ops = eventToOps(
    "Notification",
    { notification_type: "future_event_kind" },
    emptyState,
  );
  assertEquals(ops, []);
});

test("eventToOps: Notification ignores legacy data.message field", () => {
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

test("eventToOps: Notification @pane_attention never appears in any branch", () => {
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

test("eventToOps: PermissionDenied → waiting + permission-denied", () => {
  const ops = eventToOps("PermissionDenied", {}, emptyState);
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind === "set" ? reason.value : "", "permission-denied");
});

// --- PostToolUseFailure ---
// Schema: tool_name, tool_input, error (string), tool_use_id, agent_id?,
// agent_type?. Fires for tool failures. Replaces the older inference path
// in PostToolUse where a string-shape `tool_response` (`"Error: ..."`) was
// parsed to detect failure.

test("eventToOps: PostToolUseFailure (Bash) sets last_tool_error from data.error", () => {
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

test("eventToOps: PostToolUseFailure with empty error → unsets last_tool_error", () => {
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

test("eventToOps: PostToolUseFailure error is truncated", () => {
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

test("eventToOps: PostToolUseFailure (subagent-origin, agent_id set) → no resume", () => {
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

test("eventToOps: PostToolUseFailure (main-origin) + status=waiting → resume", () => {
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

test("eventToOps: PostToolUseFailure without tool_name updates only activity_at", () => {
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

test("eventToOps: PostToolUseFailure on non-matching tool keeps current_tool", () => {
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

test("eventToOps: CwdChanged with cwd → set @pane_cwd", () => {
  const ops = eventToOps("CwdChanged", { cwd: "/new" }, emptyState);
  assertEquals(ops, [{ kind: "set", key: "@pane_cwd", value: "/new" }]);
});

test("eventToOps: CwdChanged without cwd → no-op", () => {
  const ops = eventToOps("CwdChanged", {}, emptyState);
  assertEquals(ops, []);
});

// --- PreToolUse / PostToolUse ---

test("eventToOps: PreToolUse with tool_name → set @pane_current_tool", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Bash" },
    emptyState,
  );
  const toolOp = ops.find((o) => o.key === "@pane_current_tool");
  assertEquals(toolOp?.kind === "set" ? toolOp.value : "", "Bash");
});

test("eventToOps: PreToolUse without tool_name → no-op", () => {
  const ops = eventToOps("PreToolUse", { session_id: "s1" }, emptyState);
  assertEquals(ops, []);
});

test("eventToOps: PostToolUse → unset @pane_current_tool (last-wins)", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "Bash",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const toolOp = ops.find((o) => o.key === "@pane_current_tool");
  assertEquals(toolOp?.kind, "unset");
});

test("eventToOps: PostToolUse (concurrent tools) keeps current_tool when payload tool_name differs", () => {
  // Pre(A)→current=A, Pre(B)→current=B, Post(A): tool_name='A' != state.currentTool='B'.
  // current_tool must stay 'B' because B is still running.
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "ToolA" },
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "ToolB",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const currentOp = ops.find((o) => o.key === "@pane_current_tool");
  assertEquals(
    currentOp,
    undefined,
    "current_tool must not be touched when a parallel tool is still running",
  );
  const lastOp = ops.find((o) => o.key === "@pane_last_tool");
  assertEquals(lastOp?.kind === "set" ? lastOp.value : "", "ToolA");
});

test("eventToOps: PostToolUse (Bash) clears stale @pane_last_edit_file", () => {
  // Non-edit tool completion must clear any stale basename so row 2 never
  // shows `last: Bash · old-file.ts` after a prior Edit.
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "Bash",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind, "unset");
});

test("eventToOps: PostToolUse (Edit, missing file_path) clears stale @pane_last_edit_file", () => {
  // Edit-family tool without a usable file_path must also clear the stale
  // basename rather than leaving a previous Edit's value on display.
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Edit" },
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "Edit",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind, "unset");
});

test("eventToOps: PreToolUse → PostToolUse round trip on current_tool", () => {
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
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "Edit",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const postToolOp = postOps.find((o) => o.key === "@pane_current_tool");
  assertEquals(postToolOp?.kind, "unset");
});

test("eventToOps: PostToolUse (Edit) moves current_tool → last_tool + stores raw file_path + activity_at", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Edit",
      tool_input: { file_path: "/x/y.ts" },
    },
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "Edit",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const currentUnset = ops.find((o) => o.key === "@pane_current_tool");
  assertEquals(currentUnset?.kind, "unset");
  const lastTool = ops.find((o) => o.key === "@pane_last_tool");
  assertEquals(lastTool?.kind === "set" ? lastTool.value : "", "Edit");
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind === "set" ? lastFile.value : "", "/x/y.ts");
  const activity = ops.find((o) => o.key === "@pane_last_activity_at");
  assertEquals(activity?.kind, "set");
  assertEquals(
    /^\d+$/.test(activity?.kind === "set" ? activity.value : ""),
    true,
  );
});

test("eventToOps: PostToolUse (Write) stores file_path", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Write",
      tool_input: { file_path: "/a/b/new.md" },
    },
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "Write",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind === "set" ? lastFile.value : "", "/a/b/new.md");
});

test("eventToOps: PostToolUse (MultiEdit) stores file_path", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "MultiEdit",
      tool_input: { file_path: "/a/b/multi.ts" },
    },
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "MultiEdit",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind === "set" ? lastFile.value : "", "/a/b/multi.ts");
});

test("eventToOps: PostToolUse (Bash) sets last_tool and clears last_edit_file", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "Bash",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const lastTool = ops.find((o) => o.key === "@pane_last_tool");
  assertEquals(lastTool?.kind === "set" ? lastTool.value : "", "Bash");
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind, "unset");
});

test("eventToOps: PostToolUse with empty tool_name is attribution-safe (no last_*)", () => {
  // Degraded payload: only activity_at is updated — last_tool / last_edit_file
  // / current_tool are left untouched because attributing the completion via
  // state.currentTool would mis-label when parallel tools are in flight.
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1" },
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "Edit",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
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

test("eventToOps: PostToolUse (Edit) strips TAB/CR/LF from file_path", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Edit",
      tool_input: { file_path: "/x/y\n.ts\twith\rctrl" },
    },
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "Edit",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(
    lastFile?.kind === "set" ? lastFile.value : "",
    "/x/y .ts with ctrl",
  );
});

test("eventToOps: PostToolUse (Edit) with non-string file_path clears last_edit_file", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Edit",
      tool_input: { file_path: 42 },
    },
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "Edit",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind, "unset");
});

test("eventToOps: UserPromptSubmit sets @pane_last_activity_at", () => {
  const ops = eventToOps(
    "UserPromptSubmit",
    { session_id: "s1", prompt: "hello" },
    emptyState,
  );
  const activity = ops.find((o) => o.key === "@pane_last_activity_at");
  assertEquals(activity?.kind, "set");
  assertEquals(
    /^\d+$/.test(activity?.kind === "set" ? activity.value : ""),
    true,
  );
});

test("eventToOps: SessionStart sets @pane_last_activity_at (fresh-session idle seed)", () => {
  const ops = eventToOps(
    "SessionStart",
    { session_id: "s-new" },
    emptyState,
  );
  const activity = ops.find((o) =>
    o.kind === "set" && o.key === "@pane_last_activity_at"
  );
  assertEquals(activity?.kind, "set");
  assertEquals(
    /^\d+$/.test(activity?.kind === "set" ? activity.value : ""),
    true,
  );
});

test("eventToOps: SessionStart clears new last_* options (stale-session cleanup)", () => {
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

test("eventToOps: SessionEnd drain includes new last_* options", () => {
  const ops = eventToOps("SessionEnd", {}, emptyState);
  const keys = ops.map((o) => o.key);
  assertEquals(keys.includes("@pane_last_tool"), true);
  assertEquals(keys.includes("@pane_last_edit_file"), true);
  assertEquals(keys.includes("@pane_last_activity_at"), true);
});

// --- SubagentStart / SubagentStop (list encoding) ---

test("eventToOps: SubagentStart appends Type:id to list", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Explore", agent_id: "a1" },
    emptyState,
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Explore:a1");
});

test("eventToOps: SubagentStart fallback type = 'subagent' when missing", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_id: "x" },
    emptyState,
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "subagent:x");
});

test("eventToOps: SubagentStart appends to existing list", () => {
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

test("eventToOps: SubagentStart sanitizes '|' in agent_type", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Bad|Type", agent_id: "x" },
    emptyState,
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Bad-Type:x");
});

test("eventToOps: SubagentStop removes matching id from list", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWithSubagents("Explore:a1|Plan:b2"),
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Plan:b2");
});

test("eventToOps: SubagentStop last remaining → unset @pane_subagents", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWithSubagents("Explore:a1"),
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind, "unset");
});

test("eventToOps: SubagentStop drains pending teardown when list becomes empty", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    {
      subagents: "Explore:a1",
      pendingTeardown: true,
      currentTool: "",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
});

// web-fetch fires neither SubagentStart nor SubagentStop; its WebFetch call
// self-heals it into the list, and SubagentHandback is its only end signal.
test("eventToOps: subagent SubagentHandback after main Stop → list drained + idle", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      agent_id: "a1",
      agent_type: "web-fetch",
      tool_name: "SubagentHandback",
    },
    stateWith({
      status: "running",
      subagents: "web-fetch:a1",
      mainStopped: true,
    }),
  );
  assertEquals(ops.find((o) => o.key === "@pane_subagents")?.kind, "unset");
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "idle");
});

test("eventToOps: subagent SubagentHandback removes only that id", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      agent_id: "a1",
      agent_type: "web-fetch",
      tool_name: "SubagentHandback",
    },
    stateWith({ status: "running", subagents: "web-fetch:a1|Explore:b2" }),
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Explore:b2");
  assertEquals(ops.some((o) => o.key === "@pane_status"), false);
});

test("eventToOps: subagent SubagentHandback leaves no entry for a later Stop to wait on", () => {
  const handback = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      agent_id: "a1",
      agent_type: "web-fetch",
      tool_name: "SubagentHandback",
    },
    stateWith({ status: "running", subagents: "web-fetch:a1" }),
  );
  assertEquals(
    handback.find((o) => o.key === "@pane_subagents")?.kind,
    "unset",
  );
  const stop = eventToOps(
    "Stop",
    { session_id: "s1" },
    stateWith({ status: "running" }),
  );
  const status = stop.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "idle");
});

// For a general-purpose agent SubagentStop follows the handback; after a
// handback drain that SubagentStop must not self-heal @pane_agent back.
test("eventToOps: SubagentStop for an id no longer listed → no-op", () => {
  assertEquals(
    eventToOps(
      "SubagentStop",
      { session_id: "s1", agent_id: "a1" },
      emptyState,
    ),
    [],
  );
});

test("eventToOps: unknown event → no-op", () => {
  assertEquals(eventToOps("NotARealEvent", {}, emptyState), []);
  assertEquals(eventToOps("", {}, emptyState), []);
});

// --- selfHealOps ---

test("selfHealOps: with session_id returns agent + session_id (+ cwd)", () => {
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

test("selfHealOps: with session_id only (no cwd) returns agent + session_id", () => {
  const ops = selfHealOps({ session_id: "sess-2" });
  assertEquals(ops.length, 2);
  assertEquals(ops[0], { kind: "set", key: "@pane_agent", value: "claude" });
  assertEquals(ops[1], {
    kind: "set",
    key: "@pane_session_id",
    value: "sess-2",
  });
});

test("selfHealOps: without session_id returns empty", () => {
  assertEquals(selfHealOps({}), []);
  assertEquals(selfHealOps({ cwd: "/tmp" }), []);
});

test("selfHealOps: invalid session_id (path traversal) drops event", () => {
  // Defense-in-depth: writer-side SESSION_ID_RE assertion must reject
  // non-allowlist ids (e.g. `../bad`). Agentower re-validates the same regex.
  assertEquals(selfHealOps({ session_id: "../bad", cwd: "/tmp" }), []);
  assertEquals(selfHealOps({ session_id: "sess:001" }), []);
  assertEquals(selfHealOps({ session_id: "a".repeat(129) }), []);
});

// --- eventToOps self-heal behavior ---

test("eventToOps: UserPromptSubmit with session_id prefixes self-heal ops", () => {
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

test("eventToOps: CwdChanged without session_id does NOT set @pane_agent (phantom prevention)", () => {
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

test("eventToOps: SessionEnd drain (no subagents) does NOT include self-heal", () => {
  const ops = eventToOps("SessionEnd", { session_id: "sess-4" }, emptyState);
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
});

test("eventToOps: SubagentStop drain does NOT include self-heal", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "sess-5", agent_id: "a1" },
    {
      subagents: "Explore:a1",
      pendingTeardown: true,
      currentTool: "",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
});

test("eventToOps: Stop with live subagents + session_id → self-heal + main_stopped=1", () => {
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

function hasResumeOps(
  ops: { kind: string; key: string; value?: string }[],
): boolean {
  const setRunning = ops.some(
    (o) =>
      o.kind === "set" && o.key === "@pane_status" &&
      (o as { value: string }).value === "running",
  );
  const unsetReason = ops.some(
    (o) => o.kind === "unset" && o.key === "@pane_wait_reason",
  );
  return setRunning && unsetReason;
}

test("resume: PreToolUse with status=waiting → flips to running + clears wait_reason", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "waiting" }),
  );
  assertEquals(hasResumeOps(ops), true);
  const toolOp = ops.find((o) => o.key === "@pane_current_tool");
  assertEquals(toolOp?.kind === "set" ? toolOp.value : "", "Bash");
});

test("resume: PreToolUse with status=error → flips to running", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "error" }),
  );
  assertEquals(hasResumeOps(ops), true);
});

test("resume: PreToolUse with status=running → no resume ops (no-op)", () => {
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

test("resume: PreToolUse (main-shaped) with status=idle → resume (teammate sessions share the pane)", () => {
  // A teammate is a sibling full session on the same pane; its tool events
  // carry no agent_id and arrive without UserPromptSubmit. A tool event at
  // status=idle proves the display is stale regardless of which session sent it.
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "idle" }),
  );
  assertEquals(hasResumeOps(ops), true);
});

test("resume: PostToolUse with status=waiting → flips to running", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "waiting", currentTool: "Bash" }),
  );
  assertEquals(hasResumeOps(ops), true);
});

test("resume: PostToolUse with status=error → flips to running", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "error", currentTool: "Bash" }),
  );
  assertEquals(hasResumeOps(ops), true);
});

test("resume: PostToolUse with status=running → no resume ops", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "running", currentTool: "Bash" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

test("resume: PostToolUse (main-shaped) with status=idle → resume (teammate sessions share the pane)", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "idle", currentTool: "Bash" }),
  );
  assertEquals(hasResumeOps(ops), true);
});

// Resume gating is now payload-attribution-based, not state-based:
//   data.agent_id absent (main-origin)  → resume IF status is waiting/error/idle
//   data.agent_id present (subagent-origin) → never resume (subagent activity
//     is not main-attributable, so resume would falsely flip waiting→running)
// The previous gate (`state.subagents === ""`) over-blocked main resume
// whenever any subagent was alive — this is the bug the rewrite fixes.

test("resume: PreToolUse main-origin + status=waiting + active subagent → resume", () => {
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

test("resume: PreToolUse main-origin + status=error + active subagent → resume", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Bash" },
    stateWith({ status: "error", subagents: "Explore:a1" }),
  );
  assertEquals(hasResumeOps(ops), true);
});

test("resume: PreToolUse subagent-origin (agent_id set) + status=waiting → NO resume", () => {
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

test("resume: PreToolUse subagent-origin + status=error → NO resume", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", agent_id: "a1", tool_name: "Bash" },
    stateWith({ status: "error", subagents: "Explore:a1" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

test("resume: PostToolUse main-origin + status=waiting + active subagent → resume", () => {
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

test("resume: PostToolUse main-origin + status=error + active subagent → resume", () => {
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

test("resume: PostToolUse subagent-origin + status=waiting → NO resume", () => {
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

test("resume: PostToolUse subagent-origin + status=error → NO resume", () => {
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

test("resume: SubagentStart with status=waiting (user-blocking, waitReason empty) → NO resume", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Explore", agent_id: "a1" },
    stateWith({ status: "waiting" }),
  );
  assertEquals(hasResumeOps(ops), false);
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Explore:a1");
});

test("resume: SubagentStart with status=error → NO resume", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Explore", agent_id: "a1" },
    stateWith({ status: "error" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

test("resume: SubagentStart with status=running → no resume ops", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Explore", agent_id: "a1" },
    stateWith({ status: "running" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

test("resume: SubagentStart with status=idle → pane-level recovery (running + main_stopped rebuilt)", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Explore", agent_id: "a1" },
    stateWith({ status: "idle" }),
  );
  assertEquals(hasResumeOps(ops), true);
  const stopped = ops.find((o) => o.key === "@pane_main_stopped");
  assertEquals(stopped?.kind === "set" ? stopped.value : "", "1");
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Explore:a1");
});

test("resume: SubagentStart with status=waiting & waitReason='idle prompt' → pane-level recovery", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Explore", agent_id: "a1" },
    stateWith({ status: "waiting", waitReason: "idle prompt" }),
  );
  assertEquals(hasResumeOps(ops), true);
  const stopped = ops.find((o) => o.key === "@pane_main_stopped");
  assertEquals(stopped?.kind === "set" ? stopped.value : "", "1");
});

test("resume: SubagentStart with status=waiting & waitReason='permission' → NO recovery (user-blocking wait wins)", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Explore", agent_id: "a1" },
    stateWith({ status: "waiting", waitReason: "permission" }),
  );
  assertEquals(hasResumeOps(ops), false);
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Explore:a1");
});

test("resume: SubagentStop (non-drain) with status=waiting → NO resume (subagent activity is not main-attributable)", () => {
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

test("resume: SubagentStop (non-drain) with status=error → NO resume", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWith({ subagents: "Explore:a1|Plan:b2", status: "error" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

test("resume: SubagentStop (non-drain) with status=running → no resume ops", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWith({ subagents: "Explore:a1|Plan:b2", status: "running" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

test("resume: SubagentStop (non-drain) with status=idle → no resume ops", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWith({ subagents: "Explore:a1|Plan:b2", status: "idle" }),
  );
  assertEquals(hasResumeOps(ops), false);
});

// --- subagent-origin self-heal (list repair + idle-like recovery) ---
// SubagentStart frequently never fires in production; an agent_id-carrying
// tool event is the recovery input for both the list and the status.

test("self-heal: PreToolUse subagent-origin, id not in list → append + activity bump", () => {
  const ops = eventToOps(
    "PreToolUse",
    {
      session_id: "s1",
      agent_id: "a1",
      agent_type: "Explore",
      tool_name: "Bash",
    },
    stateWith({ status: "running", subagents: "" }),
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Explore:a1");
  const activity = ops.find((o) => o.key === "@pane_last_activity_at");
  assertEquals(activity?.kind, "set");
  // status=running is not idle-like: no status ops
  assertEquals(ops.some((o) => o.key === "@pane_status"), false);
});

test("self-heal: PreToolUse subagent-origin, id already in list → no append", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", agent_id: "a1", tool_name: "Bash" },
    stateWith({ status: "running", subagents: "Explore:a1" }),
  );
  assertEquals(ops.some((o) => o.key === "@pane_subagents"), false);
});

test("self-heal: PreToolUse subagent-origin + status=idle → append + running + main_stopped rebuilt", () => {
  // The Cause-D core: SubagentStart never fired, Stop already wrote idle.
  // The first subagent tool event must repair list AND display.
  const ops = eventToOps(
    "PreToolUse",
    {
      session_id: "s1",
      agent_id: "a1",
      agent_type: "Explore",
      tool_name: "Bash",
    },
    stateWith({ status: "idle" }),
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Explore:a1");
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "running");
  const stopped = ops.find((o) => o.key === "@pane_main_stopped");
  assertEquals(stopped?.kind === "set" ? stopped.value : "", "1");
});

test("self-heal: PreToolUse subagent-origin + waiting('idle prompt') → recovery", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", agent_id: "a1", tool_name: "Bash" },
    stateWith({
      status: "waiting",
      waitReason: "idle prompt",
      subagents: "subagent:a1",
    }),
  );
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "running");
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind, "unset");
});

test("self-heal: PreToolUse subagent-origin + waiting('permission') → list repaired but status untouched", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", agent_id: "a1", tool_name: "Bash" },
    stateWith({ status: "waiting", waitReason: "permission" }),
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "subagent:a1");
  assertEquals(ops.some((o) => o.key === "@pane_status"), false);
});

test("self-heal: PreToolUse subagent-origin + status=error → status ops never emitted", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", agent_id: "a1", tool_name: "Bash" },
    stateWith({ status: "error", waitReason: "rate_limit" }),
  );
  assertEquals(ops.some((o) => o.key === "@pane_status"), false);
});

test("self-heal: PostToolUse subagent-origin + status=idle → append + running + main_stopped", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      agent_id: "a1",
      agent_type: "Plan",
      tool_name: "Read",
    },
    stateWith({ status: "idle" }),
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Plan:a1");
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "running");
  const stopped = ops.find((o) => o.key === "@pane_main_stopped");
  assertEquals(stopped?.kind === "set" ? stopped.value : "", "1");
});

test("self-heal: PostToolUseFailure subagent-origin + status=idle → append + running + main_stopped", () => {
  const ops = eventToOps(
    "PostToolUseFailure",
    {
      session_id: "s1",
      agent_id: "a1",
      tool_name: "Bash",
      error: "boom",
    },
    stateWith({ status: "idle" }),
  );
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "subagent:a1");
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "running");
});

test("self-heal sequence: Stop(empty list)→idle, subagent PreToolUse→recovery, SubagentStop→idle", () => {
  // End-to-end for Cause D: SubagentStart never fires, so Stop sees an empty
  // list and writes idle; the first subagent tool event repairs everything;
  // the final SubagentStop returns the pane to idle via the rebuilt marker.
  const apply = (state: PaneState, ops: Op[]): PaneState => {
    const next = { ...state };
    for (const op of ops) {
      const v = op.kind === "set" ? op.value : "";
      if (op.key === "@pane_status") next.status = v;
      if (op.key === "@pane_subagents") next.subagents = v;
      if (op.key === "@pane_main_stopped") next.mainStopped = v === "1";
      if (op.key === "@pane_wait_reason") next.waitReason = v;
      if (op.key === "@pane_last_activity_at") next.lastActivityAt = v;
    }
    return next;
  };

  let state = stateWith({ status: "running" });
  state = apply(state, eventToOps("Stop", { session_id: "s1" }, state));
  assertEquals(state.status, "idle");

  state = apply(
    state,
    eventToOps(
      "PreToolUse",
      {
        session_id: "s1",
        agent_id: "a1",
        agent_type: "Explore",
        tool_name: "Bash",
      },
      state,
    ),
  );
  assertEquals(state.status, "running");
  assertEquals(state.subagents, "Explore:a1");
  assertEquals(state.mainStopped, true);

  state = apply(
    state,
    eventToOps("SubagentStop", { session_id: "s1", agent_id: "a1" }, state),
  );
  assertEquals(state.status, "idle");
  assertEquals(state.subagents, "");
  assertEquals(state.mainStopped, false);
});

test("teammate sequence: lead Stop→idle, teammate tool events (main-shaped)→running, teammate Stop→idle", () => {
  // Teammates are sibling full sessions multiplexed onto the same pane. Their
  // tool events carry no agent_id and no UserPromptSubmit precedes them, so
  // idle-resume is the only recovery path for the display.
  const apply = (state: PaneState, ops: Op[]): PaneState => {
    const next = { ...state };
    for (const op of ops) {
      const v = op.kind === "set" ? op.value : "";
      if (op.key === "@pane_status") next.status = v;
      if (op.key === "@pane_subagents") next.subagents = v;
      if (op.key === "@pane_main_stopped") next.mainStopped = v === "1";
      if (op.key === "@pane_wait_reason") next.waitReason = v;
    }
    return next;
  };

  let state = stateWith({ status: "running" });
  state = apply(state, eventToOps("Stop", { session_id: "lead" }, state));
  assertEquals(state.status, "idle");

  state = apply(
    state,
    eventToOps(
      "PreToolUse",
      { session_id: "teammate", tool_name: "Bash" },
      state,
    ),
  );
  assertEquals(state.status, "running");

  state = apply(
    state,
    eventToOps(
      "PostToolUse",
      { session_id: "teammate", tool_name: "Bash" },
      state,
    ),
  );
  assertEquals(state.status, "running");

  state = apply(state, eventToOps("Stop", { session_id: "teammate" }, state));
  assertEquals(state.status, "idle");
});

// --- @pane_main_stopped: Stop-with-subagents → drain → idle transition ---

test("main_stopped: SubagentStop drains to empty with mainStopped=true → idle + unset flag", () => {
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

test("main_stopped: SubagentStop drains to empty with mainStopped=false → no idle transition", () => {
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
  assertEquals(
    statusOp,
    undefined,
    "status must not change without mainStopped",
  );
  const flagOp = ops.find((o) => o.key === "@pane_main_stopped");
  assertEquals(flagOp, undefined);
});

test("main_stopped: SubagentStop non-drain (next still non-empty) with mainStopped=true → no idle transition yet", () => {
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

test("main_stopped: UserPromptSubmit unsets @pane_main_stopped (fresh main invocation)", () => {
  const ops = eventToOps(
    "UserPromptSubmit",
    { session_id: "s1", prompt: "hi" },
    stateWith({ status: "idle", mainStopped: true }),
  );
  const flagOp = ops.find((o) => o.key === "@pane_main_stopped");
  assertEquals(flagOp?.kind, "unset");
});

test("main_stopped: SessionStart clears @pane_main_stopped (STALE_AT_SESSION_START)", () => {
  const ops = eventToOps(
    "SessionStart",
    { session_id: "sess-1" },
    stateWith({ mainStopped: true }),
  );
  const flagOp = ops.find((o) => o.key === "@pane_main_stopped");
  assertEquals(flagOp?.kind, "unset");
});

test("main_stopped: ALL_PANE_OPTIONS includes @pane_main_stopped (drain completeness)", () => {
  assertEquals(ALL_PANE_OPTIONS.includes("@pane_main_stopped" as never), true);
});

test("context_used_pct: ALL_PANE_OPTIONS includes @pane_context_used_pct (drain completeness)", () => {
  assertEquals(
    ALL_PANE_OPTIONS.includes("@pane_context_used_pct" as never),
    true,
  );
});

test("main_stopped: SubagentStop drain path (pendingTeardown=true + last subagent) still ALL_PANE_OPTIONS unset only", () => {
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
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
});

test("resume: SubagentStop drain with status=waiting still returns ALL_PANE_OPTIONS unset only (no resume leakage)", () => {
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
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
  // resume op (which includes `set @pane_status running`) must be absent
  const anySet = ops.some((o) => o.kind === "set");
  assertEquals(anySet, false);
});

// --- extractToolSubject ---

test("extractToolSubject: non-object tool_input → empty", () => {
  assertEquals(extractToolSubject("Bash", null), "");
  assertEquals(extractToolSubject("Bash", undefined), "");
  assertEquals(extractToolSubject("Bash", "string"), "");
  assertEquals(extractToolSubject("Bash", []), "");
});

test("extractToolSubject: Bash takes command", () => {
  assertEquals(
    extractToolSubject("Bash", { command: "pnpm test" }),
    "pnpm test",
  );
});

test("extractToolSubject: Bash truncates at 24 chars with ellipsis", () => {
  const out = extractToolSubject("Bash", {
    command: "x".repeat(30),
  });
  assertEquals(out.length, 25); // 24 x + single '…'
  assertStringIncludes(out, "…");
});

test("extractToolSubject: Bash collapses TAB/CR/LF to space", () => {
  assertEquals(
    extractToolSubject("Bash", { command: "echo\tfoo\nbar" }),
    "echo foo bar",
  );
});

test("extractToolSubject: Edit-family returns empty (delegates to @pane_last_edit_file)", () => {
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

test("extractToolSubject: Read extracts basename from file_path", () => {
  assertEquals(
    extractToolSubject("Read", { file_path: "/a/b/c.md" }),
    "c.md",
  );
  assertEquals(
    extractToolSubject("Read", { file_path: "plain.txt" }),
    "plain.txt",
  );
  assertEquals(extractToolSubject("Read", { file_path: "" }), "");
});

test("extractToolSubject: Grep takes pattern", () => {
  assertEquals(
    extractToolSubject("Grep", { pattern: "foo.*bar" }),
    "foo.*bar",
  );
});

test("extractToolSubject: Glob takes pattern", () => {
  assertEquals(
    extractToolSubject("Glob", { pattern: "**/*.ts" }),
    "**/*.ts",
  );
});

test("extractToolSubject: WebFetch extracts host from url", () => {
  assertEquals(
    extractToolSubject("WebFetch", { url: "https://example.com/path?q=1" }),
    "example.com",
  );
});

test("extractToolSubject: WebFetch invalid url → empty", () => {
  assertEquals(
    extractToolSubject("WebFetch", { url: "not a url" }),
    "",
  );
});

test("extractToolSubject: Task joins subagent_type / description with /", () => {
  assertEquals(
    extractToolSubject("Task", {
      subagent_type: "qa-planner",
      description: "test the foo",
    }),
    "qa-planner/test the foo",
  );
});

test("extractToolSubject: Task with only subagent_type", () => {
  assertEquals(
    extractToolSubject("Task", { subagent_type: "Explore" }),
    "Explore",
  );
});

test("extractToolSubject: Task with only description", () => {
  assertEquals(
    extractToolSubject("Task", { description: "research X" }),
    "research X",
  );
});

test("extractToolSubject: Skill takes skill name", () => {
  assertEquals(
    extractToolSubject("Skill", { skill: "plan" }),
    "plan",
  );
});

test("extractToolSubject: MCP extracts server from tool_name", () => {
  assertEquals(
    extractToolSubject("mcp__claude_ai_Gmail__search_threads", {}),
    "mcp: claude_ai_Gmail",
  );
});

test("extractToolSubject: malformed MCP tool_name (no third segment) → empty", () => {
  assertEquals(extractToolSubject("mcp__only", {}), "");
});

test("extractToolSubject: unknown tool → empty", () => {
  assertEquals(extractToolSubject("UnknownTool", { foo: "bar" }), "");
});

// --- extractToolError ---

test("extractToolError: undefined / null → empty", () => {
  assertEquals(extractToolError(undefined), "");
  assertEquals(extractToolError(null), "");
});

test("extractToolError: success object (Bash) → empty", () => {
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

test("extractToolError: success object (Edit) → empty", () => {
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

test("extractToolError: Bash failure string strips 'Error: ' prefix", () => {
  assertEquals(
    extractToolError("Error: Exit code 2\nerr-to-stderr"),
    "Exit code 2 err-to-stderr",
  );
});

test("extractToolError: Edit failure string strips 'Error: ' prefix", () => {
  assertEquals(
    extractToolError("Error: String to replace not found in file."),
    "String to replace not found in file.",
  );
});

test("extractToolError: long failure string truncated to 40 chars with ellipsis", () => {
  const raw = "Error: " + "x".repeat(60);
  const out = extractToolError(raw);
  assertEquals(out.length, 41); // 40 x + single '…'
  assertStringIncludes(out, "…");
});

test("extractToolError: object with interrupted=true → 'interrupted'", () => {
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

test("extractToolError: empty string → empty", () => {
  assertEquals(extractToolError(""), "");
});

test("extractToolError: array → empty (defensive)", () => {
  assertEquals(extractToolError([1, 2, 3]), "");
});

test("extractToolError: strips ESC/NUL/BEL control bytes (terminal-escape injection defense)", () => {
  // A Bash command like `echo $'\x1b[2J'` produces failure output containing
  // the raw ESC byte. Without stripping, Agentower rendering would execute the
  // escape sequence (clear screen, title change, etc).
  const raw = "Error: \x1b[2Jmalicious\x07text\x00here";
  const out = extractToolError(raw);
  assertEquals(out.includes("\x1b"), false, "ESC must be stripped");
  assertEquals(out.includes("\x07"), false, "BEL must be stripped");
  assertEquals(out.includes("\x00"), false, "NUL must be stripped");
});

test("extractToolSubject: strips control bytes (terminal-escape injection defense)", () => {
  const out = extractToolSubject("Bash", {
    command: "echo \x1b[2Jfoo\x07",
  });
  assertEquals(out.includes("\x1b"), false);
  assertEquals(out.includes("\x07"), false);
});

// --- PreToolUse subject set/unset ---

test("eventToOps: PreToolUse (Bash) sets @pane_current_tool_subject", () => {
  const ops = eventToOps(
    "PreToolUse",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
    },
    emptyState,
  );
  const subject = ops.find((o) => o.key === "@pane_current_tool_subject");
  assertEquals(subject?.kind === "set" ? subject.value : "", "pnpm test");
});

test("eventToOps: PreToolUse (Edit) unsets @pane_current_tool_subject (Edit-family empty)", () => {
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

test("eventToOps: PreToolUse with no tool_input unsets @pane_current_tool_subject", () => {
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", tool_name: "Bash" },
    emptyState,
  );
  const subject = ops.find((o) => o.key === "@pane_current_tool_subject");
  assertEquals(subject?.kind, "unset");
});

// --- PostToolUse subject + error set/unset ---

test("eventToOps: PostToolUse (Bash) sets last_tool_subject, unsets last_tool_error on success", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
      tool_response: { stdout: "ok", stderr: "", interrupted: false },
    },
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "Bash",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const subject = ops.find((o) => o.key === "@pane_last_tool_subject");
  assertEquals(subject?.kind === "set" ? subject.value : "", "pnpm test");
  const error = ops.find((o) => o.key === "@pane_last_tool_error");
  assertEquals(error?.kind, "unset");
});

test("eventToOps: PostToolUse (Bash failure) sets last_tool_error from string response", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "false" },
      tool_response: "Error: Exit code 1",
    },
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "Bash",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const error = ops.find((o) => o.key === "@pane_last_tool_error");
  assertEquals(error?.kind === "set" ? error.value : "", "Exit code 1");
});

test("eventToOps: PostToolUse (Edit-family) unsets last_tool_subject (delegates to last_edit_file)", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Edit",
      tool_input: { file_path: "/x/y.ts" },
      tool_response: { type: "update", filePath: "/x/y.ts", content: "..." },
    },
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "Edit",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const subject = ops.find((o) => o.key === "@pane_last_tool_subject");
  assertEquals(subject?.kind, "unset");
  // last_edit_file is still set via existing path
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind === "set" ? lastFile.value : "", "/x/y.ts");
});

test("eventToOps: PostToolUse matching current tool also unsets @pane_current_tool_subject", () => {
  const ops = eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "echo ok" },
      tool_response: { stdout: "ok", stderr: "", interrupted: false },
    },
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "Bash",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const currentSubject = ops.find(
    (o) => o.key === "@pane_current_tool_subject",
  );
  assertEquals(currentSubject?.kind, "unset");
});

test("eventToOps: PostToolUse NOT matching current tool leaves @pane_current_tool_subject untouched", () => {
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
    {
      subagents: "",
      pendingTeardown: false,
      currentTool: "Edit",
      status: "",
      mainStopped: false,
      waitReason: "",
      lastActivityAt: "",
      background: "",
      backgroundUntil: "",
      permissionAgents: "",
    },
  );
  const currentSubjectOps = ops.filter(
    (o) => o.key === "@pane_current_tool_subject",
  );
  assertEquals(currentSubjectOps.length, 0);
});

// --- SessionStart / SessionEnd drain includes new options ---

test("eventToOps: SessionStart unsets new 3 options (current/last subject + last error)", () => {
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

test("eventToOps: SessionEnd drain includes new 3 options", () => {
  const ops = eventToOps("SessionEnd", { session_id: "s1" }, {
    subagents: "",
    pendingTeardown: false,
    currentTool: "",
    status: "",
    mainStopped: false,
    waitReason: "",
    lastActivityAt: "",
    background: "",
    backgroundUntil: "",
    permissionAgents: "",
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
    background: null,
  };
}

const FIXED_NOW = new Date("2026-04-20T12:34:56.789Z");

test("buildLogRecord: minimal early-exit (no-event) is fully null-safe", () => {
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

test("buildLogRecord: agent_id captured verbatim for subagent-origin events", () => {
  // Production verifiability: log inspection (rg agent_id) must be able to
  // surface the resumeOpsIfStuck attribution invariant from real traffic.
  const ctx = baseCtx();
  ctx.argv_event = "PreToolUse";
  ctx.agent_id = "explore-1234";
  const rec = buildLogRecord(ctx, FIXED_NOW, 1);
  assertEquals(rec.agent_id, "explore-1234");
});

test("buildLogRecord: agent_id null for main-origin events", () => {
  const ctx = baseCtx();
  ctx.argv_event = "PreToolUse";
  // ctx.agent_id stays null (default)
  const rec = buildLogRecord(ctx, FIXED_NOW, 1);
  assertEquals(rec.agent_id, null);
});

test("buildLogRecord: ops are stripped of value (PII safety)", () => {
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

test("buildLogRecord: apply_results pass through verbatim incl. stderr", () => {
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

test("buildLogRecord: pre_state and stdin_event_mismatch preserved", () => {
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
    waitReason: "",
    lastActivityAt: "",
    background: "",
    backgroundUntil: "",
    permissionAgents: "",
  };
  ctx.pre_state = state;
  const rec = buildLogRecord(ctx, FIXED_NOW, 1);
  assertEquals(rec.stdin_event, "PostToolUse");
  assertEquals(rec.stdin_event_mismatch, true);
  assertEquals(rec.pre_state, state);
});

test("buildLogRecord: output is JSON-serializable (no cycles/undefined)", () => {
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
  waitReason: "",
  lastActivityAt: "",
  background: "",
  backgroundUntil: "",
  permissionAgents: "",
};

test("Phase B.1 fixture: SessionStart with cwd", () => {
  const ops = b1Normalize(
    eventToOps(
      "SessionStart",
      { session_id: "test-sid", cwd: "/repo" },
      b1State,
    ),
  );
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
    { kind: "unset", key: "@pane_background" },
    { kind: "unset", key: "@pane_background_until" },
    { kind: "unset", key: "@pane_permission_agents" },
    { kind: "set", key: "@pane_status", value: "idle" },
    { kind: "set", key: "@pane_last_activity_at", value: "<NORMALIZED>" },
  ]);
});

test("Phase B.1 fixture: UserPromptSubmit with prompt", () => {
  const ops = b1Normalize(
    eventToOps("UserPromptSubmit", {
      session_id: "test-sid",
      cwd: "/repo",
      prompt: "do the thing",
    }, b1State),
  );
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "claude" },
    { kind: "set", key: "@pane_session_id", value: "test-sid" },
    { kind: "set", key: "@pane_cwd", value: "/repo" },
    { kind: "unset", key: "@pane_background" },
    { kind: "unset", key: "@pane_background_until" },
    { kind: "set", key: "@pane_status", value: "running" },
    { kind: "set", key: "@pane_started_at", value: "<NORMALIZED>" },
    { kind: "set", key: "@pane_last_activity_at", value: "<NORMALIZED>" },
    { kind: "unset", key: "@pane_main_stopped" },
    { kind: "set", key: "@pane_prompt", value: "do the thing" },
  ]);
});

test("Phase B.1 fixture: PreToolUse Bash with subject", () => {
  const ops = b1Normalize(
    eventToOps("PreToolUse", {
      session_id: "test-sid",
      cwd: "/repo",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
    }, b1State),
  );
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "claude" },
    { kind: "set", key: "@pane_session_id", value: "test-sid" },
    { kind: "set", key: "@pane_cwd", value: "/repo" },
    { kind: "set", key: "@pane_current_tool", value: "Bash" },
    { kind: "set", key: "@pane_current_tool_subject", value: "ls -la" },
  ]);
});

test("Phase B.1 fixture: PostToolUse Bash success", () => {
  const ops = b1Normalize(
    eventToOps("PostToolUse", {
      session_id: "test-sid",
      cwd: "/repo",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
      tool_response: { stdout: "out", exit_code: 0 },
    }, { ...b1State, currentTool: "Bash" }),
  );
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

test("Phase B.1 fixture: PostToolUse Bash error", () => {
  const ops = b1Normalize(
    eventToOps("PostToolUse", {
      session_id: "test-sid",
      cwd: "/repo",
      tool_name: "Bash",
      tool_input: { command: "false" },
      tool_response: "Error: command failed",
    }, { ...b1State, currentTool: "Bash" }),
  );
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

test("Phase B.1 fixture: Stop with no subagents", () => {
  const ops = b1Normalize(
    eventToOps("Stop", { session_id: "test-sid", cwd: "/repo" }, b1State),
  );
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "claude" },
    { kind: "set", key: "@pane_session_id", value: "test-sid" },
    { kind: "set", key: "@pane_cwd", value: "/repo" },
    { kind: "unset", key: "@pane_background" },
    { kind: "unset", key: "@pane_background_until" },
    { kind: "set", key: "@pane_status", value: "idle" },
    { kind: "unset", key: "@pane_main_stopped" },
  ]);
});

test("Phase B.1 fixture: SessionEnd drain", () => {
  const ops = b1Normalize(
    eventToOps("SessionEnd", { session_id: "test-sid", cwd: "/repo" }, b1State),
  );
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
    { kind: "unset", key: "@pane_background" },
    { kind: "unset", key: "@pane_background_until" },
    { kind: "unset", key: "@pane_permission_agents" },
  ]);
});

test("Phase B.1 fixture: Notification permission_prompt", () => {
  const ops = b1Normalize(
    eventToOps("Notification", {
      session_id: "test-sid",
      cwd: "/repo",
      notification_type: "permission_prompt",
    }, b1State),
  );
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "claude" },
    { kind: "set", key: "@pane_session_id", value: "test-sid" },
    { kind: "set", key: "@pane_cwd", value: "/repo" },
    { kind: "set", key: "@pane_status", value: "waiting" },
    { kind: "set", key: "@pane_wait_reason", value: "permission" },
  ]);
});

test("Phase B.1 fixture: SubagentStart with fixed agent_id", () => {
  const ops = b1Normalize(
    eventToOps("SubagentStart", {
      session_id: "test-sid",
      cwd: "/repo",
      agent_id: "test-agent-id",
      subagent_type: "Plan",
    }, b1State),
  );
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "claude" },
    { kind: "set", key: "@pane_session_id", value: "test-sid" },
    { kind: "set", key: "@pane_cwd", value: "/repo" },
    { kind: "set", key: "@pane_subagents", value: "subagent:test-agent-id" },
  ]);
});

test("Phase B.1 fixture: StopFailure rate_limit", () => {
  const ops = b1Normalize(
    eventToOps("StopFailure", {
      session_id: "test-sid",
      cwd: "/repo",
      error_type: "rate_limit",
    }, b1State),
  );
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "claude" },
    { kind: "set", key: "@pane_session_id", value: "test-sid" },
    { kind: "set", key: "@pane_cwd", value: "/repo" },
    { kind: "set", key: "@pane_status", value: "error" },
    { kind: "set", key: "@pane_wait_reason", value: "rate_limit" },
  ]);
});

// --- PreToolUse: user-input pause tools (AskUserQuestion / ExitPlanMode) ---
// These tools pause the agent for user input. PreToolUse must flip status to
// waiting immediately so Agentower no longer shows "run" while paused. Without
// this, the pane only flips to wait if a delayed Notification(elicitation_dialog)
// happens to fire.

test(
  "eventToOps: PreToolUse(AskUserQuestion) main-origin → waiting + 'question'",
  () => {
    const ops = eventToOps(
      "PreToolUse",
      { session_id: "s1", tool_name: "AskUserQuestion" },
      stateWith({ status: "running" }),
    );
    const status = ops.find((o) => o.key === "@pane_status");
    assertEquals(status?.kind === "set" ? status.value : "", "waiting");
    const reason = ops.find((o) => o.key === "@pane_wait_reason");
    assertEquals(reason?.kind === "set" ? reason.value : "", "question");
    const toolOp = ops.find((o) => o.key === "@pane_current_tool");
    assertEquals(
      toolOp?.kind === "set" ? toolOp.value : "",
      "AskUserQuestion",
    );
  },
);

test(
  "eventToOps: PreToolUse(ExitPlanMode) main-origin → waiting + 'plan review'",
  () => {
    const ops = eventToOps(
      "PreToolUse",
      { session_id: "s1", tool_name: "ExitPlanMode" },
      stateWith({ status: "running" }),
    );
    const status = ops.find((o) => o.key === "@pane_status");
    assertEquals(status?.kind === "set" ? status.value : "", "waiting");
    const reason = ops.find((o) => o.key === "@pane_wait_reason");
    assertEquals(reason?.kind === "set" ? reason.value : "", "plan review");
    const toolOp = ops.find((o) => o.key === "@pane_current_tool");
    assertEquals(toolOp?.kind === "set" ? toolOp.value : "", "ExitPlanMode");
  },
);

test(
  "eventToOps: PreToolUse(AskUserQuestion) subagent-origin → NO waiting flip",
  () => {
    // Subagents cannot legitimately invoke AskUserQuestion in normal flow.
    // Defensive: agent_id present (subagent-origin) must NOT flip main-pane
    // status to waiting.
    const ops = eventToOps(
      "PreToolUse",
      {
        session_id: "s1",
        agent_id: "a1",
        agent_type: "Explore",
        tool_name: "AskUserQuestion",
      },
      stateWith({ status: "running", subagents: "Explore:a1" }),
    );
    const status = ops.find((o) => o.key === "@pane_status");
    // Either no status op, or status is unchanged (not "waiting").
    assertEquals(status, undefined);
    const reason = ops.find((o) => o.key === "@pane_wait_reason");
    assertEquals(reason, undefined);
    // current_tool is still recorded (tool display is last-wins).
    const toolOp = ops.find((o) => o.key === "@pane_current_tool");
    assertEquals(
      toolOp?.kind === "set" ? toolOp.value : "",
      "AskUserQuestion",
    );
  },
);

test(
  "eventToOps: PostToolUse(AskUserQuestion) with status=waiting → resume to running",
  () => {
    const ops = eventToOps(
      "PostToolUse",
      { session_id: "s1", tool_name: "AskUserQuestion" },
      stateWith({ status: "waiting", currentTool: "AskUserQuestion" }),
    );
    const status = ops.find((o) =>
      o.kind === "set" && o.key === "@pane_status"
    );
    assertEquals(status?.kind === "set" ? status.value : "", "running");
    const reason = ops.find((o) => o.key === "@pane_wait_reason");
    assertEquals(reason?.kind, "unset");
  },
);

test(
  "eventToOps: PostToolUse(ExitPlanMode) with status=waiting → resume to running",
  () => {
    const ops = eventToOps(
      "PostToolUse",
      { session_id: "s1", tool_name: "ExitPlanMode" },
      stateWith({ status: "waiting", currentTool: "ExitPlanMode" }),
    );
    const status = ops.find((o) =>
      o.kind === "set" && o.key === "@pane_status"
    );
    assertEquals(status?.kind === "set" ? status.value : "", "running");
  },
);

test("parseShowOptions undoes tmux's quoting of pane option values", () => {
  const out = [
    "@pane_status running",
    '@pane_wait_reason "idle prompt"',
    '@pane_b "say \\"hi\\" \\$HOME \\\\x;"',
    "@pane_d tab\\tand\\nnewline",
    '@pane_e "it\'s"',
    "@pane_f ''",
    "",
  ].join("\n");
  const map = parseShowOptions(out);
  assertEquals(map.get("@pane_status"), "running");
  assertEquals(map.get("@pane_wait_reason"), "idle prompt");
  assertEquals(map.get("@pane_b"), 'say "hi" $HOME \\x;');
  assertEquals(map.get("@pane_d"), "tab\tand\nnewline");
  assertEquals(map.get("@pane_e"), "it's");
  assertEquals(map.get("@pane_f"), "");
  assertEquals(map.has("@pane_absent"), false);
});

test("chainSetArgs output stores a value ending in ; intact in a real tmux", async () => {
  const server = `chain-set-test-${process.pid}`;
  const tmux = (...argv: string[]) => run("tmux", ["-L", server, ...argv]);
  assertEquals(
    (await tmux("-f", "/dev/null", "new-session", "-d", "-s", "t")).code,
    0,
  );
  try {
    const pane = (await tmux("display", "-p", "-t", "t", "#{pane_id}")).stdout
      .trim();
    const set = await tmux(...chainSetArgs(pane, [
      { kind: "set", key: "@pane_a", value: "ls;" },
      { kind: "set", key: "@pane_b", value: ";" },
      { kind: "set", key: "@pane_c", value: "plain" },
    ]));
    assertEquals(set.code, 0, set.stderr);
    const options = parseShowOptions(
      (await tmux("show-options", "-p", "-t", pane)).stdout,
    );
    assertEquals(options.get("@pane_a"), "ls;");
    assertEquals(options.get("@pane_b"), ";");
    assertEquals(options.get("@pane_c"), "plain");
  } finally {
    await tmux("kill-server");
  }
});

test("chainSetArgs joins ops with a lone ; and escapes a value ending in ;", () => {
  assertEquals(
    chainSetArgs("%3", [
      { kind: "set", key: "@pane_status", value: "running" },
      { kind: "unset", key: "@pane_wait_reason" },
      { kind: "set", key: "@pane_prompt", value: "ls;" },
    ]),
    [
      "set",
      "-t",
      "%3",
      "-p",
      "@pane_status",
      "running",
      ";",
      "set",
      "-t",
      "%3",
      "-p",
      "-u",
      "@pane_wait_reason",
      ";",
      "set",
      "-t",
      "%3",
      "-p",
      "@pane_prompt",
      "ls\\;",
    ],
  );
});

// --- Background wait ---

const nowS = () => Math.floor(Date.now() / 1000);
const shellsProbe = (entries: [string, ShellProbe][]) => ({
  shells: new Map(entries),
  cronNextSec: new Map<string, number>(),
});
const shell = (id: string, command = "sleep 60") => ({
  id,
  type: "shell",
  status: "running",
  description: "",
  command,
});

test("backgroundWait: nothing in flight → null", () => {
  assertEquals(
    backgroundWait({ background_tasks: [], session_crons: [] }, NO_PROBE, 100),
    null,
  );
});

test("backgroundWait: agent and shell → summary, no deadline", () => {
  const out = backgroundWait(
    {
      background_tasks: [
        {
          id: "a1",
          type: "subagent",
          status: "running",
          agent_type: "Explore",
        },
        shell("b1"),
      ],
    },
    shellsProbe([["b1", {
      ports: [],
      headlessClient: false,
      startedAtSec: 90,
    }]]),
    100,
  );
  assertEquals(out, { summary: "agent 1 · shell 1", untilSec: null });
});

test("backgroundWait: shell alone is capped from its start", () => {
  const out = backgroundWait(
    { background_tasks: [shell("b1"), shell("b2")] },
    shellsProbe([
      ["b1", { ports: [], headlessClient: false, startedAtSec: 50 }],
      ["b2", { ports: [], headlessClient: false, startedAtSec: 90 }],
    ]),
    100,
  );
  assertEquals(out, {
    summary: "shell 2",
    untilSec: 90 + BACKGROUND_SHELL_CAP_SECONDS,
  });
});

test("backgroundWait: listening shell (a server left for the user) is not counted", () => {
  assertEquals(
    backgroundWait(
      { background_tasks: [shell("b1", "pnpm dev")] },
      shellsProbe([["b1", {
        ports: [5173],
        headlessClient: false,
        startedAtSec: 90,
      }]]),
      100,
    ),
    null,
  );
});

test("backgroundWait: shell past the cap is not counted", () => {
  assertEquals(
    backgroundWait(
      { background_tasks: [shell("b1")] },
      shellsProbe([["b1", {
        ports: [],
        headlessClient: false,
        startedAtSec: 0,
      }]]),
      BACKGROUND_SHELL_CAP_SECONDS,
    ),
    null,
  );
});

test("backgroundWait: shell missing from the process table is capped from now", () => {
  assertEquals(
    backgroundWait({ background_tasks: [shell("b1")] }, NO_PROBE, 100),
    { summary: "shell 1", untilSec: 100 + BACKGROUND_SHELL_CAP_SECONDS },
  );
});

test("backgroundWait: an artifact comment watch is not counted", () => {
  const watch = {
    id: "w1",
    type: "monitor",
    status: "running",
    description:
      "live updates for artifact https://claude.ai/artifact/x (auto-armed on publish)",
  };
  assertEquals(
    backgroundWait({ background_tasks: [watch] }, NO_PROBE, 100),
    null,
  );
  assertEquals(
    backgroundWait(
      {
        background_tasks: [watch, {
          id: "a1",
          type: "subagent",
          status: "running",
        }],
      },
      NO_PROBE,
      100,
    ),
    { summary: "agent 1", untilSec: null },
  );
});

test("backgroundWait: a Monitor command or an MCP monitor still counts", () => {
  const monitor = {
    id: "b1",
    type: "monitor",
    status: "running",
    description: "CI",
    command: "gh run watch 1",
  };
  const mcp = {
    id: "m1",
    type: "monitor",
    status: "running",
    description: "",
    server: "s",
    tool: "t",
  };
  assertEquals(
    backgroundWait({ background_tasks: [monitor, mcp] }, NO_PROBE, 100),
    { summary: "monitor 2", untilSec: 100 + BACKGROUND_SHELL_CAP_SECONDS },
  );
});

test("backgroundWait: a cron counts until shortly after its next fire", () => {
  const crons = {
    background_tasks: [],
    session_crons: [{ id: "c1", schedule: "*/5 * * * *", recurring: true }],
  };
  assertEquals(
    backgroundWait(
      crons,
      { shells: new Map(), cronNextSec: new Map([["c1", 400]]) },
      100,
    ),
    { summary: "cron 1", untilSec: 400 + 15 * 60 },
  );
});

test("backgroundWait: a cron that fires after the cap is not counted", () => {
  const crons = {
    session_crons: [{ id: "c1", schedule: "0 9 * * *", recurring: true }],
  };
  assertEquals(
    backgroundWait(
      crons,
      {
        shells: new Map(),
        cronNextSec: new Map([["c1", 100 + BACKGROUND_SHELL_CAP_SECONDS + 1]]),
      },
      100,
    ),
    null,
  );
});

test("backgroundWait: a cron whose schedule did not parse counts with the cap", () => {
  assertEquals(
    backgroundWait(
      { session_crons: [{ id: "c1", schedule: "bogus" }] },
      NO_PROBE,
      100,
    ),
    { summary: "cron 1", untilSec: 100 + BACKGROUND_SHELL_CAP_SECONDS },
  );
});

test("backgroundWait: finished tasks are skipped", () => {
  assertEquals(
    backgroundWait(
      {
        background_tasks: [{ ...shell("b1"), status: "completed" }],
      },
      NO_PROBE,
      100,
    ),
    null,
  );
});

test("eventToOps: Stop asking the user while work runs → waiting / question", () => {
  for (const last of ["どちらにしますか？", "Which one?", "進めますか？**"]) {
    const ops = eventToOps(
      "Stop",
      {
        background_tasks: [{ id: "a1", type: "subagent", status: "running" }],
        last_assistant_message: last,
      },
      stateWith({ status: "running" }),
    );
    const value = (key: string) => {
      const op = ops.find((o) => o.key === key);
      return op?.kind === "set" ? op.value : "";
    };
    assertEquals(
      [value("@pane_status"), value("@pane_wait_reason")],
      ["waiting", "question"],
      last,
    );
    assertEquals(ops.find((o) => o.key === "@pane_background")?.kind, "unset");
    assertEquals(
      ops.find((o) => o.key === "@pane_main_stopped")?.kind,
      "unset",
    );
  }
});

test("eventToOps: Stop asking the user while only a listed subagent runs → waiting / question", () => {
  const ops = eventToOps(
    "Stop",
    { last_assistant_message: "Keep both?" },
    stateWith({ status: "running", subagents: "Explore:a1" }),
  );
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "waiting");
  assertEquals(
    ops.some((o) => o.kind === "set" && o.key === "@pane_main_stopped"),
    false,
  );
});

test("eventToOps: Stop asking the user with nothing running → idle as before", () => {
  const ops = eventToOps(
    "Stop",
    { background_tasks: [], last_assistant_message: "Commit?" },
    stateWith({ status: "running" }),
  );
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "idle");
});

test("eventToOps: the question survives idle_prompt and subagent activity", () => {
  const asked = stateWith({
    status: "waiting",
    waitReason: "question",
    subagents: "Explore:a1",
    lastActivityAt: "1",
  });
  assertEquals(
    eventToOps("Notification", { notification_type: "idle_prompt" }, asked),
    [],
  );
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s", agent_id: "a1", tool_name: "Read", tool_input: {} },
    asked,
  );
  assertEquals(ops.some((o) => o.key === "@pane_status"), false);
  const stop = eventToOps(
    "SubagentStop",
    { session_id: "s", agent_id: "a1" },
    asked,
  );
  assertEquals(stop.some((o) => o.key === "@pane_status"), false);
});

test("backgroundWait: a shell listening on an ephemeral port is a job", () => {
  assertEquals(
    backgroundWait(
      { background_tasks: [shell("b1", "bun render.ts")] },
      shellsProbe([["b1", {
        ports: [59487],
        headlessClient: false,
        startedAtSec: 90,
      }]]),
      100,
    ),
    { summary: "shell 1", untilSec: 90 + BACKGROUND_SHELL_CAP_SECONDS },
  );
});

test("backgroundWait: a fixed port with a headless browser client is a job", () => {
  assertEquals(
    backgroundWait(
      { background_tasks: [shell("b1", "pnpm test:e2e")] },
      shellsProbe([["b1", {
        ports: [8787],
        headlessClient: true,
        startedAtSec: 90,
      }]]),
      100,
    ),
    { summary: "shell 1", untilSec: 90 + BACKGROUND_SHELL_CAP_SECONDS },
  );
});

test("backgroundWait: a fixed port beside an ephemeral one is a server", () => {
  assertEquals(
    backgroundWait(
      { background_tasks: [shell("b1", "wrangler dev")] },
      shellsProbe([["b1", {
        ports: [8787, 59000],
        headlessClient: false,
        startedAtSec: 90,
      }]]),
      100,
    ),
    null,
  );
});

test("eventToOps: Stop with background work → running + summary, main_stopped unset", () => {
  const ops = eventToOps(
    "Stop",
    { background_tasks: [{ id: "a1", type: "subagent", status: "running" }] },
    stateWith({ status: "running", subagents: "Explore:a1" }),
  );
  assertEquals(ops, [
    { kind: "set", key: "@pane_status", value: "running" },
    { kind: "unset", key: "@pane_wait_reason" },
    { kind: "unset", key: "@pane_main_stopped" },
    { kind: "set", key: "@pane_background", value: "agent 1" },
    { kind: "unset", key: "@pane_background_until" },
  ]);
});

test("eventToOps: Stop with a capped shell records the deadline", () => {
  const started = nowS() - 10;
  const ops = eventToOps(
    "Stop",
    { background_tasks: [shell("b1")] },
    stateWith({ status: "running" }),
    shellsProbe([["b1", {
      ports: [],
      headlessClient: false,
      startedAtSec: started,
    }]]),
  );
  const until = ops.find((o) => o.key === "@pane_background_until");
  assertEquals(
    until?.kind === "set" ? until.value : "",
    String(started + BACKGROUND_SHELL_CAP_SECONDS),
  );
});

test("eventToOps: Stop with only a listening shell → idle", () => {
  const ops = eventToOps(
    "Stop",
    { background_tasks: [shell("b1", "pnpm dev")] },
    stateWith({ status: "running", background: "shell 1" }),
    shellsProbe([["b1", {
      ports: [5173],
      headlessClient: false,
      startedAtSec: nowS(),
    }]]),
  );
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "idle");
  assertEquals(ops.find((o) => o.key === "@pane_background")?.kind, "unset");
});

test("eventToOps: idle_prompt while waiting on background work → no-op", () => {
  assertEquals(
    eventToOps(
      "Notification",
      { notification_type: "idle_prompt", session_id: "s1" },
      stateWith({ status: "running", background: "shell 1" }),
    ),
    [],
  );
});

test("eventToOps: permission_prompt while waiting on background work still waits", () => {
  const ops = eventToOps(
    "Notification",
    { notification_type: "permission_prompt" },
    stateWith({ status: "running", background: "agent 1" }),
  );
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "waiting");
});

test("eventToOps: self-resume keeps the user's prompt and start time", () => {
  for (
    const prompt of [
      "<task-notification>\n<task-id>b1</task-id>",
      '<agent-message from="a1">\n[Subagent hand-back]',
    ]
  ) {
    const ops = eventToOps(
      "UserPromptSubmit",
      { prompt },
      stateWith({ status: "running", background: "shell 1" }),
    );
    const keys = ops.map((o) => `${o.kind} ${o.key}`);
    assertEquals(keys.includes("set @pane_prompt"), false);
    assertEquals(keys.includes("unset @pane_prompt"), false);
    assertEquals(keys.includes("set @pane_started_at"), false);
    assertEquals(keys.includes("unset @pane_background"), true);
    const status = ops.find((o) => o.key === "@pane_status");
    assertEquals(status?.kind === "set" ? status.value : "", "running");
  }
});

test("eventToOps: a user prompt clears the background summary", () => {
  const ops = eventToOps(
    "UserPromptSubmit",
    { prompt: "next" },
    stateWith({ status: "running", background: "shell 1" }),
  );
  assertEquals(ops.find((o) => o.key === "@pane_background")?.kind, "unset");
  const prompt = ops.find((o) => o.key === "@pane_prompt");
  assertEquals(prompt?.kind === "set" ? prompt.value : "", "next");
});

test("parseEtime: mm:ss, hh:mm:ss, dd-hh:mm:ss", () => {
  assertEquals(parseEtime("00:02"), 2);
  assertEquals(parseEtime("01:06:57"), 4017);
  assertEquals(parseEtime("2-01:00:00"), 2 * 86400 + 3600);
  assertEquals(parseEtime("garbage"), null);
});

// The wrapper line as ps printed it for `timeout 20 sh -c 'echo "it'"'"'s"; sleep 15'`
// followed by a second line `echo second`.
const WRAPPER =
  `/bin/zsh -c source /x/snapshot-zsh.sh 2>/dev/null || true && eval 'timeout 20 sh -c '"'"'echo "it'"'"'"'"'"'"'"'"'s"; sleep 15'"'"'\\012echo second' < /dev/null && pwd -P >| /tmp/claude-4b5e-cwd`;

test("matchShells: finds the wrapper through Claude Code's re-quoting", () => {
  const procs = parseProcRows(
    [
      `  100     1  01:00:00 claude claude`,
      `  200   100     00:30 zsh ${WRAPPER}`,
      `  201   200     00:30 timeout timeout 20 sh -c echo`,
      `  300   100     00:05 zsh /bin/zsh -c eval 'pnpm dev'`,
      `  301   300     00:05 node node vite`,
    ].join("\n"),
  );
  const probe = matchShells(
    [
      {
        id: "b1",
        command: `timeout 20 sh -c 'echo "it'"'"'s"; sleep 15'\necho second`,
      },
      { id: "b2", command: "pnpm dev" },
      { id: "b3", command: "not running" },
    ],
    procs,
    100,
    new Map([[301, [5173]]]),
    1000,
  );
  assertEquals(probe.get("b1"), {
    ports: [],
    headlessClient: false,
    startedAtSec: 970,
  });
  assertEquals(probe.get("b2"), {
    ports: [5173],
    headlessClient: false,
    startedAtSec: 995,
  });
  assertEquals(probe.has("b3"), false);
});

test("matchShells: a command contained in another takes its own wrapper", () => {
  const procs = parseProcRows(
    [
      `  100     1  01:00:00 claude claude`,
      `  200   100     00:40 zsh /bin/zsh -c eval 'pnpm build && pnpm preview' < /dev/null`,
      `  201   200     00:40 node node vite preview`,
      `  300   100     00:10 zsh /bin/zsh -c eval 'pnpm build' < /dev/null`,
    ].join("\n"),
  );
  const probe = matchShells(
    [
      { id: "short", command: "pnpm build" },
      { id: "long", command: "pnpm build && pnpm preview" },
    ],
    procs,
    100,
    new Map([[201, [4173]]]),
    1000,
  );
  assertEquals(probe.get("short"), {
    ports: [],
    headlessClient: false,
    startedAtSec: 990,
  });
  assertEquals(probe.get("long"), {
    ports: [4173],
    headlessClient: false,
    startedAtSec: 960,
  });
});

test("matchShells: two runs of one command take one wrapper each", () => {
  const procs = parseProcRows(
    [
      `  100     1  01:00:00 claude claude`,
      `  200   100     00:40 zsh /bin/zsh -c eval 'sleep 300'`,
      `  300   100     00:10 zsh /bin/zsh -c eval 'sleep 300'`,
    ].join("\n"),
  );
  const probe = matchShells(
    [{ id: "b1", command: "sleep 300" }, { id: "b2", command: "sleep 300" }],
    procs,
    100,
    new Map(),
    1000,
  );
  assertEquals(
    [probe.get("b1")?.startedAtSec, probe.get("b2")?.startedAtSec].sort(),
    [960, 990],
  );
});

test("matchShells: a headless browser that listens itself is not a client", () => {
  const procs = parseProcRows(
    [
      `  100     1  01:00:00 claude claude`,
      `  200   100     00:40 zsh /bin/zsh -c eval 'bun render.ts'`,
      `  201   200     00:40 bun bun render.ts`,
      `  202   201     00:40 chrome-headless- /x/chrome-headless-shell --headless=old`,
      `  300   100     00:40 zsh /bin/zsh -c eval 'chromium --headless --remote-debugging-port=9222'`,
      `  301   300     00:40 chromium chromium --headless --remote-debugging-port=9222`,
    ].join("\n"),
  );
  const probe = matchShells(
    [
      { id: "job", command: "bun render.ts" },
      {
        id: "cdp",
        command: "chromium --headless --remote-debugging-port=9222",
      },
    ],
    procs,
    100,
    new Map([[201, [59487]], [301, [9222]]]),
    1000,
  );
  assertEquals(probe.get("job")?.headlessClient, true);
  assertEquals(probe.get("cdp")?.headlessClient, false);
});

test("parseListeners: ports per pid from lsof -F pn", () => {
  assertEquals(
    parseListeners(
      "p72368\nf7\nn*:59487\np301\nf3\nn127.0.0.1:5173\nf4\nn[::1]:5173\n",
    ),
    new Map([[72368, [59487]], [301, [5173, 5173]]]),
  );
});

test("commandKey: drops quotes, backslashes, whitespace and ps's \\012", () => {
  assertEquals(commandKey(`a 'b'\\012c`), commandKey(`a b\nc`));
});

// --- Background wait while subagents work after the main Stop ---

const waiting = (until = "1000") =>
  stateWith({
    status: "running",
    background: "shell 1",
    backgroundUntil: until,
    permissionAgents: "",
  });
const opValue = (
  ops: { kind: string; key: string; value?: string }[],
  key: string,
) => ops.find((o) => o.key === key);

test("SubagentStop during a wait recounts the session's background tasks", () => {
  const ops = eventToOps(
    "SubagentStop",
    {
      session_id: "s",
      agent_id: "fork1",
      last_assistant_message: "Shall I continue?",
      background_tasks: [shell("b1"), shell("b2")],
    },
    waiting("1000"),
    shellsProbe([["b2", {
      ports: [],
      headlessClient: false,
      startedAtSec: nowS() - 100,
    }]]),
  );
  assertEquals(opValue(ops, "@pane_background")?.value, "shell 2");
  const until = Number(opValue(ops, "@pane_background_until")?.value);
  assertEquals(until >= nowS() + BACKGROUND_SHELL_CAP_SECONDS - 5, true);
});

test("SubagentStop during a wait keeps a later deadline that activity set", () => {
  const later = String(nowS() + 2 * BACKGROUND_SHELL_CAP_SECONDS);
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s", agent_id: "fork1", background_tasks: [shell("b1")] },
    waiting(later),
    shellsProbe([["b1", {
      ports: [],
      headlessClient: false,
      startedAtSec: nowS() - 100,
    }]]),
  );
  assertEquals(opValue(ops, "@pane_background_until")?.value, later);
});

test("SubagentStop during a wait with a running agent drops the deadline", () => {
  const ops = eventToOps(
    "SubagentStop",
    {
      session_id: "s",
      agent_id: "fork1",
      background_tasks: [shell("b1"), {
        id: "a1",
        type: "subagent",
        status: "running",
      }],
    },
    waiting(),
  );
  assertEquals(opValue(ops, "@pane_background")?.value, "shell 1 · agent 1");
  assertEquals(opValue(ops, "@pane_background_until")?.kind, "unset");
});

test("SubagentStop with nothing left in flight leaves the wait as it is", () => {
  assertEquals(
    eventToOps(
      "SubagentStop",
      { session_id: "s", agent_id: "fork1", background_tasks: [] },
      waiting(),
    ),
    [],
  );
});

test("SubagentStop outside a wait does not touch the background options", () => {
  assertEquals(
    eventToOps(
      "SubagentStop",
      { session_id: "s", agent_id: "fork1", background_tasks: [shell("b1")] },
      stateWith({ status: "idle" }),
    ),
    [],
  );
});

test("a subagent's tool call during a capped wait moves the deadline", () => {
  for (const event of ["PreToolUse", "PostToolUse", "PostToolUseFailure"]) {
    const ops = eventToOps(
      event,
      { session_id: "s", agent_id: "a1", tool_name: "Bash", tool_input: {} },
      waiting("1000"),
    );
    const until = Number(opValue(ops, "@pane_background_until")?.value);
    assertEquals(
      until >= nowS() + BACKGROUND_SHELL_CAP_SECONDS - 5,
      true,
      event,
    );
  }
  const start = eventToOps(
    "SubagentStart",
    { session_id: "s", agent_id: "a1", agent_type: "x" },
    waiting("1000"),
  );
  assertEquals(opValue(start, "@pane_background_until")?.kind, "set");
});

test("main tool calls and uncapped waits leave the deadline alone", () => {
  const main = eventToOps(
    "PreToolUse",
    { session_id: "s", tool_name: "Bash", tool_input: {} },
    waiting("1000"),
  );
  assertEquals(opValue(main, "@pane_background_until"), undefined);
  const uncapped = eventToOps(
    "PreToolUse",
    { session_id: "s", agent_id: "a1", tool_name: "Bash", tool_input: {} },
    stateWith({
      status: "running",
      background: "agent 1",
      backgroundUntil: "",
      permissionAgents: "",
    }),
  );
  assertEquals(opValue(uncapped, "@pane_background_until"), undefined);
});

test("PermissionDenied from a subagent leaves the pane as it is", () => {
  assertEquals(
    eventToOps(
      "PermissionDenied",
      { session_id: "s", agent_id: "a1" },
      waiting(),
    ),
    [],
  );
});

test("SessionStart after compaction keeps the turn and its wait", () => {
  assertEquals(
    eventToOps(
      "SessionStart",
      { session_id: "s", source: "compact" },
      waiting(),
    ),
    [],
  );
  const startup = eventToOps(
    "SessionStart",
    { session_id: "s", source: "startup" },
    waiting(),
  );
  assertEquals(opValue(startup, "@pane_status")?.value, "idle");
});

// --- Permission wait across main-thread turns ---

function applyPaneOps(state: PaneState, ops: Op[]): PaneState {
  const next = { ...state };
  for (const op of ops) {
    const v = op.kind === "set" ? op.value : "";
    if (op.key === "@pane_status") next.status = v;
    if (op.key === "@pane_subagents") next.subagents = v;
    if (op.key === "@pane_main_stopped") next.mainStopped = v === "1";
    if (op.key === "@pane_wait_reason") next.waitReason = v;
    if (op.key === "@pane_background") next.background = v;
    if (op.key === "@pane_background_until") next.backgroundUntil = v;
    if (op.key === "@pane_permission_agents") next.permissionAgents = v;
  }
  return next;
}

const bgAgent = {
  id: "a1",
  type: "subagent",
  status: "running",
  agent_type: "general-purpose",
};

test("permission wait: a subagent's dialog survives a task notification and the Stop after it", () => {
  // The order observed in a real session: the main thread waits on a
  // background agent and a shell, the agent asks, then the shell reports.
  let state = stateWith({
    status: "running",
    subagents: "general-purpose:a1",
    background: "agent 1 · shell 1",
  });
  const step = (event: string, data: Record<string, unknown>) => {
    state = applyPaneOps(
      state,
      eventToOps(event, { session_id: "s1", ...data }, state),
    );
  };
  step("PreToolUse", { agent_id: "a1", tool_name: "Bash" });
  step("PermissionRequest", { agent_id: "a1", tool_name: "Bash" });
  assertEquals([state.status, state.waitReason], ["waiting", "permission"]);
  assertEquals(state.permissionAgents, "a1");

  step("Notification", { notification_type: "permission_prompt" });
  step("UserPromptSubmit", { prompt: "<task-notification>\n<task-id>b1" });
  assertEquals([state.status, state.waitReason], ["waiting", "permission"]);
  step("Stop", { background_tasks: [bgAgent] });
  assertEquals([state.status, state.waitReason], ["waiting", "permission"]);
  assertEquals(state.background, "agent 1");

  // Another subagent's work does not close a1's dialog.
  step("PostToolUse", { agent_id: "b2", tool_name: "Read" });
  assertEquals(state.status, "waiting");

  step("PostToolUse", { agent_id: "a1", tool_name: "Bash" });
  assertEquals([state.status, state.waitReason], ["running", ""]);
  assertEquals(state.permissionAgents, "");
});

test("permission wait: a denied call ends at the agent's next tool call", () => {
  let state = stateWith({
    status: "waiting",
    waitReason: "permission",
    permissionAgents: "a1",
  });
  const ops = eventToOps(
    "PreToolUse",
    { session_id: "s1", agent_id: "a1", tool_name: "Bash" },
    state,
  );
  state = applyPaneOps(state, ops);
  assertEquals([state.status, state.permissionAgents], ["running", ""]);
});

test("permission wait: SubagentStop of the asking agent closes its dialog", () => {
  const state = stateWith({
    status: "waiting",
    waitReason: "permission",
    subagents: "general-purpose:a1|general-purpose:b2",
    permissionAgents: "a1|b2",
  });
  const after = applyPaneOps(
    state,
    eventToOps("SubagentStop", { session_id: "s1", agent_id: "a1" }, state),
  );
  assertEquals([after.status, after.permissionAgents], ["waiting", "b2"]);
});

test("permission wait: the main thread's own dialog closes on its tool result", () => {
  let state = stateWith({ status: "running" });
  state = applyPaneOps(
    state,
    eventToOps(
      "PermissionRequest",
      { session_id: "s1", tool_name: "Bash" },
      state,
    ),
  );
  assertEquals([state.status, state.permissionAgents], ["waiting", "main"]);
  state = applyPaneOps(
    state,
    eventToOps("PostToolUse", { session_id: "s1", tool_name: "Bash" }, state),
  );
  assertEquals([state.status, state.permissionAgents], ["running", ""]);
});

test("permission wait: a Stop that leaves the pane idle drops what is left", () => {
  const state = stateWith({
    status: "waiting",
    waitReason: "permission",
    permissionAgents: "a1",
  });
  const after = applyPaneOps(
    state,
    eventToOps("Stop", { session_id: "s1" }, state),
  );
  assertEquals([after.status, after.permissionAgents], ["idle", ""]);
});

test("permission wait: no extra writes while the wait already shows", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", agent_id: "b2", tool_name: "Read" },
    stateWith({
      status: "waiting",
      waitReason: "permission",
      subagents: "general-purpose:b2",
      permissionAgents: "a1",
    }),
  );
  assertEquals(
    ops.filter((o) =>
      o.key === "@pane_status" || o.key === "@pane_wait_reason" ||
      o.key === "@pane_permission_agents"
    ),
    [],
  );
});

test("permission wait: the main thread's question shows, and the subagent's approval does not hide it", () => {
  let state = stateWith({
    status: "waiting",
    waitReason: "permission",
    subagents: "general-purpose:a1",
    permissionAgents: "a1",
  });
  const step = (event: string, data: Record<string, unknown>) => {
    state = applyPaneOps(
      state,
      eventToOps(event, { session_id: "s1", ...data }, state),
    );
  };
  step("PreToolUse", { tool_name: "AskUserQuestion" });
  assertEquals([state.status, state.waitReason], ["waiting", "question"]);
  step("PostToolUse", { agent_id: "a1", tool_name: "Bash" });
  assertEquals([state.status, state.waitReason], ["waiting", "question"]);
  assertEquals(state.permissionAgents, "");
});

test("permission wait: an answered question falls back to the dialog still open", () => {
  let state = stateWith({
    status: "waiting",
    waitReason: "question",
    subagents: "general-purpose:a1",
    permissionAgents: "a1",
  });
  state = applyPaneOps(
    state,
    eventToOps(
      "PostToolUse",
      { session_id: "s1", tool_name: "AskUserQuestion" },
      state,
    ),
  );
  assertEquals([state.status, state.waitReason], ["waiting", "permission"]);
});

test("permission wait: a main-thread turn starting or ending closes the main dialog", () => {
  for (
    const [event, data] of [
      ["UserPromptSubmit", { prompt: "<task-notification>\n<task-id>b1" }],
      ["Stop", { background_tasks: [bgAgent] }],
    ] as const
  ) {
    const state = stateWith({
      status: "waiting",
      waitReason: "permission",
      permissionAgents: "main",
    });
    const after = applyPaneOps(
      state,
      eventToOps(event, { session_id: "s1", ...data }, state),
    );
    assertEquals([after.status, after.permissionAgents], ["running", ""]);
  }
});

test("permission wait: a main-thread elicitation outlasts a subagent's dialog", () => {
  let state = stateWith({ status: "running", subagents: "general-purpose:a1" });
  const step = (event: string, data: Record<string, unknown>) => {
    state = applyPaneOps(
      state,
      eventToOps(event, { session_id: "s1", ...data }, state),
    );
  };
  step("Notification", { notification_type: "elicitation_dialog" });
  step("PermissionRequest", { agent_id: "a1", tool_name: "Bash" });
  step("Notification", { notification_type: "permission_prompt" });
  assertEquals([state.status, state.waitReason], ["waiting", "elicitation"]);
  step("PostToolUse", { agent_id: "a1", tool_name: "Bash" });
  assertEquals([state.status, state.waitReason], ["waiting", "elicitation"]);
});

test("permission wait: a subagent asking during the main thread's question leaves the question", () => {
  let state = stateWith({ status: "running", subagents: "general-purpose:a1" });
  const step = (event: string, data: Record<string, unknown>) => {
    state = applyPaneOps(
      state,
      eventToOps(event, { session_id: "s1", ...data }, state),
    );
  };
  step("PreToolUse", { tool_name: "AskUserQuestion" });
  step("PermissionRequest", { agent_id: "a1", tool_name: "Bash" });
  step("Notification", { notification_type: "permission_prompt" });
  assertEquals([state.status, state.waitReason], ["waiting", "question"]);
  step("PostToolUse", { agent_id: "a1", tool_name: "Bash" });
  assertEquals([state.status, state.waitReason], ["waiting", "question"]);
});

test("permission wait: the idle prompt does not replace an open dialog", () => {
  const ops = eventToOps(
    "Notification",
    { session_id: "s1", notification_type: "idle_prompt" },
    stateWith({
      status: "waiting",
      waitReason: "permission",
      subagents: "general-purpose:a1",
      background: "agent 1",
      permissionAgents: "a1",
    }),
  );
  assertEquals(ops, []);
});
