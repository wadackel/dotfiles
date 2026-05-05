// Pure formatters used by the picker UI: status accessors, elapsed-time
// formatter, path/branch utilities, summary/tool-segment text, and subagent
// list parsing/rendering. Extracted from picker.tsx so each helper can be
// unit-tested without npm:react / npm:ink at parse time.

import { type PaneRow, type PaneStatus, STATUS_META } from "./pane_row.ts";

// Elapsed seconds → "Ns" / "Nm" / "Nh" / "·" (middle dot placeholder).
// Mirrors bash format_elapsed in tmux-window-picker.sh:40-56.
export function formatElapsed(
  startedAtSec: number | null,
  nowSec: number,
): string {
  if (startedAtSec === null) return "·";
  const d = nowSec - startedAtSec;
  if (d < 0) return "·";
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  return `${Math.floor(d / 3600)}h`;
}

export function statusColor(status: PaneStatus): string {
  return STATUS_META[status].color;
}

export function statusShort(status: PaneStatus): string {
  return STATUS_META[status].short;
}

export function statusIcon(status: PaneStatus): string {
  return STATUS_META[status].icon;
}

// Basename of a path ("/" → "/", "" → "", "/a/b/c" → "c").
export function basename(path: string): string {
  if (!path) return "";
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed) return "/";
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

// Split cwd/branch into separate columns for the row renderer. Both fields are
// emitted independently so the renderer can place a middle-dot separator
// between them and align each column with padEnd. When both are empty, repo
// carries the "·" placeholder so the row is never blank.
export function cwdBranchParts(
  cwd: string,
  branch: string,
): { repo: string; branch: string } {
  const base = basename(cwd);
  if (!base && !branch) return { repo: "·", branch: "" };
  return { repo: base, branch };
}

// summary 表示: status が waiting/error なら wait_reason を優先、それ以外は prompt。
// どちらも空なら "·"。Mirrors bash tmux-window-picker.sh:118-125.
// Width-based truncation is the caller's responsibility (PaneRowLine applies
// stringCells/truncateToCells against listWidth so CJK prompts do not wrap
// into a third row).
export function summaryOf(row: PaneRow): string {
  const src = row.status === "waiting" || row.status === "error"
    ? (row.waitReason || row.prompt)
    : row.prompt;
  return src || "·";
}

// Row-2 tool segment text: "<tool>[(<subject>)][ ✖ <error>]". Same text for
// current and last tools — the caller distinguishes them by color (DOGRUN.sandy
// for current, DOGRUN.fgDim for last). Returns "" when no tool has run.
export function toolSegmentText(row: PaneRow): string {
  const tool = row.currentTool || row.lastTool;
  if (!tool) return "";
  const subject = row.currentTool
    ? row.currentToolSubject
    : row.lastToolSubject;
  const base = subject ? `${tool}(${subject})` : tool;
  if (!row.currentTool && row.lastToolError) {
    return `${base} ✖ ${row.lastToolError}`;
  }
  return base;
}

// Parse @pane_subagents pipe-sep "Type:id|Type:id" list into entries.
// Empty list → empty array. Malformed segments (no ':') treated as type only.
export interface SubagentEntry {
  type: string;
  id: string;
}
export function parseSubagents(raw: string): SubagentEntry[] {
  if (!raw) return [];
  return raw.split("|").filter(Boolean).map((seg) => {
    const colonIdx = seg.indexOf(":");
    if (colonIdx === -1) return { type: seg, id: "" };
    return { type: seg.slice(0, colonIdx), id: seg.slice(colonIdx + 1) };
  });
}

// Render subagent list grouped by type with ×N count (e.g. "Explore ×2, Plan").
// Single occurrences render bare type name; identical types aggregate into ×N.
// Empty input returns "·" placeholder. In-segment separator is ", " to
// distinguish from the outer Row2 separator " · ".
export function renderSubagentTree(entries: SubagentEntry[]): string {
  if (entries.length === 0) return "·";
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const e of entries) {
    if (!counts.has(e.type)) order.push(e.type);
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  return order
    .map((t) => (counts.get(t)! > 1 ? `${t} ×${counts.get(t)}` : t))
    .join(", ");
}
