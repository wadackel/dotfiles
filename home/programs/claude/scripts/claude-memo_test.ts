import { test } from "bun:test";
import {
  assertMemoFailurePaths,
  assertMemoPublication,
  assertReservationDoesNotDelayMemo,
  createMemoFixture,
  FIXTURE_TASK,
  waitUntil,
} from "../../agents/memo/memo-test-fixture.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../agents/lib/proc.ts";
import {
  buildLLMInput,
  countNonNoiseUserMessages,
  countToolUses,
  countUserMessages,
  extractTurns,
  extractUserTexts,
  heuristicSummary,
  proposeVocab,
} from "./claude-memo.ts";
import { resolveRepoName } from "../../agents/memo/memo-shared.ts";
import { readSessionSummary } from "../../agents/memo/summary-cache.ts";
import {
  beginSummaryPublication,
  publishSummary,
} from "../../agents/memo/summary-publisher.ts";

const unflushedShortTurn = [
  { type: "user", message: { content: "今何時？" } },
  {
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Bash" }] },
  },
  {
    type: "user",
    message: { content: [{ type: "tool_result", content: "22:51" }] },
  },
].map((entry) => JSON.stringify(entry)).join("\n") + "\n";

test(
  "empty input: waits for the final response without adding duplicate model calls",
  async () => {
    const f = await createMemoFixture("claude");
    let first: ReturnType<typeof f.invoke> | undefined;
    try {
      await writeFile(f.transcript, unflushedShortTurn);
      first = f.invoke();
      await waitUntil(async () => {
        const log = await readFile(
          join(f.env.TMPDIR, "claude-memo.log"),
          "utf8",
        ).catch(() => "");
        return log.includes("WAIT: empty summary input") ||
          (await f.calls()).length > 0;
      }, "empty input observation");
      assertEquals((await f.calls()).length, 0);
      assertEquals((await f.invoke()).code, 0);
      assertEquals((await f.calls()).length, 0);
      await appendFile(
        f.transcript,
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "現在の時刻は22時51分です。" }],
          },
        }) + "\n",
      );
      assertEquals((await first).code, 0);
      const calls = await f.calls();
      assertEquals(calls.length, 1);
      assertStringIncludes(
        calls[0].stdin,
        "[Last assistant response]\n現在の時刻は22時51分です。",
      );
      assertEquals(await readSessionSummary(f.id), FIXTURE_TASK);
      assertEquals((await f.invoke()).code, 0);
      assertEquals((await f.calls()).length, 1);
    } finally {
      await first;
      await f.cleanup();
    }
  },
  10000,
);

test(
  "empty input: timeout keeps the heuristic and previous cache without inference",
  async () => {
    const f = await createMemoFixture("claude");
    try {
      await writeFile(f.transcript, unflushedShortTurn);
      await publishSummary(
        await beginSummaryPublication(f.id),
        "前回の有効な要約",
      );
      assertEquals((await f.invoke()).code, 0);
      assertEquals((await f.calls()).length, 0);
      assertStringIncludes(await readFile(f.daily, "utf8"), "Bash: 1 を使用");
      assertEquals(await readSessionSummary(f.id), "前回の有効な要約");
      assertEquals((await f.invoke()).code, 0);
      assertEquals((await f.calls()).length, 0);
    } finally {
      await f.cleanup();
    }
  },
  10000,
);

test(
  "empty input: a vanished transcript does not start inference",
  async () => {
    const f = await createMemoFixture("claude");
    let first: ReturnType<typeof f.invoke> | undefined;
    try {
      await writeFile(f.transcript, unflushedShortTurn);
      first = f.invoke();
      await waitUntil(async () => {
        const log = await readFile(
          join(f.env.TMPDIR, "claude-memo.log"),
          "utf8",
        ).catch(() => "");
        return log.includes("WAIT: empty summary input") ||
          (await f.calls()).length > 0;
      }, "empty input observation");
      assertEquals((await f.calls()).length, 0);
      await rm(f.transcript);
      assertEquals((await first).code, 0);
      assertEquals((await f.calls()).length, 0);
      assertEquals(await readSessionSummary(f.id), null);
    } finally {
      await first;
      await f.cleanup();
    }
  },
  10000,
);

test(
  "claude memo cache: existing request and result are reused",
  () =>
    assertMemoPublication(
      "claude",
      "c4b1ad2ef160fc5cfd4395325ef354f42f5fbb1a321f097aefa672f6b9da8124",
    ),
  10000,
);
test(
  "claude memo cache: missing daily and failed provider keep existing behavior",
  () => assertMemoFailurePaths("claude"),
  10000,
);
test(
  "claude memo cache: reservation never delays existing effects",
  () => assertReservationDoesNotDelayMemo("claude"),
  10000,
);

// Shared helpers (resolveRepoName, escapeObsidianSyntax, parseLLMOutput,
// upsertDailyNote, debounceStatePath, etc.) are tested in
// home/programs/agents/memo/memo-shared_test.ts.
//
// Below covers the Claude transcript-shape parser (isMeta filtering,
// NOISE_PATTERNS coverage, heuristicSummary fallback).

test("claude-memo: shared helpers covered by memo-shared_test.ts", () => {
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

test("buildLLMInput: leads with the last response and omits tool counts", () => {
  const toolUse = {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", name: "Bash" }],
    },
  };
  const input = buildLLMInput([
    userEntry("この不具合の原因を調査して"),
    assistantEntry("最初の応答"),
    toolUse,
    assistantEntry("最終報告"),
  ]);
  assertEquals(input.startsWith("[Last assistant response]\n最終報告"), true);
  assertStringIncludes(input, "この不具合の原因を調査して");
  assertEquals(input.includes("Bash"), false);
});

test("extractUserTexts: skips isMeta:true entries", () => {
  const entries = [
    userEntry("<local-command-caveat>Caveat: ...</local-command-caveat>", true),
    userEntry("real user prompt"),
  ];
  assertEquals(extractUserTexts(entries), ["real user prompt"]);
});

test("heuristicSummary: returns empty when only isMeta caveat and no assistant text", () => {
  const entries = [
    userEntry("<local-command-caveat>Caveat: ...</local-command-caveat>", true),
  ];
  assertEquals(heuristicSummary(entries), "");
});

test("heuristicSummary: excludes <command-name>-first slash command entries", () => {
  const slashCommand =
    "<command-name>/add-dir</command-name>\n<command-message>add-dir</command-message>\n<command-args>~/some/path</command-args>";
  const entries = [
    userEntry(slashCommand),
    assistantEntry("assistant response"),
  ];
  assertEquals(heuristicSummary(entries), "assistant response");
});

test("heuristicSummary: excludes <local-command-stdout> entries", () => {
  const entries = [
    userEntry("<local-command-stdout>some shell output</local-command-stdout>"),
    assistantEntry("assistant response"),
  ];
  assertEquals(heuristicSummary(entries), "assistant response");
});

test("heuristicSummary: excludes <task-notification> entries", () => {
  const entries = [
    userEntry("<task-notification>agent done</task-notification>"),
    assistantEntry("assistant response"),
  ];
  assertEquals(heuristicSummary(entries), "assistant response");
});

test("heuristicSummary: falls through caveat to real user prompt", () => {
  const entries = [
    userEntry("<local-command-caveat>Caveat: ...</local-command-caveat>", true),
    userEntry("実際にやりたいこと: バグ調査したい"),
  ];
  assertEquals(heuristicSummary(entries), "実際にやりたいこと: バグ調査したい");
});

test("heuristicSummary: keeps prompts that mention Claude Code tags mid-text (anchor false-positive guard)", () => {
  const entries = [
    userEntry("バグ調査中に <command-name> について質問したい"),
  ];
  assertEquals(
    heuristicSummary(entries),
    "バグ調査中に <command-name> について質問したい",
  );
});

test("main: CLAUDE_MEMO_SKIP=1 short-circuits before touching state", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tmp-"));
  const scriptPath = join(import.meta.dirname, "claude-memo.ts");

  const { code } = await run(scriptPath, [], {
    env: {
      CLAUDE_MEMO_SKIP: "1",
      TMPDIR: tmp,
      HOME: tmp,
      // Bun would otherwise leave its transpiler cache in the throwaway HOME.
      BUN_RUNTIME_TRANSPILER_CACHE_PATH:
        `${process.env.HOME}/Library/Caches/bun/@t@`,
    },
    stdin: "{}",
  });
  assertEquals(code, 0);

  const log = await readFile(`${tmp}/claude-memo.log`, "utf8");
  assertStringIncludes(log, "SKIP: CLAUDE_MEMO_SKIP=1");
});

test("main: a headless claude -p session (sdk-cli) is skipped", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tmp-"));
  const scriptPath = join(import.meta.dirname, "claude-memo.ts");

  try {
    const { code } = await run(scriptPath, [], {
      env: {
        CLAUDE_MEMO_SKIP: "",
        CLAUDE_CODE_ENTRYPOINT: "sdk-cli",
        TMPDIR: tmp,
        HOME: tmp,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH:
          `${process.env.HOME}/Library/Caches/bun/@t@`,
      },
      stdin: "{}",
    });
    assertEquals(code, 0);

    const log = await readFile(`${tmp}/claude-memo.log`, "utf8");
    assertStringIncludes(log, "SKIP: headless session");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("countUserMessages: excludes isMeta:true entries", () => {
  const entries = [
    userEntry("real prompt 1"),
    userEntry("<local-command-caveat>...</local-command-caveat>", true),
    userEntry("real prompt 2"),
    userEntry("<local-command-caveat>...</local-command-caveat>", true),
  ];
  assertEquals(countUserMessages(entries), 2);
});

test("countNonNoiseUserMessages: differs from countUserMessages by noise filtering", () => {
  const entries = [
    userEntry("ok"),
    userEntry("実装の質問が複数あります"),
  ];
  assertEquals(countUserMessages(entries), 2);
  assertEquals(countNonNoiseUserMessages(entries), 1);
});

test("countToolUses: counts assistant tool_use blocks only", () => {
  const entries = [
    userEntry("prompt"),
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "working" },
          { type: "tool_use", name: "Bash" },
          { type: "tool_use", name: "Read" },
          { type: "tool_use" },
        ],
      },
    },
  ];
  assertEquals(countToolUses(entries), 2);
  assertEquals(countToolUses([userEntry("prompt")]), 0);
});

test("claude-memo: extractTurns keeps order and drops meta and noise", () => {
  const turns = extractTurns(
    [
      {
        type: "user",
        message: { role: "user", content: "gate の範囲を教えて" },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "どの計画ですか？" }],
        },
      },
      {
        type: "user",
        isMeta: true,
        message: { role: "user", content: "meta" },
      },
      { type: "user", message: { role: "user", content: "ok" } },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "いま開いている計画のこと" }],
        },
      },
    ] as unknown as Parameters<typeof extractTurns>[0],
  );
  assertEquals(turns, [
    { role: "user", text: "gate の範囲を教えて" },
    { role: "assistant", text: "どの計画ですか？" },
    { role: "user", text: "いま開いている計画のこと" },
  ]);
});

test("claude-memo: a vocabulary module that fails to load does not throw", async () => {
  const previous = process.env.TMPDIR;
  const tmp = await mkdtemp(join(tmpdir(), "claude-memo-vocab-"));
  process.env.TMPDIR = tmp;
  try {
    await proposeVocab(
      {
        agent: "claude",
        sessionId: "s",
        cwd: "/tmp",
        repo: "r",
        turns: [],
      },
      () => Promise.reject(new Error("module not found")),
    );
    assertStringIncludes(
      await readFile(`${tmp}/claude-memo.log`, "utf8"),
      "VOCAB ERROR: Error: module not found",
    );
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    await rm(tmp, { recursive: true });
  }
});
