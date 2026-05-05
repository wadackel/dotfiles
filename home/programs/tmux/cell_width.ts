// Display-cell width helpers + ellipsis-aware truncation.
// Pure module — extracted from picker.tsx so non-React tooling can compute
// terminal-cell widths (CJK / fullwidth aware) without dragging in
// npm:react / npm:ink.

// East Asian Wide + Fullwidth ranges (Unicode EAW W + F). Other categories
// (narrow / ambiguous / neutral) fall back to 1 cell, matching default
// terminal rendering outside East Asian locales. Called per code point from
// Array.from iteration so surrogate pairs are already merged.
export const EAST_ASIAN_WIDE_RE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{2FFFD}]/u;

export function charCells(ch: string): number {
  return EAST_ASIAN_WIDE_RE.test(ch) ? 2 : 1;
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

// Truncate `s` to at most `cells` display cells, appending "…" on overflow.
// - cells <= 0 → ""
// - stringCells(s) <= cells → s unchanged (no ellipsis when the whole string fits)
// - cells === 1 (or the budget after reserving 1 cell for "…" cannot fit any
//   leading code point) → just "…"
// Iterates code points via `for..of` so surrogate pairs are not split.
export function truncateToCells(s: string, cells: number): string {
  if (cells <= 0) return "";
  if (stringCells(s) <= cells) return s;
  const budget = cells - 1;
  if (budget <= 0) return ELLIPSIS;
  let used = 0;
  let out = "";
  for (const ch of s) {
    const w = charCells(ch);
    if (used + w > budget) break;
    used += w;
    out += ch;
  }
  return out + ELLIPSIS;
}
