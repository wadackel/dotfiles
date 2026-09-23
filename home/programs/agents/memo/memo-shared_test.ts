import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@^1";
import {
  composeLLMInput,
  debounceStatePath,
  escapeObsidianSyntax,
  formatEntryLines,
  isThrowawaySession,
  memoRunDir,
  parseLLMOutput,
  resolveRepoName,
  saveDebounceState,
  shouldRunLLM,
  upsertDailyNote,
} from "./memo-shared.ts";

Deno.test("isThrowawaySession: tool use or a second prompt keeps the session", () => {
  assertEquals(isThrowawaySession(0, 0), true);
  assertEquals(isThrowawaySession(1, 0), true);
  assertEquals(isThrowawaySession(2, 0), false);
  assertEquals(isThrowawaySession(1, 1), false);
  assertEquals(isThrowawaySession(0, 5), false);
  assertEquals(isThrowawaySession(5, 0), false);
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

Deno.test("parseLLMOutput: returns the learning line apart from details", () => {
  const out = parseLLMOutput(
    "要約\n- one\n- two\n- three\n学び: bot のラベル付与で本命 run がキャンセルされる",
  );
  assertEquals(out?.details, ["one", "two", "three"]);
  assertEquals(out?.learning, "bot のラベル付与で本命 run がキャンセルされる");
});

Deno.test("parseLLMOutput: recognizes learning prefixed, bolded, or full-width", () => {
  for (
    const line of [
      "- 学び: X",
      "・学び: X",
      "学び：X",
      "**学び**: X",
      "- **学び：** X",
    ]
  ) {
    const out = parseLLMOutput(`要約\n- detail\n${line}`);
    assertEquals(out?.learning, "X", line);
    assertEquals(out?.details, ["detail"], line);
  }
});

Deno.test("parseLLMOutput: treats an empty or none learning as absent", () => {
  for (
    const value of [
      "",
      "なし",
      "なし。",
      "（なし）",
      "特になし。",
      "無し",
      "-",
      "N/A",
    ]
  ) {
    const out = parseLLMOutput(`要約\n学び: ${value}`);
    assertEquals(out, { summary: "要約", details: [] }, value);
  }
});

Deno.test("parseLLMOutput: caps learning to 150 chars", () => {
  const out = parseLLMOutput(`要約\n学び: ${"あ".repeat(300)}`);
  assertEquals(out?.learning?.length, 150);
});

Deno.test("formatEntryLines: writes the learning as the last detail line", () => {
  assertEquals(
    formatEntryLines(
      { summary: "要約 #tag", details: ["詳細"], learning: "学んだ #rule" },
      { timestamp: "10:00", repoName: "repo", sessionShort: "abcd1234" },
    ),
    [
      "- 10:00 - `(repo/abcd1234)` 要約 ＃tag",
      "    - 詳細",
      "    - 学び: 学んだ ＃rule",
    ],
  );
});

Deno.test("formatEntryLines: omits the learning line when there is none", () => {
  assertEquals(
    formatEntryLines({ summary: "要約", details: [] }, {
      timestamp: "10:00",
      repoName: "r",
      sessionShort: "s",
    }),
    ["- 10:00 - `(r/s)` 要約"],
  );
});

Deno.test("composeLLMInput: drops tool counts and keeps the last response under many prompts", () => {
  const prompts = Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(250, "p"));
  const last = "L".repeat(2000);
  const input = composeLLMInput(prompts, ["F".repeat(500), last]);
  assertEquals(input.includes("[Actions taken]"), false);
  assertStringIncludes(input, `[Last assistant response]\n${"L".repeat(1500)}`);
  assertEquals(input.includes("L".repeat(1501)), false);
  assertStringIncludes(input, `- 0${"p".repeat(199)}`);
  assertStringIncludes(input, `- 19${"p".repeat(198)}`);
  assertEquals(input.includes(`- 1${"p".repeat(199)}`), false);
  assertEquals(
    input.indexOf(`- 18${"p".repeat(198)}`) <
      input.indexOf(`- 19${"p".repeat(198)}`),
    true,
  );
  assertEquals(input.length <= 3000, true);
});

Deno.test("composeLLMInput: handles empty inputs and prompts alone", () => {
  assertEquals(composeLLMInput([], []), "");
  assertEquals(
    composeLLMInput(["この件を調べて"], []),
    "[User prompts]\n- この件を調べて",
  );
});

Deno.test("composeLLMInput: treats a lone response as the last one", () => {
  const input = composeLLMInput(["q"], ["A".repeat(1000)]);
  assertStringIncludes(input, `[Last assistant response]\n${"A".repeat(1000)}`);
  assertEquals(input.includes("[First assistant response]"), false);
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

Deno.test("memoRunDir: creates $HOME/.cache/claude-memo and is idempotent", async () => {
  const home = await Deno.makeTempDir();
  const dir = memoRunDir(home);
  assertEquals(dir, `${home}/.cache/claude-memo`);
  assertEquals(Deno.statSync(dir).isDirectory, true);
  assertEquals(memoRunDir(home), dir);
});

Deno.test("memoRunDir: rejects an empty HOME instead of using /tmp", () => {
  assertThrows(() => memoRunDir(""), Error, "HOME is empty or not set");
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
