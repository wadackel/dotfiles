import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import {
  buildLLMInput,
  buildWorkerArgs,
  extractAssistantTexts,
  extractToolSummary,
  extractUserTexts,
  type HookLogEntry,
  heuristicSummary,
  readHookLogEntriesForSession,
  validateHookData,
} from "./codex-memo.ts";

// Shared helpers (resolveRepoName, escapeObsidianSyntax, parseLLMOutput,
// upsertDailyNote) are tested in memo-shared_test.ts. This suite covers Codex
// hooks.jsonl parsing, prompt-building, and hook-data validation.

const SESSION = "abc12345-aaaa-bbbb-cccc-000000000001";

function makeEntry(
  event: string,
  payload: Record<string, unknown>,
  overrides: Partial<HookLogEntry> = {},
): HookLogEntry {
  return {
    ts: "2026-07-09T00:00:00.000Z",
    event,
    session_id: SESSION,
    cwd: "/Users/me/repo",
    tool_name: "",
    payload,
    ...overrides,
  };
}

const entries: HookLogEntry[] = [
  makeEntry("UserPromptSubmit", {
    prompt: "# AGENTS.md instructions\nnoise",
  }),
  makeEntry("UserPromptSubmit", {
    prompt: "codexのhooksを改善してObsidianに作業内容を残したい",
  }),
  makeEntry("PreToolUse", {}, { tool_name: "exec_command" }),
  makeEntry("PreToolUse", {}, { tool_name: "exec_command" }),
  makeEntry("PreToolUse", {}, { tool_name: "apply_patch" }),
  makeEntry("Stop", { last_assistant_message: "関連hookを確認します。" }),
  makeEntry("Stop", { last_assistant_message: "実装が完了しました。" }),
];

Deno.test("extractors: read Codex UserPromptSubmit / Stop / PreToolUse", () => {
  assertEquals(extractUserTexts(entries).length, 2);
  assertEquals(extractAssistantTexts(entries), [
    "関連hookを確認します。",
    "実装が完了しました。",
  ]);
  assertEquals(extractToolSummary(entries), "exec_command: 2, apply_patch: 1");
});

Deno.test("extractUserTexts: skips _truncated, non-string, empty prompt", () => {
  const noisy: HookLogEntry[] = [
    makeEntry("UserPromptSubmit", { _truncated: true, keys: ["prompt"] }),
    makeEntry("UserPromptSubmit", { prompt: 42 }),
    makeEntry("UserPromptSubmit", { prompt: "" }),
    makeEntry("UserPromptSubmit", { prompt: "keeper" }),
  ];
  assertEquals(extractUserTexts(noisy), ["keeper"]);
});

Deno.test("extractAssistantTexts: skips _truncated, non-string, empty message", () => {
  const noisy: HookLogEntry[] = [
    makeEntry("Stop", { _truncated: true, keys: ["last_assistant_message"] }),
    makeEntry("Stop", { last_assistant_message: null }),
    makeEntry("Stop", { last_assistant_message: "" }),
    makeEntry("Stop", { last_assistant_message: "keeper" }),
  ];
  assertEquals(extractAssistantTexts(noisy), ["keeper"]);
});

Deno.test("extractToolSummary: aggregates entry-level tool_name only", () => {
  const mixed: HookLogEntry[] = [
    makeEntry("PreToolUse", { tool_name: "buried_in_payload_ignored" }, {
      tool_name: "a",
    }),
    makeEntry("PreToolUse", {}, { tool_name: "a" }),
    makeEntry("PreToolUse", {}, { tool_name: "b" }),
    makeEntry("PreToolUse", {}, { tool_name: "" }),
    makeEntry("Stop", { last_assistant_message: "not counted" }),
  ];
  assertEquals(extractToolSummary(mixed), "a: 2, b: 1");
});

Deno.test("heuristicSummary: skips injected prompt noise", () => {
  assertEquals(
    heuristicSummary(entries),
    "codexのhooksを改善してObsidianに作業内容を残したい",
  );
});

Deno.test("heuristicSummary / buildLLMInput: safe on empty entries", () => {
  assertEquals(heuristicSummary([]), "");
  assertEquals(buildLLMInput([]), "");
});

Deno.test("heuristicSummary: falls back to first assistant when only Stop present", () => {
  const stopOnly: HookLogEntry[] = [
    makeEntry("Stop", { last_assistant_message: "first assistant reply" }),
  ];
  assertEquals(heuristicSummary(stopOnly), "first assistant reply");
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
    session_id: SESSION,
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

Deno.test("validateHookData: session_id required, cwd optional, transcript_path irrelevant", () => {
  assertEquals(
    validateHookData({ session_id: "abc", cwd: "/Users/me" }),
    { session_id: "abc", cwd: "/Users/me" },
  );

  assertEquals(
    validateHookData({ session_id: "abc" }),
    { session_id: "abc", cwd: undefined },
  );

  assertEquals(
    validateHookData({ session_id: "abc", transcript_path: null }),
    { session_id: "abc", cwd: undefined },
  );

  assertEquals(validateHookData(null), null);
  assertEquals(validateHookData([]), null);
  assertEquals(validateHookData({ session_id: 42 }), null);
  assertEquals(validateHookData({ session_id: "" }), null);
  assertEquals(validateHookData({ session_id: "x", cwd: 42 }), null);
});

Deno.test("readHookLogEntriesForSession: filters by session and event, tolerates parse errors", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/hooks.jsonl`;
  const otherSession = "def45678-aaaa-bbbb-cccc-000000000002";
  const lines = [
    JSON.stringify({
      ts: "t1",
      event: "UserPromptSubmit",
      session_id: SESSION,
      cwd: "/w",
      tool_name: "",
      payload: { prompt: "first" },
    }),
    "not json at all",
    JSON.stringify({
      ts: "t2",
      event: "PreToolUse",
      session_id: otherSession,
      cwd: "/w",
      tool_name: "shell",
      payload: {},
    }),
    JSON.stringify({
      ts: "t3",
      event: "Stop",
      session_id: SESSION,
      cwd: "/w",
      tool_name: "",
      payload: { last_assistant_message: "done" },
    }),
    JSON.stringify({
      ts: "t4",
      event: "SessionStart",
      session_id: SESSION,
      cwd: "/w",
      tool_name: "",
      payload: {},
    }),
    "",
  ];
  await Deno.writeTextFile(path, lines.join("\n"));

  const filtered = readHookLogEntriesForSession(path, SESSION, {
    types: ["UserPromptSubmit", "Stop"],
  });
  assertEquals(filtered.map((e) => `${e.event}:${e.ts}`), [
    "UserPromptSubmit:t1",
    "Stop:t3",
  ]);

  const allEvents = readHookLogEntriesForSession(path, SESSION);
  assertEquals(allEvents.length, 3);
});

Deno.test("readHookLogEntriesForSession: missing file returns empty array", () => {
  const missing = readHookLogEntriesForSession(
    "/tmp/does-not-exist-hooks.jsonl",
    SESSION,
  );
  assertEquals(missing, []);
});

Deno.test("readHookLogEntriesForSession: rejects malformed entries (missing required fields, wrong types)", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/hooks.jsonl`;
  const lines = [
    JSON.stringify({
      ts: "t1",
      event: "UserPromptSubmit",
      session_id: SESSION,
      cwd: "/w",
      tool_name: "",
      payload: { prompt: "valid" },
    }),
    // missing tool_name
    JSON.stringify({
      ts: "t2",
      event: "Stop",
      session_id: SESSION,
      cwd: "/w",
      payload: {},
    }),
    // payload is an array, not an object
    JSON.stringify({
      ts: "t3",
      event: "Stop",
      session_id: SESSION,
      cwd: "/w",
      tool_name: "",
      payload: [],
    }),
    // session_id is a number
    JSON.stringify({
      ts: "t4",
      event: "Stop",
      session_id: 42,
      cwd: "/w",
      tool_name: "",
      payload: {},
    }),
    // top-level array
    JSON.stringify([1, 2, 3]),
    // top-level null
    "null",
  ];
  await Deno.writeTextFile(path, lines.join("\n"));

  const entries = readHookLogEntriesForSession(path, SESSION);
  assertEquals(entries.length, 1);
  assertEquals(entries[0].ts, "t1");
});
