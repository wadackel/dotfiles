// Display-cell width helpers + ellipsis-aware truncation.
// Pure module — extracted from agentower.tsx so non-React tooling can compute
// terminal-cell widths (CJK / fullwidth aware) without dragging in
// npm:react / npm:ink.

// East Asian Wide + Fullwidth ranges (Unicode EAW W + F). Other categories
// (narrow / ambiguous / neutral) fall back to 1 cell, matching default
// terminal rendering outside East Asian locales. Called per code point from
// Array.from iteration so surrogate pairs are already merged.
export const EAST_ASIAN_WIDE_RE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{2FFFD}]/u;

// Combining marks and zero-width format characters draw into the previous
// cell. Checked before EAST_ASIAN_WIDE_RE because the kana block it spans also
// holds the combining (han)dakuten U+3099/U+309A that macOS NFD paths carry.
// VS16 (U+FE0F) is a nonspacing mark too, but it is left at 1 cell: tmux turns
// the narrow symbol before it into a 2-cell emoji (U+2764 U+FE0F), and a per-code-point
// count only gets that total right by charging the selector for the extra cell.
const ZERO_WIDTH_RE = /[\p{Mn}\p{Me}\u200B-\u200F\u2060\uFEFF]/u;

// Emoji whose default presentation is emoji (🎉, ⭐, ⌛) are EAW Wide, but sit
// outside the CJK ranges above. Text-default symbols (⏺, ✻, ⚠) stay 1 cell,
// which is what tmux measures for both groups.
const EMOJI_PRESENTATION_RE = /\p{Emoji_Presentation}/u;

export function charCells(ch: string): number {
  if (ch !== "\uFE0F" && ZERO_WIDTH_RE.test(ch)) return 0;
  return EAST_ASIAN_WIDE_RE.test(ch) || EMOJI_PRESENTATION_RE.test(ch) ? 2 : 1;
}

// Display cell width of `s` accounting for EAW Wide/Fullwidth code points
// as 2 cells. Used by PaneRowLine to bound Line 1 summary to the remaining
// listWidth budget (CJK prompts were overflowing the 40 code-point cap).
export function stringCells(s: string): number {
  let total = 0;
  for (const ch of s) total += charCells(ch);
  return total;
}

export const ELLIPSIS = "…"; // U+2026, 1 cell. Matches truncateTopSegBody's marker.

// Longest prefix of `s` that fits in `cells` display cells, with no marker.
// Iterates code points via `for..of` so surrogate pairs are not split, and
// keeps a zero-width mark that follows the last character taken.
export function sliceToCells(s: string, cells: number): string {
  let used = 0;
  let out = "";
  for (const ch of s) {
    const w = charCells(ch);
    if (used + w > cells) break;
    used += w;
    out += ch;
  }
  return out;
}

// Truncate `s` to at most `cells` display cells, appending "…" on overflow.
// - cells <= 0 → ""
// - stringCells(s) <= cells → s unchanged (no ellipsis when the whole string fits)
// - cells === 1 (or the budget after reserving 1 cell for "…" cannot fit any
//   leading code point) → just "…"
export function truncateToCells(s: string, cells: number): string {
  if (cells <= 0) return "";
  if (stringCells(s) <= cells) return s;
  return sliceToCells(s, cells - 1) + ELLIPSIS;
}
