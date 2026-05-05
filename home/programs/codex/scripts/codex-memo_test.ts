import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import {
  buildLLMInput,
  buildWorkerArgs,
  escapeObsidianSyntax,
  extractAssistantTexts,
  extractToolSummary,
  extractUserTexts,
  heuristicSummary,
  parseLLMOutput,
  resolveRepoName,
  upsertDailyNote,
  validateHookData,
} from "./codex-memo.ts";

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

Deno.test("parseLLMOutput: accepts summary plus bullet details", () => {
  assertEquals(
    parseLLMOutput(
      "Codex hookのメモ連携を実装した\n- Stop hookを追加\n- テストを追加",
    ),
    {
      summary: "Codex hookのメモ連携を実装した",
      details: ["Stop hookを追加", "テストを追加"],
    },
  );
});

Deno.test("resolveRepoName: handles normal repos and worktrees", () => {
  assertEquals(resolveRepoName("/Users/me/repo", ".git"), "repo");
  assertEquals(
    resolveRepoName("/Users/me/worktrees/feat", "/Users/me/repo/.git"),
    "repo",
  );
  assertEquals(
    resolveRepoName("/Users/me/repo/.worktrees/feat", "../../.git"),
    "repo",
  );
});

Deno.test("upsertDailyNote: inserts before Reading and replaces existing details", async () => {
  const dir = await Deno.makeTempDir();
  const daily = `${dir}/daily.md`;
  await Deno.writeTextFile(
    daily,
    [
      "## 🧠 Work",
      "",
      "## 📕 Reading",
      "",
    ].join("\n"),
  );

  upsertDailyNote(daily, "abc12345", [
    "- 11:00 - `(repo/abc12345)` first",
    "    - detail",
  ]);
  assertEquals(
    await Deno.readTextFile(daily),
    [
      "## 🧠 Work",
      "- 11:00 - `(repo/abc12345)` first",
      "    - detail",
      "",
      "## 📕 Reading",
      "",
    ].join("\n"),
  );

  upsertDailyNote(daily, "abc12345", [
    "- 11:05 - `(repo/abc12345)` second",
  ]);
  assertEquals(
    await Deno.readTextFile(daily),
    [
      "## 🧠 Work",
      "- 11:05 - `(repo/abc12345)` second",
      "",
      "## 📕 Reading",
      "",
    ].join("\n"),
  );
});

Deno.test("escapeObsidianSyntax: matches Claude memo hash escaping", () => {
  assertEquals(
    escapeObsidianSyntax("#tag and issue #123"),
    "＃tag and issue ＃123",
  );
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
