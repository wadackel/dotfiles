import { assertEquals } from "jsr:@std/assert@1";
import {
  basename,
  cwdBranchParts,
  formatElapsed,
  isLiveClaudePaneCommand,
  type PaneRow,
  parseRow,
  parseSubagents,
  parseTarget,
  readTaskProgress,
  renderSubagentTree,
  type Row2Seg,
  sanitizeAnsi,
  statusColor,
  statusIcon,
  statusShort,
  stringCells,
  summaryOf,
  TMUX_FORMAT,
  toolSegmentText,
  truncateAnsiLine,
  truncateToCells,
  truncateTopSegBody,
} from "./picker.tsx";

Deno.test("TMUX_FORMAT contains 21 US-separated field tokens", () => {
  const fields = TMUX_FORMAT.split("\x1f");
  assertEquals(fields.length, 21);
});

Deno.test("parseRow: full row with all fields present", () => {
  const line = [
    "%42",
    "0:1.2",
    "node",
    "/Users/wadackel/dotfiles",
    "claude",
    "waiting",
    "1700000000",
    "/Users/wadackel/dotfiles",
    "main",
    "Explore:a1|Plan:b2",
    "hello world",
    "permission-denied",
    "Bash",
    "sess-abc",
    "Edit",
    "/x/y/file.ts",
    "1700001234",
    "pnpm test",
    "picker.tsx",
    "Exit code 1",
    "42",
  ].join("\x1f");
  const row = parseRow(line);
  const expected: PaneRow = {
    paneId: "%42",
    target: "0:1.2",
    currentCommand: "node",
    currentPath: "/Users/wadackel/dotfiles",
    agent: "claude",
    status: "waiting",
    startedAtSec: 1700000000,
    cwd: "/Users/wadackel/dotfiles",
    worktreeBranch: "main",
    subagents: "Explore:a1|Plan:b2",
    prompt: "hello world",
    waitReason: "permission-denied",
    currentTool: "Bash",
    sessionId: "sess-abc",
    lastTool: "Edit",
    lastEditFile: "/x/y/file.ts",
    lastActivityAtSec: 1700001234,
    currentToolSubject: "pnpm test",
    lastToolSubject: "picker.tsx",
    lastToolError: "Exit code 1",
    contextUsedPct: 42,
  };
  assertEquals(row, expected);
});

Deno.test("parseRow: empty @pane_* fields stay as empty strings / null", () => {
  const line = Array(21).fill("").map((v, i) => i === 0 ? "%1" : (i === 3 ? "/home/me" : v))
    .join("\x1f");
  const row = parseRow(line);
  assertEquals(row?.agent, "");
  assertEquals(row?.status, "");
  assertEquals(row?.startedAtSec, null);
  assertEquals(row?.subagents, "");
  assertEquals(row?.currentTool, "");
  assertEquals(row?.worktreeBranch, "");
  assertEquals(row?.currentPath, "/home/me");
  assertEquals(row?.sessionId, "");
  assertEquals(row?.lastTool, "");
  assertEquals(row?.lastEditFile, "");
  assertEquals(row?.lastActivityAtSec, null);
  assertEquals(row?.currentToolSubject, "");
  assertEquals(row?.lastToolSubject, "");
  assertEquals(row?.lastToolError, "");
  assertEquals(row?.contextUsedPct, null);
});

Deno.test("parseRow: unknown status normalized to empty string", () => {
  const line = Array(21).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 1 ? "0:0.0" : i === 2 ? "zsh" : i === 5 ? "bogus" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.status, "");
});

Deno.test("parseRow: non-numeric started_at → null (safe parse)", () => {
  const line = Array(21).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 1 ? "0:0.0" : i === 5 ? "idle" : i === 6 ? "nope" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.startedAtSec, null);
});

Deno.test("parseRow: non-numeric last_activity_at → null (safe parse)", () => {
  const line = Array(21).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 16 ? "nope" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.lastActivityAtSec, null);
});

Deno.test("parseRow: non-numeric context_used_pct → null (safe parse)", () => {
  const line = Array(21).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 20 ? "nope" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.contextUsedPct, null);
});

Deno.test("parseRow: valid context_used_pct parsed as integer", () => {
  const line = Array(21).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 20 ? "75" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.contextUsedPct, 75);
});

Deno.test("parseRow: malformed input returns null", () => {
  assertEquals(parseRow(""), null);
  assertEquals(parseRow("only\x1ftwo"), null);
  // 20 fields (one short of 21) → null
  const twenty = Array(20).fill("x").join("\x1f");
  assertEquals(parseRow(twenty), null);
  // 21 fields but paneId empty → null (matches bash SELF_PANE_ID skip logic)
  const emptyId = Array(21).fill("").join("\x1f");
  assertEquals(parseRow(emptyId), null);
});

Deno.test("isLiveClaudePaneCommand: accepts live cc entry points", () => {
  assertEquals(isLiveClaudePaneCommand(".claude-wrapped"), true);
  assertEquals(isLiveClaudePaneCommand("claude"), true);
  assertEquals(isLiveClaudePaneCommand("node"), true);
});

Deno.test("isLiveClaudePaneCommand: rejects non-cc commands", () => {
  assertEquals(isLiveClaudePaneCommand("zsh"), false);
  assertEquals(isLiveClaudePaneCommand("bash"), false);
  assertEquals(isLiveClaudePaneCommand(""), false);
});

Deno.test("formatElapsed: null → middle dot", () => {
  assertEquals(formatElapsed(null, 1700000000), "·");
});

Deno.test("formatElapsed: clock skew (negative diff) → middle dot", () => {
  assertEquals(formatElapsed(1700000100, 1700000000), "·");
});

Deno.test("formatElapsed: seconds bucket", () => {
  assertEquals(formatElapsed(1700000000, 1700000000), "0s");
  assertEquals(formatElapsed(1700000000, 1700000059), "59s");
});

Deno.test("formatElapsed: minutes bucket (floor)", () => {
  assertEquals(formatElapsed(1700000000, 1700000060), "1m");
  assertEquals(formatElapsed(1700000000, 1700000119), "1m");
  assertEquals(formatElapsed(1700000000, 1700003599), "59m");
});

Deno.test("formatElapsed: hours bucket (floor)", () => {
  assertEquals(formatElapsed(1700000000, 1700003600), "1h");
  assertEquals(formatElapsed(1700000000, 1700010800), "3h");
});

Deno.test("statusColor: known statuses", () => {
  assertEquals(statusColor("running"), "#73c1a9");
  assertEquals(statusColor("waiting"), "#ac8b83");
  assertEquals(statusColor("idle"), "#545c8c");
  assertEquals(statusColor("error"), "#ff9494");
});

Deno.test("statusColor: unknown → Normal fg", () => {
  assertEquals(statusColor(""), "#9ea3c0");
});

Deno.test("sanitizeAnsi: SGR (color) passes through unchanged", () => {
  const sgr = "\x1b[31mred\x1b[0m\x1b[1;32mbold-green\x1b[m";
  assertEquals(sanitizeAnsi(sgr), sgr);
});

Deno.test("sanitizeAnsi: cursor-move / erase CSI removed", () => {
  // \x1b[2J = clear screen, \x1b[H = cursor home, \x1b[10;5H = move cursor
  const dirty = "\x1b[2J\x1b[Hhello\x1b[31m red\x1b[0m\x1b[10;5Hworld\x1b[K";
  const clean = sanitizeAnsi(dirty);
  assertEquals(clean, "hello\x1b[31m red\x1b[0mworld");
});

Deno.test("sanitizeAnsi: plain text untouched", () => {
  assertEquals(sanitizeAnsi("hello world"), "hello world");
});

Deno.test("sanitizeAnsi: OSC title sequence (BEL-terminated) stripped", () => {
  // ESC ] 0 ; my-title BEL
  const dirty = "before\x1b]0;my-title\x07after";
  assertEquals(sanitizeAnsi(dirty), "beforeafter");
});

Deno.test("sanitizeAnsi: OSC 8 hyperlink (ST-terminated) stripped", () => {
  // ESC ] 8 ; ; https://example.com ESC \  link-text  ESC ] 8 ; ; ESC \
  const dirty =
    "prefix\x1b]8;;https://example.com\x1b\\link-text\x1b]8;;\x1b\\suffix";
  assertEquals(sanitizeAnsi(dirty), "prefixlink-textsuffix");
});

Deno.test("sanitizeAnsi: DCS / APC / PM stripped", () => {
  const dcs = "a\x1bPstate\x1b\\b"; // DCS
  const apc = "c\x1b_cmd\x1b\\d"; // APC
  const pm = "e\x1b^note\x1b\\f"; // PM
  assertEquals(sanitizeAnsi(dcs), "ab");
  assertEquals(sanitizeAnsi(apc), "cd");
  assertEquals(sanitizeAnsi(pm), "ef");
});

Deno.test("sanitizeAnsi: simple 2-byte escapes stripped (RIS, save-cursor)", () => {
  // ESC c = RIS (reset), ESC 7 = save cursor, ESC 8 = restore cursor
  assertEquals(sanitizeAnsi("x\x1bcy"), "xy");
  assertEquals(sanitizeAnsi("x\x1b7y\x1b8z"), "xyz");
});

Deno.test("sanitizeAnsi: SGR preserved while OSC/CSI move are stripped in mix", () => {
  const dirty =
    "\x1b]0;title\x07\x1b[31mred\x1b[0m\x1b[2J\x1b[H\x1b[1;32mgreen\x1b[m";
  assertEquals(
    sanitizeAnsi(dirty),
    "\x1b[31mred\x1b[0m\x1b[1;32mgreen\x1b[m",
  );
});

Deno.test("sanitizeAnsi: CSI with < = > parameter bytes stripped (ECMA-48)", () => {
  // Primary DA request, secondary DA request, device status report — all non-SGR
  // and would slip through a [0-9;?] param class but NOT [\x30-\x3F].
  assertEquals(sanitizeAnsi("a\x1b[>0cb"), "ab");
  assertEquals(sanitizeAnsi("a\x1b[=1;2cb"), "ab");
  assertEquals(sanitizeAnsi("a\x1b[<0;5;5Mb"), "ab");
  // SGR with ? param still preserved
  assertEquals(sanitizeAnsi("\x1b[?25h"), "");
  // SGR proper unchanged
  assertEquals(
    sanitizeAnsi("\x1b[38;5;196mfg\x1b[m"),
    "\x1b[38;5;196mfg\x1b[m",
  );
});

Deno.test("truncateAnsiLine: plain text truncated by printable char count", () => {
  assertEquals(truncateAnsiLine("hello world", 5), "hello");
  assertEquals(truncateAnsiLine("short", 20), "short");
});

Deno.test("truncateAnsiLine: SGR sequence never cut mid-escape", () => {
  // Raw length of "\x1b[31mAB\x1b[0m" is 11; printable chars are 2 ("AB").
  const colored = "\x1b[31mABCDE\x1b[0m";
  // maxCols=3: should keep "\x1b[31mABC" + append reset since SGR was open.
  assertEquals(truncateAnsiLine(colored, 3), "\x1b[31mABC\x1b[0m");
});

Deno.test("truncateAnsiLine: appends SGR reset when truncation leaves SGR open", () => {
  const colored = "\x1b[32mhello";
  const out = truncateAnsiLine(colored, 3);
  assertEquals(out, "\x1b[32mhel\x1b[0m");
});

Deno.test("truncateAnsiLine: no reset when SGR already closed in preserved span", () => {
  const colored = "\x1b[31mA\x1b[0mBCDE";
  // printable=5, maxCols=5: keeps entire thing; SGR already reset.
  assertEquals(truncateAnsiLine(colored, 5), "\x1b[31mA\x1b[0mBCDE");
});

Deno.test("parseTarget: basic session:window.pane", () => {
  assertEquals(parseTarget("0:1.2"), { session: "0", window: "0:1" });
});

Deno.test("parseTarget: session name containing dot", () => {
  // Bash picker: `${target%%:*}` = "work.foo", `${win_pane%%.*}` = "1"
  // → select-window target is "work.foo:1"
  assertEquals(parseTarget("work.foo:1.2"), {
    session: "work.foo",
    window: "work.foo:1",
  });
});

Deno.test("parseTarget: malformed target falls back to identity", () => {
  assertEquals(parseTarget("broken"), { session: "broken", window: "broken" });
  assertEquals(parseTarget(":1.2"), { session: "", window: ":1" });
});

Deno.test("parseTarget: dot before colon is not treated as pane separator", () => {
  // `a.b:0.1` — lastDotIdx=6 (after colon), colonIdx=3
  assertEquals(parseTarget("a.b:0.1"), { session: "a.b", window: "a.b:0" });
});

Deno.test("statusShort: known statuses", () => {
  assertEquals(statusShort("running"), "run");
  assertEquals(statusShort("waiting"), "wait");
  assertEquals(statusShort("idle"), "idle");
  assertEquals(statusShort("error"), "err");
  assertEquals(statusShort(""), "");
});

Deno.test("statusIcon: known statuses", () => {
  assertEquals(statusIcon("running"), "●");
  assertEquals(statusIcon("waiting"), "◐");
  assertEquals(statusIcon("idle"), "○");
  assertEquals(statusIcon("error"), "✖");
  assertEquals(statusIcon(""), " ");
});

function mkRow(overrides: Partial<PaneRow> = {}): PaneRow {
  return {
    paneId: "%1",
    target: "0:0.0",
    currentCommand: "",
    currentPath: "",
    agent: "",
    status: "",
    startedAtSec: null,
    cwd: "",
    worktreeBranch: "",
    subagents: "",
    prompt: "",
    waitReason: "",
    currentTool: "",
    sessionId: "",
    lastTool: "",
    lastEditFile: "",
    lastActivityAtSec: null,
    currentToolSubject: "",
    lastToolSubject: "",
    lastToolError: "",
    contextUsedPct: null,
    ...overrides,
  };
}

Deno.test("summaryOf: waiting uses wait_reason", () => {
  assertEquals(
    summaryOf(mkRow({ status: "waiting", waitReason: "perm", prompt: "p" })),
    "perm",
  );
});

Deno.test("summaryOf: error uses wait_reason", () => {
  assertEquals(
    summaryOf(mkRow({ status: "error", waitReason: "err", prompt: "p" })),
    "err",
  );
});

Deno.test("summaryOf: waiting falls back to prompt if wait_reason empty", () => {
  assertEquals(
    summaryOf(mkRow({ status: "waiting", waitReason: "", prompt: "hi" })),
    "hi",
  );
});

Deno.test("summaryOf: running uses prompt", () => {
  assertEquals(
    summaryOf(mkRow({ status: "running", prompt: "go" })),
    "go",
  );
});

Deno.test("summaryOf: empty fallback → middle dot", () => {
  assertEquals(summaryOf(mkRow({ status: "idle" })), "·");
});

Deno.test("summaryOf: returns full prompt without length cap", () => {
  const long = "a".repeat(200);
  assertEquals(summaryOf(mkRow({ prompt: long })), long);
});

Deno.test("summaryOf: preserves full CJK prompt (caller truncates by width)", () => {
  const jp = "提出したPRが他のPRをマージしたらコンフリクトしたので適切に修正したい";
  assertEquals(summaryOf(mkRow({ prompt: jp })), jp);
});

// --- stringCells ---

Deno.test("stringCells: empty → 0", () => {
  assertEquals(stringCells(""), 0);
});

Deno.test("stringCells: ASCII → code point count", () => {
  assertEquals(stringCells("abcdef"), 6);
});

Deno.test("stringCells: Japanese → 2 cells per char", () => {
  assertEquals(stringCells("あいう"), 6);
  assertEquals(stringCells("漢字"), 4);
});

Deno.test("stringCells: mixed ASCII + CJK", () => {
  assertEquals(stringCells("abあ"), 4); // 1+1+2
  assertEquals(stringCells("提出したPR"), 10); // 4*2 + 2
});

Deno.test("stringCells: fullwidth ASCII counts as 2", () => {
  assertEquals(stringCells("ＡＢ"), 4);
});

// --- truncateToCells ---

Deno.test("truncateToCells: budget 0 → empty", () => {
  assertEquals(truncateToCells("abc", 0), "");
});

Deno.test("truncateToCells: negative budget → empty", () => {
  assertEquals(truncateToCells("abc", -3), "");
});

Deno.test("truncateToCells: fits → unchanged (no ellipsis)", () => {
  assertEquals(truncateToCells("abc", 10), "abc");
  assertEquals(truncateToCells("あい", 4), "あい");
  assertEquals(truncateToCells("", 5), "");
});

Deno.test("truncateToCells: ASCII overflow → prefix + …", () => {
  assertEquals(truncateToCells("abcdef", 4), "abc…"); // 3 ASCII + 1 ellipsis
  assertEquals(truncateToCells("abcdef", 1), "…"); // budget=0 after ellipsis
});

Deno.test("truncateToCells: CJK budget=1 → just …", () => {
  assertEquals(truncateToCells("あいう", 1), "…");
});

Deno.test("truncateToCells: CJK budget=2 can't fit wide char + …", () => {
  // total=6 > 2, budget after ellipsis = 1, "あ"(2) won't fit → just "…"
  assertEquals(truncateToCells("あいう", 2), "…");
});

Deno.test("truncateToCells: CJK budget=3 fits 1 wide char + …", () => {
  assertEquals(truncateToCells("あいう", 3), "あ…");
});

Deno.test("truncateToCells: CJK budget=4 fits 1 wide char + … (next wide would overflow)", () => {
  assertEquals(truncateToCells("あいう", 4), "あ…");
});

Deno.test("truncateToCells: CJK budget=5 fits 2 wide chars + …", () => {
  assertEquals(truncateToCells("あいう", 5), "あい…");
});

Deno.test("truncateToCells: mixed ASCII + CJK respects boundary", () => {
  // "abあ" = 1+1+2 = 4 cells; budget=3 → after ellipsis=2, "ab"(2) fits,
  // "あ"(2) overflows → "ab…"
  assertEquals(truncateToCells("abあ", 3), "ab…");
  // budget=4 exactly fits → unchanged
  assertEquals(truncateToCells("abあ", 4), "abあ");
});

// --- cwdBranchParts ---

Deno.test("cwdBranchParts: cwd + branch → both fields populated", () => {
  assertEquals(
    cwdBranchParts("/Users/wadackel/dotfiles", "main"),
    { repo: "dotfiles", branch: "main" },
  );
});

Deno.test("cwdBranchParts: cwd only → branch empty", () => {
  assertEquals(
    cwdBranchParts("/Users/wadackel/dotfiles", ""),
    { repo: "dotfiles", branch: "" },
  );
});

Deno.test("cwdBranchParts: branch only → repo empty", () => {
  assertEquals(cwdBranchParts("", "main"), { repo: "", branch: "main" });
});

Deno.test("cwdBranchParts: both empty → middle dot in repo, branch empty", () => {
  assertEquals(cwdBranchParts("", ""), { repo: "·", branch: "" });
});

Deno.test("cwdBranchParts: root path basename is /", () => {
  assertEquals(cwdBranchParts("/", "main"), { repo: "/", branch: "main" });
});

// --- parseSubagents ---

Deno.test("parseSubagents: empty → empty array", () => {
  assertEquals(parseSubagents(""), []);
});

Deno.test("parseSubagents: single entry", () => {
  assertEquals(parseSubagents("Explore:a1"), [{ type: "Explore", id: "a1" }]);
});

Deno.test("parseSubagents: multiple entries", () => {
  assertEquals(parseSubagents("Explore:a1|Plan:b2|Explore:c3"), [
    { type: "Explore", id: "a1" },
    { type: "Plan", id: "b2" },
    { type: "Explore", id: "c3" },
  ]);
});

Deno.test("parseSubagents: malformed segment without colon → type only", () => {
  assertEquals(parseSubagents("bogus"), [{ type: "bogus", id: "" }]);
});

Deno.test("parseSubagents: trailing pipe filtered", () => {
  assertEquals(parseSubagents("A:1|"), [{ type: "A", id: "1" }]);
});

// --- renderSubagentTree ---

Deno.test("renderSubagentTree: empty → middle dot", () => {
  assertEquals(renderSubagentTree([]), "·");
});

Deno.test("renderSubagentTree: single entry → type name only", () => {
  assertEquals(
    renderSubagentTree([{ type: "Explore", id: "a1" }]),
    "Explore",
  );
});

Deno.test("renderSubagentTree: multiple types → comma-separated", () => {
  const result = renderSubagentTree([
    { type: "Explore", id: "a1" },
    { type: "Plan", id: "b2" },
    { type: "Researcher", id: "c3" },
  ]);
  assertEquals(result, "Explore, Plan, Researcher");
});

Deno.test("renderSubagentTree: same type aggregates with ×N", () => {
  const result = renderSubagentTree([
    { type: "Explore", id: "a1" },
    { type: "Explore", id: "b2" },
    { type: "Plan", id: "c3" },
  ]);
  assertEquals(result, "Explore ×2, Plan");
});

// --- basename ---

Deno.test("basename: typical path returns final segment", () => {
  assertEquals(basename("/a/b/file.ts"), "file.ts");
});

Deno.test("basename: trailing slash stripped", () => {
  assertEquals(basename("/a/b/c/"), "c");
});

Deno.test("basename: empty string returns empty", () => {
  assertEquals(basename(""), "");
});

Deno.test("basename: root slash returns root", () => {
  assertEquals(basename("/"), "/");
});

Deno.test("basename: no slash returns entire string", () => {
  assertEquals(basename("bare.txt"), "bare.txt");
});

// --- readTaskProgress ---

async function withTempHome<T>(
  fn: (homeDir: string) => Promise<T>,
): Promise<T> {
  const tmpHome = await Deno.makeTempDir({ prefix: "picker-test-home-" });
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", tmpHome);
  try {
    return await fn(tmpHome);
  } finally {
    if (originalHome !== undefined) Deno.env.set("HOME", originalHome);
    else Deno.env.delete("HOME");
    await Deno.remove(tmpHome, { recursive: true });
  }
}

Deno.test("readTaskProgress: empty sessionId → null", async () => {
  assertEquals(await readTaskProgress(""), null);
});

Deno.test("readTaskProgress: sessionId with path-traversal chars → null", async () => {
  assertEquals(await readTaskProgress("../etc"), null);
  assertEquals(await readTaskProgress("./."), null);
  assertEquals(await readTaskProgress("foo/bar"), null);
  assertEquals(await readTaskProgress(".."), null);
});

Deno.test("readTaskProgress: missing dir → null", async () => {
  await withTempHome(async () => {
    const result = await readTaskProgress("nonexistent-session");
    assertEquals(result, null);
  });
});

Deno.test("readTaskProgress: aggregates completed/total counts", async () => {
  await withTempHome(async (home) => {
    const sessionId = "sess-A";
    const dir = `${home}/.claude/tasks/${sessionId}`;
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/1.json`,
      JSON.stringify({ id: "1", status: "completed" }),
    );
    await Deno.writeTextFile(
      `${dir}/2.json`,
      JSON.stringify({ id: "2", status: "completed" }),
    );
    await Deno.writeTextFile(
      `${dir}/3.json`,
      JSON.stringify({ id: "3", status: "in_progress" }),
    );
    const result = await readTaskProgress(sessionId);
    assertEquals(result, { done: 2, total: 3 });
  });
});

Deno.test("readTaskProgress: empty dir → null", async () => {
  await withTempHome(async (home) => {
    const sessionId = "sess-empty";
    await Deno.mkdir(`${home}/.claude/tasks/${sessionId}`, { recursive: true });
    const result = await readTaskProgress(sessionId);
    assertEquals(result, null);
  });
});

Deno.test("readTaskProgress: skips malformed json", async () => {
  await withTempHome(async (home) => {
    const sessionId = "sess-broken";
    const dir = `${home}/.claude/tasks/${sessionId}`;
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/1.json`,
      JSON.stringify({ status: "completed" }),
    );
    await Deno.writeTextFile(`${dir}/2.json`, "{bogus");
    const result = await readTaskProgress(sessionId);
    assertEquals(result, { done: 1, total: 1 });
  });
});

Deno.test("readTaskProgress: non-json files ignored", async () => {
  await withTempHome(async (home) => {
    const sessionId = "sess-mixed";
    const dir = `${home}/.claude/tasks/${sessionId}`;
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/1.json`,
      JSON.stringify({ status: "pending" }),
    );
    await Deno.writeTextFile(`${dir}/README.md`, "# notes");
    const result = await readTaskProgress(sessionId);
    assertEquals(result, { done: 0, total: 1 });
  });
});

// --- toolSegmentText ---

Deno.test("toolSegmentText: no tool → empty string", () => {
  assertEquals(toolSegmentText(mkRow()), "");
});

Deno.test("toolSegmentText: currentTool without subject → tool name only", () => {
  assertEquals(
    toolSegmentText(mkRow({ currentTool: "Bash" })),
    "Bash",
  );
});

Deno.test("toolSegmentText: currentTool with subject → `tool(subject)`", () => {
  assertEquals(
    toolSegmentText(
      mkRow({ currentTool: "Bash", currentToolSubject: "pnpm test" }),
    ),
    "Bash(pnpm test)",
  );
});

Deno.test("toolSegmentText: lastTool without subject → bare tool name", () => {
  assertEquals(
    toolSegmentText(mkRow({ lastTool: "Edit" })),
    "Edit",
  );
});

Deno.test("toolSegmentText: lastTool with subject → `tool(subject)`", () => {
  assertEquals(
    toolSegmentText(
      mkRow({ lastTool: "Grep", lastToolSubject: "foo.*bar" }),
    ),
    "Grep(foo.*bar)",
  );
});

Deno.test("toolSegmentText: lastTool with error (no subject) appends ` ✖ <error>`", () => {
  assertEquals(
    toolSegmentText(
      mkRow({ lastTool: "Bash", lastToolError: "Exit code 1" }),
    ),
    "Bash ✖ Exit code 1",
  );
});

Deno.test("toolSegmentText: lastTool with subject + error → `tool(subject) ✖ error`", () => {
  assertEquals(
    toolSegmentText(
      mkRow({
        lastTool: "Bash",
        lastToolSubject: "pnpm test",
        lastToolError: "Exit code 1",
      }),
    ),
    "Bash(pnpm test) ✖ Exit code 1",
  );
});

Deno.test("toolSegmentText: currentTool takes precedence over lastTool", () => {
  assertEquals(
    toolSegmentText(
      mkRow({
        currentTool: "Grep",
        currentToolSubject: "TODO",
        lastTool: "Bash",
        lastToolSubject: "pnpm test",
        lastToolError: "Exit code 1",
      }),
    ),
    "Grep(TODO)",
  );
});

Deno.test("toolSegmentText: Edit-family with empty lastToolSubject (delegates to file segment)", () => {
  // SUBJECT_EXTRACTORS returns "" for Edit/Write/MultiEdit, so lastToolSubject
  // is empty and the tool segment renders without the basename. The independent
  // `file` segment (populated from @pane_last_edit_file) shows the target path.
  assertEquals(
    toolSegmentText(
      mkRow({
        lastTool: "Edit",
        lastToolSubject: "",
        lastEditFile: "/x/y/picker.tsx",
      }),
    ),
    "Edit",
  );
});

// --- truncateTopSegBody ---

function mkSeg(overrides: Partial<Row2Seg> = {}): Row2Seg {
  return {
    key: "tool",
    icon: "󰒓",
    body: "",
    color: "cyan",
    ...overrides,
  };
}

Deno.test("truncateTopSegBody: tool seg with `)` terminator → appends `…)` preserving paren", () => {
  // budget 15 → maxBodyCells 13 → keep first 11 cps + "…)"
  const seg = mkSeg({ body: "Bash(pnpm test here ok)" });
  assertEquals(truncateTopSegBody(seg, 15), "Bash(pnpm t…)");
});

Deno.test("truncateTopSegBody: bare tool name (no paren) → generic slice", () => {
  // No `)` terminator → fall through to raw code-point slice, no ellipsis.
  // budget 12 → maxBodyCells 10 → first 10 cps.
  const seg = mkSeg({ body: "BashToolXYZWriteTailChunk" });
  assertEquals(truncateTopSegBody(seg, 12), "BashToolXY");
});

Deno.test("truncateTopSegBody: tool seg with error suffix → generic slice", () => {
  // Body ends with error text, not `)`, so paren-preservation does not fire.
  // budget 16 → maxBodyCells 14 → cut inside the error tail, no ellipsis.
  const seg = mkSeg({ body: "Bash(test) ✖ Exit code 1" });
  assertEquals(truncateTopSegBody(seg, 16), "Bash(test) ✖ E");
});

Deno.test("truncateTopSegBody: budget with slack → body returned unchanged", () => {
  // maxBodyCells >= cps.length → slice returns full body.
  const seg = mkSeg({ body: "Bash(ok)" });
  assertEquals(truncateTopSegBody(seg, 100), "Bash(ok)");
});

Deno.test("default.nix passes --no-prompt to deno compile (prevents picker hang from Deno permission prompter)", async () => {
  // Regression guard. Without --no-prompt, an unauthorized runtime op causes
  // Deno's TtyPrompter::prompt to call clear_stdin (runtime/permissions/
  // prompter.rs), which loops on tcflush + select with a 100ms timeout. Inside
  // a tmux popup, stdin is steadily readable, so select never returns 0 and
  // the loop never exits. The picker's main thread spins inside this loop,
  // starving the JS event loop. ESC/q bytes arrive at stdin but useInput
  // never fires; only SIGINT (Ctrl+C) breaks out via signal-exit. Adding
  // --no-prompt converts unauthorized ops into thrown errors caught by the
  // tick try/catch (picker.tsx:781-783), preserving input responsiveness.
  const url = new URL("./default.nix", import.meta.url);
  const text = await Deno.readTextFile(url);
  const m = text.match(
    /run \$\{pkgs\.deno\}\/bin\/deno compile[\s\S]*?--output/,
  );
  if (!m) {
    throw new Error("Could not locate deno compile invocation in default.nix");
  }
  if (!m[0].includes("--no-prompt")) {
    throw new Error(
      "Missing --no-prompt in deno compile invocation. Without it, Deno's " +
        "permission prompter can infinite-loop on tcflush+select inside " +
        "TtyPrompter::prompt, hanging the picker.",
    );
  }
});

Deno.test("truncateTopSegBody: budget too small for `…)` → generic slice fallback", () => {
  // maxBodyCells < 3 → paren-preservation guard fails, fall back to slice.
  const seg = mkSeg({ body: "Bash(x)" });
  assertEquals(truncateTopSegBody(seg, 4), "Ba");
});
