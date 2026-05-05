import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import {
  debounceStatePath,
  escapeObsidianSyntax,
  parseLLMOutput,
  resolveRepoName,
  saveDebounceState,
  shouldRunLLM,
  upsertDailyNote,
} from "./memo-shared.ts";

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
  assertEquals(
    resolveRepoName("/Users/me/dotfiles", "/Users/me/dotfiles/.git"),
    "dotfiles",
  );
  assertEquals(resolveRepoName("/", ""), "");
});

Deno.test("escapeObsidianSyntax: replaces inline hash but leaves bare # alone", () => {
  assertEquals(
    escapeObsidianSyntax("#tag and issue #123 plain # alone"),
    "＃tag and issue ＃123 plain # alone",
  );
});

Deno.test("parseLLMOutput: returns null for empty input", () => {
  assertEquals(parseLLMOutput(""), null);
  assertEquals(parseLLMOutput("   \n  "), null);
});

Deno.test("parseLLMOutput: accepts summary line only", () => {
  assertEquals(parseLLMOutput("単一行サマリ"), {
    summary: "単一行サマリ",
    details: [],
  });
});

Deno.test("parseLLMOutput: accepts summary plus bullet details (- and ・)", () => {
  assertEquals(
    parseLLMOutput(
      "Codex hookのメモ連携を実装した\n- Stop hookを追加\n・テストを追加",
    ),
    {
      summary: "Codex hookのメモ連携を実装した",
      details: ["Stop hookを追加", "テストを追加"],
    },
  );
});

Deno.test("parseLLMOutput: trims markdown heading and bold markers", () => {
  const out = parseLLMOutput("## **見出し**\n- **太字** body");
  assertEquals(out?.summary, "見出し");
  assertEquals(out?.details, ["太字 body"]);
});

Deno.test("parseLLMOutput: caps details to 3 items", () => {
  const out = parseLLMOutput(
    "summary\n- one\n- two\n- three\n- four\n- five",
  );
  assertEquals(out?.details.length, 3);
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

Deno.test("upsertDailyNote: silently no-ops when Reading section is missing", async () => {
  const dir = await Deno.makeTempDir();
  const daily = `${dir}/daily.md`;
  const original = "## 🧠 Work\n";
  await Deno.writeTextFile(daily, original);
  upsertDailyNote(daily, "xxxxxxxx", ["- 11:00 - `(r/xxxxxxxx)` x"]);
  assertEquals(await Deno.readTextFile(daily), original);
});

Deno.test("debounceStatePath: composes prefix + sessionShort under TMPDIR", () => {
  const tmp = Deno.env.get("TMPDIR") ?? "/tmp";
  assertEquals(
    debounceStatePath("claude", "abc12345"),
    `${tmp}/claude-memo-llm-abc12345.json`,
  );
  assertEquals(
    debounceStatePath("codex", "abc12345"),
    `${tmp}/codex-memo-llm-abc12345.json`,
  );
  assertEquals(
    debounceStatePath("opencode", "ses_207e"),
    `${tmp}/opencode-memo-llm-ses_207e.json`,
  );
});

Deno.test("shouldRunLLM / saveDebounceState: round-trip controls debounce decisions", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/state.json`;

  // No state file yet — first run, allow.
  assertEquals(shouldRunLLM(path, 1), true);

  saveDebounceState(path, 3);
  assertStringIncludes(await Deno.readTextFile(path), '"userMessageCount":3');

  // Same count → skip
  assertEquals(shouldRunLLM(path, 3), false);
  // Lower count → skip
  assertEquals(shouldRunLLM(path, 2), false);
  // Higher count → run
  assertEquals(shouldRunLLM(path, 4), true);
});
