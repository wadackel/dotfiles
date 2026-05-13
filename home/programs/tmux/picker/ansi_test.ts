import { assertEquals } from "jsr:@std/assert@1";
import { sanitizeAnsi, truncateAnsiLine } from "./ansi.ts";

// --- sanitizeAnsi ---

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

// --- truncateAnsiLine ---

Deno.test("truncateAnsiLine: plain text truncated by display-cell count", () => {
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

// --- truncateAnsiLine: cell-width awareness ---
// `maxCols` is a TERMINAL CELL budget (not a code-point count). East Asian
// Wide / Fullwidth code points consume 2 cells. This is what prevents Ink
// from visually wrapping CJK preview lines and pushing the chat-box at the
// bottom of an AI-agent pane out of view.

Deno.test("truncateAnsiLine: pure CJK truncated to even cell budget", () => {
  // "あいうえお" = 5 chars × 2 cells = 10 cells. maxCols=4 → "あい" (4 cells).
  assertEquals(truncateAnsiLine("あいうえお", 4), "あい");
});

Deno.test("truncateAnsiLine: pure CJK with odd cell budget leaves trailing cell empty", () => {
  // maxCols=3: "あ" (2 cells) fits, next "い" (2 cells) would overflow → stop.
  assertEquals(truncateAnsiLine("あいう", 3), "あ");
});

Deno.test("truncateAnsiLine: mixed ASCII + CJK respects cell totals", () => {
  // "ab あい cd" cells: a(1)+b(1)+SP(1)+あ(2)+い(2)+SP(1)+c(1)+d(1)=10.
  // maxCols=6: a(1)+b(1)+SP(1)+あ(2)=5, next い(2) → 7 > 6 → stop at "ab あ".
  assertEquals(truncateAnsiLine("ab あい cd", 6), "ab あ");
});

Deno.test("truncateAnsiLine: CJK inside closed SGR span", () => {
  // "\x1b[31m日本語\x1b[0m" cells = 6 (3 × 2). maxCols=4 → keep "日本", SGR
  // already closed by the trailing \x1b[0m we never reach, so we still need
  // to emit a reset because hasOpenSgr was set when SGR opened.
  assertEquals(
    truncateAnsiLine("\x1b[31m日本語\x1b[0m", 4),
    "\x1b[31m日本\x1b[0m",
  );
});

Deno.test("truncateAnsiLine: CJK cut keeps SGR-open + appends reset", () => {
  // No trailing \x1b[0m in input. maxCols=4 → "日本" inside red, reset added.
  assertEquals(
    truncateAnsiLine("\x1b[32m日本語", 4),
    "\x1b[32m日本\x1b[0m",
  );
});

Deno.test("truncateAnsiLine: surrogate pair (CJK Ext B) counts as 2 cells, not split", () => {
  // U+20000 (𠀀, CJK Ext B) is a wide char encoded as UTF-16 surrogate pair.
  // 2 cells per occurrence; iteration must read both code units atomically.
  const wide = "\u{20000}\u{20001}\u{20002}"; // 3 wide CPs = 6 cells.
  assertEquals(truncateAnsiLine(wide, 4), "\u{20000}\u{20001}");
  // maxCols=3 → only first wide CP fits (2 cells), next would overflow.
  assertEquals(truncateAnsiLine(wide, 3), "\u{20000}");
});
