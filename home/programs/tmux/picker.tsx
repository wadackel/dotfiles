#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=tmux,git

// tmux Claude Code session picker (prefix+w).
// ink + React on Deno. SSOT: @pane_* tmux pane options written by claude-pane-status.ts.

/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import React, { useEffect, useState } from "npm:react@18.3.1";
import {
  Box,
  render,
  Text,
  useApp,
  useInput,
  useStdout,
} from "npm:ink@5.2.1";

// ---- Types ----

export type PaneStatus = "running" | "waiting" | "idle" | "error" | "";

export interface PaneRow {
  paneId: string;
  target: string;
  currentCommand: string;
  currentPath: string;
  agent: string;
  status: PaneStatus;
  startedAtSec: number | null;
  cwd: string;
  worktreeBranch: string;
  subagentsCount: number;
  prompt: string;
  waitReason: string;
  attention: string;
}

// Status → display metadata. Mirrors bash tmux-window-picker.sh:59-78 (icon + short text).
export const STATUS_META = {
  running: { color: "green", short: "run", icon: "●" },
  waiting: { color: "yellow", short: "wait", icon: "◐" },
  idle: { color: "gray", short: "idle", icon: "○" },
  error: { color: "red", short: "err", icon: "✖" },
  "": { color: "white", short: "", icon: " " },
} as const;

// ---- Pure helpers (exported for tests) ----

// Format string passed to `tmux list-panes -a -F ...`. US (\x1f) separates fields
// because tmux format output can contain tabs/spaces and @pane_* values may be empty.
export const TMUX_FORMAT =
  "#{pane_id}\x1f" +
  "#{session_name}:#{window_index}.#{pane_index}\x1f" +
  "#{pane_current_command}\x1f" +
  "#{pane_current_path}\x1f" +
  "#{@pane_agent}\x1f" +
  "#{@pane_status}\x1f" +
  "#{@pane_started_at}\x1f" +
  "#{@pane_cwd}\x1f" +
  "#{@pane_worktree_branch}\x1f" +
  "#{@pane_subagents_count}\x1f" +
  "#{@pane_prompt}\x1f" +
  "#{@pane_wait_reason}\x1f" +
  "#{@pane_attention}";

const NUMERIC = /^\d+$/;

function parseIntOrNull(raw: string): number | null {
  return NUMERIC.test(raw) ? Number.parseInt(raw, 10) : null;
}

function normalizeStatus(raw: string): PaneStatus {
  return Object.hasOwn(STATUS_META, raw) ? (raw as PaneStatus) : "";
}

// Parse one line of `tmux list-panes -a -F TMUX_FORMAT` output into a PaneRow.
// Returns null when the line is malformed (< 13 fields or empty pane_id).
export function parseRow(line: string): PaneRow | null {
  const fields = line.split("\x1f");
  if (fields.length < 13) return null;
  const [
    paneId,
    target,
    currentCommand,
    currentPath,
    agent,
    status,
    startedAt,
    cwd,
    worktreeBranch,
    subsCount,
    prompt,
    waitReason,
    attention,
  ] = fields;
  if (!paneId) return null;
  return {
    paneId,
    target,
    currentCommand,
    currentPath,
    agent,
    status: normalizeStatus(status),
    startedAtSec: parseIntOrNull(startedAt),
    cwd,
    worktreeBranch,
    subagentsCount: parseIntOrNull(subsCount) ?? 0,
    prompt,
    waitReason,
    attention,
  };
}

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
function basename(path: string): string {
  if (!path) return "";
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed) return "/";
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
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

// ---- tmux I/O (impure) ----

async function tmuxRun(args: string[]): Promise<{ stdout: string; code: number }> {
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

async function fetchPanes(selfPaneId: string): Promise<PaneRow[]> {
  const { stdout } = await tmuxRun(["list-panes", "-a", "-F", TMUX_FORMAT]);
  const rows: PaneRow[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const row = parseRow(line);
    if (row && row.paneId !== selfPaneId) rows.push(row);
  }
  // Fill in missing worktreeBranch from the pane's cwd (or pane_current_path
  // for non-Claude panes) in parallel.
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

async function clearAttention(paneId: string): Promise<void> {
  await tmuxRun(["set", "-t", paneId, "-p", "-u", "@pane_attention"]);
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
}

function PaneRowLine({ row, now, selected }: PaneRowLineProps) {
  const color = statusColor(row.status);
  const pointer = selected ? "»" : " ";
  const attentionMark = row.attention === "notification" ? "!" : " ";
  // Claude panes have an @pane_status icon; non-Claude panes keep a space for
  // alignment and fall back to pane_current_command for the status column.
  const icon = row.status ? statusIcon(row.status) : " ";
  const subsCell = row.subagentsCount > 0
    ? String(row.subagentsCount).padStart(2)
    : "  ";
  const statusText = row.status ? statusShort(row.status) : row.currentCommand;
  const status4 = statusText.slice(0, 4).padEnd(4);
  const cwdSource = row.cwd || row.currentPath;
  const cwdBase = (basename(cwdSource) || "·").slice(0, 16).padEnd(16);
  const branch = (row.worktreeBranch || "·").slice(0, 14).padEnd(14);
  const elapsed = formatElapsed(row.startedAtSec, now).padEnd(4);
  const summary = summaryOf(row);
  return (
    <Box>
      <Text color={selected ? "magenta" : "gray"}>{pointer} </Text>
      <Text color={row.attention === "notification" ? "magenta" : "gray"}>
        {attentionMark}
      </Text>
      <Text color={color}>{icon}</Text>
      <Text color="cyan" dimColor>{subsCell}</Text>
      <Text color={color}> {status4}</Text>
      <Text color="blue"> {cwdBase}</Text>
      <Text color="yellow"> {branch}</Text>
      <Text color="gray"> {elapsed}</Text>
      <Text> {summary}</Text>
      <Text color="gray" dimColor>{" "}{row.target}</Text>
    </Box>
  );
}

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
    // Border consumes 1 col on each side (2 total); account for it when clamping lines.
    const innerCols = Math.max(10, width - 4);
    const innerRows = Math.max(3, height - 3);
    capturePane(target)
      .then((text) => {
        if (!cancelled) setContent(clampPreview(text, innerCols, innerRows));
      })
      .catch((e: unknown) => {
        if (!cancelled) setContent(`(preview failed: ${String(e)})`);
      });
    return () => {
      cancelled = true;
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
  rows,
  onSelect,
}: {
  rows: PaneRow[];
  onSelect: (row: PaneRow | null) => void;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [index, setIndex] = useState(0);
  // Elapsed is computed once at mount — the picker is a one-shot popup, no
  // auto-tick re-render to avoid terminal flicker.
  const now = Math.floor(Date.now() / 1000);

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
      setIndex((i: number) => Math.max(0, i - 1));
    }
    if (key.downArrow || input === "j") {
      setIndex((i: number) => Math.min(rows.length - 1, i + 1));
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

  return (
    <Box flexDirection="column" width={totalCols} height={totalRows}>
      <Box marginBottom={1}>
        <Text color="cyan">Select pane </Text>
        <Text color="gray">[Enter: jump / Esc or q: cancel / ↑↓ jk: move]</Text>
      </Box>
      <Box flexDirection="row" height={bodyHeight}>
        <Box flexDirection="column" width={listWidth}>
          {rows.map((row, i) => (
            <Box key={row.paneId}>
              <PaneRowLine row={row} now={now} selected={i === index} />
            </Box>
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
  // TMUX_PANE is set in regular panes but NOT in `display-popup -E` subprocesses.
  // Fall back to empty so fetchPanes lists every pane — popups themselves are
  // not enumerated by `tmux list-panes -a`, so nothing spurious leaks in.
  const selfPaneId = Deno.env.get("TMUX_PANE") ?? "";
  const rows = await fetchPanes(selfPaneId);

  const result: { value: PaneRow | null } = { value: null };
  const { waitUntilExit } = render(
    <App rows={rows} onSelect={(r) => { result.value = r; }} />,
  );
  await waitUntilExit();

  const picked = result.value;
  if (!picked) return;
  await clearAttention(picked.paneId);
  await jumpTo(picked.target);
}

if (import.meta.main) {
  await main().catch((e: unknown) => {
    console.error(e);
    Deno.exit(1);
  });
}
