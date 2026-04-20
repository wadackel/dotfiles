import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALL_PANE_OPTIONS,
  appendSubagent,
  count,
  eventToOps,
  formatElapsed,
  maskPrompt,
  type PaneState,
  removeSubagent,
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
};

function stateWithSubagents(list: string): PaneState {
  return { subagents: list, pendingTeardown: false, currentTool: "" };
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
    { subagents: "", pendingTeardown: false, currentTool: "Bash" },
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
    { subagents: "", pendingTeardown: false, currentTool: "ToolB" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Bash" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Edit" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Edit" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Edit" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Write" },
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
    { subagents: "", pendingTeardown: false, currentTool: "MultiEdit" },
  );
  const lastFile = ops.find((o) => o.key === "@pane_last_edit_file");
  assertEquals(lastFile?.kind === "set" ? lastFile.value : "", "/a/b/multi.ts");
});

Deno.test("eventToOps: PostToolUse (Bash) sets last_tool and clears last_edit_file", () => {
  const ops = eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash" },
    { subagents: "", pendingTeardown: false, currentTool: "Bash" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Edit" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Edit" },
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
    { subagents: "", pendingTeardown: false, currentTool: "Edit" },
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
    { subagents: "Explore:a1", pendingTeardown: true, currentTool: "" },
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
    { subagents: "Explore:a1", pendingTeardown: true, currentTool: "" },
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
