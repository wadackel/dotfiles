#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --no-prompt

// tmux Claude Code session picker (prefix+w).
// ink + React on Deno. SSOT: @pane_* tmux pane options written by claude-pane-status.ts.

/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import React, { useEffect, useRef, useState } from "npm:react@19.2.0";
import { Box, render, Text, useApp, useInput, useStdout } from "npm:ink@7.1.1";

// ---- Types + row parsing SSOT ----

// PaneRow / PaneStatus / STATUS_META / TMUX_FORMAT / parseRow live in
// pane_row.ts so non-TUI tooling (picker-doctor.ts, tests) can reuse them
// without dragging in React + Ink at import time.
import {
  type Agent,
  isLivePaneCommand,
  nextUserLabel,
  type PaneRow,
  type PaneStatus,
  parseRow,
  STATUS_META,
  TMUX_FORMAT,
  USER_LABEL_CYCLE,
  USER_LABEL_META,
  type UserLabel,
} from "./pane_row.ts";
export {
  type Agent,
  isLivePaneCommand,
  nextUserLabel,
  type PaneRow,
  type PaneStatus,
  parseRow,
  STATUS_META,
  TMUX_FORMAT,
  USER_LABEL_CYCLE,
  USER_LABEL_META,
  type UserLabel,
};

// Row-1 repo/branch column width caps for the dynamic layout. App computes
// per-render repoMax / branchMax by scanning visible rows and clamps to these
// upper bounds so a single long branch cannot starve the summary slot.
const REPO_CAP = 24;
const BRANCH_CAP = 28;
// Minimum visible summary width the layout must preserve after repo + branch.
const MIN_SUMMARY = 15;

// Dashboard-style auto-refresh cadence. Both the list fetch (fetchPanes) and
// the preview capture (capturePane) re-run at this interval so the popup
// reflects pane status / prompt / subagents / elapsed time / preview without
// manual interaction.
const TICK_INTERVAL_MS = 1000;

// ---- Pure helpers (extracted to sibling modules for unit testability) ----

import { sanitizeAnsi, truncateAnsiLine } from "./ansi.ts";
import { stringCells, truncateToCells } from "./cell_width.ts";
import {
  basename,
  type GitLocation,
  locationParts,
  parseGitLocation,
} from "./format_helpers.ts";

import {
  Card,
  CARD_CHROME_COLS,
  DOGRUN,
  HintBar,
  PaneRowLine,
  ROW1_FIXED_OVERHEAD,
  type TaskProgress,
  UsageCard,
  usageCardRows,
  usageLayout,
  usageRowWidth,
} from "./components.tsx";
import { type AgentUsage, readAgentUsage } from "../shared/agent-usage.ts";

// ---- Usage footer layout gates ----

// The preview card keeps at least this many rows under the Usage card; below
// that the capture is too short to show a permission prompt, which is what the
// preview is mostly opened for.
const MIN_PREVIEW_CARD_ROWS = 8;

// The Usage card sits under the preview, so it needs a preview column wide
// enough for a bar-less row (42 cells for the 5h / 7d labels) and tall enough
// to leave the preview its minimum. Anything narrower would clip the columns
// the rows are laid out on.
export function showUsageCard(
  usages: AgentUsage[],
  previewWidth: number,
  columnHeight: number,
): boolean {
  const inner = previewWidth - CARD_CHROME_COLS;
  const layout = usageLayout(usages, inner);
  return layout !== null && usageRowWidth(layout) <= inner &&
    columnHeight >= usageCardRows(usages.length) + MIN_PREVIEW_CARD_ROWS;
}

// Blank rows above the list and the preview column: one keeps the first card
// off the popup border, and a short popup spends it on panes instead.
export function topRowsFor(totalRows: number): number {
  return isCompact(totalRows) ? 0 : 1;
}

// The list also gives up 2 rows to the key-hint bar and its marginTop.
export function bodyHeightFor(totalRows: number): number {
  return Math.max(5, totalRows - topRowsFor(totalRows) - 2);
}

// Gutter between the list and the preview, spent as the preview's marginLeft.
const PREVIEW_GUTTER = 2;
const MIN_LIST = 40;
// clampPreview floors its inner width at Math.max(10, width - 4), so a preview
// box narrower than this renders content wider than the box it sits in.
const MIN_PREVIEW = 14;

// Clamping listWidth and previewWidth against independent floors lets their sum
// exceed totalCols on a narrow terminal (40 + 1 + 20 = 61 at cols 60), and Ink
// wraps the overflow instead of clipping it. Cutting both out of one budget is
// what keeps the row inside the frame; the preview is dropped outright once the
// remainder is too thin to render honestly.
export function splitLayout(totalCols: number): {
  listWidth: number;
  previewWidth: number;
} {
  const listWidth = Math.min(
    Math.max(0, totalCols),
    Math.max(MIN_LIST, Math.floor(totalCols * 0.6)),
  );
  const rest = totalCols - listWidth - PREVIEW_GUTTER;
  return { listWidth, previewWidth: rest >= MIN_PREVIEW ? rest : 0 };
}

// Row-1 repo / branch column widths for a given list width. Both columns are
// padEnd'd to these widths by PaneRowLine, so their sum plus
// ROW1_FIXED_OVERHEAD is what row-1 actually occupies — overshoot it and Ink
// wraps the row, pushing the following panes off-screen.
//
// Two budgets, because the 4-cell floors have to survive one of them and not
// the other: `soft` keeps MIN_SUMMARY visible and is the target, while `hard`
// is the width that physically exists. A list narrow enough to make `soft`
// unaffordable used to leave the floors in place and overflow the box.
export function row1Columns(
  listWidth: number,
  repoWant: number,
  branchWant: number,
): { repoMax: number; branchMax: number } {
  const hard = Math.max(0, listWidth - ROW1_FIXED_OVERHEAD);
  const soft = Math.max(0, hard - MIN_SUMMARY);
  let repoMax = Math.min(REPO_CAP, Math.max(4, repoWant));
  let branchMax = Math.min(BRANCH_CAP, Math.max(4, branchWant));
  if (repoMax + branchMax > soft) {
    branchMax = Math.max(4, soft - repoMax);
  }
  if (repoMax + branchMax > hard) {
    branchMax = Math.max(0, hard - repoMax);
    repoMax = Math.min(repoMax, hard);
  }
  return { repoMax, branchMax };
}

// Both agents are read on every tick rather than cached: the files are a few
// hundred bytes and are rewritten by other processes, so there is no local
// signal that would tell the picker its copy went stale.
export async function readAllAgentUsage(): Promise<AgentUsage[]> {
  const home = Deno.env.get("HOME");
  if (!home) return [];
  const both = await Promise.all([
    readAgentUsage(home, "claude"),
    readAgentUsage(home, "codex"),
  ]);
  // Windowless entries are dropped here rather than at render time so the
  // visibility gate and UsageCard agree on what counts as a segment — a file
  // with an empty windows array would otherwise cost two body rows and draw
  // nothing into them.
  return both.filter((u): u is AgentUsage =>
    u !== null && u.windows.length > 0
  );
}

export interface ListWindow {
  offset: number;
  count: number;
  above: number;
  below: number;
  scrolling: boolean;
}

export interface CardShape {
  rows: number;
  gap: number;
}

// A four-row card: the two content rows between blank padding rows.
export const FULL_CARD: CardShape = { rows: 4, gap: 0 };
// A short popup drops the padding and keeps one blank row between panes.
export const COMPACT_CARD: CardShape = { rows: 2, gap: 1 };

// Below this many rows the popup switches to COMPACT_CARD and starts the list
// on the top row, trading the padding for panes.
const COMPACT_BELOW_ROWS = 30;

export function isCompact(totalRows: number): boolean {
  return totalRows < COMPACT_BELOW_ROWS;
}

// Which panes fit in `height` rows given the card shape.
// On overflow the `↑ N more` / `↓ N more` lines are reserved even at count 0,
// so the window does not resize as the selection moves. Letting Yoga shrink
// an overflowing list instead collapses rows unevenly and overlaps each pane's
// rows.
export function visibleWindow(
  total: number,
  selected: number,
  height: number,
  prevOffset: number,
  card: CardShape = FULL_CARD,
): ListWindow {
  if (total * card.rows + Math.max(0, total - 1) * card.gap <= height) {
    return { offset: 0, count: total, above: 0, below: 0, scrolling: false };
  }
  const count = Math.max(
    1,
    Math.floor((height - 2 + card.gap) / (card.rows + card.gap)),
  );
  let offset = Math.min(Math.max(0, prevOffset), total - count);
  if (selected < offset) offset = selected;
  else if (selected >= offset + count) offset = selected - count + 1;
  return {
    offset,
    count,
    above: offset,
    below: total - offset - count,
    scrolling: true,
  };
}

export interface ListGeometry {
  listWidth: number;
  previewWidth: number;
  topRows: number;
  bodyHeight: number;
  card: CardShape;
  view: ListWindow;
}

// Shared by the render and the mouse handler so a click is hit-tested against
// the same rows the frame was drawn with.
export function listGeometry(opts: {
  columns: number;
  rows: number;
  total: number;
  selected: number;
  prevOffset: number;
}): ListGeometry {
  const { listWidth, previewWidth } = splitLayout(opts.columns);
  const topRows = topRowsFor(opts.rows);
  const bodyHeight = bodyHeightFor(opts.rows);
  const card = isCompact(opts.rows) ? COMPACT_CARD : FULL_CARD;
  const view = visibleWindow(
    opts.total,
    opts.selected,
    bodyHeight,
    opts.prevOffset,
    card,
  );
  return { listWidth, previewWidth, topRows, bodyHeight, card, view };
}

export const MOUSE_LEFT = 0;
export const MOUSE_RIGHT = 2;
export const MOUSE_WHEEL_UP = 64;
export const MOUSE_WHEEL_DOWN = 65;

export interface MouseReport {
  button: number;
  x: number;
  y: number;
  press: boolean;
}

// An SGR (1006) report as useInput hands it over: Ink strips the leading ESC.
// Coordinates on the wire are 1-based.
const SGR_MOUSE_RE = /^\[<(\d+);(\d+);(\d+)([Mm])$/;

export function parseMouse(input: string): MouseReport | null {
  const m = SGR_MOUSE_RE.exec(input);
  if (!m) return null;
  return {
    button: Number(m[1]),
    x: Number(m[2]) - 1,
    y: Number(m[3]) - 1,
    press: m[4] === "M",
  };
}

// Index into derivedRows of the card under (x, y), or null for the preview,
// the scroll indicators, compact gaps, and the hint bar.
export function cardIndexAt(
  geometry: ListGeometry,
  point: { x: number; y: number },
): number | null {
  const { listWidth, topRows, card, view } = geometry;
  if (point.x < 0 || point.x >= listWidth) return null;
  const r = point.y - topRows - (view.scrolling ? 1 : 0);
  if (r < 0) return null;
  const stride = card.rows + card.gap;
  const i = Math.floor(r / stride);
  if (i >= view.count || r % stride >= card.rows) return null;
  return view.offset + i;
}

// Index `n` moves to: the first waiting row after `from`, wrapping past the
// end. `from` itself when no row is waiting, so the key is a no-op then.
export function nextWaitingIndex(rows: PaneRow[], from: number): number {
  for (let d = 1; d <= rows.length; d++) {
    const i = (from + d) % rows.length;
    if (rows[i].status === "waiting") return i;
  }
  return from;
}

// ---- tmux I/O (impure) ----

async function tmuxRun(
  args: string[],
): Promise<{ stdout: string; code: number }> {
  const proc = new Deno.Command("tmux", {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await proc.output();
  if (code !== 0) {
    const errText = new TextDecoder().decode(stderr).trim();
    if (errText) console.error(`tmux ${args[0]} failed: ${errText}`);
  }
  return { stdout: new TextDecoder().decode(stdout), code };
}

// Resolve the current git branch for cwd. Returns "" when cwd is not a git
// repo or git fails — callers fall back to the "·" placeholder.
async function gitBranch(cwd: string): Promise<string> {
  if (!cwd) return "";
  try {
    const { code, stdout } = await new Deno.Command("git", {
      args: ["symbolic-ref", "--short", "HEAD"],
      cwd,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
    }).output();
    if (code !== 0) return "";
    return new TextDecoder().decode(stdout).trim();
  } catch {
    return "";
  }
}

// A directory's toplevel and common dir cannot change while the popup is open,
// so each is resolved once; the branch is not cached because a checkout inside
// the pane moves it.
const gitLocationCache = new Map<string, GitLocation>();

// Falls back to the directory's basename when git has nothing to say (not a
// repository, a bare repository, or a cwd that no longer exists), so the
// column still names the directory.
async function gitLocation(dir: string): Promise<GitLocation> {
  const cached = gitLocationCache.get(dir);
  if (cached) return cached;
  let location: GitLocation | null = null;
  try {
    const { code, stdout } = await new Deno.Command("git", {
      args: [
        "rev-parse",
        "--path-format=absolute",
        "--show-toplevel",
        "--git-dir",
        "--git-common-dir",
      ],
      cwd: dir,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
    }).output();
    if (code === 0) {
      location = parseGitLocation(new TextDecoder().decode(stdout));
    }
  } catch {
    // Deno.Command throws when cwd does not exist.
  }
  const resolved = location ?? { repo: basename(dir), worktree: "" };
  gitLocationCache.set(dir, resolved);
  return resolved;
}

// Allowed shape for a session id when used as a filesystem path segment.
// Imported from pane-shared.ts so the writer (selfHealOps) and reader
// (picker) share one regex — defense-in-depth against `sessionId =
// "../something"` directory traversal at every consumer.
import { SESSION_ID_RE } from "../shared/pane-shared.ts";

// Read `~/.claude/tasks/<sessionId>/*.json` and aggregate completed/total counts.
// Returns null when the dir is missing, empty, or every file fails to parse —
// in which case the picker simply omits the task-progress segment. No cache:
// dir-mtime cache is unsafe because an in-place status flip on an existing
// task file does not bump dir mtime. Empirical task counts are ≤ ~13 per
// session so the 1s tick budget is unaffected.
export async function readTaskProgress(
  sessionId: string,
): Promise<TaskProgress | null> {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  const home = Deno.env.get("HOME");
  if (!home) return null;
  const dir = `${home}/.claude/tasks/${sessionId}`;
  let done = 0;
  let total = 0;
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !e.name.endsWith(".json")) continue;
      try {
        const raw: unknown = JSON.parse(
          await Deno.readTextFile(`${dir}/${e.name}`),
        );
        if (
          raw !== null && typeof raw === "object" && "status" in raw &&
          typeof (raw as { status: unknown }).status === "string"
        ) {
          total++;
          if ((raw as { status: string }).status === "completed") done++;
        }
      } catch {
        // skip malformed — tolerates concurrent /impl writes
      }
    }
  } catch {
    return null; // dir missing
  }
  return total === 0 ? null : { done, total };
}

const CODEX_MARKER_TTL_MS = 24 * 60 * 60 * 1000;
const CODEX_TASK_STATUSES = new Set([
  "pending",
  "in_progress",
  "completed",
]);

// Mirrors codex-plan-marker.ts:canonical so picker hashes the same cwd string
// as the marker writer even when the leaf path has disappeared.
async function canonical(p: string): Promise<string> {
  try {
    return await Deno.realPath(p);
  } catch {
    // fall through
  }
  const tail: string[] = [];
  let cur = p;
  while (cur.length > 1) {
    const idx = cur.lastIndexOf("/");
    if (idx < 0) break;
    tail.unshift(cur.slice(idx + 1));
    cur = idx === 0 ? "/" : cur.slice(0, idx);
    try {
      const real = await Deno.realPath(cur);
      return real === "/" ? "/" + tail.join("/") : real + "/" + tail.join("/");
    } catch {
      // keep walking up
    }
  }
  return p;
}

export async function codexCwdHash(cwd: string): Promise<string | null> {
  if (!cwd) return null;
  try {
    const real = await canonical(cwd);
    const data = new TextEncoder().encode(real);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  } catch {
    return null;
  }
}

async function readFreshMarker(path: string): Promise<string | null> {
  try {
    const stat = await Deno.lstat(path);
    if (!stat.isFile || stat.isSymlink) return null;
    const mtime = stat.mtime?.getTime() ?? 0;
    if (Date.now() - mtime >= CODEX_MARKER_TTL_MS) return null;
    return (await Deno.readTextFile(path)).trim();
  } catch {
    return null;
  }
}

async function activeMarkerPresence(
  path: string,
): Promise<"present" | "absent" | "blocked"> {
  try {
    await Deno.lstat(path);
    return "present";
  } catch (err) {
    return err instanceof Deno.errors.NotFound ? "absent" : "blocked";
  }
}

async function evidencePathFromMarker(
  plansDir: string,
  marker: string,
): Promise<string | null> {
  if (!marker.startsWith("/") || !marker.endsWith(".md")) return null;
  const basename = marker.slice(marker.lastIndexOf("/") + 1);
  if (!basename || basename.startsWith(".")) return null;
  let plansDirReal = "";
  let planReal = "";
  try {
    plansDirReal = await Deno.realPath(plansDir);
    planReal = await Deno.realPath(marker);
  } catch {
    return null;
  }
  if (planReal !== plansDirReal + "/" + basename) return null;

  const evidence = `${plansDirReal}/${basename.slice(0, -3)}.evidence.json`;
  try {
    const info = await Deno.lstat(evidence);
    if (!info.isFile || info.isSymlink) return null;
  } catch {
    return null;
  }
  return evidence;
}

async function readCodexTaskProgress(
  cwd: string,
): Promise<TaskProgress | null> {
  const home = Deno.env.get("HOME");
  if (!home) return null;
  const hash = await codexCwdHash(cwd);
  if (!hash) return null;

  const plansDir = `${home}/.codex/plans`;
  const activePath = `${plansDir}/.active-${hash}`;
  const pendingPath = `${plansDir}/.pending-${hash}`;
  const active = await activeMarkerPresence(activePath);
  if (active === "blocked") return null;
  const marker = active === "present"
    ? await readFreshMarker(activePath)
    : await readFreshMarker(pendingPath);
  if (!marker) return null;

  const evidence = await evidencePathFromMarker(plansDir, marker);
  if (!evidence) return null;

  try {
    const raw: unknown = JSON.parse(await Deno.readTextFile(evidence));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const tasks = (raw as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasks)) return null;
    let done = 0;
    let total = 0;
    for (const task of tasks) {
      if (!task || typeof task !== "object" || Array.isArray(task)) {
        return null;
      }
      const status = (task as { status?: unknown }).status ?? "pending";
      if (typeof status !== "string" || !CODEX_TASK_STATUSES.has(status)) {
        return null;
      }
      total++;
      if (status === "completed") done++;
    }
    return total === 0 ? null : { done, total };
  } catch {
    return null;
  }
}

export async function readTaskProgressForRow(
  row: PaneRow,
): Promise<TaskProgress | null> {
  if (row.agent === "codex") {
    return await readCodexTaskProgress(row.cwd || row.currentPath);
  }
  if (row.agent === "claude") {
    return await readTaskProgress(row.sessionId);
  }
  return null;
}

// Per-agent live-pane allowlist + isLivePaneCommand live in pane_row.ts so
// non-TUI tooling (picker-doctor, tests) can share the SSOT without React/Ink.
// The matcher is intentionally exact-match against tmux's `pane_current_command`
// (kernel p_comm basename, ≤15 bytes on macOS) — distinct from
// picker-doctor.ts:detectAgentCommand which scans full `ps -o command` substrings.

async function fetchPanes(): Promise<PaneRow[]> {
  const { stdout } = await tmuxRun(["list-panes", "-a", "-F", TMUX_FORMAT]);
  const rows: PaneRow[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const row = parseRow(line);
    if (
      row &&
      (row.agent === "claude" || row.agent === "opencode" ||
        row.agent === "codex") &&
      isLivePaneCommand(row.agent, row.currentCommand)
    ) {
      rows.push(row);
    }
  }
  // Resolve the repository location and fill in a missing worktreeBranch from
  // the pane's cwd (falling back to pane_current_path when @pane_cwd is unset,
  // e.g. when the latest hook event for a Claude pane carried no cwd payload)
  // in parallel.
  await Promise.all(
    rows.map(async (row) => {
      const source = row.cwd || row.currentPath;
      if (!source) return;
      const [location, branch] = await Promise.all([
        gitLocation(source),
        row.worktreeBranch || gitBranch(source),
      ]);
      row.repoName = location.repo;
      row.worktreeName = location.worktree;
      row.worktreeBranch = branch;
    }),
  );
  return rows;
}

async function capturePane(target: string): Promise<string> {
  const { stdout } = await tmuxRun(["capture-pane", "-p", "-e", "-t", target]);
  return sanitizeAnsi(stdout);
}

// Parse a tmux target `session:window.pane` into its components.
// Correctly handles session names containing `.` by splitting on the FIRST
// `:` for session and the LAST `.` for the window/pane boundary. Mirrors the
// bash picker's `${target%%:*}` + `${win_pane%%.*}` semantics.
export function parseTarget(target: string): {
  session: string;
  window: string;
} {
  const colonIdx = target.indexOf(":");
  const lastDotIdx = target.lastIndexOf(".");
  if (colonIdx === -1 || lastDotIdx <= colonIdx) {
    return { session: target, window: target };
  }
  return {
    session: target.substring(0, colonIdx),
    window: target.substring(0, lastDotIdx),
  };
}

// A popup takes every key before tmux's prefix table sees it, so the
// `prefix w` that opened the picker has to be recognised here to close it.
// Only the Ctrl+letter form is supported; anything else disables the chord.
// C-h/i/j/m are excluded because Ink reports them as backspace/tab/enter/return
// without the ctrl flag.
export function parsePrefixKey(raw: string): string | null {
  return /^C-([a-gk-ln-z])$/.exec(raw.trim())?.[1] ?? null;
}

async function readPrefixKey(): Promise<string | null> {
  const { stdout } = await tmuxRun(["show-options", "-gv", "prefix"]);
  return parsePrefixKey(stdout);
}

async function jumpTo(target: string): Promise<void> {
  const { session, window } = parseTarget(target);
  await tmuxRun(["switch-client", "-t", session]);
  await tmuxRun(["select-window", "-t", window]);
  await tmuxRun(["select-pane", "-t", target]);
}

// Keep preview bounded so it never pushes the list column to zero width and
// never exceeds the popup height. Truncate each line to the column width and
// keep only the last `maxLines` lines.
function clampPreview(text: string, maxCols: number, maxLines: number): string {
  const lines = text.split("\n");
  const tail = lines.slice(Math.max(0, lines.length - maxLines));
  return tail.map((line) => truncateAnsiLine(line, maxCols)).join("\n");
}

// Shown under the card title so the selected pane's full location is readable
// even where the list column truncates it.
function displayPath(path: string): string {
  const home = Deno.env.get("HOME");
  return home && (path === home || path.startsWith(home + "/"))
    ? "~" + path.slice(home.length)
    : path;
}

function Preview(
  { row, width, height }: { row: PaneRow; width: number; height: number },
) {
  const target = row.target;
  const [content, setContent] = useState<string | null>(null);
  useEffect(() => {
    // Reset content the moment target changes — without this, a stale capture
    // of the previous target keeps rendering under the new card title until
    // the new capturePane resolves (~0–1 s).
    setContent(null);
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    // The card spends CARD_CHROME_COLS on border and padding, and three rows on
    // its top edge, bottom border, and the path line.
    const innerCols = Math.max(10, width - CARD_CHROME_COLS);
    const innerRows = Math.max(3, height - 3);
    // Self-rescheduling setTimeout (not setInterval) guarantees at most one
    // in-flight capturePane per target and prevents out-of-order completions
    // from overwriting fresher content.
    const tick = async () => {
      try {
        const text = await capturePane(target);
        if (!cancelled) setContent(clampPreview(text, innerCols, innerRows));
      } catch (e) {
        if (!cancelled) setContent(`(preview failed: ${String(e)})`);
      } finally {
        if (!cancelled) timerId = setTimeout(tick, TICK_INTERVAL_MS);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timerId !== undefined) clearTimeout(timerId);
    };
  }, [target, width, height]);
  const { repo, worktree, branch } = locationParts(row);
  const title = [
    { text: repo, color: DOGRUN.fg },
    ...(worktree ? [{ text: `(${worktree})`, color: DOGRUN.fgDim }] : []),
    ...(branch
      ? [
        { text: " · ", color: DOGRUN.muted },
        { text: branch, color: DOGRUN.accent },
      ]
      : []),
  ];
  const path = displayPath(row.cwd || row.currentPath);
  return (
    <Card title={title} width={width} height={height}>
      <Text color={DOGRUN.fgDim}>
        {truncateToCells(path, Math.max(0, width - CARD_CHROME_COLS))}
      </Text>
      <Text>{content ?? "(loading...)"}</Text>
    </Card>
  );
}

function App({
  initialRows,
  initialSelectedPaneId,
  initialUsages,
  prefixKey,
  onSelect,
}: {
  initialRows: PaneRow[];
  initialSelectedPaneId: string;
  initialUsages: AgentUsage[];
  prefixKey: string | null;
  onSelect: (row: PaneRow | null) => void;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  // useStdout() does not re-render on resize; subscribe to stdout's 'resize'
  // event so that totalCols/totalRows (and everything derived: listWidth,
  // previewWidth, bodyHeight, hint bar width) follow tmux popup / window resizes.
  const [size, setSize] = useState({
    columns: stdout?.columns ?? 120,
    rows: stdout?.rows ?? 30,
  });
  useEffect(() => {
    if (!stdout) return;
    const handler = () => {
      setSize({ columns: stdout.columns, rows: stdout.rows });
    };
    stdout.on("resize", handler);
    return () => {
      stdout.off("resize", handler);
    };
  }, [stdout]);
  // Written to the stream directly: useStdout().write erases and redraws the
  // whole frame around its payload, undoing incrementalRendering for bytes
  // that draw nothing. tmux forwards popup mouse events only while this is on.
  useEffect(() => {
    if (!stdout) return;
    stdout.write("\x1b[?1000h\x1b[?1006h");
    return () => {
      stdout.write("\x1b[?1006l\x1b[?1000l");
    };
  }, [stdout]);
  const [rows, setRows] = useState(initialRows);
  // Pending `m`/`M` writes the tmux SSOT has not yet acknowledged. The fetch
  // tick (≤ TICK_INTERVAL_MS) can race ahead of an in-flight tmuxRun and read
  // the stale label, reverting an optimistic update on screen. Keying by
  // paneId lets the merge below keep showing the user's intended value until
  // SSOT catches up. useRef (not useState) because mutations are always
  // paired with a setRows call that drives the re-render.
  const pendingLabelWrites = useRef<Map<string, UserLabel>>(new Map());
  // First visible pane of a scrolled list. Kept across renders so moving the
  // selection inside the window does not shift it.
  const listOffset = useRef(0);
  const prefixPending = useRef(false);
  const prefixByte = prefixKey === null
    ? null
    : String.fromCharCode(prefixKey.charCodeAt(0) & 0x1f);
  const [taskProgressMap, setTaskProgressMap] = useState<
    Map<string, TaskProgress | null>
  >(new Map());
  const [usages, setUsages] = useState(initialUsages);
  const [selectedPaneId, setSelectedPaneId] = useState(initialSelectedPaneId);
  const [filterEnabled, setFilterEnabled] = useState(false);
  // `now` re-reads Date.now() on every render; the periodic setRows below
  // triggers a re-render every TICK_INTERVAL_MS, so elapsed time advances
  // naturally without a dedicated tick state.
  const now = Math.floor(Date.now() / 1000);

  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    // Self-rescheduling setTimeout chain: at most one fetchPanes in-flight,
    // no out-of-order overwrite, and errors do not break the loop.
    const tick = async () => {
      try {
        const r = await fetchPanes();
        if (cancelled) return;
        // Merge in any pending m/M writes whose tmux SSOT hasn't caught up.
        // When SSOT matches the pending label, clear the guard so future ticks
        // accept canonical values again (self-healing on external writes).
        const pending = pendingLabelWrites.current;
        const merged = pending.size === 0 ? r : r.map((row) => {
          const want = pending.get(row.paneId);
          if (want === undefined) return row;
          if (row.userLabel === want) {
            pending.delete(row.paneId);
            return row;
          }
          return { ...row, userLabel: want };
        });
        setRows(merged);
        // Fetch task progress for every supported pane in parallel. Failures are
        // isolated (readTaskProgress swallows them) so one bad session dir does
        // not block the whole tick.
        const entries = await Promise.all(
          r.map(async (row) =>
            [row.paneId, await readTaskProgressForRow(row)] as const
          ),
        );
        if (!cancelled) setTaskProgressMap(new Map(entries));
        // Sits after setRows so a throw from the usage files cannot take the
        // pane list down with it — this tick body is one try block.
        const nextUsages = await readAllAgentUsage();
        if (!cancelled) setUsages(nextUsages);
      } catch (e) {
        console.error("picker: fetchPanes tick failed:", e);
      } finally {
        if (!cancelled) timerId = setTimeout(tick, TICK_INTERVAL_MS);
      }
    };
    timerId = setTimeout(tick, TICK_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timerId !== undefined) clearTimeout(timerId);
    };
  }, []);

  // Filter-on-demand: pressing `w` toggles filterEnabled. derivedRows is the
  // source of truth for everything visible (selection, navigation, layout).
  // Inline filter — N is small (≤20 panes typical), useMemo would add no value.
  const derivedRows = filterEnabled
    ? rows.filter((r: PaneRow) => r.status === "waiting" || r.status === "idle")
    : rows;
  const foundIdx = derivedRows.findIndex((r: PaneRow) =>
    r.paneId === selectedPaneId
  );
  const index = foundIdx >= 0 ? foundIdx : 0;

  const writeUserLabel = (
    paneId: string,
    label: UserLabel,
    sessionId: string,
  ) => {
    // Optimistic local update + pending guard. The tick's merge keeps showing
    // `label` until tmux SSOT acknowledges it, so a fetchPanes that races
    // ahead of the in-flight tmuxRun cannot revert the visible value. The
    // .catch below only fires on a spawn-level failure (tmuxRun resolves on a
    // non-zero tmux exit, logging stderr); in that case the guard is dropped
    // so the next tick self-heals to the canonical (unchanged) tmux value.
    //
    // @pane_user_label_session records the session the label is bound to.
    // parseRow gates display on it matching the pane's current session, so a
    // new agent session (fresh @pane_session_id) drops the stale label
    // automatically. Both keys are written together; on label="" the session
    // value is irrelevant but writing it keeps the path uniform.
    pendingLabelWrites.current.set(paneId, label);
    setRows((prev: PaneRow[]) =>
      prev.map((r: PaneRow) =>
        r.paneId === paneId ? { ...r, userLabel: label } : r
      )
    );
    Promise.all([
      tmuxRun(["set-option", "-p", "-t", paneId, "@pane_user_label", label]),
      tmuxRun([
        "set-option",
        "-p",
        "-t",
        paneId,
        "@pane_user_label_session",
        sessionId,
      ]),
    ]).catch((e) => {
      console.error("picker: writeUserLabel tmux write failed:", e);
      // Only drop our own guard — a later press may have superseded `label`,
      // in which case the newer pending write should remain in effect.
      if (pendingLabelWrites.current.get(paneId) === label) {
        pendingLabelWrites.current.delete(paneId);
      }
    });
  };

  const handleMouse = (mouse: MouseReport) => {
    if (derivedRows.length === 0) return;
    const geometry = listGeometry({
      columns: size.columns,
      rows: size.rows,
      total: derivedRows.length,
      selected: index,
      prevOffset: listOffset.current,
    });
    if (
      mouse.button === MOUSE_WHEEL_UP || mouse.button === MOUSE_WHEEL_DOWN
    ) {
      if (mouse.x >= geometry.listWidth) return;
      // Clamped rather than wrapped like j/k: one trackpad fling delivers a
      // burst of wheel events, and wrapping would spin the selection around.
      const step = mouse.button === MOUSE_WHEEL_UP ? -1 : 1;
      const nextIdx = Math.min(
        derivedRows.length - 1,
        Math.max(0, index + step),
      );
      setSelectedPaneId(derivedRows[nextIdx].paneId);
      return;
    }
    const hit = cardIndexAt(geometry, mouse);
    if (hit === null) return;
    const target = derivedRows[hit];
    if (mouse.button === MOUSE_LEFT) {
      if (hit === index) {
        onSelect(target);
        exit();
      } else {
        setSelectedPaneId(target.paneId);
      }
    } else if (mouse.button === MOUSE_RIGHT) {
      setSelectedPaneId(target.paneId);
      writeUserLabel(
        target.paneId,
        nextUserLabel(target.userLabel),
        target.sessionId,
      );
    }
  };

  useInput((chunk, key) => {
    const mouse = parseMouse(chunk);
    if (mouse) {
      if (mouse.press) handleMouse(mouse);
      return;
    }
    let input = chunk;
    // Keys that reach stdin in one read arrive as a single unsplit chunk
    // (`\x13w`), so the prefix byte is peeled off here rather than relying on
    // Ink to report it as its own Ctrl keypress.
    if (prefixByte !== null && chunk.length > 1 && chunk[0] === prefixByte) {
      prefixPending.current = true;
      input = chunk.slice(1);
    }
    if (prefixPending.current) {
      prefixPending.current = false;
      if (input === "w") {
        onSelect(null);
        exit();
        return;
      }
    } else if (key.ctrl && input === prefixKey) {
      prefixPending.current = true;
      return;
    }
    if (key.escape || input === "q") {
      onSelect(null);
      exit();
      return;
    }
    if (key.return) {
      onSelect(derivedRows[index] ?? null);
      exit();
      return;
    }
    if (key.upArrow || input === "k") {
      const nextIdx = index === 0 ? derivedRows.length - 1 : index - 1;
      const nextId = derivedRows[nextIdx]?.paneId;
      if (nextId !== undefined) setSelectedPaneId(nextId);
    }
    if (key.downArrow || input === "j") {
      const nextIdx = index === derivedRows.length - 1 ? 0 : index + 1;
      const nextId = derivedRows[nextIdx]?.paneId;
      if (nextId !== undefined) setSelectedPaneId(nextId);
    }
    if (input === "n") {
      const nextId = derivedRows[nextWaitingIndex(derivedRows, index)]?.paneId;
      if (nextId !== undefined) setSelectedPaneId(nextId);
      return;
    }
    if (input === "w") {
      setFilterEnabled((v: boolean) => !v);
      return;
    }
    if (input === "m") {
      // Cycle the user-defined label on the currently selected pane.
      // writeUserLabel applies an optimistic local update + tmux write.
      const target = derivedRows[index];
      if (target) {
        writeUserLabel(
          target.paneId,
          nextUserLabel(target.userLabel),
          target.sessionId,
        );
      }
      return;
    }
    if (input === "M") {
      // Reset user label to none (counterpart to m's cycle).
      const target = derivedRows[index];
      if (target) writeUserLabel(target.paneId, "", target.sessionId);
      return;
    }
  });

  if (rows.length === 0) {
    return <Text color={DOGRUN.warn}>No panes available.</Text>;
  }
  if (filterEnabled && derivedRows.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color={DOGRUN.warn}>No waiting/idle panes</Text>
        <Text color={DOGRUN.muted}>Press w to clear filter</Text>
      </Box>
    );
  }

  const current = derivedRows[index];
  const totalCols = size.columns;
  // A frame exactly as tall as the terminal is fine, but one TALLER is not:
  // Ink falls back to clearing the whole terminal between frames once the
  // output overflows the viewport, which inside a tmux popup blanks and
  // repaints every cell on each tick. Ink clips output to the root box height,
  // so pinning the root to totalRows is what keeps overflow impossible.
  const totalRows = size.rows;
  const { listWidth, previewWidth, topRows, bodyHeight, card, view } =
    listGeometry({
      columns: totalCols,
      rows: totalRows,
      total: derivedRows.length,
      selected: index,
      prevOffset: listOffset.current,
    });
  // The preview column starts on the same row as the list and runs to the
  // bottom row so the Usage card sits beside the hints.
  const columnHeight = totalRows - topRows;
  const usageVisible = previewWidth > 0 &&
    showUsageCard(usages, previewWidth, columnHeight);
  listOffset.current = view.offset;
  const previewHeight = columnHeight -
    (usageVisible ? usageCardRows(usages.length) : 0);
  // Dynamic repo/branch column widths: scan visible rows, clamp to caps, and
  // shrink branch first if the combined width would starve the summary slot.
  const rowsParts: ReturnType<typeof locationParts>[] = derivedRows.map(
    (r: PaneRow) => locationParts(r),
  );
  const { repoMax, branchMax } = row1Columns(
    listWidth,
    Math.max(
      0,
      ...rowsParts.map((p) =>
        stringCells(p.worktree ? `${p.repo}(${p.worktree})` : p.repo)
      ),
    ),
    Math.max(0, ...rowsParts.map((p) => p.branch.length)),
  );

  return (
    <Box flexDirection="row" width={totalCols} height={totalRows}>
      <Box flexDirection="column" width={listWidth}>
        <Box flexDirection="column" height={bodyHeight} marginTop={topRows}>
          {view.scrolling && (
            <Text color={DOGRUN.muted}>
              {view.above > 0 ? `  ↑ ${view.above} more` : " "}
            </Text>
          )}
          <Box flexDirection="column" gap={card.gap}>
            {derivedRows
              .slice(view.offset, view.offset + view.count)
              .map((row: PaneRow, i: number) => (
                <PaneRowLine
                  key={row.paneId}
                  row={row}
                  now={now}
                  selected={view.offset + i === index}
                  taskProgress={taskProgressMap.get(row.paneId) ?? null}
                  listWidth={listWidth}
                  repoMax={repoMax}
                  branchMax={branchMax}
                  padded={card === FULL_CARD}
                />
              ))}
          </Box>
          {view.scrolling && (
            <Text color={DOGRUN.muted}>
              {view.below > 0 ? `  ↓ ${view.below} more` : " "}
            </Text>
          )}
        </Box>
        <HintBar filterEnabled={filterEnabled} width={listWidth} />
      </Box>
      {current && previewWidth > 0 && (
        <Box
          marginLeft={PREVIEW_GUTTER}
          marginTop={topRows}
          flexDirection="column"
          height={columnHeight}
        >
          <Preview row={current} width={previewWidth} height={previewHeight} />
          {usageVisible && (
            <UsageCard usages={usages} now={now} width={previewWidth} />
          )}
        </Box>
      )}
    </Box>
  );
}

// ---- Main ----

async function main(): Promise<void> {
  if (!Deno.env.get("TMUX")) {
    console.error("picker.tsx must run inside tmux");
    Deno.exit(2);
  }
  // Parallel with fetchPanes so the footer costs the popup no extra startup
  // latency — the whole reason the picker is AOT-compiled in the first place.
  const [rows, usages, prefixKey] = await Promise.all([
    fetchPanes(),
    readAllAgentUsage(),
    readPrefixKey(),
  ]);

  // tmux.conf bind-key w writes CC_PICKER_FROM_PANE to the session environment via
  // `set-environment` BEFORE display-popup runs; the popup process inherits the value at spawn.
  // The earlier `display-popup -e "VAR=#{pane_id}"` form was empirically observed to deliver
  // a stale pane id (off-by-one against the previous invocation's source pane) — see the
  // diagnostic samples captured in plan 20260429T1822-picker-cursor-from-pane-fix. Routing the
  // value through session env, set BEFORE display-popup, sidesteps that quirk.
  // Reserved TMUX_PANE is unsuitable: tmux overwrites it with the popup's own pane id at spawn.
  const fromPane = Deno.env.get("CC_PICKER_FROM_PANE") ?? null;
  const initialSelectedPaneId =
    fromPane && rows.some((r) => r.paneId === fromPane)
      ? fromPane
      : (rows[0]?.paneId ?? "");

  const result: { value: PaneRow | null } = { value: null };
  const { waitUntilExit } = render(
    <App
      initialRows={rows}
      initialSelectedPaneId={initialSelectedPaneId}
      initialUsages={usages}
      prefixKey={prefixKey}
      onSelect={(r) => {
        result.value = r;
      }}
    />,
    {
      // Opt-in per-line diffing. Ink's default renderer rewrites every line of
      // the frame whenever any part of it changes, so the static title bar was
      // being blanked and repainted on each 1s tick — inside a tmux popup that
      // reads as flicker along the top edge. With this on, lines whose content
      // is unchanged are never written, so tmux never marks them dirty.
      incrementalRendering: true,
    },
  );
  await waitUntilExit();

  const picked = result.value;
  if (!picked) return;
  await jumpTo(picked.target);
}

if (import.meta.main) {
  try {
    await main();
    // One-shot CLI: force exit so popup closes deterministically (avoid
    // event-loop drain stall after jumpTo / Ink unmount).
    Deno.exit(0);
  } catch (e) {
    console.error(e);
    Deno.exit(1);
  }
}
