import { assertEquals } from "jsr:@std/assert@1";
import { stringCells, truncateToCells } from "./cell_width.ts";

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

// Expected widths are tmux's own: each was read back as #{cursor_x} after
// printing the string into a pane.
Deno.test("stringCells: emoji with default emoji presentation → 2 cells", () => {
  assertEquals(stringCells("A🎉B"), 4);
  assertEquals(stringCells("⭐"), 2);
  assertEquals(stringCells("⌛"), 2);
});

Deno.test("stringCells: text-presentation symbols stay 1 cell", () => {
  assertEquals(stringCells("⏺✻⚠✔▶"), 5);
});

Deno.test("stringCells: combining marks and zero-width characters → 0 cells", () => {
  assertEquals(stringCells("か\u3099X"), 3); // NFD が + X
  assertEquals(stringCells("e\u0301Y"), 2);
  assertEquals(stringCells("\u200bZ"), 1);
});

Deno.test("stringCells: VS16 widens the symbol before it", () => {
  assertEquals(stringCells("\u2764\ufe0fZ"), 3);
});

Deno.test("truncateToCells: emoji counted as 2 cells", () => {
  assertEquals(truncateToCells("🎉🎉🎉", 4), "🎉…");
});
