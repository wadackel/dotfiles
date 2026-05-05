// Pure-ish Ink view layer: PaneRowLine + the visual constants and the
// row-2 truncator it depends on. Extracted from picker.tsx so the row
// renderer can be reasoned about independently of the App-level state
// machine (selection, filter, fetchPanes, useInput).
//
// Visual tokens (DOGRUN, PILL_LEFT, PILL_RIGHT, TITLE_ICON, ROW1_FIXED_OVERHEAD,
// TaskProgress) live here too — picker.tsx re-imports them so the App-level
// chrome (title bar, filter chip, summary budget, task-progress shape) shares
// a single source.

/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import React from "npm:react@18.3.1";
import { Box, Text } from "npm:ink@5.2.1";

import { type PaneRow } from "./pane_row.ts";
import {
  basename,
  cwdBranchParts,
  formatElapsed,
  parseSubagents,
  renderSubagentTree,
  statusColor,
  statusIcon,
  statusShort,
  summaryOf,
  toolSegmentText,
} from "./format_helpers.ts";
import { truncateToCells } from "./cell_width.ts";

// --- Shared types ---

export interface TaskProgress {
  done: number;
  total: number;
}

// --- Layout constants ---

// Row-1 fixed-width overhead before the summary body:
//   pointer(2) + "icon "(2) + status5(5) + elapsed5(5) + agentSlot(13) + " · "(3) + "  "(2) = 32
// `agentSlot` is fixed at 13 cells = PILL_LEFT(1) + " " + agentLabel +
// " "(2 + agentLabel.length) + PILL_RIGHT(1) + trailingPad(9 - agentLabel.length).
// Chip width tracks the canonical name length (claude=10 / opencode=12 /
// codex=9) so the chip itself hugs the text, while the trailing pad keeps the
// total slot width constant so repoCol's left edge aligns across rows. Same
// decorative idiom as the filter chip in the title bar.
// Excludes repoMax/branchMax (dynamic). Used by both App()'s columnBudget and
// PaneRowLine's summaryBudget — keep them in sync via this single constant.
export const ROW1_FIXED_OVERHEAD = 32;

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
// with no tool history / subagents / edits / tasks and no idle activity
// timestamp). Without this the row collapses to an indent-only blank line
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
  idle: "󰏤", // nf-md-sleep
  token: "\u{F01BC}", // nf-md-database — mirrors statusline's nf-fa-database
} as const;

// Powerline rounded segment endcaps (Nerd Font: nf-pl-left_soft_divider /
// nf-pl-right_soft_divider). PUA code points are emitted via \u{} escapes per
// CLAUDE.md's "Private Use Area glyphs at runtime" rule so the source file
// stays ASCII-only and grep-/diff-friendly. Each endcap renders as 1 cell in
// CaskaydiaCove Nerd Font Mono and inherits the foreground color of the Text
// node — matching that color to the adjacent badge backgroundColor produces
// the pill silhouette without a literal background fill on the endcap itself.
export const PILL_LEFT = "\u{E0B6}";
export const PILL_RIGHT = "\u{E0B4}";

// Title bar icon + dogrun-derived palette. See vim-dogrun
// (github.com/wadackel/vim-dogrun colors/dogrun.vim) — keys name the dogrun
// highlight role they derive from, not an abstract severity level.
export const TITLE_ICON = "󱚤"; // nf-md-robot-outline, 1 cell
export const DOGRUN = {
  fg: "#9ea3c0", // Normal — primary text / summary / repo label
  fgDim: "#757aa5", // StatusLine fg — row2 auxiliary segments
  fgChip: "#8085a6", // Delimiter / NormalFloat — agent-chip text (between fgDim and fg)
  muted: "#545c8c", // Comment — separators / low-strength labels
  dim: "#4b4e6d", // StatusLineNC — preview border / target id / last tool
  bgChip: "#2a2c3f", // ColorColumn / CursorLine — agent-chip fill (terminal-bg adjacent)
  accent: "#929be5", // Function — title / branch / key name / preview title
  search: "#a6afff", // Search — selected pointer marker
  sandy: "#a8a384", // Type — current (running) tool segment
  warn: "#ac8b83", // Keyword — empty-state notice / token 50-75% threshold
  ok: "#6ba291", // token <50% threshold — desaturated from STATUS_META.running
  err: "#d68888", // token ≥75% threshold — desaturated from STATUS_META.error
} as const;

// --- PaneRowLine ---

interface PaneRowLineProps {
  row: PaneRow;
  now: number;
  selected: boolean;
  taskProgress: TaskProgress | null;
  listWidth: number;
  repoMax: number;
  branchMax: number;
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
  }: PaneRowLineProps,
) => {
  const color = statusColor(row.status);
  const pointer = selected ? "❯ " : "  ";
  const icon = statusIcon(row.status);
  const statusText = statusShort(row.status);
  // Trailing space in each padded column produces inter-column gaps without
  // extra spacer <Text> nodes.
  const status5 = statusText.slice(0, 4).padEnd(5);
  const elapsed5 = formatElapsed(row.startedAtSec, now).padEnd(5);
  const { repo, branch: branchName } = cwdBranchParts(
    row.cwd || row.currentPath,
    row.worktreeBranch,
  );
  const repoCol = repo.slice(0, repoMax).padEnd(repoMax);
  const branchCol = branchName.slice(0, branchMax).padEnd(branchMax);
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
  if (row.status === "idle" && row.lastActivityAtSec !== null) {
    segs.push({
      key: "idle",
      icon: ROW2_ICONS.idle,
      body: `idle ${formatElapsed(row.lastActivityAtSec, now)}`,
      color: DOGRUN.fgDim,
    });
  }

  // Cell width = icon(1) + space(1) + body code points. Accurate while icons
  // stay supplementary-plane (1 cell) and bodies stay ASCII-heavy. CJK bodies
  // would undercount, but upstream TOOL_SUBJECT_MAX_CHARS=24 bounds that risk.
  const segCells = (s: Row2Seg): number =>
    SEG_PREFIX_CELLS + Array.from(s.body).length;

  // Budget = listWidth minus 2-space indent minus the flex-pushed row.target
  // on the right minus the token slot (icon + space + "NN%" + 2-space gap).
  // Target is ASCII (tmux "session:W.P"), so target.length equals its cell width.
  // row.contextUsedPct is sourced from the @pane_context_used_pct tmux option
  // (written by statusline.sh, read via pane_row.ts's TMUX_FORMAT).
  const tokenSlotCells = row.contextUsedPct != null
    ? SEG_PREFIX_CELLS + Array.from(`${row.contextUsedPct}%`).length + 2
    : 0;
  const budget = Math.max(
    0,
    listWidth - 2 - row.target.length - tokenSlotCells,
  );
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

  return (
    <Box flexDirection="column">
      {/* Line 1: marker + icon + status + elapsed + agent-chip + repo · branch + summary */}
      <Box>
        <Text color={selected ? DOGRUN.search : DOGRUN.dim}>{pointer}</Text>
        <Text color={color}>{icon + " "}</Text>
        <Text color={color}>{status5}</Text>
        <Text color={DOGRUN.fgDim}>{elapsed5}</Text>
        <Text color={DOGRUN.bgChip}>{PILL_LEFT}</Text>
        <Text color={DOGRUN.fgChip} backgroundColor={DOGRUN.bgChip}>
          {" " + agentLabel + " "}
        </Text>
        <Text color={DOGRUN.bgChip}>{PILL_RIGHT}</Text>
        <Text>{agentTrailingPad}</Text>
        <Text color={DOGRUN.fg}>{repoCol}</Text>
        <Text color={DOGRUN.muted}>{separator}</Text>
        <Text color={DOGRUN.accent}>{branchCol}</Text>
        <Text color={DOGRUN.fg}>{"  " + renderedSummary}</Text>
      </Box>
      {
        /* Line 2: indent + priority-ordered segments + target (right-align).
          Each segment emits icon and body as TWO <Text> siblings; combining
          them into one <Text> triggers an Ink 5.2.1 flex-layout bug that eats
          the tail character when a sibling Text follows. */
      }
      <Box>
        <Text>{"  "}</Text>
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
        {row.contextUsedPct != null
          ? (() => {
            const pct = row.contextUsedPct;
            const tokenColor = pct < 50
              ? DOGRUN.ok
              : pct < 75
              ? DOGRUN.warn
              : DOGRUN.err;
            return (
              <>
                <Text color={tokenColor}>{ROW2_ICONS.token}</Text>
                <Text color={tokenColor}>{` ${pct}%`}</Text>
                <Text>{"  "}</Text>
              </>
            );
          })()
          : null}
        <Text color={DOGRUN.muted}>{row.target}</Text>
      </Box>
    </Box>
  );
};
