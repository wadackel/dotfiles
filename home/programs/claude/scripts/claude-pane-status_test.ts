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
};

function stateWithSubagents(list: string): PaneState {
  return {
    subagents: list,
    pendingTeardown: false,
    currentTool: "",
    status: "",
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

Deno.test("eventToOps: Stop with no subagents → idle", () => {
  const ops = eventToOps("Stop", {}, emptyState);
  assertEquals(ops, [{ kind: "set", key: "@pane_status", value: "idle" }]);
});

Deno.test("eventToOps: Stop with live subagents → defer (empty)", () => {
  const ops = eventToOps("Stop", {}, stateWithSubagents("Explore:x1"));
  assertEquals(ops, []);
});

Deno.test("eventToOps: StopFailure → error + wait_reason", () => {
  const ops = eventToOps("StopFailure", { message: "boom" }, emptyState);
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "error");
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind === "set" ? reason.value : "", "boom");
});

Deno.test("eventToOps: Notification → waiting + wait_reason (no @pane_attention)", () => {
  const ops = eventToOps(
    "Notification",
    { message: "please approve" },
    emptyState,
  );
  const status = ops.find((o) => o.key === "@pane_status");
  assertEquals(status?.kind === "set" ? status.value : "", "waiting");
  const reason = ops.find((o) => o.key === "@pane_wait_reason");
  assertEquals(reason?.kind === "set" ? reason.value : "", "please approve");
  // @pane_attention was removed — must not appear
  assertEquals(ops.some((o) => o.key === "@pane_attention"), false);
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
    { subagents: "", pendingTeardown: false, currentTool: "Bash", status: "" },
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
    { subagents: "", pendingTeardown: false, currentTool: "ToolB", status: "" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Bash", status: "" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Write", status: "" },
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
    { subagents: "", pendingTeardown: false, currentTool: "MultiEdit", status: "" },
  );
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind === "set" ? lastFile.value : "", "/a/b/multi.ts");
});

Deno.test("eventToOps: PostToolUse (Bash) sets last_tool and clears last_edit_file", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    { subagents: "", pendingTeardown: false, currentTool: "Bash", status: "" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "" },
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
    { subagents: "Explore:a1", pendingTeardown: true, currentTool: "", status: "" },
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
    { subagents: "Explore:a1", pendingTeardown: true, currentTool: "", status: "" },
  );
  assertEquals(ops.length, ALL_PANE_OPTIONS.length);
  assertEquals(ops.every((o) => o.kind === "unset"), true);
});

Deno.test("eventToOps: Stop with live subagents (defer) stays empty — self-heal skipped", () => {
  const ops = eventToOps(
    "Stop",
    { session_id: "sess-6" },
    stateWithSubagents("A:1|B:2"),
  );
  assertEquals(ops, []);
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

Deno.test("resume: SubagentStart with status=waiting → flips to running + appends subagent", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Explore", agent_id: "a1" },
    stateWith({ status: "waiting" }),
  );
  assertEquals(hasResumeOps(ops), true);
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Explore:a1");
});

Deno.test("resume: SubagentStart with status=error → flips to running", () => {
  const ops = eventToOps(
    "SubagentStart",
    { session_id: "s1", agent_type: "Explore", agent_id: "a1" },
    stateWith({ status: "error" }),
  );
  assertEquals(hasResumeOps(ops), true);
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

Deno.test("resume: SubagentStop (non-drain) with status=waiting → flips to running", () => {
  // Non-drain: pendingTeardown=false, list still has another entry after removal
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWith({ subagents: "Explore:a1|Plan:b2", status: "waiting" }),
  );
  assertEquals(hasResumeOps(ops), true);
  const listOp = ops.find((o) => o.key === "@pane_subagents");
  assertEquals(listOp?.kind === "set" ? listOp.value : "", "Plan:b2");
});

Deno.test("resume: SubagentStop (non-drain) with status=error → flips to running", () => {
  const ops = eventToOps(
    "SubagentStop",
    { session_id: "s1", agent_id: "a1" },
    stateWith({ subagents: "Explore:a1|Plan:b2", status: "error" }),
  );
  assertEquals(hasResumeOps(ops), true);
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
    { subagents: "", pendingTeardown: false, currentTool: "Bash", status: "" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Bash", status: "" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Bash", status: "" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Edit", status: "" },
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
  assertEquals(rec.tmux_pane, null);
  assertEquals(rec.cwd, null);
  assertEquals(rec.pre_state, null);
  assertEquals(rec.ops, []);
  assertEquals(rec.apply_results, []);
  assertEquals(rec.early_exit, "no-event");
  assertEquals(rec.stdin_event_mismatch, false);
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
