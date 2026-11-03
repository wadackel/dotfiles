// `agentower --snapshot` and `agentower --restore`. Reached from
// agentower-main.ts before raw mode and before ink is loaded: the snapshot runs
// every minute from launchd, and the restore prompt needs a normal tty.

import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import { run } from "../../agents/lib/proc.ts";
import { truncate } from "../shared/pane-shared.ts";
import { stringCells, truncateToCells } from "./cell_width.ts";
import {
  type Agent,
  isLivePaneCommand,
  isStartupCodex,
  PANE_SNAPSHOT_FORMAT,
  type PaneSnapshot,
  parsePaneSnapshot,
  USER_LABEL_META,
  type UserLabel,
} from "./pane_row.ts";

const AGENT_KINDS = [
  "claude",
  "codex",
  "opencode",
] as const satisfies readonly Agent[];
const USER_LABELS = Object.keys(USER_LABEL_META) as [UserLabel, ...UserLabel[]];

// Narrower than SESSION_ID_RE: the id is typed after `claude --resume`, whose
// value is optional, so an id starting with `-` would reach the agent as a flag
// of its own, one a pane could plant for the next reboot.
const RESUME_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const AgentSchema = z.strictObject({
  kind: z.enum(AGENT_KINDS),
  sessionId: z.string().regex(RESUME_ID_RE),
  prompt: z.string(),
  userLabel: z.enum(USER_LABELS),
});

const PaneSchema = z.strictObject({
  index: z.number().int(),
  active: z.boolean(),
  path: z.string(),
  command: z.string(),
  agent: AgentSchema.nullable(),
});

const WindowSchema = z.strictObject({
  index: z.number().int(),
  name: z.string(),
  layout: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  automaticRename: z.boolean(),
  zoomed: z.boolean(),
  active: z.boolean(),
  panes: z.array(PaneSchema).min(1),
});

const SessionSchema = z.strictObject({
  name: z.string(),
  lastAttachedSec: z.number().int().nullable(),
  windows: z.array(WindowSchema).min(1),
});

export const SnapshotSchema = z.strictObject({
  savedAtSec: z.number().int(),
  serverStartTime: z.number().int(),
  sessions: z.array(SessionSchema).min(1),
});

export type Snapshot = z.infer<typeof SnapshotSchema>;
export type SnapshotAgent = z.infer<typeof AgentSchema>;
type SnapshotPane = z.infer<typeof PaneSchema>;
type SnapshotWindow = z.infer<typeof WindowSchema>;

// Keep in step with parseWindowLine. window_name stays last: it is free text.
export const WINDOW_FORMAT = "#{session_name}\x1f" +
  "#{session_last_attached}\x1f" +
  "#{window_index}\x1f" +
  "#{window_width}\x1f" +
  "#{window_height}\x1f" +
  "#{automatic-rename}\x1f" +
  "#{window_zoomed_flag}\x1f" +
  "#{window_active}\x1f" +
  "#{window_layout}\x1f" +
  "#{window_name}";

const WINDOW_FIXED_FIELDS = WINDOW_FORMAT.split("\x1f").length - 1;

// launchd gives the process no locale, and a tmux client without UTF-8 rewrites
// every control byte and non-ASCII character of its output to `_`. Setting LANG
// on the job would leave a run by hand depending on the caller's environment.
export function tmuxArgs(args: string[]): string[] {
  return ["-u", ...args];
}

export type CliCommand =
  | { kind: "snapshot" }
  | { kind: "list" }
  | { kind: "restore"; generation: number };

export function parseCliArgs(argv: string[]): CliCommand | null {
  if (argv.length === 1 && argv[0] === "--snapshot") {
    return { kind: "snapshot" };
  }
  if (argv[0] !== "--restore") return null;
  if (argv.length === 1) return { kind: "restore", generation: 1 };
  if (argv.length !== 2) return null;
  if (argv[1] === "--list") return { kind: "list" };
  if (!/^[1-9]\d*$/.test(argv[1])) return null;
  return { kind: "restore", generation: Number(argv[1]) };
}

interface WindowRow extends Omit<SnapshotWindow, "panes"> {
  session: string;
  lastAttachedSec: number | null;
}

function parseWindowLine(line: string): WindowRow {
  const fields = line.split("\x1f");
  if (fields.length <= WINDOW_FIXED_FIELDS) {
    throw new Error(`list-windows line has ${fields.length} fields`);
  }
  const [
    session,
    lastAttached,
    index,
    width,
    height,
    automaticRename,
    zoomed,
    active,
    layout,
  ] = fields;
  return {
    session,
    lastAttachedSec: lastAttached === "" ? null : Number(lastAttached),
    index: Number(index),
    name: fields.slice(WINDOW_FIXED_FIELDS).join("\x1f"),
    layout,
    width: Number(width),
    height: Number(height),
    automaticRename: automaticRename === "1",
    zoomed: zoomed === "1",
    active: active === "1",
  };
}

function isAgentKind(value: string): value is SnapshotAgent["kind"] {
  return (AGENT_KINDS as readonly string[]).includes(value);
}

function snapshotAgent(snapshot: PaneSnapshot): SnapshotAgent | null {
  const { row } = snapshot;
  if (isStartupCodex(snapshot)) return null;
  if (!isLivePaneCommand(row.agent, row.currentCommand)) return null;
  if (!isAgentKind(row.agent) || !RESUME_ID_RE.test(row.sessionId)) {
    return null;
  }
  return {
    kind: row.agent,
    sessionId: row.sessionId,
    prompt: row.prompt,
    userLabel: row.userLabel,
  };
}

function snapshotPane(snapshot: PaneSnapshot): SnapshotPane {
  const { row } = snapshot;
  return {
    index: Number(row.target.slice(row.target.lastIndexOf(".") + 1)),
    active: snapshot.active,
    path: row.currentPath,
    command: row.currentCommand,
    agent: snapshotAgent(snapshot),
  };
}

function nonEmpty(lines: string[]): string[] {
  return lines.filter((line) => line !== "");
}

function windowKey(session: string, index: string | number): string {
  return `${session}\x1f${index}`;
}

function layoutLeaves(layout: string): number {
  return layout.match(/\d+x\d+,\d+,\d+,\d+/g)?.length ?? 0;
}

// Thrown on any disagreement between the two tmux reads, which is what a window
// opened between them looks like: the previous file stays and the next minute
// succeeds. A snapshot short of a pane would not restore its layout at all.
export function buildSnapshot(input: {
  paneLines: string[];
  windowLines: string[];
  startTime: number;
  nowSec: number;
}): Snapshot {
  const panesByWindow = new Map<string, SnapshotPane[]>();
  for (const line of nonEmpty(input.paneLines)) {
    const parsed = parsePaneSnapshot(line);
    // Only the pane id goes in the message: the line carries @pane_prompt, and
    // this error reaches a log that is not as private as the snapshot.
    if (parsed === null) {
      const paneId = line.split("\x1f")[0];
      const named = /^%\d+$/.test(paneId) ? paneId : "?";
      throw new Error(`unexpected list-panes line: ${named}`);
    }
    const key = windowKey(parsed.sessionName, parsed.windowIndex);
    panesByWindow.set(key, [
      ...(panesByWindow.get(key) ?? []),
      snapshotPane(parsed),
    ]);
  }

  const sessions = new Map<string, Snapshot["sessions"][number]>();
  for (const line of nonEmpty(input.windowLines)) {
    const { session, lastAttachedSec, ...window } = parseWindowLine(line);
    const key = windowKey(session, window.index);
    const panes = panesByWindow.get(key);
    if (panes === undefined) {
      throw new Error(`window without panes: ${session}:${window.index}`);
    }
    panesByWindow.delete(key);
    if (layoutLeaves(window.layout) !== panes.length) {
      throw new Error(
        `layout disagrees with panes: ${session}:${window.index}`,
      );
    }
    const entry = sessions.get(session) ??
      { name: session, lastAttachedSec, windows: [] };
    entry.windows.push({
      ...window,
      panes: panes.toSorted((a, b) => a.index - b.index),
    });
    sessions.set(session, entry);
  }
  if (panesByWindow.size > 0) {
    throw new Error(`panes without a window: ${[...panesByWindow.keys()]}`);
  }

  return SnapshotSchema.parse({
    savedAtSec: input.nowSec,
    serverStartTime: input.startTime,
    sessions: [...sessions.values()].map((session) => ({
      ...session,
      windows: session.windows.toSorted((a, b) => a.index - b.index),
    })),
  });
}

export function parseSnapshot(text: string): Snapshot {
  return SnapshotSchema.parse(JSON.parse(text));
}

const GENERATION_FILE_RE = /^\d+\.json$/;
const KEPT_GENERATIONS = 10;
const RESTORING_OPTION = "@agentower_restoring";

// The current server's file is not a generation: it is being written, and
// restoring it would mean restoring what is already on screen.
export function generationFiles(
  names: string[],
  currentStartTime: string | null,
): string[] {
  return names
    .filter((name) =>
      GENERATION_FILE_RE.test(name) && name !== `${currentStartTime}.json`
    )
    .toSorted((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));
}

export function filesToPrune(
  names: string[],
  currentStartTime: string | null,
): string[] {
  return generationFiles(names, currentStartTime).slice(KEPT_GENERATIONS);
}

// tmux expands formats in -s, -n and -c, and takes an argument ending in `;` for
// a command separator, so a window named `build;` would fail the restore every
// time it was retried.
export function escapeArg(value: string): string {
  return value.replaceAll("#", "##").replace(/;$/, "\\;");
}

export function resumeCommand(agent: SnapshotAgent): string {
  switch (agent.kind) {
    case "claude":
      return `claude --resume ${agent.sessionId}`;
    case "codex":
      return `codex resume ${agent.sessionId}`;
    case "opencode":
      return `opencode --session ${agent.sessionId}`;
    default: {
      const unreachable: never = agent.kind;
      throw new Error(`unknown agent: ${unreachable}`);
    }
  }
}

const DIR_COLUMN_CELLS = 27;
const NAME_COLUMN_CELLS = 12;
const SHELLS = new Set(["zsh", "bash", "fish", "sh"]);

// Large enough never to cut anything: the width is cut by truncateToCells.
const clean = (value: string): string => truncate(value, 4096);

function formatSavedAt(sec: number): string {
  const date = new Date(sec * 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(date.getMonth() + 1)}/${two(date.getDate())} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}`;
}

function countAgents(snapshot: Snapshot): number {
  return snapshot.sessions.flatMap((s) => s.windows)
    .flatMap((w) => w.panes)
    .filter((p) => p.agent !== null).length;
}

function countWindows(snapshot: Snapshot): number {
  return snapshot.sessions.flatMap((s) => s.windows).length;
}

function displayPath(path: string, home: string): string {
  const tilde = path === home
    ? "~"
    : path.startsWith(`${home}/`)
    ? `~${path.slice(home.length)}`
    : path;
  if (stringCells(tilde) <= DIR_COLUMN_CELLS) return tilde;
  const prefix = tilde.startsWith("~") ? "~/.../" : "/.../";
  return truncateToCells(
    prefix + tilde.slice(tilde.lastIndexOf("/") + 1),
    DIR_COLUMN_CELLS,
  );
}

function padCells(value: string, cells: number): string {
  return value + " ".repeat(Math.max(0, cells - stringCells(value)));
}

function representativePane(window: SnapshotWindow): SnapshotPane {
  return window.panes.find((p) => p.agent !== null) ??
    window.panes.find((p) => p.active) ?? window.panes[0];
}

function runningLabel(pane: SnapshotPane): string {
  if (pane.agent !== null) return pane.agent.kind;
  return SHELLS.has(pane.command) ? "" : clean(pane.command);
}

function morePanesLabel(window: SnapshotWindow): string {
  return window.panes.length > 1 ? `+${window.panes.length - 1} ペイン` : "";
}

export function listLines(
  snapshot: Snapshot,
  opts: {
    home: string;
    columns: number;
    pathExists: (path: string) => boolean;
    running?: { windows: number; agents: number };
  },
): string[] {
  const windows = snapshot.sessions.flatMap((s) => s.windows);
  const nameCells = Math.min(
    NAME_COLUMN_CELLS,
    Math.max(...windows.map((w) => stringCells(clean(w.name)))),
  );
  const indexChars = Math.max(...windows.map((w) => String(w.index).length));
  const runningCells = Math.max(
    ...windows.map((w) => stringCells(runningLabel(representativePane(w)))),
  );
  const moreCells = Math.max(
    ...windows.map((w) => stringCells(morePanesLabel(w))),
  );

  const row = (window: SnapshotWindow): string => {
    const pane = representativePane(window);
    const cells = [
      ` ${String(window.index).padStart(indexChars)}`,
      padCells(truncateToCells(clean(window.name), nameCells), nameCells),
      "",
      padCells(
        displayPath(clean(pane.path), opts.home),
        DIR_COLUMN_CELLS,
      ),
      "",
      padCells(runningLabel(pane), runningCells),
      "",
      padCells(morePanesLabel(window), moreCells),
      "",
      clean(pane.agent?.prompt ?? ""),
    ].join(" ").trimEnd();
    return truncateToCells(cells, opts.columns);
  };

  const lines = [
    `保存: ${formatSavedAt(snapshot.savedAtSec)}` +
    `（${countWindows(snapshot)} ウィンドウ、エージェント ${
      countAgents(snapshot)
    }）`,
  ];
  for (const session of snapshot.sessions) {
    if (snapshot.sessions.length > 1) lines.push(`[${clean(session.name)}]`);
    lines.push(...session.windows.map(row));
  }
  if (opts.running !== undefined) {
    lines.push(
      `! 実行中の ${opts.running.windows} ウィンドウを閉じます` +
        `（エージェント ${opts.running.agents}）`,
    );
  }
  for (const window of windows) {
    for (const pane of window.panes) {
      if (opts.pathExists(pane.path)) continue;
      lines.push(
        `! ${clean(window.name)}.${pane.index}: ${
          clean(pane.path)
        } がありません`,
      );
    }
  }
  return lines;
}

export function generationLine(n: number, snapshot: Snapshot | null): string {
  if (snapshot === null) return ` ${n} 読めません`;
  return ` ${n} ${formatSavedAt(snapshot.savedAtSec)}  ` +
    `${countWindows(snapshot)} ウィンドウ、エージェント ${
      countAgents(snapshot)
    }`;
}

// The rename is what keeps a crash mid-write from costing the previous snapshot,
// the one a reboot would otherwise have to restore from.
export async function writeSnapshotFile(
  dir: string,
  snapshot: Snapshot,
): Promise<void> {
  const parsed = SnapshotSchema.parse(snapshot);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, `${parsed.serverStartTime}.json`);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(parsed), { mode: 0o600 });
  await rename(temp, target);
}

// ---- tmux I/O (impure) ----

// `no server running` is a socket with nothing behind it, `error connecting ...
// No such file` a socket that was never there, which is the state right after a
// reboot. Anything else, `Permission denied` included, is a real failure.
export function isNoServerError(stderr: string): boolean {
  return stderr.includes("no server running on") ||
    (stderr.includes("error connecting to") &&
      stderr.includes("No such file or directory"));
}

async function tmux(args: string[]): Promise<string> {
  const { code, stdout, stderr } = await run("tmux", tmuxArgs(args));
  if (code !== 0) {
    throw new Error(`tmux ${args.join(" ")}: ${stderr.trim()}`);
  }
  return stdout;
}

async function currentServer(): Promise<string | null> {
  const { code, stdout, stderr } = await run(
    "tmux",
    tmuxArgs(["display", "-p", "#{start_time}"]),
  );
  if (code === 0) return stdout.trim();
  if (isNoServerError(stderr)) return null;
  throw new Error(`tmux display: ${stderr.trim()}`);
}

async function isRestoring(): Promise<boolean> {
  const value = await tmux(["show-options", "-gqv", RESTORING_OPTION]);
  return value.trim() === "1";
}

async function captureSnapshot(startTime: string): Promise<Snapshot> {
  const panes = await tmux(["list-panes", "-a", "-F", PANE_SNAPSHOT_FORMAT]);
  const windows = await tmux(["list-windows", "-a", "-F", WINDOW_FORMAT]);
  return buildSnapshot({
    paneLines: panes.split("\n"),
    windowLines: windows.split("\n"),
    startTime: Number(startTime),
    nowSec: Math.floor(Date.now() / 1000),
  });
}

function homeDir(): string {
  const home = process.env.HOME;
  if (!home) throw new Error("HOME is not set");
  return home;
}

function snapshotDir(): string {
  return join(homeDir(), ".local/state/agentower/snapshots");
}

async function runSnapshot(): Promise<number> {
  const startTime = await currentServer();
  if (startTime === null) return 0;
  if (await isRestoring()) {
    console.error("復元中のため保存を飛ばしました");
    return 0;
  }
  const dir = snapshotDir();
  await writeSnapshotFile(dir, await captureSnapshot(startTime));
  const stale = filesToPrune(await readdir(dir), startTime);
  await Promise.all(stale.map((name) => rm(join(dir, name), { force: true })));
  return 0;
}

async function savedFiles(
  dir: string,
  current: string | null,
): Promise<string[]> {
  const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return generationFiles(names, current);
}

async function runList(): Promise<number> {
  const dir = snapshotDir();
  const files = await savedFiles(dir, await currentServer());
  if (files.length === 0) {
    console.log("保存がありません");
    return 0;
  }
  for (const [i, file] of files.entries()) {
    const snapshot = await readFile(join(dir, file), "utf8")
      .then(parseSnapshot)
      .catch(() => null);
    console.log(generationLine(i + 1, snapshot));
  }
  return 0;
}

async function loadGeneration(
  dir: string,
  files: string[],
  generation: number,
): Promise<Snapshot> {
  if (files.length === 0) throw new Error("保存がありません");
  const file = files[generation - 1];
  if (file === undefined) {
    throw new Error(
      `世代 ${generation} はありません（1 から ${files.length}）`,
    );
  }
  const path = join(dir, file);
  try {
    return parseSnapshot(await readFile(path, "utf8"));
  } catch {
    throw new Error(`読めません: ${path}`);
  }
}

// Any failure counts as gone: a path that cannot be read must open at home like a
// missing one, not stop the whole generation from restoring.
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// run() closes the child's stdin, and `tty` then answers `not a tty`: the check
// would pass and kill-server would take this process with it.
function ownTty(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("tty", [], { stdio: ["inherit", "pipe", "ignore"] });
    let out = "";
    child.stdout!.on("data", (chunk: Buffer) => out += chunk);
    child.on("error", reject);
    child.on("close", () => resolve(out.trim()));
  });
}

async function isInsideServer(): Promise<boolean> {
  const panes = await tmux(["list-panes", "-a", "-F", "#{pane_tty}"]);
  return panes.split("\n").includes(await ownTty());
}

function readAnswer(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.once("close", () => resolve(""));
    rl.question(prompt, (answer) => {
      resolve(answer);
      rl.close();
    });
  });
}

export function isConfirmed(answer: string): boolean {
  return /^y(es)?$/i.test(answer.trim());
}

async function runRestore(generation: number): Promise<number> {
  const home = homeDir();
  const current = await currentServer();
  const dir = snapshotDir();
  const snapshot = await loadGeneration(
    dir,
    await savedFiles(dir, current),
    generation,
  );
  if (!process.stdin.isTTY) {
    throw new Error("確認の入力には端末が必要です");
  }
  let running: { windows: number; agents: number } | undefined;
  if (current !== null) {
    if (await isInsideServer()) {
      throw new Error("tmux の外で実行してください");
    }
    const live = await captureSnapshot(current);
    running = { windows: countWindows(live), agents: countAgents(live) };
  }
  const lines = listLines(snapshot, {
    home,
    columns: process.stdout.columns || 100,
    pathExists: isDirectory,
    running,
  });
  console.log(lines.join("\n"));
  if (!isConfirmed(await readAnswer("復元しますか？ [y/N] "))) {
    console.log("取り消しました");
    return 0;
  }

  // A server left by a failed restore is not worth a generation of its own.
  const replaced = current !== null && !(await isRestoring());
  if (replaced) await writeSnapshotFile(dir, await captureSnapshot(current));
  if (current !== null) await stopServer();
  let target: string;
  try {
    target = await buildServer(snapshot, home);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retry = replaced ? generation + 1 : generation;
    throw new Error(
      `${message}\n` +
        `\`agentower --restore ${retry}\` で再実行するか、` +
        "`tmux kill-server` で途中のサーバーを閉じてください",
    );
  }
  return await attach(target);
}

// kill-server returns before the server has gone, and a client connecting in
// that window gets `server exited unexpectedly`.
async function stopServer(): Promise<void> {
  await tmux(["kill-server"]);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { code, stderr } = await run(
      "tmux",
      tmuxArgs(["display", "-p", "#{start_time}"]),
    );
    if (code !== 0 && isNoServerError(stderr)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("tmux サーバーが終了しませんでした");
}

function startDir(path: string, home: string): string {
  return isDirectory(path) ? path : home;
}

interface PlacedPane {
  id: string;
  pane: SnapshotPane;
}

interface PlacedWindow {
  id: string;
  window: SnapshotWindow;
  panes: PlacedPane[];
}

// Splitting the previous pane keeps creation order equal to pane index; the
// select-layout then assigns cells in that order. tiled makes room as it goes:
// without it the fifth split of a 24-line window has no space left.
async function buildPanes(
  firstPane: string,
  window: SnapshotWindow,
  home: string,
): Promise<PlacedPane[]> {
  const ids = [firstPane];
  for (const pane of window.panes.slice(1)) {
    const id = (await tmux([
      "split-window",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      ids[ids.length - 1],
      "-c",
      escapeArg(startDir(pane.path, home)),
    ])).trim();
    await tmux(["select-layout", "-t", id, "tiled"]);
    ids.push(id);
  }
  await tmux(["select-layout", "-t", firstPane, window.layout]);
  if (window.automaticRename) {
    await tmux(["set-option", "-w", "-t", firstPane, "automatic-rename", "on"]);
  }
  return window.panes.map((pane, i) => ({ id: ids[i], pane }));
}

// The window size is left alone: resize-window would pin it to `manual` and the
// window would stop following the terminal once attached. -x and -y only have to
// be large enough for the splits.
async function buildSession(
  session: Snapshot["sessions"][number],
  opts: { home: string; markRestoring: boolean },
): Promise<{ id: string; windows: PlacedWindow[] }> {
  const [first, ...rest] = session.windows;
  const created = await tmux([
    "new-session",
    "-d",
    "-P",
    "-F",
    "#{session_id} #{window_id} #{pane_id} #{window_index}",
    "-s",
    escapeArg(session.name),
    "-n",
    escapeArg(first.name),
    "-c",
    escapeArg(startDir(first.panes[0].path, opts.home)),
    "-x",
    String(Math.max(...session.windows.map((w) => w.width))),
    "-y",
    String(Math.max(...session.windows.map((w) => w.height))),
    // In one invocation so a --snapshot cannot run between the two and save a
    // half-built server.
    ...(opts.markRestoring
      ? [";", "set-option", "-g", RESTORING_OPTION, "1"]
      : []),
  ]);
  const [id, firstWindow, firstPane, firstIndex] = created.trim().split(" ");
  // Before the other windows exist, or saved indexes 0,1 would meet the window
  // that base-index 1 put at 1.
  if (Number(firstIndex) !== first.index) {
    await tmux([
      "move-window",
      "-s",
      firstWindow,
      "-t",
      `${id}:${first.index}`,
    ]);
  }

  const windows = [{
    id: firstWindow,
    window: first,
    panes: await buildPanes(firstPane, first, opts.home),
  }];
  for (const window of rest) {
    const line = await tmux([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{window_id} #{pane_id}",
      "-t",
      `${id}:${window.index}`,
      "-n",
      escapeArg(window.name),
      "-c",
      escapeArg(startDir(window.panes[0].path, opts.home)),
    ]);
    const [windowId, paneId] = line.trim().split(" ");
    windows.push({
      id: windowId,
      window,
      panes: await buildPanes(paneId, window, opts.home),
    });
  }
  return { id, windows };
}

// Written here as well as by the agent's hooks: opencode may not register until
// the first prompt, and the next snapshot would otherwise lose the agent.
async function resumeAgent({ id, pane }: PlacedPane): Promise<void> {
  const { agent } = pane;
  if (agent === null) return;
  const options = [
    ["@pane_agent", agent.kind],
    ["@pane_session_id", agent.sessionId],
    ...(agent.userLabel === "" ? [] : [
      ["@pane_user_label", agent.userLabel],
      ["@pane_user_label_session", agent.sessionId],
    ]),
  ];
  for (const [key, value] of options) {
    await tmux(["set-option", "-p", "-t", id, key, value]);
  }
  // Typed into the pane's shell rather than run as its command, so the shell is
  // still there when the agent exits.
  await tmux(["send-keys", "-t", id, "-l", resumeCommand(agent)]);
  if (isDirectory(pane.path)) await tmux(["send-keys", "-t", id, "Enter"]);
}

async function restoreFocus(windows: PlacedWindow[]): Promise<void> {
  for (const { window, panes } of windows) {
    const active = panes.find((p) => p.pane.active) ?? panes[0];
    await tmux(["select-pane", "-t", active.id]);
    if (window.zoomed) await tmux(["resize-pane", "-Z", "-t", active.id]);
  }
  const activeWindow = windows.find((w) => w.window.active) ?? windows[0];
  await tmux(["select-window", "-t", activeWindow.id]);
}

async function buildServer(snapshot: Snapshot, home: string): Promise<string> {
  const sessions = [];
  for (const [i, session] of snapshot.sessions.entries()) {
    const built = await buildSession(session, { home, markRestoring: i === 0 });
    sessions.push({ ...built, lastAttachedSec: session.lastAttachedSec });
  }
  for (const { windows } of sessions) {
    for (const { panes } of windows) {
      for (const pane of panes) await resumeAgent(pane);
    }
    await restoreFocus(windows);
  }
  await tmux(["set-option", "-gu", RESTORING_OPTION]);
  const [target] = sessions.toSorted((a, b) =>
    (b.lastAttachedSec ?? -1) - (a.lastAttachedSec ?? -1)
  );
  return target.id;
}

function attach(sessionId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "tmux",
      tmuxArgs(["attach-session", "-t", sessionId]),
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

const USAGE =
  "usage: agentower --snapshot | --restore [<n>] | --restore --list";

export async function runRestoreCli(argv: string[]): Promise<number> {
  // An inherited TMUX points every tmux call at that socket, and refuses the
  // attach as nested, even from a terminal that is outside tmux.
  delete process.env.TMUX;
  delete process.env.TMUX_PANE;
  const command = parseCliArgs(argv);
  if (command === null) {
    console.error(USAGE);
    return 1;
  }
  try {
    switch (command.kind) {
      case "snapshot":
        return await runSnapshot();
      case "list":
        return await runList();
      case "restore":
        return await runRestore(command.generation);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}
