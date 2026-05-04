import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  eventToOps,
  extractTokenPct,
  extractToolError,
  maskPrompt,
  type Op,
  type PaneState,
  selfHealOps,
} from "./codex-pane-status.ts";

function state(overrides: Partial<PaneState> = {}): PaneState {
  return {
    status: "",
    currentTool: "",
    currentToolUseId: "",
    agent: "",
    sessionId: "",
    ...overrides,
  };
}

function hasOp(ops: Op[], expected: Op): boolean {
  return ops.some((op) => JSON.stringify(op) === JSON.stringify(expected));
}

Deno.test("selfHealOps: session id missing returns no ops", () => {
  assertEquals(selfHealOps({}), []);
});

Deno.test("selfHealOps: sets codex session and cwd", () => {
  assertEquals(selfHealOps({ session_id: "s1", cwd: "/tmp/x" }), [
    { kind: "set", key: "@pane_agent", value: "codex" },
    { kind: "set", key: "@pane_session_id", value: "s1" },
    { kind: "set", key: "@pane_cwd", value: "/tmp/x" },
  ]);
});

Deno.test("maskPrompt: strips controls, collapses whitespace, truncates", () => {
  assertEquals(maskPrompt("hello\n\tworld"), "hello world");
  assertEquals(maskPrompt("x".repeat(45)), "x".repeat(40) + "...");
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
    { session_id: "s1", tool_name: "Bash", tool_use_id: "u1" },
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
});

Deno.test("eventToOps: PreToolUse without tool name is no-op", async () => {
  assertEquals(
    await eventToOps("PreToolUse", { session_id: "s1" }, state()),
    [],
  );
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

Deno.test("eventToOps: Stop unsets context pct when transcript miss", async () => {
  const ops = await eventToOps(
    "Stop",
    { session_id: "s1", transcript_path: "/no/such/file.jsonl" },
    state(),
  );
  assert(hasOp(ops, { kind: "set", key: "@pane_status", value: "idle" }));
  assert(hasOp(ops, { kind: "unset", key: "@pane_context_used_pct" }));
});

Deno.test("eventToOps: Stop sets context pct when token_count is readable", async () => {
  const transcript =
    new URL("./fixtures/token-ok.jsonl", import.meta.url).pathname;
  const ops = await eventToOps(
    "Stop",
    { session_id: "s1", transcript_path: transcript },
    state(),
  );
  assert(
    hasOp(ops, { kind: "set", key: "@pane_context_used_pct", value: "25" }),
  );
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

Deno.test("eventToOps: unknown event is no-op", async () => {
  assertEquals(await eventToOps("Nope", { session_id: "s1" }, state()), []);
});

Deno.test("extractToolError: accepts string Error prefix only", () => {
  assertEquals(extractToolError("Error: failure"), "failure");
  assertEquals(extractToolError("ok"), null);
  assertEquals(extractToolError({ is_error: true }), null);
});

Deno.test("extractTokenPct: reads latest token_count from 64KB tail", async () => {
  const path = new URL("./fixtures/token-ok.jsonl", import.meta.url).pathname;
  assertEquals(await extractTokenPct(path), 25);
});

Deno.test("extractTokenPct: token_count missing / zero window / file missing return null", async () => {
  const missing = new URL("./fixtures/token-missing.jsonl", import.meta.url)
    .pathname;
  const zero = new URL("./fixtures/token-zero-window.jsonl", import.meta.url)
    .pathname;
  assertEquals(await extractTokenPct(missing), null);
  assertEquals(await extractTokenPct(zero), null);
  assertEquals(await extractTokenPct("/definitely/not/found.jsonl"), null);
});

Deno.test("extractTokenPct: clamps percentages above 100", async () => {
  const path = new URL("./fixtures/token-over-window.jsonl", import.meta.url)
    .pathname;
  assertEquals(await extractTokenPct(path), 100);
});

Deno.test("main: no TMUX_PANE exits gracefully and writes no stdout", async () => {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-env=TMUX_PANE",
      "--allow-read",
      "--allow-run=tmux",
      "home/programs/codex/codex-pane-status.ts",
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
      "--allow-env=TMUX_PANE",
      "--allow-read",
      "--allow-run=tmux",
      "home/programs/codex/codex-pane-status.ts",
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
