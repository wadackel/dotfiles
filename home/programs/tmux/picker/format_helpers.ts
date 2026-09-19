// Pure formatters used by the picker UI: status accessors, elapsed-time
// formatter, path/branch utilities, summary/tool-segment text, and subagent
// list parsing/rendering. Extracted from picker.tsx so each helper can be
// unit-tested without npm:react / npm:ink at parse time.

import { type PaneRow, type PaneStatus, STATUS_META } from "./pane_row.ts";
import { stringCells, truncateToCells } from "./cell_width.ts";

// Elapsed seconds → "Ns" / "Nm" / "Nh" / "Nd" / "·" (middle dot placeholder).
// Capped at 99d so the result never outgrows the row's 3-cell elapsed column.
export function formatElapsed(
  startedAtSec: number | null,
  nowSec: number,
): string {
  if (startedAtSec === null) return "·";
  const d = nowSec - startedAtSec;
  if (d < 0) return "·";
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.min(99, Math.floor(d / 86400))}d`;
}

// Timestamp the row's elapsed column counts from: a running pane is timed from
// its prompt (how long this turn has been working), every other state from the
// last activity (how long it has been waiting on the user, or left alone).
export function elapsedSource(row: PaneRow): number | null {
  return row.status === "running" ? row.startedAtSec : row.lastActivityAtSec;
}

// formatElapsed is not reused here: its 1h granularity collapses the whole
// last hour before a reset into "1h", and that hour is exactly when the
// remaining time changes what the reader does next.
// Callers screen out elapsed windows first (UsageFooter renders those as "--"),
// so no past-timestamp branch lives here — a second source for that literal
// would be one more place to keep in sync.
export function formatRemaining(
  resetsAtSec: number,
  nowSec: number,
): string {
  const d = resetsAtSec - nowSec;
  if (d < 60) return "<1m";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) {
    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    return m === 0 ? `${h}h` : `${h}h${m}m`;
  }
  return `${Math.floor(d / 86400)}d`;
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

export interface GitLocation {
  repo: string;
  worktree: string;
}

// Parse `git rev-parse --path-format=absolute --show-toplevel --git-dir
// --git-common-dir`. The repo is named after the common dir because the
// toplevel of a linked worktree is the worktree's own directory. A common dir
// whose name starts with "." (`.git`, `.bare`) sits inside the project
// directory, so the parent carries the name; otherwise it is the repository
// directory itself (`repo.git`, a submodule's `modules/<name>`).
export function parseGitLocation(stdout: string): GitLocation | null {
  const [top, gitDir, commonDir] = stdout.trim().split("\n");
  if (!top || !gitDir || !commonDir) return null;
  const common = basename(commonDir);
  const repo = common.startsWith(".")
    ? basename(commonDir.replace(/\/+$/, "").replace(/\/[^/]*$/, ""))
    : common.replace(/\.git$/, "");
  return { repo, worktree: gitDir === commonDir ? "" : basename(top) };
}

// Location columns for the row renderer. `repoName` is absent until
// fetchPanes' git lookup lands (and in unit fixtures), so the cwd basename
// stands in. When everything is empty, repo carries the "·" placeholder so the
// row is never blank.
export function locationParts(
  row: PaneRow,
): { repo: string; worktree: string; branch: string } {
  const repo = row.repoName || basename(row.cwd || row.currentPath);
  const worktree = row.worktreeName ?? "";
  const branch = row.worktreeBranch;
  if (!repo && !branch) return { repo: "·", worktree: "", branch: "" };
  return { repo, worktree, branch };
}

// Repo column text within `maxCells`: the `(worktree)` suffix survives and
// the repo name gives way first, because the worktree is what tells two rows
// of the same repository apart. Only a suffix that cannot fit on its own is
// cut together with the name.
export function repoLabel(
  repo: string,
  worktree: string,
  maxCells: number,
): { head: string; suffix: string } {
  const suffix = worktree ? `(${worktree})` : "";
  if (stringCells(repo + suffix) <= maxCells) return { head: repo, suffix };
  const room = maxCells - stringCells(suffix);
  if (suffix && room >= 1) {
    return { head: truncateToCells(repo, room), suffix };
  }
  return { head: truncateToCells(repo + suffix, maxCells), suffix: "" };
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

// Same glyph as STATUS_META.error.icon, deliberately not shared: that one marks
// a pane's status in row 1, this one separates a tool name from its error text
// in row 2, and either could change without the other. (U+2716 ✖ is absent from
// CaskaydiaCove Nerd Font Mono, so the CJK fallback drew it double-width.)
const ERROR_MARK = "\u{F0156}"; // nf-md-close

// Row-2 tool segment text: "<tool>[(<subject>)][ <ERROR_MARK> <error>]". Same
// text for current and last tools — the caller distinguishes them by color
// (DOGRUN.sandy for current, DOGRUN.fgDim for last). Returns "" when no tool
// has run.
export function toolSegmentText(row: PaneRow): string {
  const tool = row.currentTool || row.lastTool;
  if (!tool) return "";
  const subject = row.currentTool
    ? row.currentToolSubject
    : row.lastToolSubject;
  const base = subject ? `${tool}(${subject})` : tool;
  if (!row.currentTool && row.lastToolError) {
    return `${base} ${ERROR_MARK} ${row.lastToolError}`;
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
