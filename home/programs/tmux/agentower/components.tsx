// Pure-ish Ink view layer: PaneRowLine + the visual constants and the
// row-2 truncator it depends on. Extracted from agentower.tsx so the row
// renderer can be reasoned about independently of the App-level state
// machine (selection, filter, fetchPanes, useInput).
//
// Visual tokens (DOGRUN, ROW1_FIXED_OVERHEAD, TaskProgress) and the bottom
// key-hint bar live here too — agentower.tsx re-imports them so the App-level
// chrome (hint bar, filter chip, summary budget, task-progress shape) shares
// a single source.

/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import React from "npm:react@19.2.0";
import { Box, Text } from "npm:ink@7.1.1";

import { type PaneRow, STATUS_META, USER_LABEL_META } from "./pane_row.ts";
import {
  basename,
  elapsedSource,
  formatElapsed,
  formatRemaining,
  locationParts,
  parseSubagents,
  renderSubagentTree,
  repoLabel,
  summaryOf,
  toolSegmentText,
} from "./format_helpers.ts";
import { stringCells, truncateToCells } from "./cell_width.ts";
import {
  type AgentUsage,
  isUsageStale,
  isWindowExpired,
} from "../shared/agent-usage.ts";

// --- Shared types ---

export interface TaskProgress {
  done: number;
  total: number;
}

// --- Layout constants ---

// Row-1 fixed-width overhead before the summary body:
//   marker(2) + icon(1) + " textPad"(1 + 9) + agentSlot(13) + " · "(3) + "  "(2) = 31
// `textPad` holds either the pane-status short text (run/wait/idle/err) or
// the user-defined label text (review/parked/feedback/pending), whichever
// displayMeta() selects for the row. Padded to STATUS_OR_LABEL_TEXT_WIDTH
// so repo column left-edge aligns across labeled and unlabeled rows. The
// leading space sits on the textPad side (not appended to icon) because
// PUA glyphs inside the same <Text> as a trailing space hit Ink 5.2.1's
// supplementary-plane clip bug — see the JSX comment on the renderer.
// `agentSlot` is fixed at 13 cells = PILL_LEFT(1) + " " + agentLabel +
// " "(2 + agentLabel.length) + PILL_RIGHT(1) + trailingPad(9 - agentLabel.length).
// Chip width tracks the canonical name length (claude=10 / opencode=12 /
// codex=9) so the chip itself hugs the text, while the trailing pad keeps the
// total slot width constant so repoCol's left edge aligns across rows. Same
// decorative idiom as the filter chip in the title bar.
// Excludes repoMax/branchMax (dynamic). Used by both App()'s columnBudget and
// PaneRowLine's summaryBudget — keep them in sync via this single constant.
export const ROW1_FIXED_OVERHEAD = 31;

// Width of the row-1 status/label text column (icon is rendered separately
// as a 2-cell <Text>: icon glyph + trailing space). Sized to fit the
// longest UserLabel short text — `feedback` (8 cells) — plus 1 cell of
// trailing gap before the agent chip.
export const STATUS_OR_LABEL_TEXT_WIDTH = 9;

// Row-2 segment (icon + body, colored together). Built in priority order; when
// the cumulative cell width exceeds budget, trim from the end (lowest priority
// first). `icon` and `body` stay separate so the renderer can emit the icon as
// its own <Text> sibling — Ink 5.2.1 silently clips the tail of a <Text> whose
// content is "<supplementary-plane icon> <body>" when a sibling Text follows,
// even with plenty of container slack (reproduced with ink_repro*.tsx).
export interface Row2Seg {
  key: string;
  icon: string;
  body: string;
  color: string;
}

const ROW2_SEP = " · ";

// Row-2 placeholder rendered when no segments are available (fresh session
// with no tool history / subagents / edits / tasks). Without this the row collapses to an indent-only blank line
// that reads as a bug or data-load failure.
const ROW2_EMPTY_TEXT = "(no activity)";

// Cell width = icon(1) + space(1) + body code points. Module-level so
// `truncateTopSegBody` can reference it without threading a parameter.
const SEG_PREFIX_CELLS = 2;

// Pre-truncate the top-priority row-2 segment when its cells exceed `budget`.
// Returns the new body string. For tool segments whose body ends with `)`
// (i.e. "Tool(subject)" with no error suffix), reserve 2 cells and append
// "…)" so the closing paren survives the cut — otherwise fall back to the
// generic code-point slice (bare tool names, error suffixes, non-tool keys).
// Safe to call when the body already fits within the budget — returns the
// original body unchanged in that case so the paren-preservation branch
// cannot spuriously append "…)" when no truncation is needed.
export function truncateTopSegBody(seg: Row2Seg, budget: number): string {
  const maxBodyCells = Math.max(0, budget - SEG_PREFIX_CELLS);
  const cps = Array.from(seg.body);
  if (cps.length <= maxBodyCells) return seg.body;
  if (seg.key === "tool" && seg.body.endsWith(")") && maxBodyCells >= 3) {
    return cps.slice(0, maxBodyCells - 2).join("") + "…)";
  }
  return cps.slice(0, maxBodyCells).join("");
}

// Row-2 segment icons (Nerd Font Material Design). Supplementary-plane code
// points; each renders as 1 cell in CaskaydiaCove Nerd Font Mono. Kept separate
// from body text in Row2Seg so the renderer can emit icon + body as two sibling
// <Text> nodes (see Row2Seg comment above for the Ink clip rationale).
const ROW2_ICONS = {
  tool: "󰒓", // nf-md-cog
  tree: "󱙺", // nf-md-graph-outline
  file: "󰈔", // nf-md-file-document-outline
  progress: "󰄱", // nf-md-checkbox-multiple-marked-outline
} as const;

// Row-2 right block, fixed so the elapsed time and the context gauge line up
// down the list whether or not a pane has values: gap(2) + elapsed(3) + gap(2)
// + gauge(GAUGE_CELLS) + percent(5, " 100%").
const ELAPSED_CELLS = 3;
const GAUGE_CELLS = 8;
const PCT_CELLS = 5;
const ROW2_RIGHT_CELLS = 2 + ELAPSED_CELLS + 2 + GAUGE_CELLS + PCT_CELLS;

// Box Drawing heavy/light horizontals: one cell in charCells and in tmux, and
// present in the primary font, so the gauge never falls back to a wide glyph.
const GAUGE_FILLED = "━";
const GAUGE_TRACK = "─";

// Lit cells for a percentage. A window that has been touched at all keeps one
// lit cell: plain rounding draws 1% and 0% identically, and "have I started
// spending this" is the first question a gauge exists to answer.
function gaugeFill(pct: number): number {
  return Math.min(
    GAUGE_CELLS,
    pct > 0 ? Math.max(1, Math.round(pct / 100 * GAUGE_CELLS)) : 0,
  );
}

// Powerline rounded segment endcaps (Nerd Font: nf-pl-left_soft_divider /
// nf-pl-right_soft_divider). PUA code points are emitted via \u{} escapes per
// CLAUDE.md's "Private Use Area glyphs at runtime" rule so the source file
// stays ASCII-only and grep-/diff-friendly. Each endcap renders as 1 cell in
// CaskaydiaCove Nerd Font Mono and inherits the foreground color of the Text
// node — matching that color to the adjacent badge backgroundColor produces
// the pill silhouette without a literal background fill on the endcap itself.
const PILL_LEFT = "\u{E0B6}";
const PILL_RIGHT = "\u{E0B4}";

// Dogrun-derived palette. See vim-dogrun
// (github.com/wadackel/vim-dogrun colors/dogrun.vim) — keys name the dogrun
// highlight role they derive from, not an abstract severity level.
export const DOGRUN = {
  fg: "#9ea3c0", // Normal — primary text / summary / repo label
  fgDim: "#757aa5", // StatusLine fg — row2 auxiliary segments
  fgChip: "#8085a6", // Delimiter / NormalFloat — agent-chip text (between fgDim and fg)
  muted: "#545c8c", // Comment — separators / low-strength labels
  dim: "#4b4e6d", // StatusLineNC — preview border / target id / last tool
  bgChip: "#2a2c3f", // ColorColumn / CursorLine — agent-chip fill (terminal-bg adjacent)
  // On the selection band the regular chip fill is darker than the band and
  // reads as a hole cut into it, so the chip steps one shade lighter there.
  bgChipOnBand: "#444a70",
  fgChipOnBand: "#a4a8c8",
  accent: "#929be5", // Function — branch / key name / selection bar
  band: "#33385a", // selected pane background — between CursorLine and Visual
  sandy: "#a8a384", // Type — current (running) tool segment
  warn: "#ac8b83", // Keyword — empty-state notice / token 50-75% threshold
  ok: "#6ba291", // token <50% threshold — desaturated from STATUS_META.running
  err: "#d68888", // token ≥75% threshold — desaturated from STATUS_META.error
} as const;

// --- Row-1 display selector ---

// Pick the row-1 icon / text / color for a pane. When the pane carries a
// user-defined label (row.userLabel non-empty) the label's meta wins; the
// pane's automatic PaneStatus (run/wait/idle/err) is hidden in row-1 in
// that case. This helper is **row-1 only** — row-2 segments (lastTool,
// subagents, file, progress) and the elapsed column continue to derive from
// PaneStatus through format_helpers.ts.
//
// Returns the raw label text without padding; callers pad to
// STATUS_OR_LABEL_TEXT_WIDTH so the column aligns.
export function displayMeta(
  row: PaneRow,
): { color: string; icon: string; text: string } {
  if (row.userLabel) {
    const m = USER_LABEL_META[row.userLabel];
    return { color: m.color, icon: m.icon, text: m.short };
  }
  const m = STATUS_META[row.status];
  return { color: m.color, icon: m.icon, text: m.short };
}

// --- PaneRowLine ---

interface PaneRowLineProps {
  row: PaneRow;
  now: number;
  selected: boolean;
  taskProgress: TaskProgress | null;
  listWidth: number;
  repoMax: number;
  branchMax: number;
  // Blank rows above and below that make the pane a four-row card; dropped on
  // a short popup so more panes fit.
  padded: boolean;
}

export const PaneRowLine: React.FC<PaneRowLineProps> = (
  {
    row,
    now,
    selected,
    taskProgress,
    listWidth,
    repoMax,
    branchMax,
    padded,
  }: PaneRowLineProps,
) => {
  const display = displayMeta(row);
  const marker = selected ? "▌ " : "  ";
  // Pad text to fixed width so repo column left-edge stays aligned across
  // labeled and unlabeled rows. Trailing space in each padded column
  // produces inter-column gaps without extra spacer <Text> nodes.
  const textPad = display.text.padEnd(STATUS_OR_LABEL_TEXT_WIDTH);
  const { repo, worktree, branch: branchName } = locationParts(row);
  const repoText = repoLabel(repo, worktree, repoMax);
  const repoPad = " ".repeat(
    Math.max(0, repoMax - stringCells(repoText.head + repoText.suffix)),
  );
  const branchText = truncateToCells(branchName, branchMax);
  const branchCol = branchText +
    " ".repeat(Math.max(0, branchMax - stringCells(branchText)));
  const separator = repo && branchName ? " · " : "   ";
  const summary = summaryOf(row);
  // Truncate so CJK prompts (each char = 2 cells) do not wrap the row into a
  // third line — the previous 40 code-point cap was width-unaware.
  // truncateToCells short-circuits when the string already fits.
  const summaryBudget = Math.max(
    0,
    listWidth - ROW1_FIXED_OVERHEAD - repoMax - branchMax,
  );
  const renderedSummary = truncateToCells(summary, summaryBudget);
  const subagents = parseSubagents(row.subagents);

  // Build row-2 segments in priority order (higher priority first). The
  // cumulative cell width is compared against `budget` and low-priority
  // segments are dropped from the tail if over. target sits in flexGrow-pushed
  // right slot outside this budget.
  const segs: Row2Seg[] = [];
  if (row.currentTool) {
    segs.push({
      key: "tool",
      icon: ROW2_ICONS.tool,
      body: toolSegmentText(row),
      color: DOGRUN.sandy,
    });
  } else if (row.lastTool) {
    segs.push({
      key: "tool",
      icon: ROW2_ICONS.tool,
      body: toolSegmentText(row),
      color: DOGRUN.fgDim,
    });
  }
  if (subagents.length > 0) {
    segs.push({
      key: "tree",
      icon: ROW2_ICONS.tree,
      body: renderSubagentTree(subagents),
      color: DOGRUN.fgDim,
    });
  }
  if (row.lastEditFile) {
    segs.push({
      key: "file",
      icon: ROW2_ICONS.file,
      body: basename(row.lastEditFile),
      color: DOGRUN.fgDim,
    });
  }
  if (taskProgress) {
    segs.push({
      key: "progress",
      icon: ROW2_ICONS.progress,
      body: `${taskProgress.done}/${taskProgress.total}`,
      color: DOGRUN.fgDim,
    });
  }

  // Cell width = icon(1) + space(1) + body code points. Accurate while icons
  // stay supplementary-plane (1 cell) and bodies stay ASCII-heavy. CJK bodies
  // would undercount, but upstream TOOL_SUBJECT_MAX_CHARS=24 bounds that risk.
  const segCells = (s: Row2Seg): number =>
    SEG_PREFIX_CELLS + Array.from(s.body).length;

  const budget = Math.max(0, listWidth - 2 - ROW2_RIGHT_CELLS);
  let totalCells = segs.length > 0 ? segCells(segs[0]) : 0;
  for (let i = 1; i < segs.length; i++) {
    totalCells += ROW2_SEP.length + segCells(segs[i]);
  }
  while (segs.length > 1 && totalCells > budget) {
    const dropped = segs.pop()!;
    totalCells -= ROW2_SEP.length + segCells(dropped);
  }
  // Top-priority segment survives the drop loop but may still exceed budget
  // when alone. Without this guard Ink would wrap the overflow onto the next
  // row, pushing following panes off-screen. truncateTopSegBody handles
  // code-point-safe truncation and preserves `)` for tool segments so the
  // "Tool(subject)" shape keeps its closing paren when width cuts in.
  if (segs.length > 0 && segCells(segs[0]) > budget) {
    segs[0] = { ...segs[0], body: truncateTopSegBody(segs[0], budget) };
  }

  // Agent chip: canonical name wrapped in a Powerline-style rounded chip —
  // same idiom as the filter chip in the title bar. Chip width hugs the
  // label (claude=10, opencode=12, codex=9 cells); trailing pad fills the
  // rest of the fixed 13-cell agentSlot so repoCol stays aligned across
  // mixed-agent rows. Default branch ("claude") is unreachable — fetchPanes
  // filters row.agent to claude/opencode/codex.
  const agentLabel = row.agent === "opencode"
    ? "opencode"
    : row.agent === "codex"
    ? "codex"
    : "claude";
  const agentTrailingPad = " ".repeat(9 - agentLabel.length);
  const chipFill = selected ? DOGRUN.bgChipOnBand : DOGRUN.bgChip;
  const chipText = selected ? DOGRUN.fgChipOnBand : DOGRUN.fgChip;

  const since = elapsedSource(row);
  const elapsed = since === null || since > now
    ? ""
    : formatElapsed(since, now);
  // row.contextUsedPct is sourced from the @pane_context_used_pct tmux option
  // (written by statusline.sh, read via pane_row.ts's TMUX_FORMAT).
  const pct = row.contextUsedPct;
  const pctColor = pct === null
    ? DOGRUN.muted
    : pct < 50
    ? DOGRUN.ok
    : pct < 75
    ? DOGRUN.warn
    : DOGRUN.err;
  const lit = pct === null ? 0 : gaugeFill(pct);

  return (
    <Box
      flexDirection="column"
      backgroundColor={selected ? DOGRUN.band : undefined}
    >
      {
        /* A blank row above and below makes each pane a four-row card; they
          are Text rather than paddingY so the selection marker runs down the
          whole card. */
      }
      {padded ? <Text color={DOGRUN.accent}>{marker}</Text> : null}
      {
        /* Line 1: marker + icon + status-or-label + agent-chip + repo · branch + summary.
          The icon and text are emitted as TWO sibling <Text> nodes (rather
          than concatenated as `icon + " "`) to dodge the Ink 5.2.1 supplementary-
          plane clipping bug — UserLabel icons live in the PUA, so the trailing
          space gets eaten if combined with the glyph inside one <Text>. Same
          idiom as the row-2 segments below. */
      }
      <Box>
        <Text color={DOGRUN.accent}>{marker}</Text>
        <Text color={display.color}>{display.icon}</Text>
        <Text color={display.color}>{" " + textPad}</Text>
        <Text color={chipFill}>{PILL_LEFT}</Text>
        <Text color={chipText} backgroundColor={chipFill}>
          {" " + agentLabel + " "}
        </Text>
        <Text color={chipFill}>{PILL_RIGHT}</Text>
        <Text>{agentTrailingPad}</Text>
        <Text color={DOGRUN.fg}>{repoText.head}</Text>
        {repoText.suffix
          ? <Text color={DOGRUN.fgDim}>{repoText.suffix}</Text>
          : null}
        <Text>{repoPad}</Text>
        <Text color={DOGRUN.muted}>{separator}</Text>
        <Text color={DOGRUN.accent}>{branchCol}</Text>
        <Text color={DOGRUN.fg} bold={selected}>
          {"  " + renderedSummary}
        </Text>
      </Box>
      {
        /* Line 2: marker + priority-ordered segments + fixed right block.
          Each segment emits icon and body as TWO <Text> siblings; combining
          them into one <Text> triggers an Ink 5.2.1 flex-layout bug that eats
          the tail character when a sibling Text follows. */
      }
      <Box>
        <Text color={DOGRUN.accent}>{marker}</Text>
        {segs.length === 0
          ? <Text color={DOGRUN.muted}>{ROW2_EMPTY_TEXT}</Text>
          : segs.map((s, i) => (
            <React.Fragment key={s.key}>
              {i > 0 ? <Text color={DOGRUN.muted}>{ROW2_SEP}</Text> : null}
              <Text color={s.color}>{s.icon}</Text>
              <Text color={s.color}>{" " + s.body}</Text>
            </React.Fragment>
          ))}
        <Box flexGrow={1} />
        <Text color={DOGRUN.fgDim}>
          {"  " + elapsed.padStart(ELAPSED_CELLS) + "  "}
        </Text>
        {pct === null ? <Text>{" ".repeat(GAUGE_CELLS + PCT_CELLS)}</Text> : (
          <>
            <Text color={pctColor}>{GAUGE_FILLED.repeat(lit)}</Text>
            <Text color={DOGRUN.dim}>
              {GAUGE_TRACK.repeat(GAUGE_CELLS - lit)}
            </Text>
            <Text color={pctColor}>
              {`${pct}%`.padStart(PCT_CELLS)}
            </Text>
          </>
        )}
      </Box>
      {padded ? <Text color={DOGRUN.accent}>{marker}</Text> : null}
    </Box>
  );
};

// --- Usage rows ---

export interface UsageToken {
  text: string;
  color: string;
  backgroundColor?: string;
}

// Only the percentage and the filled run of the bar escalate, and only past
// this line. The per-pane context % uses a three-tier gradient, but this card is
// reference material parked under the preview — colouring it on every render
// would keep pulling the eye back to a number that rarely matters.
const USAGE_ALERT_PCT = 80;

// The countdown rides the shortest window alone. A 7d reset is days out and
// never changes what the reader does next.
const COUNTDOWN_LABEL = "5h";

// U+21BB ↻ read better on paper but is absent from CaskaydiaCove Nerd Font Mono,
// so it fell through to the CJK fallback and drew a double-width glyph inside one
// cell, bleeding over the digit next to it. Nerd Font PUA glyphs are patched to a
// single-cell advance and never leave the primary font.
const COUNTDOWN_ICON = "\u{F0450}"; // nf-md-refresh

// Sub-slot widths. The row width is their sum, and the bar threshold is derived
// from that sum rather than written as its own literal — a literal would keep
// the old threshold when one of these constants moves.
const AGENT_PAD = 2;
const PCT_W = 4; // "100%" / "  1%" / "  --"
const REMAIN_W = 5; // formatRemaining tops out at "4h59m"
const COUNTDOWN_W = 3 + REMAIN_W; // " " + icon + " " + remaining
const COL_GAP = 2;
// Reserved on every row whether or not the file is currently stale. Staleness
// flips with elapsed time, so deriving the row width from the actual suffix
// would make the bar appear and vanish as a usage file crosses 15 minutes.
// Sized for a two-digit age; past 99d the suffix runs one cell long and
// clampUsageTokens trims its tail, which costs nothing that a column depends on
// because the suffix is last on the row.
const STALE_W = 10; // " (29d ago)"

// Neither sibling formatter fits: formatElapsed caps at 99d and renders a
// fresh file as seconds rather than "0m", and formatRemaining counts down
// toward a deadline rather than up from a timestamp.
function formatAge(sec: number): string {
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export interface UsageLayout {
  cols: string[];
  agentW: number;
  labelW: number;
  bars: boolean;
}

// Union in encounter order rather than by parsed window duration. Both writers
// already emit shortest-window-first, and USAGE_LABEL_RE admits any
// [0-9a-z]{1,8}, so a parser would owe an ordering for labels it cannot rank.
function usageColumns(usages: AgentUsage[]): string[] {
  const out: string[] = [];
  for (const u of usages) {
    for (const w of u.windows) if (!out.includes(w.label)) out.push(w.label);
  }
  return out;
}

// The renderer and the bar threshold must agree on this to the cell: a second
// copy would let a cap or label change move the drawn row without moving the
// width the threshold reasons about, and the result is a wrapped row rather
// than a type error.
function usageCellW(layout: UsageLayout): number {
  return layout.labelW + 1 + (layout.bars ? GAUGE_CELLS + 1 : 0) + PCT_W;
}

export function usageRowWidth(layout: UsageLayout): number {
  const { cols, agentW } = layout;
  const cellW = usageCellW(layout);
  let w = agentW;
  cols.forEach((label, i) => {
    if (i > 0) w += COL_GAP;
    w += cellW;
    if (label === COUNTDOWN_LABEL) w += COUNTDOWN_W;
  });
  return w + STALE_W;
}

// Both entry points narrow to the same set; two copies of the predicate would
// let agentW be sized off a different roster than the rows actually drawn.
function agentsWithWindows(usages: AgentUsage[]): AgentUsage[] {
  return usages.filter((u) => u.windows.length > 0);
}

export function usageLayout(
  usages: AgentUsage[],
  innerWidth: number,
): UsageLayout | null {
  const present = agentsWithWindows(usages);
  if (present.length === 0) return null;
  const cols = usageColumns(present);
  const withBars: UsageLayout = {
    cols,
    agentW: Math.max(...present.map((u) => u.agent.length)) + AGENT_PAD,
    labelW: Math.max(...cols.map((l) => l.length)),
    bars: true,
  };
  return usageRowWidth(withBars) <= innerWidth
    ? withBars
    : { ...withBars, bars: false };
}

function barTokens(pct: number, alert: boolean): UsageToken[] {
  const filled = gaugeFill(pct);
  return [
    {
      text: GAUGE_FILLED.repeat(filled),
      color: alert ? DOGRUN.err : DOGRUN.fgDim,
    },
    { text: GAUGE_TRACK.repeat(GAUGE_CELLS - filled), color: DOGRUN.dim },
  ].filter((t) => t.text.length > 0);
}

function usageRowTokens(
  usage: AgentUsage,
  layout: UsageLayout,
  nowSec: number,
): UsageToken[] {
  const { cols, agentW, labelW, bars } = layout;
  const cellW = usageCellW(layout);
  const byLabel = new Map(usage.windows.map((w) => [w.label, w]));
  const out: UsageToken[] = [
    { text: usage.agent.padEnd(agentW), color: DOGRUN.fgDim },
  ];
  cols.forEach((label, i) => {
    if (i > 0) out.push({ text: " ".repeat(COL_GAP), color: DOGRUN.muted });
    const w = byLabel.get(label);
    if (w === undefined) {
      out.push({ text: " ".repeat(cellW), color: DOGRUN.muted });
      if (label === COUNTDOWN_LABEL) {
        out.push({ text: " ".repeat(COUNTDOWN_W), color: DOGRUN.muted });
      }
      return;
    }
    const expired = isWindowExpired(w, nowSec);
    const alert = !expired && w.usedPct >= USAGE_ALERT_PCT;
    out.push({ text: label.padEnd(labelW) + " ", color: DOGRUN.fgDim });
    if (bars) {
      // An elapsed window says the quota reset, not that nothing was spent
      // since — an empty track would assert 0%, which the file cannot support.
      out.push(
        ...(expired
          ? [{ text: " ".repeat(GAUGE_CELLS), color: DOGRUN.muted }]
          : barTokens(w.usedPct, alert)),
      );
      out.push({ text: " ", color: DOGRUN.muted });
    }
    out.push({
      text: (expired ? "--" : `${w.usedPct}%`).padStart(PCT_W),
      color: alert ? DOGRUN.err : DOGRUN.fgDim,
    });
    if (label !== COUNTDOWN_LABEL) return;
    if (expired) {
      // The slot stays reserved: collapsing it would slide only this row's
      // later columns eight cells left.
      out.push({ text: " ".repeat(COUNTDOWN_W), color: DOGRUN.muted });
      return;
    }
    // Ink clips the tail of a <Text> holding "<supplementary-plane glyph>
    // <body>" when a sibling <Text> follows, same as PaneRowLine's segments.
    out.push({ text: " ", color: DOGRUN.fgDim });
    out.push({ text: COUNTDOWN_ICON, color: DOGRUN.fgDim });
    out.push({
      // padEnd alone widens the slot when the writer reports a reset further out
      // than the window name implies, and the columns after it slide right.
      text: " " +
        truncateToCells(formatRemaining(w.resetsAt, nowSec), REMAIN_W)
          .padEnd(REMAIN_W),
      color: DOGRUN.fgDim,
    });
  });
  if (isUsageStale(usage, nowSec)) {
    out.push({
      text: ` (${formatAge(nowSec - usage.updatedAt)} ago)`,
      color: DOGRUN.muted,
    });
  }
  return out;
}

// One row per agent, columns keyed on the union of window labels so an agent
// that lacks a window leaves a gap the eye can land on. Flat token lists rather
// than formatted strings: the percentage and the filled run need their own
// colour, and colouring a pre-joined line would mean re-finding them inside it.
export function usageRows(
  usages: AgentUsage[],
  nowSec: number,
  innerWidth: number,
): UsageToken[][] {
  const layout = usageLayout(usages, innerWidth);
  if (layout === null) return [];
  return agentsWithWindows(usages).map((u) =>
    usageRowTokens(u, layout, nowSec)
  );
}

// Ink clips against the root box height, so a wrapped row would silently
// eat the bottom pane row instead of overflowing visibly.
export function clampUsageTokens(
  tokens: UsageToken[],
  budget: number,
): UsageToken[] {
  const kept: UsageToken[] = [];
  let used = 0;
  for (const t of tokens) {
    const w = stringCells(t.text);
    if (used + w <= budget) {
      kept.push(t);
      used += w;
      continue;
    }
    const room = budget - used;
    if (room > 0) kept.push({ ...t, text: truncateToCells(t.text, room) });
    break;
  }
  return kept;
}

// --- Titled card ---

// A rounded frame whose top edge carries a title, as `╭─ title ─────╮`. Ink
// draws no border titles, so the top edge is a Text row of its own and the Box
// below it draws the other three sides.
const CARD_TOP_LEFT = "╭─ ";

interface CardProps {
  title: UsageToken[];
  width: number;
  height?: number;
  children?: React.ReactNode;
}

export const Card: React.FC<CardProps> = (
  { title, width, height, children }: CardProps,
) => {
  // CARD_TOP_LEFT + title + " " + at least one "─" + "╮"
  const shown = clampUsageTokens(title, Math.max(0, width - 6));
  const titleCells = shown.reduce((n, t) => n + stringCells(t.text), 0);
  const rule = "─".repeat(Math.max(1, width - 5 - titleCells));
  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box>
        <Text color={DOGRUN.dim}>{CARD_TOP_LEFT}</Text>
        {shown.map((t, i) => (
          <React.Fragment key={i}>
            <Text color={t.color} bold={i === 0}>{t.text}</Text>
          </React.Fragment>
        ))}
        <Text color={DOGRUN.dim}>{" " + rule + "╮"}</Text>
      </Box>
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderTop={false}
        borderColor={DOGRUN.dim}
        paddingX={1}
      >
        {children}
      </Box>
    </Box>
  );
};

// Rows the Usage card takes: top edge, one row per agent, bottom border.
export function usageCardRows(usageCount: number): number {
  return usageCount + 2;
}

// Border (2) + paddingX (2).
export const CARD_CHROME_COLS = 4;

interface UsageCardProps {
  usages: AgentUsage[];
  now: number;
  width: number;
}

export const UsageCard: React.FC<UsageCardProps> = (
  { usages, now, width }: UsageCardProps,
) => {
  const inner = Math.max(0, width - CARD_CHROME_COLS);
  return (
    <Card title={[{ text: "Usage", color: DOGRUN.fg }]} width={width}>
      {usageRows(usages, now, inner).map((row, ri) => (
        <Box key={ri}>
          {clampUsageTokens(row, inner).map((t, i) => (
            // Ink 7 types Text's props as a closed object, so `key` on it fails
            // type-check (TS2322) even though React treats key as reserved.
            <React.Fragment key={i}>
              <Text color={t.color}>{t.text}</Text>
            </React.Fragment>
          ))}
        </Box>
      ))}
    </Card>
  );
};

// --- Key-hint bar ---

// U+21B5 ↵ is absent from CaskaydiaCove Nerd Font Mono and would fall back to
// a double-width glyph inside one cell, as ↻ did for the countdown.
const ENTER_ICON = "\u{F0311}"; // nf-md-keyboard-return

const HINT_GAP = "   ";

function chipTokens(
  text: string,
  color: string,
  fill: string,
): UsageToken[] {
  return [
    { text: PILL_LEFT, color: fill },
    { text, color, backgroundColor: fill },
    { text: PILL_RIGHT, color: fill },
  ];
}

// The bottom row: the wait/idle filter pill while `w` is on, then each key as
// a chip followed by what it does. Built as tokens so clampUsageTokens can cut
// it from the right on a narrow popup — "jump" sits first so the harness'
// spawn marker survives the narrowest e2e width.
export function hintTokens(filterEnabled: boolean): UsageToken[] {
  const keys: [string, string][] = [
    [ENTER_ICON, "jump"],
    ["j k", "move"],
    ["n", "next wait"],
    ["w", filterEnabled ? "clear" : "filter"],
    ["m", "label"],
    ["q", "quit"],
  ];
  const out: UsageToken[] = filterEnabled
    ? [
      ...chipTokens(" wait/idle ", DOGRUN.fg, DOGRUN.muted),
      { text: HINT_GAP, color: DOGRUN.muted },
    ]
    : [];
  keys.forEach(([key, label], i) => {
    if (i > 0) out.push({ text: HINT_GAP, color: DOGRUN.muted });
    out.push(...chipTokens(key, DOGRUN.accent, DOGRUN.bgChip));
    out.push({ text: " " + label, color: DOGRUN.fgDim });
  });
  return out;
}

interface HintBarProps {
  filterEnabled: boolean;
  width: number;
}

export const HintBar: React.FC<HintBarProps> = (
  { filterEnabled, width }: HintBarProps,
) => (
  <Box marginTop={1}>
    {clampUsageTokens(hintTokens(filterEnabled), width).map((t, i) => (
      <React.Fragment key={i}>
        <Text color={t.color} backgroundColor={t.backgroundColor}>
          {t.text}
        </Text>
      </React.Fragment>
    ))}
  </Box>
);
