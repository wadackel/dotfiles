#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=tmux,git

// tmux Claude Code session picker (prefix+w).
// ink + React on Deno. SSOT: @pane_* tmux pane options written by claude-pane-status.ts.

/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import React, { useEffect, useState } from "npm:react@18.3.1";
import { Box, render, Text, useApp, useInput, useStdout } from "npm:ink@5.2.1";

// ---- Types + row parsing SSOT ----

// PaneRow / PaneStatus / STATUS_META / TMUX_FORMAT / parseRow live in
// pane_row.ts so non-TUI tooling (picker-doctor.ts, tests) can reuse them
// without dragging in React + Ink at import time.
import {
  type PaneRow,
  type PaneStatus,
  parseRow,
  STATUS_META,
  TMUX_FORMAT,
} from "./pane_row.ts";
export {
  type PaneRow,
  type PaneStatus,
  parseRow,
  STATUS_META,
  TMUX_FORMAT,
};

export interface TaskProgress {
  done: number;
  total: number;
}

// Row-1 repo/branch column width caps for the dynamic layout. App computes
// per-render repoMax / branchMax by scanning visible rows and clamps to these
// upper bounds so a single long branch cannot starve the summary slot.
const REPO_CAP = 16;
const BRANCH_CAP = 28;
// Minimum visible summary width the layout must preserve after repo + branch.
const MIN_SUMMARY = 15;

// Dashboard-style auto-refresh cadence. Both the list fetch (fetchPanes) and
// the preview capture (capturePane) re-run at this interval so the popup
// reflects pane status / prompt / subagents / elapsed time / preview without
// manual interaction.
const TICK_INTERVAL_MS = 1000;

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

// tmux capture-pane -e emits ANSI. ink <Text> passes SGR (color) through
// cleanly, but cursor-move CSI corrupts the layout AND OSC/DCS/APC/PM can
// smuggle titles, hyperlinks, and device control into the host terminal
// (terminal-injection surface). Strip every ESC sequence except SGR CSI.
//
// Order matters: handle string-terminated families (OSC/DCS/APC/PM) first
// because their payload may incidentally contain `[` that would otherwise be
// eaten by the CSI matcher. Then strip non-SGR CSI. Then strip simple
// single-char escapes that are neither CSI introducer nor string intros.
// Parameter byte range per ECMA-48 is 0x30-0x3F (covers `<`, `=`, `>`, `?`
// in addition to digits and `;:`). Using the full range prevents e.g.
// `\x1b[>0c` (primary device attributes request) from bypassing the sanitizer.
const OSC_LIKE = /\x1b[\]P_^][\s\S]*?(?:\x07|\x1b\\)/g;
const CSI_SEQUENCE = /\x1b\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g;
const SIMPLE_ESC = /\x1b[^\[\]P_^]/g;
export function sanitizeAnsi(input: string): string {
  return input
    .replace(OSC_LIKE, "")
    .replace(CSI_SEQUENCE, (match) => (match.endsWith("m") ? match : ""))
    .replace(SIMPLE_ESC, "");
}

// ANSI-aware line truncation. After sanitizeAnsi, only SGR CSI sequences
// remain; if a raw .slice(0, N) happens to cut mid-escape, Ink would render
// a dangling ESC and leak terminal control into the host. This truncator
// counts only printable characters toward the column budget while passing
// escape sequences through intact. If truncation occurs mid-SGR-span, a
// reset `\x1b[0m` is appended so no color leaks to the next line.
export function truncateAnsiLine(line: string, maxCols: number): string {
  let out = "";
  let printable = 0;
  let hasOpenSgr = false;
  let i = 0;
  while (i < line.length && printable < maxCols) {
    const ch = line[i];
    if (ch === "\x1b") {
      const rest = line.slice(i);
      const m = rest.match(/^\x1b\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/);
      if (m) {
        out += m[0];
        // Track open SGR: any SGR other than a plain reset opens a span.
        if (m[0].endsWith("m")) {
          const params = m[0].slice(2, -1);
          hasOpenSgr = params !== "" && params !== "0";
        }
        i += m[0].length;
        continue;
      }
      i++;
      continue;
    }
    out += ch;
    printable++;
    i++;
  }
  if (hasOpenSgr) out += "\x1b[0m";
  return out;
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
export function summaryOf(row: PaneRow): string {
  const src = row.status === "waiting" || row.status === "error"
    ? (row.waitReason || row.prompt)
    : row.prompt;
  const trimmed = src.slice(0, 40);
  return trimmed || "·";
}

// Row-2 tool segment text: "<tool>[: <subject>][ ✖ <error>]". Same text for
// current and last tools — the caller distinguishes them by color (cyan for
// current, gray for last). Returns "" when no tool has run (caller skips).
export function toolSegmentText(row: PaneRow): string {
  const tool = row.currentTool || row.lastTool;
  if (!tool) return "";
  const subject = row.currentTool ? row.currentToolSubject : row.lastToolSubject;
  const base = subject ? `${tool}: ${subject}` : tool;
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

// Allowed shape for a session id when used as a filesystem path segment.
// Claude Code session ids are UUIDs, and team-scoped tasks use name-like
// identifiers; in both cases they fit within this conservative allowlist.
// Rejecting anything else closes the `sessionId = "../something"` directory
// traversal class of issue at the picker boundary.
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

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

async function fetchPanes(): Promise<PaneRow[]> {
  const { stdout } = await tmuxRun(["list-panes", "-a", "-F", TMUX_FORMAT]);
  const rows: PaneRow[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const row = parseRow(line);
    if (row && row.agent === "claude") {
      rows.push(row);
    }
  }
  // Fill in missing worktreeBranch from the pane's cwd (falling back to
  // pane_current_path when @pane_cwd is unset, e.g. when the latest hook event
  // for a Claude pane carried no cwd payload) in parallel.
  await Promise.all(
    rows.map(async (row) => {
      if (!row.worktreeBranch) {
        const source = row.cwd || row.currentPath;
        if (source) row.worktreeBranch = await gitBranch(source);
      }
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

async function jumpTo(target: string): Promise<void> {
  const { session, window } = parseTarget(target);
  await tmuxRun(["switch-client", "-t", session]);
  await tmuxRun(["select-window", "-t", window]);
  await tmuxRun(["select-pane", "-t", target]);
}

// ---- UI ----

interface PaneRowLineProps {
  row: PaneRow;
  now: number;
  selected: boolean;
  taskProgress: TaskProgress | null;
  listWidth: number;
  repoMax: number;
  branchMax: number;
}

// Row-2 segment (colored text). Built in priority order; when the cumulative
// width exceeds budget, trim from the end (lowest priority first).
interface Row2Seg {
  key: string;
  text: string;
  color: string;
}

const ROW2_SEP = " · ";

const PaneRowLine: React.FC<PaneRowLineProps> = (
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
  const subagents = parseSubagents(row.subagents);

  // Build row-2 segments in priority order (higher priority first). The
  // cumulative width is compared against `budget` and low-priority segments
  // are dropped from the tail if over. target sits in flexGrow-pushed right
  // slot outside this budget.
  const segs: Row2Seg[] = [];
  if (row.currentTool) {
    segs.push({ key: "tool", text: toolSegmentText(row), color: "cyan" });
  } else if (row.lastTool) {
    segs.push({ key: "tool", text: toolSegmentText(row), color: "gray" });
  }
  if (subagents.length > 0) {
    segs.push({
      key: "tree",
      text: renderSubagentTree(subagents),
      color: "gray",
    });
  }
  if (row.lastEditFile) {
    segs.push({
      key: "file",
      text: basename(row.lastEditFile),
      color: "gray",
    });
  }
  if (taskProgress) {
    segs.push({
      key: "progress",
      text: `${taskProgress.done}/${taskProgress.total}`,
      color: "gray",
    });
  }
  if (row.status === "idle" && row.lastActivityAtSec !== null) {
    segs.push({
      key: "idle",
      text: `idle ${formatElapsed(row.lastActivityAtSec, now)}`,
      color: "gray",
    });
  }

  // Budget = listWidth minus 2-space indent minus a small margin before target.
  // Always keep at least the top-priority segment even if it exceeds budget —
  // an overrun is preferable to rendering nothing.
  const budget = Math.max(0, listWidth - 2 - 2);
  let totalLen = segs.length > 0 ? segs[0].text.length : 0;
  for (let i = 1; i < segs.length; i++) {
    totalLen += ROW2_SEP.length + segs[i].text.length;
  }
  while (segs.length > 1 && totalLen > budget) {
    const dropped = segs.pop()!;
    totalLen -= ROW2_SEP.length + dropped.text.length;
  }

  return (
    <Box flexDirection="column">
      {/* Line 1: marker + icon + status + elapsed + repo · branch + summary */}
      <Box>
        <Text color={selected ? "magenta" : "gray"}>{pointer}</Text>
        <Text color={color}>{icon + " "}</Text>
        <Text color={color}>{status5}</Text>
        <Text color="gray">{elapsed5}</Text>
        <Text color="blue">{repoCol}</Text>
        <Text color="gray">{separator}</Text>
        <Text color="cyan">{branchCol}</Text>
        <Text>{" " + summary}</Text>
      </Box>
      {/* Line 2: indent + priority-ordered segments + target (right-align) */}
      <Box>
        <Text>{"  "}</Text>
        {segs.map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 ? <Text color="gray">{ROW2_SEP}</Text> : null}
            <Text color={s.color}>{s.text}</Text>
          </React.Fragment>
        ))}
        <Box flexGrow={1} />
        <Text color="gray">{row.target}</Text>
      </Box>
    </Box>
  );
};

// Keep preview bounded so it never pushes the list column to zero width and
// never exceeds the popup height. Truncate each line to the column width and
// keep only the last `maxLines` lines.
function clampPreview(text: string, maxCols: number, maxLines: number): string {
  const lines = text.split("\n");
  const tail = lines.slice(Math.max(0, lines.length - maxLines));
  return tail.map((line) => truncateAnsiLine(line, maxCols)).join("\n");
}

function Preview(
  { target, width, height }: { target: string; width: number; height: number },
) {
  const [content, setContent] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timerId: number | undefined;
    // Border consumes 1 col on each side (2 total); account for it when clamping lines.
    const innerCols = Math.max(10, width - 4);
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
  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderColor="gray"
      paddingLeft={1}
    >
      <Text color="cyan">Preview: {target}</Text>
      <Text>{content ?? "(loading...)"}</Text>
    </Box>
  );
}

function App({
  initialRows,
  onSelect,
}: {
  initialRows: PaneRow[];
  onSelect: (row: PaneRow | null) => void;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [rows, setRows] = useState(initialRows);
  const [taskProgressMap, setTaskProgressMap] = useState<
    Map<string, TaskProgress | null>
  >(new Map());
  const [selectedPaneId, setSelectedPaneId] = useState(
    initialRows[0]?.paneId ?? "",
  );
  // `now` re-reads Date.now() on every render; the periodic setRows below
  // triggers a re-render every TICK_INTERVAL_MS, so elapsed time advances
  // naturally without a dedicated tick state.
  const now = Math.floor(Date.now() / 1000);

  useEffect(() => {
    let cancelled = false;
    let timerId: number | undefined;
    // Self-rescheduling setTimeout chain: at most one fetchPanes in-flight,
    // no out-of-order overwrite, and errors do not break the loop.
    const tick = async () => {
      try {
        const r = await fetchPanes();
        if (cancelled) return;
        setRows(r);
        // Fetch task progress for every Claude pane in parallel. Failures are
        // isolated (readTaskProgress swallows them) so one bad session dir does
        // not block the whole tick.
        const entries = await Promise.all(
          r.map(async (row) =>
            [row.paneId, await readTaskProgress(row.sessionId)] as const
          ),
        );
        if (!cancelled) setTaskProgressMap(new Map(entries));
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

  const foundIdx = rows.findIndex((r: PaneRow) => r.paneId === selectedPaneId);
  const index = foundIdx >= 0 ? foundIdx : 0;

  useInput((input, key) => {
    if (key.escape || input === "q") {
      onSelect(null);
      exit();
      return;
    }
    if (key.return) {
      onSelect(rows[index] ?? null);
      exit();
      return;
    }
    if (key.upArrow || input === "k") {
      const nextIdx = index === 0 ? rows.length - 1 : index - 1;
      const nextId = rows[nextIdx]?.paneId;
      if (nextId !== undefined) setSelectedPaneId(nextId);
    }
    if (key.downArrow || input === "j") {
      const nextIdx = index === rows.length - 1 ? 0 : index + 1;
      const nextId = rows[nextIdx]?.paneId;
      if (nextId !== undefined) setSelectedPaneId(nextId);
    }
  });

  if (rows.length === 0) {
    return <Text color="yellow">No panes available.</Text>;
  }

  const current = rows[index];
  const totalCols = stdout?.columns ?? 120;
  const totalRows = stdout?.rows ?? 30;
  const listWidth = Math.max(40, Math.floor(totalCols * 0.6));
  const previewWidth = Math.max(20, totalCols - listWidth - 1);
  const bodyHeight = Math.max(5, totalRows - 2);

  // Dynamic repo/branch column widths: scan visible rows, clamp to caps, and
  // shrink branch first if the combined width would starve the summary slot.
  // Row 1 fixed-width cost before summary: pointer(2) + "icon "(2) + status5(5)
  // + elapsed5(5) + " · "(3) + " "(1) = 18 cols.
  const rowsParts = rows.map((r: PaneRow) =>
    cwdBranchParts(r.cwd || r.currentPath, r.worktreeBranch)
  );
  const columnBudget = Math.max(0, listWidth - 18 - MIN_SUMMARY);
  const repoMax = Math.min(
    REPO_CAP,
    Math.max(4, ...rowsParts.map((p: { repo: string }) => p.repo.length)),
  );
  let branchMax = Math.min(
    BRANCH_CAP,
    Math.max(4, ...rowsParts.map((p: { branch: string }) => p.branch.length)),
  );
  if (repoMax + branchMax > columnBudget) {
    branchMax = Math.max(4, columnBudget - repoMax);
  }

  return (
    <Box flexDirection="column" width={totalCols} height={totalRows}>
      <Box marginBottom={1}>
        <Text color="cyan">Select pane</Text>
        <Box marginLeft={2}>
          <Text color="gray">[Enter: jump / Esc or q: cancel / ↑↓ jk: move]</Text>
        </Box>
      </Box>
      <Box flexDirection="row" height={bodyHeight}>
        <Box flexDirection="column" width={listWidth}>
          {rows.map((row: PaneRow, i: number) => (
            <PaneRowLine
              key={row.paneId}
              row={row}
              now={now}
              selected={i === index}
              taskProgress={taskProgressMap.get(row.paneId) ?? null}
              listWidth={listWidth}
              repoMax={repoMax}
              branchMax={branchMax}
            />
          ))}
        </Box>
        {current && (
          <Box marginLeft={1}>
            <Preview
              target={current.target}
              width={previewWidth}
              height={bodyHeight}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ---- Main ----

async function main(): Promise<void> {
  if (!Deno.env.get("TMUX")) {
    console.error("picker.tsx must run inside tmux");
    Deno.exit(2);
  }
  const rows = await fetchPanes();

  const result: { value: PaneRow | null } = { value: null };
  const { waitUntilExit } = render(
    <App
      initialRows={rows}
      onSelect={(r) => {
        result.value = r;
      }}
    />,
  );
  await waitUntilExit();

  const picked = result.value;
  if (!picked) return;
  await jumpTo(picked.target);
}

if (import.meta.main) {
  await main().catch((e: unknown) => {
    console.error(e);
    Deno.exit(1);
  });
}
