import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import {
  buildLLMInput,
  buildWorkerArgs,
  extractAssistantTexts,
  extractToolSummary,
  extractUserTexts,
  heuristicSummary,
  isSubagentTranscript,
  validateHookData,
} from "./codex-memo.ts";

// Shared helpers (resolveRepoName, escapeObsidianSyntax, parseLLMOutput,
// upsertDailyNote) are now tested in
// home/programs/agents/memo/memo-shared_test.ts. codex-memo_test.ts only
// covers Codex-specific transcript parsing, prompt-building, and hook-data
// validation.

const entries = [
  {
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: "# AGENTS.md instructions\nnoise",
      }],
    },
  },
  {
    type: "event_msg",
    payload: {
      type: "user_message",
      message: "codexのhooksを改善してObsidianに作業内容を残したい",
    },
  },
  {
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      phase: "commentary",
      content: [{ type: "output_text", text: "関連hookを確認します。" }],
    },
  },
  {
    type: "response_item",
    payload: { type: "function_call", name: "exec_command" },
  },
  {
    type: "response_item",
    payload: { type: "function_call", name: "exec_command" },
  },
  {
    type: "response_item",
    payload: { type: "function_call", name: "apply_patch" },
  },
  {
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "実装が完了しました。" }],
    },
  },
];

Deno.test("extractors: read Codex user, assistant, and tool events", () => {
  assertEquals(extractUserTexts(entries).length, 2);
  assertEquals(extractAssistantTexts(entries), [
    "関連hookを確認します。",
    "実装が完了しました。",
  ]);
  assertEquals(extractToolSummary(entries), "exec_command: 2, apply_patch: 1");
});

Deno.test("heuristicSummary: skips injected prompt noise", () => {
  assertEquals(
    heuristicSummary(entries),
    "codexのhooksを改善してObsidianに作業内容を残したい",
  );
});

Deno.test("buildLLMInput: includes compact user prompts, assistant text, and tools", () => {
  const input = buildLLMInput(entries);
  assertStringIncludes(input, "[User prompts]");
  assertStringIncludes(input, "codexのhooksを改善");
  assertStringIncludes(input, "[First assistant response]");
  assertStringIncludes(input, "[Last assistant response]");
  assertStringIncludes(input, "exec_command: 2");
});

Deno.test("buildWorkerArgs: produces a stable detached argv", () => {
  const hookData = {
    session_id: "019df142-b1b6-7700-ac46-22521b61a981",
    transcript_path:
      "/Users/me/.codex/sessions/2026/05/04/rollout-019df142.jsonl",
    cwd: "/Users/me/dotfiles",
  };
  const scriptPath = "/Users/me/.codex/scripts/codex-memo.ts";
  assertEquals(buildWorkerArgs(scriptPath, hookData), [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-env=HOME,TMPDIR",
    "--allow-run=git,gemini",
    scriptPath,
    "--worker",
    JSON.stringify(hookData),
  ]);
});

Deno.test("isSubagentTranscript: detects subagent thread_spawn source", () => {
  const subagentEntries = [
    {
      type: "session_meta",
      payload: {
        id: "019dfb77-c077-7d73-bdfb-cb1b48fb2bfd",
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: "019dfb1c-faa2-7261-93a8-396b9bca5ade",
              depth: 1,
              agent_role: "code-reviewer",
            },
          },
        },
      },
    },
    {
      type: "event_msg",
      payload: { type: "user_message", message: "Code Quality review..." },
    },
  ];
  assertEquals(isSubagentTranscript(subagentEntries), true);
});

Deno.test("isSubagentTranscript: returns false for parent cli source", () => {
  const parentEntries = [
    {
      type: "session_meta",
      payload: {
        id: "019dfb1c-faa2-7261-93a8-396b9bca5ade",
        source: "cli",
      },
    },
    {
      type: "event_msg",
      payload: { type: "user_message", message: "親プロンプト" },
    },
  ];
  assertEquals(isSubagentTranscript(parentEntries), false);
});

Deno.test("isSubagentTranscript: returns false when session_meta missing", () => {
  // existing fixture (entries) has no session_meta — represents a transcript
  // where the meta line failed to parse. Treat as non-subagent (memo continues).
  assertEquals(isSubagentTranscript(entries), false);
});

Deno.test("isSubagentTranscript: returns false for unknown source shape (object without subagent key)", () => {
  const unknownEntries = [
    {
      type: "session_meta",
      payload: {
        id: "future-id",
        source: { user: { foo: "bar" } },
      },
    },
  ];
  assertEquals(isSubagentTranscript(unknownEntries), false);
});

Deno.test("validateHookData: accepts valid HookData and rejects malformed input", () => {
  // valid: passes through with same shape
  assertEquals(
    validateHookData({
      session_id: "abc",
      transcript_path: "/path/to/jsonl",
      cwd: "/Users/me",
    }),
    {
      session_id: "abc",
      transcript_path: "/path/to/jsonl",
      cwd: "/Users/me",
    },
  );

  // valid: cwd is optional
  assertEquals(
    validateHookData({ session_id: "abc", transcript_path: "/p" }),
    { session_id: "abc", transcript_path: "/p", cwd: undefined },
  );

  // null
  assertEquals(validateHookData(null), null);

  // array
  assertEquals(validateHookData([]), null);

  // wrong session_id type
  assertEquals(
    validateHookData({ session_id: 42, transcript_path: "/x" }),
    null,
  );

  // empty session_id
  assertEquals(
    validateHookData({ session_id: "", transcript_path: "/x" }),
    null,
  );

  // null transcript_path
  assertEquals(
    validateHookData({ session_id: "x", transcript_path: null }),
    null,
  );

  // wrong cwd type
  assertEquals(
    validateHookData({ session_id: "x", transcript_path: "/y", cwd: 42 }),
    null,
  );
});
