import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  appendSubagent,
  buildRunLog,
  CHILD_SESSION_START_FRESHNESS_SECONDS,
  childSessionStartOps,
  commandOutput,
  countSubagents,
  eventToOps,
  extractEditFile,
  extractTokenPct,
  extractToolError,
  extractToolSubject,
  hasFreshActivity,
  incrementPendingSubagentNotifications,
  isChildCodexEvent,
  isMissingRequestedUserOption,
  normalizeMissingUserOption,
  type PaneOp,
  type PaneState,
  parentStopOps,
  removeSubagent,
  selfHealOps,
  shouldIncrementPendingSubagentNotification,
  subagentMutationOps,
} from "./codex-pane-status.ts";
import { maskPrompt, type Op } from "../pane-shared.ts";

function state(overrides: Partial<PaneState> = {}): PaneState {
  return {
    status: "",
    currentTool: "",
    currentToolUseId: "",
    agent: "",
    sessionId: "",
    subagents: "",
    mainStopped: false,
    lastActivityAt: "",
    ...overrides,
  };
}

function hasOp(ops: PaneOp[], expected: Op): boolean {
  return ops.some((op) => JSON.stringify(op) === JSON.stringify(expected));
}

function hasParentStop(ops: PaneOp[], contextPct: string | null): boolean {
  return ops.some((op) =>
    op.kind === "set" &&
    op.key === "@pane_status" &&
    "parentStop" in op &&
    op.parentStop.contextPct === contextPct
  );
}

function hasSubagentAdd(ops: PaneOp[], id: string): boolean {
  return ops.some((op) =>
    op.kind === "set" &&
    op.key === "@pane_subagents" &&
    "subagentMutation" in op &&
    op.subagentMutation.action === "add" &&
    op.subagentMutation.id === id
  );
}

Deno.test("selfHealOps: session id missing returns no ops", () => {
  assertEquals(selfHealOps({}), []);
});

Deno.test("selfHealOps: invalid session_id (path traversal) drops event", () => {
  assertEquals(selfHealOps({ session_id: "../bad", cwd: "/tmp" }), []);
  assertEquals(selfHealOps({ session_id: "sess:001" }), []);
  assertEquals(selfHealOps({ session_id: "a".repeat(129) }), []);
});

Deno.test("selfHealOps: sets codex session and cwd", () => {
  assertEquals(selfHealOps({ session_id: "s1", cwd: "/tmp/x" }), [
    { kind: "set", key: "@pane_agent", value: "codex" },
    { kind: "set", key: "@pane_session_id", value: "s1" },
    { kind: "set", key: "@pane_cwd", value: "/tmp/x" },
  ]);
});

Deno.test("maskPrompt: strips controls, collapses whitespace, truncates", () => {
  // codex preserves 3-dot ellipsis ("...") via the explicit option; pane-shared
  // default is "…". See pane-shared.ts:131-132.
  assertEquals(
    maskPrompt("hello\n\tworld", { ellipsis: "..." }),
    "hello world",
  );
  assertEquals(
    maskPrompt("x".repeat(45), { ellipsis: "..." }),
    "x".repeat(40) + "...",
  );
});

Deno.test("appendSubagent: appends and preserves order", () => {
  assertEquals(appendSubagent("", "Codex", "c1"), "Codex:c1");
  assertEquals(
    appendSubagent("Codex:c1", "Codex", "c2"),
    "Codex:c1|Codex:c2",
  );
});

Deno.test("appendSubagent: sanitizes list delimiters and is idempotent", () => {
  assertEquals(appendSubagent("", "Co|dex", "c:1"), "Co-dex:c-1");
  assertEquals(appendSubagent("Codex:c1", "Codex", "c1"), "Codex:c1");
});

Deno.test("removeSubagent: removes first matching id", () => {
  assertEquals(
    removeSubagent("Codex:c1|Codex:c2|Codex:c1", "c1"),
    "Codex:c2|Codex:c1",
  );
  assertEquals(removeSubagent("Codex:c1", "c1"), "");
  assertEquals(removeSubagent("Codex:c1", "missing"), "Codex:c1");
});

Deno.test("countSubagents: counts non-empty list entries", () => {
  assertEquals(countSubagents(""), 0);
  assertEquals(countSubagents("Codex:c1|Codex:c2|"), 2);
});

Deno.test("incrementPendingSubagentNotifications: parses positive integers only", () => {
  assertEquals(incrementPendingSubagentNotifications(""), "1");
  assertEquals(incrementPendingSubagentNotifications("0"), "1");
  assertEquals(incrementPendingSubagentNotifications("2"), "3");
  assertEquals(incrementPendingSubagentNotifications("-1"), "1");
  assertEquals(incrementPendingSubagentNotifications("not-a-number"), "1");
});

Deno.test("isMissingRequestedUserOption: matches only exact missing user option stderr", () => {
  assertEquals(
    isMissingRequestedUserOption(
      "invalid option: @pane_subagents",
      "@pane_subagents",
    ),
    true,
  );
  assertEquals(
    isMissingRequestedUserOption(
      "invalid option: @pane_subagents\n",
      "@pane_subagents",
    ),
    true,
  );
  assertEquals(
    isMissingRequestedUserOption(
      "invalid option: @pane_status",
      "@pane_subagents",
    ),
    false,
  );
  assertEquals(
    isMissingRequestedUserOption("no such pane: %999", "@pane_subagents"),
    false,
  );
  assertEquals(
    isMissingRequestedUserOption("invalid option: status", "status"),
    false,
  );
});

Deno.test("normalizeMissingUserOption: treats missing user option as empty value only", () => {
  assertEquals(
    normalizeMissingUserOption(
      { ok: false, stderr: "invalid option: @pane_subagents" },
      "@pane_subagents",
    ),
    { ok: true, value: "" },
  );
  assertEquals(
    normalizeMissingUserOption(
      { ok: false, stderr: "no such pane: %999" },
      "@pane_subagents",
    ),
    { ok: false, stderr: "no such pane: %999" },
  );
  assertEquals(
    normalizeMissingUserOption(
      { ok: true, value: "Codex:child" },
      "@pane_subagents",
    ),
    { ok: true, value: "Codex:child" },
  );
});

Deno.test("shouldIncrementPendingSubagentNotification: only successful removes count", () => {
  assertEquals(
    shouldIncrementPendingSubagentNotification(
      { action: "remove", id: "child" },
      [{ kind: "unset", key: "@pane_subagents" }],
    ),
    true,
  );
  assertEquals(
    shouldIncrementPendingSubagentNotification(
      { action: "remove", id: "missing" },
      [],
    ),
    false,
  );
  assertEquals(
    shouldIncrementPendingSubagentNotification(
      { action: "add", type: "Codex", id: "child" },
      [{ kind: "set", key: "@pane_subagents", value: "Codex:child" }],
    ),
    false,
  );
});

Deno.test("subagentMutationOps: adds from latest list snapshot", () => {
  assertEquals(
    subagentMutationOps(
      "Codex:c1",
      { action: "add", type: "Codex", id: "c2" },
      false,
      "100",
    ),
    [{
      kind: "set",
      key: "@pane_subagents",
      value: "Codex:c1|Codex:c2",
    }],
  );
});

Deno.test("subagentMutationOps: removes from latest list and drains idle", () => {
  assertEquals(
    subagentMutationOps(
      "Codex:c1|Codex:c2",
      { action: "remove", id: "c1" },
      true,
      "100",
    ),
    [{ kind: "set", key: "@pane_subagents", value: "Codex:c2" }],
  );
  assertEquals(
    subagentMutationOps(
      "Codex:c1",
      { action: "remove", id: "c1" },
      true,
      "100",
    ),
    [
      { kind: "unset", key: "@pane_subagents" },
      { kind: "set", key: "@pane_status", value: "idle" },
      { kind: "set", key: "@pane_last_activity_at", value: "100" },
      { kind: "unset", key: "@pane_main_stopped" },
    ],
  );
  assertEquals(
    subagentMutationOps(
      "Codex:c1",
      { action: "remove", id: "missing" },
      true,
      "100",
    ),
    [],
  );
});

Deno.test("subagentMutationOps: missing pending snapshot increments first skipped notification", () => {
  const ops = subagentMutationOps(
    "Codex:child",
    { action: "remove", id: "child" },
    false,
    "100",
  );
  assertEquals(
    shouldIncrementPendingSubagentNotification(
      { action: "remove", id: "child" },
      ops,
    ),
    true,
  );
  const pending = normalizeMissingUserOption(
    {
      ok: false,
      stderr: "invalid option: @pane_pending_subagent_notifications",
    },
    "@pane_pending_subagent_notifications",
  );
  assertEquals(
    pending.ok ? incrementPendingSubagentNotifications(pending.value) : "",
    "1",
  );
});

Deno.test("parentStopOps: defers idle or drains from latest list snapshot", () => {
  assertEquals(parentStopOps("Codex:c1", null, "100"), [
    { kind: "set", key: "@pane_main_stopped", value: "1" },
    { kind: "set", key: "@pane_last_activity_at", value: "100" },
    { kind: "unset", key: "@pane_context_used_pct" },
  ]);
  assertEquals(parentStopOps("Codex:c1", "25", "100"), [
    { kind: "set", key: "@pane_main_stopped", value: "1" },
    { kind: "set", key: "@pane_last_activity_at", value: "100" },
    { kind: "set", key: "@pane_context_used_pct", value: "25" },
  ]);
  assertEquals(parentStopOps("", "25", "100"), [
    { kind: "set", key: "@pane_status", value: "idle" },
    { kind: "set", key: "@pane_last_activity_at", value: "100" },
    { kind: "set", key: "@pane_context_used_pct", value: "25" },
    { kind: "unset", key: "@pane_main_stopped" },
  ]);
  assertEquals(parentStopOps("", null, "100"), [
    { kind: "set", key: "@pane_status", value: "idle" },
    { kind: "set", key: "@pane_last_activity_at", value: "100" },
    { kind: "unset", key: "@pane_context_used_pct" },
    { kind: "unset", key: "@pane_main_stopped" },
  ]);
});

Deno.test("parentStopOps + subagentMutationOps: final tracked child drains idle", () => {
  const parentStop = parentStopOps("Codex:child", null, "100");
  assertEquals(parentStop, [
    { kind: "set", key: "@pane_main_stopped", value: "1" },
    { kind: "set", key: "@pane_last_activity_at", value: "100" },
    { kind: "unset", key: "@pane_context_used_pct" },
  ]);

  const finalChildStop = subagentMutationOps(
    "Codex:child",
    { action: "remove", id: "child" },
    true,
    "200",
  );
  assertEquals(finalChildStop, [
    { kind: "unset", key: "@pane_subagents" },
    { kind: "set", key: "@pane_status", value: "idle" },
    { kind: "set", key: "@pane_last_activity_at", value: "200" },
    { kind: "unset", key: "@pane_main_stopped" },
  ]);
});

Deno.test("childSessionStartOps: appends only when latest parent is running", () => {
  assertEquals(
    childSessionStartOps(
      {
        status: "running",
        agent: "codex",
        sessionId: "parent",
        subagents: "Codex:c1",
      },
      { id: "child", type: "Codex", cwd: "/repo", source: "startup" },
      "100",
    ),
    [{
      kind: "set",
      key: "@pane_subagents",
      value: "Codex:c1|Codex:child",
    }],
  );
});

Deno.test("childSessionStartOps: missing subagents snapshot registers first child", () => {
  assertEquals(
    childSessionStartOps(
      {
        status: "running",
        agent: "codex",
        sessionId: "parent",
        subagents: "",
      },
      { id: "child", type: "Codex", cwd: "/repo", source: "startup" },
      "100",
    ),
    [{
      kind: "set",
      key: "@pane_subagents",
      value: "Codex:child",
    }],
  );
});

Deno.test("childSessionStartOps: latest idle falls back to new main session", () => {
  const ops = childSessionStartOps(
    {
      status: "idle",
      agent: "codex",
      sessionId: "parent",
      subagents: "Codex:child",
    },
    { id: "child", type: "Codex", cwd: "/repo", source: "startup" },
    "100",
  );
  assert(hasOp(ops, { kind: "set", key: "@pane_session_id", value: "child" }));
  assert(hasOp(ops, { kind: "set", key: "@pane_cwd", value: "/repo" }));
  assert(hasOp(ops, { kind: "unset", key: "@pane_subagents" }));
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "idle" }));
});

Deno.test("hasFreshActivity: uses named child startup freshness window", () => {
  assertEquals(
    hasFreshActivity(
      "1000",
      String(1000 + CHILD_SESSION_START_FRESHNESS_SECONDS),
    ),
    true,
  );
  assertEquals(
    hasFreshActivity(
      "1000",
      String(1001 + CHILD_SESSION_START_FRESHNESS_SECONDS),
    ),
    false,
  );
  assertEquals(hasFreshActivity("", "1000"), false);
});

Deno.test("isChildCodexEvent: classifies only known or fresh child candidates", () => {
  const fresh = String(Math.floor(Date.now() / 1000));
  const stale = String(
    Math.floor(Date.now() / 1000) - CHILD_SESSION_START_FRESHNESS_SECONDS - 1,
  );
  assertEquals(
    isChildCodexEvent(
      { session_id: "child" },
      state({
        status: "running",
        agent: "codex",
        sessionId: "parent",
        lastActivityAt: fresh,
      }),
      "SessionStart",
    ),
    true,
  );
  assertEquals(
    isChildCodexEvent(
      { session_id: "child" },
      state({
        status: "running",
        agent: "codex",
        sessionId: "parent",
        lastActivityAt: stale,
      }),
      "SessionStart",
    ),
    false,
  );
  assertEquals(
    isChildCodexEvent(
      { session_id: "child" },
      state({
        status: "waiting",
        agent: "codex",
        sessionId: "parent",
        subagents: "Codex:child",
      }),
    ),
    true,
  );
  assertEquals(
    isChildCodexEvent(
      { session_id: "child" },
      state({
        status: "waiting",
        agent: "codex",
        sessionId: "parent",
        subagents: "Codex:child",
      }),
      "SessionStart",
    ),
    true,
  );
  assertEquals(
    isChildCodexEvent(
      { session_id: "child" },
      state({
        status: "idle",
        agent: "codex",
        sessionId: "parent",
        subagents: "Codex:child",
      }),
    ),
    false,
  );
  assertEquals(
    isChildCodexEvent(
      { session_id: "child" },
      state({
        status: "waiting",
        agent: "codex",
        sessionId: "parent",
      }),
    ),
    false,
  );
  assertEquals(
    isChildCodexEvent(
      { session_id: "../bad" },
      state({ status: "running", agent: "codex", sessionId: "parent" }),
    ),
    false,
  );
});

Deno.test("eventToOps: SessionStart startup drains stale state and seeds idle", async () => {
  const ops = await eventToOps(
    "SessionStart",
    { session_id: "s1", source: "startup" },
    state({ agent: "claude", sessionId: "old" }),
  );
  assert(hasOp(ops, { kind: "set", key: "@pane_agent", value: "codex" }));
  assert(hasOp(ops, { kind: "unset", key: "@pane_prompt" }));
  assert(hasOp(ops, { kind: "unset", key: "@pane_subagents" }));
  assert(hasOp(ops, {
    kind: "unset",
    key: "@pane_pending_subagent_notifications",
  }));
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "idle" }));
});

Deno.test("eventToOps: SessionStart clear drains stale state", async () => {
  const ops = await eventToOps(
    "SessionStart",
    { session_id: "s1", source: "clear" },
    state({ agent: "codex", sessionId: "s1" }),
  );
  assert(hasOp(ops, { kind: "unset", key: "@pane_prompt" }));
  assert(hasOp(ops, { kind: "unset", key: "@pane_current_tool" }));
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "idle" }));
});

Deno.test("eventToOps: SessionStart resume same codex preserves durable fields and drains transients", async () => {
  const ops = await eventToOps(
    "SessionStart",
    { session_id: "s1", source: "resume" },
    state({ agent: "codex", sessionId: "s1", currentToolUseId: "tool-1" }),
  );
  assert(hasOp(ops, { kind: "unset", key: "@pane_subagents" }));
  assert(hasOp(ops, {
    kind: "unset",
    key: "@pane_pending_subagent_notifications",
  }));
  assert(hasOp(ops, { kind: "unset", key: "@pane_current_tool" }));
  assert(hasOp(ops, { kind: "unset", key: "@pane_current_tool_use_id" }));
  assert(!hasOp(ops, { kind: "unset", key: "@pane_prompt" }));
  assert(!hasOp(ops, { kind: "unset", key: "@pane_context_used_pct" }));
});

Deno.test("eventToOps: SessionStart resume cross-agent falls back to full drain", async () => {
  const ops = await eventToOps(
    "SessionStart",
    { session_id: "s1", source: "resume" },
    state({ agent: "claude", sessionId: "s1" }),
  );
  assert(hasOp(ops, { kind: "unset", key: "@pane_prompt" }));
  assert(hasOp(ops, { kind: "unset", key: "@pane_context_used_pct" }));
});

Deno.test("eventToOps: child SessionStart tracks subagent without idling or self-heal", async () => {
  const fresh = String(Math.floor(Date.now() / 1000));
  const ops = await eventToOps(
    "SessionStart",
    { session_id: "child", source: "startup", cwd: "/repo" },
    state({
      status: "running",
      agent: "codex",
      sessionId: "parent",
      lastActivityAt: fresh,
    }),
  );
  assertEquals(ops, [{
    kind: "set",
    key: "@pane_subagents",
    value: "child",
    childSessionStart: {
      id: "child",
      type: "Codex",
      cwd: "/repo",
      source: "startup",
    },
  }]);
});

Deno.test("eventToOps: stale valid-different SessionStart drains as new main", async () => {
  const ops = await eventToOps(
    "SessionStart",
    { session_id: "new-main", source: "startup", cwd: "/repo" },
    state({
      status: "running",
      agent: "codex",
      sessionId: "old-main",
      subagents: "",
      lastActivityAt: "1",
    }),
  );
  assert(hasOp(ops, {
    kind: "set",
    key: "@pane_session_id",
    value: "new-main",
  }));
  assert(hasOp(ops, { kind: "set", key: "@pane_cwd", value: "/repo" }));
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "idle" }));
  assert(hasOp(ops, { kind: "unset", key: "@pane_subagents" }));
});

Deno.test("eventToOps: stale SessionStart with main discriminator drains as new main", async () => {
  const ops = await eventToOps(
    "SessionStart",
    {
      session_id: "new-main",
      agent_type: "main",
      source: "startup",
      cwd: "/repo",
    },
    state({
      status: "running",
      agent: "codex",
      sessionId: "old-main",
      lastActivityAt: "1",
    }),
  );
  assert(hasOp(ops, {
    kind: "set",
    key: "@pane_session_id",
    value: "new-main",
  }));
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "idle" }));
});

Deno.test("eventToOps: fresh SessionStart with main discriminator drains as new main", async () => {
  const ops = await eventToOps(
    "SessionStart",
    {
      session_id: "new-main",
      agent_type: "main",
      source: "startup",
      cwd: "/repo",
    },
    state({
      status: "running",
      agent: "codex",
      sessionId: "old-main",
      lastActivityAt: String(Math.floor(Date.now() / 1000)),
    }),
  );
  assert(hasOp(ops, {
    kind: "set",
    key: "@pane_session_id",
    value: "new-main",
  }));
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "idle" }));
  assert(!ops.some((op) => "childSessionStart" in op));
});

Deno.test("eventToOps: unrelated agent_type does not force child classification", async () => {
  const ops = await eventToOps(
    "SessionStart",
    {
      session_id: "new-main",
      agent_type: "not-child",
      source: "startup",
      cwd: "/repo",
    },
    state({
      status: "running",
      agent: "codex",
      sessionId: "old-main",
      lastActivityAt: "1",
    }),
  );
  assert(hasOp(ops, {
    kind: "set",
    key: "@pane_session_id",
    value: "new-main",
  }));
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "idle" }));
});

Deno.test("eventToOps: explicit child discriminator can track stale child start", async () => {
  const ops = await eventToOps(
    "SessionStart",
    {
      session_id: "child",
      agent_type: "subagent",
      source: "startup",
      cwd: "/repo",
    },
    state({
      status: "running",
      agent: "codex",
      sessionId: "parent",
      lastActivityAt: "1",
    }),
  );
  assertEquals(ops, [{
    kind: "set",
    key: "@pane_subagents",
    value: "child",
    childSessionStart: {
      id: "child",
      type: "Codex",
      cwd: "/repo",
      source: "startup",
    },
  }]);
});

Deno.test("eventToOps: different SessionStart while idle is a new main session", async () => {
  const ops = await eventToOps(
    "SessionStart",
    { session_id: "new-main", source: "startup", cwd: "/repo" },
    state({ status: "idle", agent: "codex", sessionId: "old-main" }),
  );
  assert(
    hasOp(ops, { kind: "set", key: "@pane_session_id", value: "new-main" }),
  );
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "idle" }));
});

Deno.test("eventToOps: invalid SessionStart id drains without unsafe self-heal", async () => {
  const ops = await eventToOps(
    "SessionStart",
    { session_id: "../bad", source: "startup", cwd: "/repo" },
    state({
      status: "running",
      agent: "codex",
      sessionId: "parent",
      lastActivityAt: "1",
    }),
  );
  assert(
    !hasOp(ops, {
      kind: "set",
      key: "@pane_session_id",
      value: "../bad",
    }),
  );
  assert(!hasOp(ops, { kind: "set", key: "@pane_cwd", value: "/repo" }));
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "idle" }));
});

Deno.test("eventToOps: missing SessionStart id still drains stale running", async () => {
  const ops = await eventToOps(
    "SessionStart",
    { source: "startup", cwd: "/repo" },
    state({
      status: "running",
      agent: "codex",
      sessionId: "parent",
      lastActivityAt: "1",
    }),
  );
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "idle" }));
  assert(!ops.some((op) => op.key === "@pane_session_id"));
});

Deno.test("eventToOps: UserPromptSubmit sets running prompt timestamps", async () => {
  const ops = await eventToOps(
    "UserPromptSubmit",
    { session_id: "s1", prompt: "build it" },
    state(),
  );
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "running" }));
  assert(hasOp(ops, { kind: "set", key: "@pane_prompt", value: "build it" }));
  assert(ops.some((op) => op.kind === "set" && op.key === "@pane_started_at"));
});

Deno.test("eventToOps: UserPromptSubmit publishes context pct when token_count is readable", async () => {
  const transcript =
    new URL("../fixtures/token-nested-ok.jsonl", import.meta.url).pathname;
  const ops = await eventToOps(
    "UserPromptSubmit",
    { session_id: "s1", prompt: "build it", transcript_path: transcript },
    state(),
  );
  assert(hasOp(ops, {
    kind: "set",
    key: "@pane_context_used_pct",
    value: "25",
  }));
});

Deno.test("eventToOps: UserPromptSubmit empty prompt unsets prompt", async () => {
  const ops = await eventToOps(
    "UserPromptSubmit",
    { session_id: "s1", prompt: "" },
    state(),
  );
  assert(hasOp(ops, { kind: "unset", key: "@pane_prompt" }));
});

Deno.test("eventToOps: PreToolUse resumes waiting and records tool_use_id", async () => {
  const ops = await eventToOps(
    "PreToolUse",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "deno test" },
      tool_use_id: "u1",
    },
    state({ status: "waiting" }),
  );
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "running" }));
  assert(hasOp(ops, { kind: "unset", key: "@pane_wait_reason" }));
  assert(hasOp(ops, { kind: "set", key: "@pane_current_tool", value: "Bash" }));
  assert(hasOp(ops, {
    kind: "set",
    key: "@pane_current_tool_use_id",
    value: "u1",
  }));
  assert(hasOp(ops, {
    kind: "set",
    key: "@pane_current_tool_subject",
    value: "deno test",
  }));
});

Deno.test("eventToOps: PreToolUse publishes context pct when token_count is readable", async () => {
  const transcript =
    new URL("../fixtures/token-nested-ok.jsonl", import.meta.url).pathname;
  const ops = await eventToOps(
    "PreToolUse",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "deno test" },
      tool_use_id: "u1",
      transcript_path: transcript,
    },
    state({ status: "waiting" }),
  );
  assert(hasOp(ops, {
    kind: "set",
    key: "@pane_context_used_pct",
    value: "25",
  }));
});

Deno.test("eventToOps: PreToolUse without tool name is no-op", async () => {
  assertEquals(
    await eventToOps("PreToolUse", { session_id: "s1" }, state()),
    [],
  );
});

Deno.test("eventToOps: child PreToolUse updates tool without self-heal or resume", async () => {
  const transcript =
    new URL("../fixtures/token-nested-ok.jsonl", import.meta.url).pathname;
  const ops = await eventToOps(
    "PreToolUse",
    {
      session_id: "child",
      cwd: "/repo",
      tool_name: "Bash",
      tool_input: { command: "deno test" },
      tool_use_id: "u-child",
      transcript_path: transcript,
    },
    state({
      status: "waiting",
      agent: "codex",
      sessionId: "parent",
      subagents: "Codex:child",
    }),
  );
  assert(hasOp(ops, { kind: "set", key: "@pane_current_tool", value: "Bash" }));
  assert(hasOp(ops, {
    kind: "set",
    key: "@pane_current_tool_use_id",
    value: "u-child",
  }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_status", value: "running" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_session_id", value: "child" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_cwd", value: "/repo" }));
  assert(!ops.some((op) => op.key === "@pane_context_used_pct"));
});

Deno.test("eventToOps: child PreToolUse does not resume error parent", async () => {
  const ops = await eventToOps(
    "PreToolUse",
    {
      session_id: "child",
      cwd: "/repo",
      tool_name: "Bash",
      tool_input: { command: "deno test" },
      tool_use_id: "u-child",
    },
    state({
      status: "error",
      agent: "codex",
      sessionId: "parent",
      subagents: "Codex:child",
    }),
  );
  assert(hasOp(ops, { kind: "set", key: "@pane_current_tool", value: "Bash" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_status", value: "running" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_session_id", value: "child" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_cwd", value: "/repo" }));
});

Deno.test("eventToOps: PostToolUse clears current only for matching tool_use_id", async () => {
  const stale = await eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash", tool_use_id: "old" },
    state({ currentTool: "Bash", currentToolUseId: "new" }),
  );
  assert(!hasOp(stale, { kind: "unset", key: "@pane_current_tool" }));

  const current = await eventToOps(
    "PostToolUse",
    { session_id: "s1", tool_name: "Bash", tool_use_id: "new" },
    state({ currentTool: "Bash", currentToolUseId: "new" }),
  );
  assert(hasOp(current, { kind: "unset", key: "@pane_current_tool" }));
  assert(hasOp(current, { kind: "unset", key: "@pane_current_tool_use_id" }));
});

Deno.test("eventToOps: PostToolUse without tool name only updates activity", async () => {
  const ops = await eventToOps("PostToolUse", { session_id: "s1" }, state());
  assert(
    ops.some((op) => op.kind === "set" && op.key === "@pane_last_activity_at"),
  );
  assert(!ops.some((op) => op.key === "@pane_last_tool"));
});

Deno.test("eventToOps: PostToolUse publishes context pct when token_count is readable", async () => {
  const transcript =
    new URL("../fixtures/token-nested-ok.jsonl", import.meta.url).pathname;
  const ops = await eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_use_id: "u1",
      transcript_path: transcript,
    },
    state({ currentToolUseId: "u1" }),
  );
  assert(hasOp(ops, {
    kind: "set",
    key: "@pane_context_used_pct",
    value: "25",
  }));
});

Deno.test("eventToOps: normal event with missing token_count leaves context pct untouched", async () => {
  const transcript =
    new URL("../fixtures/token-missing.jsonl", import.meta.url).pathname;
  const ops = await eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_use_id: "u1",
      transcript_path: transcript,
    },
    state({ currentToolUseId: "u1" }),
  );
  assert(!ops.some((op) => op.key === "@pane_context_used_pct"));
});

Deno.test("eventToOps: PostToolUse records last tool and string Error response", async () => {
  const ops = await eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Bash",
      tool_use_id: "u1",
      tool_response: "Error: command failed",
    },
    state({ currentToolUseId: "u1" }),
  );
  assert(hasOp(ops, { kind: "set", key: "@pane_last_tool", value: "Bash" }));
  assert(hasOp(ops, {
    kind: "set",
    key: "@pane_last_tool_error",
    value: "command failed",
  }));
});

Deno.test("eventToOps: PostToolUse records last edit file when payload exposes file_path", async () => {
  const ops = await eventToOps(
    "PostToolUse",
    {
      session_id: "s1",
      tool_name: "Write",
      tool_use_id: "u1",
      tool_input: { file_path: "/tmp/project/app.ts", content: "ignored" },
    },
    state({ currentToolUseId: "u1" }),
  );
  assert(hasOp(ops, {
    kind: "set",
    key: "@pane_last_edit_file",
    value: "/tmp/project/app.ts",
  }));
});

Deno.test("eventToOps: child PostToolUse records last tool without self-heal or resume", async () => {
  const ops = await eventToOps(
    "PostToolUse",
    {
      session_id: "child",
      cwd: "/repo",
      tool_name: "Bash",
      tool_input: { command: "deno test" },
      tool_use_id: "u-child",
    },
    state({
      status: "waiting",
      currentTool: "Bash",
      currentToolUseId: "u-child",
      agent: "codex",
      sessionId: "parent",
      subagents: "Codex:child",
    }),
  );
  assert(hasOp(ops, { kind: "set", key: "@pane_last_tool", value: "Bash" }));
  assert(hasOp(ops, { kind: "unset", key: "@pane_current_tool" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_status", value: "running" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_session_id", value: "child" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_cwd", value: "/repo" }));
});

Deno.test("eventToOps: child PostToolUse does not resume error parent", async () => {
  const ops = await eventToOps(
    "PostToolUse",
    {
      session_id: "child",
      cwd: "/repo",
      tool_name: "Bash",
      tool_input: { command: "deno test" },
      tool_use_id: "u-child",
    },
    state({
      status: "error",
      currentTool: "Bash",
      currentToolUseId: "u-child",
      agent: "codex",
      sessionId: "parent",
      subagents: "Codex:child",
    }),
  );
  assert(hasOp(ops, { kind: "set", key: "@pane_last_tool", value: "Bash" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_status", value: "running" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_session_id", value: "child" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_cwd", value: "/repo" }));
});

Deno.test("eventToOps: Stop unsets context pct when transcript miss", async () => {
  const ops = await eventToOps(
    "Stop",
    { session_id: "s1", transcript_path: "/no/such/file.jsonl" },
    state(),
  );
  assert(hasParentStop(ops, null));
  assert(!hasOp(ops, { kind: "unset", key: "@pane_context_used_pct" }));
  assert(!hasOp(ops, { kind: "unset", key: "@pane_main_stopped" }));
});

Deno.test("eventToOps: Stop sets context pct when token_count is readable", async () => {
  const transcript =
    new URL("../fixtures/token-ok.jsonl", import.meta.url).pathname;
  const ops = await eventToOps(
    "Stop",
    { session_id: "s1", transcript_path: transcript },
    state(),
  );
  assert(hasParentStop(ops, "25"));
});

Deno.test("eventToOps: parent Stop delegates latest-list idle decision", async () => {
  const ops = await eventToOps(
    "Stop",
    { session_id: "parent", cwd: "/repo" },
    state({
      status: "running",
      agent: "codex",
      sessionId: "parent",
      subagents: "Codex:child",
    }),
  );
  assert(hasOp(ops, { kind: "set", key: "@pane_session_id", value: "parent" }));
  assert(hasParentStop(ops, null));
  assert(!hasOp(ops, { kind: "set", key: "@pane_main_stopped", value: "1" }));
});

Deno.test("eventToOps: unknown different Stop is treated as main stop", async () => {
  const ops = await eventToOps(
    "Stop",
    { session_id: "child-missing", cwd: "/repo" },
    state({
      status: "running",
      agent: "codex",
      sessionId: "parent",
      subagents: "Codex:child",
      mainStopped: true,
    }),
  );
  assert(hasOp(ops, {
    kind: "set",
    key: "@pane_session_id",
    value: "child-missing",
  }));
  assert(hasParentStop(ops, null));
});

Deno.test("eventToOps: child Stop does not self-heal parent identity", async () => {
  const ops = await eventToOps(
    "Stop",
    { session_id: "child", cwd: "/repo" },
    state({
      status: "running",
      agent: "codex",
      sessionId: "parent",
      subagents: "Codex:child",
      mainStopped: true,
    }),
  );
  assertEquals(ops, [{
    kind: "set",
    key: "@pane_subagents",
    value: "child",
    subagentMutation: { action: "remove", id: "child" },
  }]);
  assert(!hasOp(ops, { kind: "set", key: "@pane_session_id", value: "child" }));
});

Deno.test("eventToOps: PermissionRequest sets waiting permission", async () => {
  const ops = await eventToOps(
    "PermissionRequest",
    { session_id: "s1" },
    state(),
  );
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "waiting" }));
  assert(
    hasOp(ops, { kind: "set", key: "@pane_wait_reason", value: "permission" }),
  );
});

Deno.test("eventToOps: unknown different PermissionRequest wait-marks main", async () => {
  const ops = await eventToOps(
    "PermissionRequest",
    { session_id: "unknown-child", cwd: "/repo" },
    state({
      status: "running",
      agent: "codex",
      sessionId: "parent",
      subagents: "Codex:known-child",
    }),
  );
  assert(hasOp(ops, {
    kind: "set",
    key: "@pane_session_id",
    value: "unknown-child",
  }));
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "waiting" }));
  assert(
    hasOp(ops, { kind: "set", key: "@pane_wait_reason", value: "permission" }),
  );
});

Deno.test("eventToOps: child PermissionRequest does not wait-mark parent", async () => {
  assertEquals(
    await eventToOps(
      "PermissionRequest",
      { session_id: "child", cwd: "/repo" },
      state({
        status: "running",
        agent: "codex",
        sessionId: "parent",
        subagents: "Codex:child",
      }),
    ),
    [],
  );
});

Deno.test("eventToOps: PermissionRequest does not publish context pct", async () => {
  const transcript =
    new URL("../fixtures/token-nested-ok.jsonl", import.meta.url).pathname;
  const ops = await eventToOps(
    "PermissionRequest",
    { session_id: "s1", transcript_path: transcript },
    state(),
  );
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "waiting" }));
  assert(!ops.some((op) => op.key === "@pane_context_used_pct"));
});

Deno.test("eventToOps: child UserPromptSubmit does not self-heal parent identity", async () => {
  assertEquals(
    await eventToOps(
      "UserPromptSubmit",
      { session_id: "child", cwd: "/repo", prompt: "child prompt" },
      state({
        status: "running",
        agent: "codex",
        sessionId: "parent",
        subagents: "Codex:child",
      }),
    ),
    [],
  );
});

Deno.test("eventToOps: fresh different UserPromptSubmit does not self-heal parent identity", async () => {
  const ops = await eventToOps(
    "UserPromptSubmit",
    { session_id: "child", cwd: "/repo", prompt: "child prompt" },
    state({
      status: "running",
      agent: "codex",
      sessionId: "parent",
      lastActivityAt: String(Math.floor(Date.now() / 1000)),
    }),
  );
  assert(hasSubagentAdd(ops, "child"));
  assert(!hasOp(ops, { kind: "set", key: "@pane_session_id", value: "child" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_cwd", value: "/repo" }));
});

Deno.test("eventToOps: fresh different PreToolUse does not self-heal parent identity", async () => {
  const ops = await eventToOps(
    "PreToolUse",
    {
      session_id: "child",
      cwd: "/repo",
      tool_name: "Bash",
      tool_input: { command: "deno test" },
      tool_use_id: "u-child",
    },
    state({
      status: "running",
      agent: "codex",
      sessionId: "parent",
      lastActivityAt: String(Math.floor(Date.now() / 1000)),
    }),
  );
  assert(hasSubagentAdd(ops, "child"));
  assert(hasOp(ops, { kind: "set", key: "@pane_current_tool", value: "Bash" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_session_id", value: "child" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_cwd", value: "/repo" }));
});

Deno.test("eventToOps: fresh different PostToolUse does not self-heal parent identity", async () => {
  const ops = await eventToOps(
    "PostToolUse",
    {
      session_id: "child",
      cwd: "/repo",
      tool_name: "Bash",
      tool_input: { command: "deno test" },
      tool_use_id: "u-child",
    },
    state({
      status: "running",
      agent: "codex",
      sessionId: "parent",
      currentTool: "Bash",
      currentToolUseId: "u-child",
      lastActivityAt: String(Math.floor(Date.now() / 1000)),
    }),
  );
  assert(hasSubagentAdd(ops, "child"));
  assert(hasOp(ops, { kind: "set", key: "@pane_last_tool", value: "Bash" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_session_id", value: "child" }));
  assert(!hasOp(ops, { kind: "set", key: "@pane_cwd", value: "/repo" }));
});

Deno.test("eventToOps: unknown event is no-op", async () => {
  assertEquals(await eventToOps("Nope", { session_id: "s1" }, state()), []);
});

Deno.test("extractToolError: accepts string Error prefix only", () => {
  assertEquals(extractToolError("Error: failure"), "failure");
  assertEquals(extractToolError("ok"), null);
  assertEquals(extractToolError({ is_error: true }), null);
});

Deno.test("extractToolSubject: extracts safe compact subjects from known tools and MCP tools", () => {
  assertEquals(extractToolSubject("Bash", { command: "echo hi" }), "echo hi");
  assertEquals(
    extractToolSubject("Read", { file_path: "/tmp/app.ts" }),
    "app.ts",
  );
  assertEquals(
    extractToolSubject("WebFetch", { url: "https://example.com/a" }),
    "example.com",
  );
  assertEquals(extractToolSubject("mcp__docs__search", {}), "mcp: docs");
  assertEquals(extractToolSubject("Edit", { file_path: "/tmp/app.ts" }), "");
});

Deno.test("extractEditFile: extracts edit-family file paths and strips controls", () => {
  assertEquals(
    extractEditFile("Write", { file_path: "/tmp/a\nb.ts" }),
    "/tmp/a b.ts",
  );
  assertEquals(extractEditFile("Bash", { file_path: "/tmp/a.ts" }), "");
});

Deno.test("buildRunLog: records metadata without raw option values", () => {
  const log = buildRunLog({
    event: "PostToolUse",
    data: {
      hook_event_name: "PostToolUse",
      session_id: "s1",
      cwd: "/repo",
    },
    pane: "%1",
    state: state({ status: "running" }),
    ops: [{ kind: "set", key: "@pane_status", value: "idle" }],
    earlyExit: null,
    stdinEventMismatch: false,
    now: new Date("2026-05-04T00:00:00Z"),
  });
  assertEquals(log.ts, "2026-05-04T00:00:00.000Z");
  assertEquals(log.ops, [{ kind: "set", key: "@pane_status" }]);
  assertEquals(log.session_id, "s1");
});

Deno.test("commandOutput: handles null streams without masking exit code", async () => {
  const result = await commandOutput("/bin/echo", ["hi"], {
    stdout: "null",
    stderr: "piped",
  });
  assertEquals(result, { code: 0, stdout: "", stderr: "" });
});

Deno.test("extractTokenPct: reads latest token_count from 64KB tail", async () => {
  const path = new URL("../fixtures/token-ok.jsonl", import.meta.url).pathname;
  assertEquals(await extractTokenPct(path), 25);
});

Deno.test("extractTokenPct: reads current nested event_msg token_count shape", async () => {
  const path = new URL("../fixtures/token-nested-ok.jsonl", import.meta.url)
    .pathname;
  assertEquals(await extractTokenPct(path), 25);
});

Deno.test("extractTokenPct: uses last usage instead of cumulative session total", async () => {
  const path = new URL(
    "../fixtures/token-cumulative-over-window.jsonl",
    import.meta.url,
  ).pathname;
  assertEquals(await extractTokenPct(path), 11);
});

Deno.test("extractTokenPct: token_count missing / zero window / file missing return null", async () => {
  const missing = new URL("../fixtures/token-missing.jsonl", import.meta.url)
    .pathname;
  const zero = new URL("../fixtures/token-zero-window.jsonl", import.meta.url)
    .pathname;
  assertEquals(await extractTokenPct(missing), null);
  assertEquals(await extractTokenPct(zero), null);
  assertEquals(await extractTokenPct("/definitely/not/found.jsonl"), null);
});

Deno.test("extractTokenPct: clamps percentages above 100", async () => {
  const path = new URL("../fixtures/token-over-window.jsonl", import.meta.url)
    .pathname;
  assertEquals(await extractTokenPct(path), 100);
});

Deno.test("main: no TMUX_PANE exits gracefully and writes no stdout", async () => {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-env=HOME,TMUX_PANE",
      "--allow-read",
      "--allow-write",
      "--allow-run=tmux,ps",
      "home/programs/codex/scripts/codex-pane-status.ts",
      "SessionStart",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    env: { TMUX_PANE: "" },
  });
  const child = cmd.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode(JSON.stringify({ session_id: "s1" })),
  );
  await writer.close();
  const { code, stdout } = await child.output();
  assertEquals(code, 0);
  assertEquals(stdout.length, 0);
});

Deno.test("main: invalid TMUX_PANE exits gracefully and writes no stdout", async () => {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-env=HOME,TMUX_PANE",
      "--allow-read",
      "--allow-write",
      "--allow-run=tmux,ps",
      "home/programs/codex/scripts/codex-pane-status.ts",
      "SessionStart",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    env: { TMUX_PANE: "-L" },
  });
  const child = cmd.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode(JSON.stringify({ session_id: "s1" })),
  );
  await writer.close();
  const { code, stdout } = await child.output();
  assertEquals(code, 0);
  assertEquals(stdout.length, 0);
});
// === Phase B.1: fixture-based op-array baselines ===
// Locked-in current behavior so Phase B.2 (import-substitution)
// and Phase C (transition-builder migration) can prove bit-
// identical Op[] output. Generated from capture-codex-fixtures.ts.
// Identifiers are b1-prefixed to avoid collision with existing helpers.

const B1_TS_KEYS = new Set(["@pane_started_at", "@pane_last_activity_at"]);

function b1Normalize(ops: PaneOp[]): PaneOp[] {
  return ops.map((op) =>
    op.kind === "set" && B1_TS_KEYS.has(op.key)
      ? { kind: "set" as const, key: op.key, value: "<NORMALIZED>" }
      : op
  );
}

const b1State: PaneState = {
  status: "",
  currentTool: "",
  currentToolUseId: "",
  agent: "",
  sessionId: "",
  subagents: "",
  mainStopped: false,
  lastActivityAt: "",
};

Deno.test("Phase B.1 fixture: SessionStart fresh", async () => {
  const ops = b1Normalize(
    await eventToOps(
      "SessionStart",
      { session_id: "test-sid", cwd: "/repo" },
      b1State,
    ),
  );
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "codex" },
    { kind: "set", key: "@pane_session_id", value: "test-sid" },
    { kind: "set", key: "@pane_cwd", value: "/repo" },
    { kind: "unset", key: "@pane_status" },
    { kind: "unset", key: "@pane_started_at" },
    { kind: "unset", key: "@pane_prompt" },
    { kind: "unset", key: "@pane_wait_reason" },
    { kind: "unset", key: "@pane_current_tool" },
    { kind: "unset", key: "@pane_current_tool_use_id" },
    { kind: "unset", key: "@pane_last_tool" },
    { kind: "unset", key: "@pane_last_activity_at" },
    { kind: "unset", key: "@pane_context_used_pct" },
    { kind: "unset", key: "@pane_last_tool_error" },
    { kind: "unset", key: "@pane_subagents" },
    { kind: "unset", key: "@pane_pending_subagent_notifications" },
    { kind: "unset", key: "@pane_pending_teardown" },
    { kind: "unset", key: "@pane_main_stopped" },
    { kind: "unset", key: "@pane_worktree_branch" },
    { kind: "unset", key: "@pane_worktree_path" },
    { kind: "unset", key: "@pane_last_edit_file" },
    { kind: "unset", key: "@pane_current_tool_subject" },
    { kind: "unset", key: "@pane_last_tool_subject" },
    { kind: "set", key: "@pane_status", value: "idle" },
    { kind: "set", key: "@pane_last_activity_at", value: "<NORMALIZED>" },
  ]);
});

Deno.test("Phase B.1 fixture: SessionStart resume", async () => {
  const ops = b1Normalize(
    await eventToOps("SessionStart", {
      session_id: "test-sid",
      cwd: "/repo",
      source: "resume",
    }, { ...b1State, agent: "codex", sessionId: "test-sid" }),
  );
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "codex" },
    { kind: "set", key: "@pane_session_id", value: "test-sid" },
    { kind: "set", key: "@pane_cwd", value: "/repo" },
    { kind: "unset", key: "@pane_subagents" },
    { kind: "unset", key: "@pane_pending_teardown" },
    { kind: "unset", key: "@pane_main_stopped" },
    { kind: "unset", key: "@pane_worktree_branch" },
    { kind: "unset", key: "@pane_worktree_path" },
    { kind: "unset", key: "@pane_current_tool" },
    { kind: "unset", key: "@pane_current_tool_use_id" },
    { kind: "unset", key: "@pane_wait_reason" },
    { kind: "unset", key: "@pane_pending_subagent_notifications" },
    { kind: "set", key: "@pane_status", value: "idle" },
    { kind: "set", key: "@pane_last_activity_at", value: "<NORMALIZED>" },
  ]);
});

Deno.test("Phase B.1 fixture: UserPromptSubmit with prompt", async () => {
  const ops = b1Normalize(
    await eventToOps("UserPromptSubmit", {
      session_id: "test-sid",
      cwd: "/repo",
      prompt: "do the thing",
    }, b1State),
  );
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "codex" },
    { kind: "set", key: "@pane_session_id", value: "test-sid" },
    { kind: "set", key: "@pane_cwd", value: "/repo" },
    { kind: "set", key: "@pane_status", value: "running" },
    { kind: "set", key: "@pane_started_at", value: "<NORMALIZED>" },
    { kind: "set", key: "@pane_last_activity_at", value: "<NORMALIZED>" },
    { kind: "set", key: "@pane_prompt", value: "do the thing" },
    { kind: "unset", key: "@pane_main_stopped" },
  ]);
});

Deno.test("Phase B.1 fixture: PreToolUse Bash with tool_use_id", async () => {
  const ops = b1Normalize(
    await eventToOps("PreToolUse", {
      session_id: "test-sid",
      cwd: "/repo",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
      tool_use_id: "test-tool-use",
    }, b1State),
  );
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "codex" },
    { kind: "set", key: "@pane_session_id", value: "test-sid" },
    { kind: "set", key: "@pane_cwd", value: "/repo" },
    { kind: "set", key: "@pane_current_tool", value: "Bash" },
    { kind: "set", key: "@pane_current_tool_subject", value: "ls -la" },
    { kind: "set", key: "@pane_current_tool_use_id", value: "test-tool-use" },
  ]);
});

Deno.test("Phase B.1 fixture: PostToolUse Bash success", async () => {
  const ops = b1Normalize(
    await eventToOps("PostToolUse", {
      session_id: "test-sid",
      cwd: "/repo",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
      tool_response: { stdout: "out" },
      tool_use_id: "test-tool-use",
    }, { ...b1State, currentTool: "Bash", currentToolUseId: "test-tool-use" }),
  );
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "codex" },
    { kind: "set", key: "@pane_session_id", value: "test-sid" },
    { kind: "set", key: "@pane_cwd", value: "/repo" },
    { kind: "set", key: "@pane_last_activity_at", value: "<NORMALIZED>" },
    { kind: "unset", key: "@pane_current_tool" },
    { kind: "unset", key: "@pane_current_tool_use_id" },
    { kind: "unset", key: "@pane_current_tool_subject" },
    { kind: "set", key: "@pane_last_tool", value: "Bash" },
    { kind: "set", key: "@pane_last_tool_subject", value: "ls -la" },
    { kind: "unset", key: "@pane_last_edit_file" },
    { kind: "unset", key: "@pane_last_tool_error" },
  ]);
});

Deno.test("Phase B.1 fixture: PostToolUse Bash error", async () => {
  const ops = b1Normalize(
    await eventToOps("PostToolUse", {
      session_id: "test-sid",
      cwd: "/repo",
      tool_name: "Bash",
      tool_input: { command: "false" },
      tool_response: "Error: command failed",
      tool_use_id: "test-tool-use",
    }, { ...b1State, currentTool: "Bash", currentToolUseId: "test-tool-use" }),
  );
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "codex" },
    { kind: "set", key: "@pane_session_id", value: "test-sid" },
    { kind: "set", key: "@pane_cwd", value: "/repo" },
    { kind: "set", key: "@pane_last_activity_at", value: "<NORMALIZED>" },
    { kind: "unset", key: "@pane_current_tool" },
    { kind: "unset", key: "@pane_current_tool_use_id" },
    { kind: "unset", key: "@pane_current_tool_subject" },
    { kind: "set", key: "@pane_last_tool", value: "Bash" },
    { kind: "set", key: "@pane_last_tool_subject", value: "false" },
    { kind: "unset", key: "@pane_last_edit_file" },
    { kind: "set", key: "@pane_last_tool_error", value: "command failed" },
  ]);
});

Deno.test("Phase B.1 fixture: Stop", async () => {
  const ops = b1Normalize(
    await eventToOps("Stop", { session_id: "test-sid", cwd: "/repo" }, b1State),
  );
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "codex" },
    { kind: "set", key: "@pane_session_id", value: "test-sid" },
    { kind: "set", key: "@pane_cwd", value: "/repo" },
    {
      kind: "set",
      key: "@pane_status",
      value: "idle",
      parentStop: { contextPct: null },
    },
  ]);
});

Deno.test("Phase B.1 fixture: PermissionRequest", async () => {
  const ops = b1Normalize(
    await eventToOps("PermissionRequest", {
      session_id: "test-sid",
      cwd: "/repo",
    }, b1State),
  );
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "codex" },
    { kind: "set", key: "@pane_session_id", value: "test-sid" },
    { kind: "set", key: "@pane_cwd", value: "/repo" },
    { kind: "set", key: "@pane_status", value: "waiting" },
    { kind: "set", key: "@pane_wait_reason", value: "permission" },
  ]);
});
