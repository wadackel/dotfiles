#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --no-prompt

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
const REPO_CAP = 16;
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
import { cwdBranchParts } from "./format_helpers.ts";

import {
  DOGRUN,
  PaneRowLine,
  PILL_LEFT,
  PILL_RIGHT,
  ROW1_FIXED_OVERHEAD,
  type TaskProgress,
  TITLE_ICON,
} from "./components.tsx";

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

// Mirrors codex-plan-gate.ts:canonical so picker hashes the same cwd string
// as the edit gate even when the leaf path has disappeared.
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
    // Reset content the moment target changes — without this, a stale capture
    // of the previous target keeps rendering under the new "Preview: <target>"
    // header until the new capturePane resolves (~0–1 s).
    setContent(null);
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
      borderColor={DOGRUN.dim}
      paddingLeft={1}
    >
      <Text color={DOGRUN.accent}>Preview: {target}</Text>
      <Text>{content ?? "(loading...)"}</Text>
    </Box>
  );
}

function App({
  initialRows,
  initialSelectedPaneId,
  onSelect,
}: {
  initialRows: PaneRow[];
  initialSelectedPaneId: string;
  onSelect: (row: PaneRow | null) => void;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  // useStdout() does not re-render on resize; subscribe to stdout's 'resize'
  // event so that totalCols/totalRows (and everything derived: listWidth,
  // previewWidth, bodyHeight, showFilterUI) follow tmux popup / window resizes.
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
  const [rows, setRows] = useState(initialRows);
  const [taskProgressMap, setTaskProgressMap] = useState<
    Map<string, TaskProgress | null>
  >(new Map());
  const [selectedPaneId, setSelectedPaneId] = useState(initialSelectedPaneId);
  const [filterEnabled, setFilterEnabled] = useState(false);
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
        // Fetch task progress for every supported pane in parallel. Failures are
        // isolated (readTaskProgress swallows them) so one bad session dir does
        // not block the whole tick.
        const entries = await Promise.all(
          r.map(async (row) =>
            [row.paneId, await readTaskProgressForRow(row)] as const
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

  useInput((input, key) => {
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
    if (input === "w") {
      setFilterEnabled((v: boolean) => !v);
      return;
    }
    if (input === "m") {
      // Cycle the user-defined label on the currently selected pane. The
      // tmux pane option write happens asynchronously; the next fetchPanes
      // tick (≤ TICK_INTERVAL_MS) picks up the new value and re-renders.
      // No local state mutation needed — the SSOT is the tmux option.
      const target = derivedRows[index];
      if (target) {
        const next = nextUserLabel(target.userLabel);
        tmuxRun([
          "set-option",
          "-p",
          "-t",
          target.paneId,
          "@pane_user_label",
          next,
        ]);
      }
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
  const totalRows = size.rows;
  const listWidth = Math.max(40, Math.floor(totalCols * 0.6));
  const previewWidth = Math.max(20, totalCols - listWidth - 1);
  const bodyHeight = Math.max(5, totalRows - 2);
  // The baseline title bar (icon + title + Enter / j/k / Esc hints) is ~61
  // cells, fitting on one line at the popup's typical 80%-of-screen width.
  // The `w filter/clear` hint and the `[w] wait/idle` badge would push the
  // total past narrow-tmux widths (cols=60 in S10/S14/S15 fixtures) and force
  // the title to wrap, which breaks spawnPicker's `AI Agents` waitFor.
  // Suppress both decorations below this threshold; users on narrow widths
  // can still discover the `w` shortcut from CLAUDE.md / tmux.conf.
  const showFilterUI = totalCols >= 80;

  // Dynamic repo/branch column widths: scan visible rows, clamp to caps, and
  // shrink branch first if the combined width would starve the summary slot.
  const rowsParts = derivedRows.map((r: PaneRow) =>
    cwdBranchParts(r.cwd || r.currentPath, r.worktreeBranch)
  );
  const columnBudget = Math.max(
    0,
    listWidth - ROW1_FIXED_OVERHEAD - MIN_SUMMARY,
  );
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
        <Text color={DOGRUN.accent}>{TITLE_ICON + "  "}</Text>
        <Text color={DOGRUN.accent} bold>AI Agents</Text>
        {showFilterUI && filterEnabled
          ? (
            <>
              <Text>{"  "}</Text>
              <Text color={DOGRUN.muted}>{PILL_LEFT}</Text>
              <Text color={DOGRUN.fg} backgroundColor={DOGRUN.muted}>
                {" wait/idle "}
              </Text>
              <Text color={DOGRUN.muted}>{PILL_RIGHT}</Text>
            </>
          )
          : null}
        <Box flexGrow={1} />
        <Text color={DOGRUN.accent}>Enter</Text>
        <Text color={DOGRUN.fg}>{" jump  "}</Text>
        <Text color={DOGRUN.muted}>·</Text>
        <Text color={DOGRUN.accent}>{"  j/k ↑↓"}</Text>
        <Text color={DOGRUN.fg}>{" move  "}</Text>
        {showFilterUI
          ? (
            <>
              <Text color={DOGRUN.muted}>·</Text>
              <Text color={DOGRUN.accent}>{"  w"}</Text>
              <Text color={DOGRUN.fg}>
                {filterEnabled ? " clear  " : " filter  "}
              </Text>
              <Text color={DOGRUN.muted}>·</Text>
              <Text color={DOGRUN.accent}>{"  m"}</Text>
              <Text color={DOGRUN.fg}>{" label  "}</Text>
            </>
          )
          : null}
        <Text color={DOGRUN.muted}>·</Text>
        <Text color={DOGRUN.accent}>{"  Esc q"}</Text>
        <Text color={DOGRUN.fg}>{" cancel"}</Text>
      </Box>
      <Box flexDirection="row" height={bodyHeight}>
        <Box flexDirection="column" width={listWidth} gap={1}>
          {derivedRows.map((row: PaneRow, i: number) => (
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
