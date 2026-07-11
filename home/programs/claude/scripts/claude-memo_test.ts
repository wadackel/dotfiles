import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import {
  countUserMessages,
  extractUserTexts,
  heuristicSummary,
} from "./claude-memo.ts";
import { resolveRepoName } from "./memo-shared.ts";

// Shared helpers (resolveRepoName, escapeObsidianSyntax, parseLLMOutput,
// upsertDailyNote, debounceStatePath, etc.) are tested in
// home/programs/agents/memo/memo-shared_test.ts.
//
// Below covers the Claude transcript-shape parser (isMeta filtering,
// NOISE_PATTERNS coverage, heuristicSummary fallback).

Deno.test("claude-memo: shared helpers covered by memo-shared_test.ts", () => {
  assertEquals(resolveRepoName("/tmp/repo", "/tmp/repo/.git"), "repo");
});

const userEntry = (content: string, isMeta = false) => ({
  type: "user",
  isMeta,
  message: { role: "user", content },
});

const assistantEntry = (text: string) => ({
  type: "assistant",
  message: {
    role: "assistant",
    content: [{ type: "text", text }],
  },
});

Deno.test("extractUserTexts: skips isMeta:true entries", () => {
  const entries = [
    userEntry("<local-command-caveat>Caveat: ...</local-command-caveat>", true),
    userEntry("real user prompt"),
  ];
  assertEquals(extractUserTexts(entries), ["real user prompt"]);
});

Deno.test("heuristicSummary: returns empty when only isMeta caveat and no assistant text", () => {
  const entries = [
    userEntry("<local-command-caveat>Caveat: ...</local-command-caveat>", true),
  ];
  assertEquals(heuristicSummary(entries), "");
});

Deno.test("heuristicSummary: excludes <command-name>-first slash command entries", () => {
  const slashCommand =
    "<command-name>/add-dir</command-name>\n<command-message>add-dir</command-message>\n<command-args>~/some/path</command-args>";
  const entries = [
    userEntry(slashCommand),
    assistantEntry("assistant response"),
  ];
  assertEquals(heuristicSummary(entries), "assistant response");
});

Deno.test("heuristicSummary: excludes <local-command-stdout> entries", () => {
  const entries = [
    userEntry("<local-command-stdout>some shell output</local-command-stdout>"),
    assistantEntry("assistant response"),
  ];
  assertEquals(heuristicSummary(entries), "assistant response");
});

Deno.test("heuristicSummary: excludes <task-notification> entries", () => {
  const entries = [
    userEntry("<task-notification>agent done</task-notification>"),
    assistantEntry("assistant response"),
  ];
  assertEquals(heuristicSummary(entries), "assistant response");
});

Deno.test("heuristicSummary: falls through caveat to real user prompt", () => {
  const entries = [
    userEntry("<local-command-caveat>Caveat: ...</local-command-caveat>", true),
    userEntry("実際にやりたいこと: バグ調査したい"),
  ];
  assertEquals(heuristicSummary(entries), "実際にやりたいこと: バグ調査したい");
});

Deno.test("heuristicSummary: keeps prompts that mention Claude Code tags mid-text (anchor false-positive guard)", () => {
  const entries = [
    userEntry("バグ調査中に <command-name> について質問したい"),
  ];
  assertEquals(
    heuristicSummary(entries),
    "バグ調査中に <command-name> について質問したい",
  );
});

Deno.test("main: CLAUDE_MEMO_SKIP=1 short-circuits before touching state", async () => {
  const tmp = await Deno.makeTempDir();
  const scriptPath = new URL("./claude-memo.ts", import.meta.url).pathname;

  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run=git,claude",
      scriptPath,
    ],
    env: { CLAUDE_MEMO_SKIP: "1", TMPDIR: tmp, HOME: tmp },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const proc = cmd.spawn();
  const writer = proc.stdin.getWriter();
  await writer.write(new TextEncoder().encode("{}"));
  await writer.close();
  const { code } = await proc.output();
  assertEquals(code, 0);

  const log = await Deno.readTextFile(`${tmp}/claude-memo.log`);
  assertStringIncludes(log, "SKIP: CLAUDE_MEMO_SKIP=1");
});

Deno.test("countUserMessages: excludes isMeta:true entries", () => {
  const entries = [
    userEntry("real prompt 1"),
    userEntry("<local-command-caveat>...</local-command-caveat>", true),
    userEntry("real prompt 2"),
    userEntry("<local-command-caveat>...</local-command-caveat>", true),
  ];
  assertEquals(countUserMessages(entries), 2);
});
