import { assertEquals } from "jsr:@std/assert";
import {
  collectErrorSummary,
  collectToolSummary,
  encodeProjectDir,
  extractTimeline,
  formatSize,
  truncate,
  type ContentBlock,
  type TranscriptEntry,
} from "./extract-session-history.ts";

// --- truncate ---

Deno.test("truncate: short string returned as-is", () => {
  assertEquals(truncate("hello", 10), "hello");
});

Deno.test("truncate: string at limit returned as-is", () => {
  assertEquals(truncate("hello", 5), "hello");
});

Deno.test("truncate: long string is truncated with char count", () => {
  const result = truncate("abcdef", 3);
  assertEquals(result, "abc... [6 chars]");
});

Deno.test("truncate: newlines replaced with spaces", () => {
  assertEquals(truncate("hello\nworld", 20), "hello world");
});

Deno.test("truncate: newlines replaced before length check", () => {
  // "a\nb" becomes "a b" (3 chars), limit 3 — no truncation
  assertEquals(truncate("a\nb", 3), "a b");
});

// --- formatSize ---

Deno.test("formatSize: bytes less than 1MB shown as K", () => {
  assertEquals(formatSize(1024), "1K");
});

Deno.test("formatSize: zero bytes shown as 0K", () => {
  assertEquals(formatSize(0), "0K");
});

Deno.test("formatSize: exactly 1MB threshold shown as K", () => {
  // 1024 * 1024 is NOT greater than 1024 * 1024, so K
  assertEquals(formatSize(1024 * 1024), "1024K");
});

Deno.test("formatSize: bytes greater than 1MB shown as M", () => {
  assertEquals(formatSize(1024 * 1024 + 1), "1.0M");
});

Deno.test("formatSize: 2.5MB formatted correctly", () => {
  assertEquals(formatSize(2.5 * 1024 * 1024), "2.5M");
});

// --- encodeProjectDir ---

Deno.test("encodeProjectDir: strips leading slash and replaces slashes", () => {
  assertEquals(
    encodeProjectDir("/Users/wadackel/dotfiles"),
    "Users-wadackel-dotfiles",
  );
});

Deno.test("encodeProjectDir: replaces dots with hyphens", () => {
  assertEquals(
    encodeProjectDir("/Users/wadackel/develop/github.com/wadackel/zmk-config"),
    "Users-wadackel-develop-github-com-wadackel-zmk-config",
  );
});

Deno.test("encodeProjectDir: path without leading slash works", () => {
  assertEquals(encodeProjectDir("Users/foo"), "Users-foo");
});

Deno.test("encodeProjectDir: multiple dots in segment", () => {
  assertEquals(encodeProjectDir("/a/b.c.d/e"), "a-b-c-d-e");
});

// --- extractTimeline ---

Deno.test("extractTimeline: empty entries returns empty string", () => {
  assertEquals(extractTimeline([], 300, 200), "");
});

Deno.test("extractTimeline: user message with string content", () => {
  const entries: TranscriptEntry[] = [
    { type: "user", message: { content: "Hello" } },
  ];
  assertEquals(extractTimeline(entries, 300, 200), "### User\nHello\n");
});

Deno.test("extractTimeline: user message with ContentBlock text", () => {
  const entries: TranscriptEntry[] = [
    {
      type: "user",
      message: {
        content: [{ type: "text", text: "Hello from block" }],
      },
    },
  ];
  assertEquals(
    extractTimeline(entries, 300, 200),
    "### User\nHello from block\n",
  );
});

Deno.test("extractTimeline: user message with tool_result error", () => {
  const entries: TranscriptEntry[] = [
    {
      type: "user",
      message: {
        content: [{ type: "tool_result", is_error: true, content: "Fail!" }],
      },
    },
  ];
  const result = extractTimeline(entries, 300, 200);
  assertEquals(result.includes("**[TOOL ERROR]**"), true);
  assertEquals(result.includes("Fail!"), true);
});

Deno.test("extractTimeline: assistant message with text and tool_use", () => {
  const entries: TranscriptEntry[] = [
    {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I'll help." },
          { type: "tool_use", name: "Read" },
        ],
      },
    },
  ];
  const result = extractTimeline(entries, 300, 200);
  assertEquals(result.includes("### Assistant"), true);
  assertEquals(result.includes("`[Tool: Read]`"), true);
});

Deno.test("extractTimeline: compact boundary", () => {
  const entries: TranscriptEntry[] = [
    {
      type: "system",
      subtype: "compact_boundary",
      compactMetadata: { trigger: "manual", preTokens: 5000 },
      timestamp: "2026-01-01T00:00:00Z",
    },
  ];
  const result = extractTimeline(entries, 300, 200);
  assertEquals(result.includes("**[COMPACT BOUNDARY]**"), true);
  assertEquals(result.includes("manual"), true);
  assertEquals(result.includes("5000"), true);
});

Deno.test("extractTimeline: summary entry", () => {
  const entries: TranscriptEntry[] = [
    { type: "summary", summary: "This session fixed a bug." },
  ];
  const result = extractTimeline(entries, 300, 200);
  assertEquals(result, "**[SESSION SUMMARY]** This session fixed a bug.");
});

Deno.test("extractTimeline: user content truncated at maxUser", () => {
  const longText = "a".repeat(10);
  const entries: TranscriptEntry[] = [
    { type: "user", message: { content: longText } },
  ];
  const result = extractTimeline(entries, 5, 200);
  assertEquals(result.includes("... [10 chars]"), true);
});

// --- collectToolSummary ---

Deno.test("collectToolSummary: no tool use returns None", () => {
  const entries: TranscriptEntry[] = [
    { type: "user", message: { content: "Hello" } },
  ];
  assertEquals(collectToolSummary(entries), "None");
});

Deno.test("collectToolSummary: empty entries returns None", () => {
  assertEquals(collectToolSummary([]), "None");
});

Deno.test("collectToolSummary: counts tools and sorts by frequency", () => {
  const blocks = (names: string[]): ContentBlock[] =>
    names.map((name) => ({ type: "tool_use", name }));

  const entries: TranscriptEntry[] = [
    { type: "assistant", message: { content: blocks(["Read", "Read", "Bash"]) } },
    { type: "assistant", message: { content: blocks(["Read"]) } },
  ];
  const result = collectToolSummary(entries);
  // Read (3) should come before Bash (1)
  const lines = result.split("\n");
  assertEquals(lines[0], "- **Read**: 3 calls");
  assertEquals(lines[1], "- **Bash**: 1 calls");
});

// --- collectErrorSummary ---

Deno.test("collectErrorSummary: no errors returns None", () => {
  const entries: TranscriptEntry[] = [
    { type: "user", message: { content: "Hello" } },
  ];
  assertEquals(collectErrorSummary(entries), "None");
});

Deno.test("collectErrorSummary: empty entries returns None", () => {
  assertEquals(collectErrorSummary([]), "None");
});

Deno.test("collectErrorSummary: extracts error content", () => {
  const entries: TranscriptEntry[] = [
    {
      type: "user",
      message: {
        content: [{ type: "tool_result", is_error: true, content: "Command failed" }],
      },
    },
  ];
  const result = collectErrorSummary(entries);
  assertEquals(result, "- Command failed");
});

Deno.test("collectErrorSummary: non-error tool_result ignored", () => {
  const entries: TranscriptEntry[] = [
    {
      type: "user",
      message: {
        content: [{ type: "tool_result", is_error: false, content: "OK" }],
      },
    },
  ];
  assertEquals(collectErrorSummary(entries), "None");
});

Deno.test("collectErrorSummary: error content truncated at 100 chars", () => {
  const longError = "x".repeat(150);
  const entries: TranscriptEntry[] = [
    {
      type: "user",
      message: {
        content: [{ type: "tool_result", is_error: true, content: longError }],
      },
    },
  ];
  const result = collectErrorSummary(entries);
  // "- " + 100 chars = 102 chars total
  assertEquals(result.length, 102);
  assertEquals(result.startsWith("- "), true);
});
