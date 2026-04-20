import { assertEquals } from "jsr:@std/assert@1";
import {
  cwdBranchLabel,
  formatElapsed,
  type PaneRow,
  parseRow,
  parseSubagents,
  parseTarget,
  renderSubagentTree,
  sanitizeAnsi,
  statusColor,
  statusIcon,
  statusShort,
  summaryOf,
  TMUX_FORMAT,
  truncateAnsiLine,
} from "./picker.tsx";

Deno.test("TMUX_FORMAT contains 13 US-separated field tokens", () => {
  const fields = TMUX_FORMAT.split("\x1f");
  assertEquals(fields.length, 13);
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
  };
  assertEquals(row, expected);
});

Deno.test("parseRow: empty @pane_* fields stay as empty strings / null", () => {
  const line = [
    "%1",
    "0:0.0",
    "zsh",
    "/home/me",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ].join("\x1f");
  const row = parseRow(line);
  assertEquals(row?.agent, "");
  assertEquals(row?.status, "");
  assertEquals(row?.startedAtSec, null);
  assertEquals(row?.subagents, "");
  assertEquals(row?.currentTool, "");
  assertEquals(row?.worktreeBranch, "");
  assertEquals(row?.currentPath, "/home/me");
});

Deno.test("parseRow: unknown status normalized to empty string", () => {
  const line = [
    "%1",
    "0:0.0",
    "zsh",
    "",
    "",
    "bogus",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ]
    .join("\x1f");
  assertEquals(parseRow(line)?.status, "");
});

Deno.test("parseRow: non-numeric started_at → null (safe parse)", () => {
  const line = [
    "%1",
    "0:0.0",
    "zsh",
    "",
    "",
    "idle",
    "nope",
    "",
    "",
    "",
    "",
    "",
    "",
  ]
    .join("\x1f");
  assertEquals(parseRow(line)?.startedAtSec, null);
});

Deno.test("parseRow: malformed input returns null", () => {
  assertEquals(parseRow(""), null);
  assertEquals(parseRow("only\x1ftwo"), null);
  // 13 fields but paneId empty → null (matches bash SELF_PANE_ID skip logic)
  const emptyId = Array(13).fill("").join("\x1f");
  assertEquals(parseRow(emptyId), null);
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
  assertEquals(statusColor("running"), "green");
  assertEquals(statusColor("waiting"), "yellow");
  assertEquals(statusColor("idle"), "gray");
  assertEquals(statusColor("error"), "red");
});

Deno.test("statusColor: unknown → white", () => {
  assertEquals(statusColor(""), "white");
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

Deno.test("summaryOf: truncates to 40 chars", () => {
  const long = "a".repeat(80);
  assertEquals(summaryOf(mkRow({ prompt: long })).length, 40);
});

// --- cwdBranchLabel ---

Deno.test("cwdBranchLabel: cwd + branch → slash-joined", () => {
  assertEquals(
    cwdBranchLabel("/Users/wadackel/dotfiles", "main"),
    "dotfiles/main",
  );
});

Deno.test("cwdBranchLabel: cwd only → basename", () => {
  assertEquals(cwdBranchLabel("/Users/wadackel/dotfiles", ""), "dotfiles");
});

Deno.test("cwdBranchLabel: branch only → branch", () => {
  assertEquals(cwdBranchLabel("", "main"), "main");
});

Deno.test("cwdBranchLabel: both empty → middle dot", () => {
  assertEquals(cwdBranchLabel("", ""), "·");
});

Deno.test("cwdBranchLabel: root path → /", () => {
  assertEquals(cwdBranchLabel("/", "main"), "//main");
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

Deno.test("renderSubagentTree: single entry → └ with number", () => {
  assertEquals(
    renderSubagentTree([{ type: "Explore", id: "a1" }]),
    "└ Explore #1",
  );
});

Deno.test("renderSubagentTree: multiple entries → tree connectors", () => {
  const result = renderSubagentTree([
    { type: "Explore", id: "a1" },
    { type: "Plan", id: "b2" },
    { type: "Researcher", id: "c3" },
  ]);
  assertEquals(result, "├ Explore #1 ├ Plan #1 └ Researcher #1");
});

Deno.test("renderSubagentTree: same type auto-numbers per type", () => {
  const result = renderSubagentTree([
    { type: "Explore", id: "a1" },
    { type: "Explore", id: "b2" },
    { type: "Plan", id: "c3" },
  ]);
  assertEquals(result, "├ Explore #1 ├ Explore #2 └ Plan #1");
});
