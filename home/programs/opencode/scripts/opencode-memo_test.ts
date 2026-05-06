import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import {
  buildLLMInput,
  countUserMessages,
  formatToolSummary,
  heuristicSummary,
  isNoise,
  parseRows,
  validateHookData,
  type MessageRow,
  type PartRow,
} from "./opencode-memo.ts";
import { upsertDailyNote } from "../../agents/memo/memo-shared.ts";

const messages: MessageRow[] = [
  { id: "m1", role: "user" },
  { id: "m2", role: "assistant" },
  { id: "m3", role: "assistant" },
];

const parts: PartRow[] = [
  { message_id: "m1", type: "text", text: "opencodeのhooksを改善したい", tool: null },
  { message_id: "m2", type: "step-start", text: null, tool: null },
  { message_id: "m2", type: "reasoning", text: "thinking quietly", tool: null },
  { message_id: "m2", type: "text", text: "関連箇所を確認します。", tool: null },
  { message_id: "m2", type: "tool", text: null, tool: "glob" },
  { message_id: "m2", type: "tool", text: null, tool: "read" },
  { message_id: "m2", type: "step-finish", text: null, tool: null },
  { message_id: "m3", type: "tool", text: null, tool: "glob" },
  { message_id: "m3", type: "patch", text: null, tool: null },
  { message_id: "m3", type: "text", text: "実装が完了しました。", tool: null },
];

Deno.test("parseRows: groups by role, captures text + tool counts", () => {
  const out = parseRows(messages, parts);
  assertEquals(out.user, ["opencodeのhooksを改善したい"]);
  assertEquals(out.assistant, ["関連箇所を確認します。", "実装が完了しました。"]);
  assertEquals(out.toolCounts.get("glob"), 2);
  assertEquals(out.toolCounts.get("read"), 1);
  assertEquals(out.toolCounts.size, 2);
});

Deno.test("parseRows: ignores reasoning / step-start / step-finish / patch types", () => {
  const out = parseRows(messages, parts);
  // assistant text count should be 2, not include reasoning string
  assertEquals(out.assistant.length, 2);
  for (const a of out.assistant) {
    assertEquals(a.includes("thinking quietly"), false);
  }
});

Deno.test("parseRows: orphan part (unknown message_id) is silently dropped", () => {
  const out = parseRows(messages, [
    { message_id: "missing", type: "text", text: "ghost", tool: null },
  ]);
  assertEquals(out.user, []);
  assertEquals(out.assistant, []);
});

Deno.test("formatToolSummary: top-5, descending, comma-separated", () => {
  const m = new Map([["a", 5], ["b", 1], ["c", 3]]);
  assertEquals(formatToolSummary(m), "a: 5, c: 3, b: 1");
  assertEquals(formatToolSummary(new Map()), "");
});

Deno.test("isNoise: short / slash-prefixed / template noise / locale yes/no", () => {
  assertEquals(isNoise("ok"), true);
  assertEquals(isNoise("はい"), true);
  assertEquals(isNoise("/plan"), true);
  assertEquals(isNoise("<command-message>foo"), true);
  assertEquals(isNoise("# AGENTS.md instructions\nnoise"), true);
  assertEquals(isNoise("実装したい機能の説明"), false);
});

Deno.test("heuristicSummary: prefers first non-noise user prompt", () => {
  const out = parseRows(messages, parts);
  assertEquals(heuristicSummary(out), "opencodeのhooksを改善したい");
});

Deno.test("heuristicSummary: falls back to first assistant text when user is noise", () => {
  const noisyUserParts: PartRow[] = [
    { message_id: "m1", type: "text", text: "ok", tool: null },
    { message_id: "m2", type: "text", text: "応答テキスト本文", tool: null },
  ];
  const out = parseRows(messages, noisyUserParts);
  assertEquals(heuristicSummary(out), "応答テキスト本文");
});

Deno.test("heuristicSummary: falls back to tool summary when no text at all", () => {
  const onlyToolParts: PartRow[] = [
    { message_id: "m2", type: "tool", text: null, tool: "glob" },
  ];
  const out = parseRows(messages, onlyToolParts);
  assertEquals(heuristicSummary(out), "glob: 1 を使用");
});

Deno.test("buildLLMInput: includes user prompts, assistant text, tools", () => {
  const out = parseRows(messages, parts);
  const input = buildLLMInput(out);
  assertStringIncludes(input, "[User prompts]");
  assertStringIncludes(input, "opencodeのhooks");
  assertStringIncludes(input, "[First assistant response]");
  assertStringIncludes(input, "[Last assistant response]");
  assertStringIncludes(input, "glob: 2");
});

Deno.test("countUserMessages: counts non-noise user prompts only", () => {
  const out = parseRows(messages, [
    { message_id: "m1", type: "text", text: "ok", tool: null },
    { message_id: "m1", type: "text", text: "実装の質問が複数あります", tool: null },
  ]);
  assertEquals(countUserMessages(out), 1);
});

Deno.test("validateHookData: accepts valid ses_-prefixed session_id", () => {
  assertEquals(
    validateHookData({
      session_id: "ses_207e2d5c2ffeuGCp036WZmtae3",
      cwd: "/Users/me",
    }),
    {
      session_id: "ses_207e2d5c2ffeuGCp036WZmtae3",
      cwd: "/Users/me",
    },
  );
});

Deno.test("validateHookData: rejects malformed session_id (path traversal / shell metachars / wrong prefix)", () => {
  assertEquals(validateHookData({ session_id: "../../etc/passwd" }), null);
  assertEquals(
    validateHookData({ session_id: "ses_abc'; DROP TABLE--" }),
    null,
  );
  assertEquals(validateHookData({ session_id: "abc12345-not-prefixed" }), null);
  assertEquals(validateHookData({ session_id: "" }), null);
  assertEquals(validateHookData({ session_id: 42 }), null);
  assertEquals(validateHookData(null), null);
  assertEquals(validateHookData([]), null);
  assertEquals(
    validateHookData({ session_id: "ses_abc", cwd: 42 }),
    null,
  );
});

Deno.test("integration: upsertDailyNote writes opencode entry in expected format", async () => {
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

  const sessionShort = "ses_207e";
  upsertDailyNote(daily, sessionShort, [
    `- 11:00 - \`(dotfiles/${sessionShort})\` 要約テスト`,
    "    - 詳細1",
    "    - 詳細2",
  ]);

  const after = await Deno.readTextFile(daily);
  assertStringIncludes(after, `(dotfiles/${sessionShort})`);
  assertStringIncludes(after, "    - 詳細1");
  // Inserted before the Reading section.
  const lines = after.split("\n");
  const memoIdx = lines.findIndex((l) => l.includes(sessionShort));
  const readingIdx = lines.findIndex((l) => /^## 📕 Reading/.test(l));
  assertEquals(memoIdx < readingIdx, true);
});
