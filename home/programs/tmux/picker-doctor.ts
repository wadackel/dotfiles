#!/usr/bin/env -S deno run --allow-env=HOME --allow-run=tmux,ps --allow-read

// Diagnostic snapshot for the tmux Claude Code session picker.
//
// Run this when the picker (prefix+w) is missing a pane that has Claude Code
// running. It enumerates every tmux pane, walks each pane's descendant
// processes, and classifies whether the pane matches what the picker expects:
//
//   OK                    — @pane_agent == "claude" AND claude descendant found
//   SUSPECT_MISSING_FLAG  — claude descendant found but @pane_agent != "claude"
//                           (the invisible-in-picker signature — the picker's
//                            filter in picker.tsx is `row.agent === "claude"`)
//   STALE_FLAG            — @pane_agent == "claude" but no claude descendant
//                           (teardown failure or orphaned flag)
//   NORMAL                — neither condition — not a Claude Code pane
//
// Intentionally NOT a detection fallback for picker.tsx. If that were the goal
// we'd widen the picker filter; instead we keep picker's single-predicate SSOT
// and use this tool to diagnose why the SSOT is out of sync with reality.

import {
  type PaneRow,
  parseRow,
  TMUX_FORMAT,
} from "./pane_row.ts";

// --- Types ---

export type Category =
  | "OK"
  | "SUSPECT_MISSING_FLAG"
  | "STALE_FLAG"
  | "NORMAL";

export interface ProcInfo {
  pid: number;
  ppid: number;
  command: string;
}

export interface PaneReport {
  row: PaneRow;
  panePid: number;
  category: Category;
  claudeDescendantPids: number[];
}

// --- Pure helpers (exported for tests) ---

// True when `cmd` (full ps command line) mentions claude as a path component
// or a bare token. Deliberately substring-based, not shell-lex: we're not
// interpreting the command, just checking tokens.
export function isClaudeCommand(cmd: string): boolean {
  for (const word of cmd.split(/\s+/)) {
    for (const seg of word.split("/")) {
      if (seg === "claude") return true;
      if (seg.includes("claude-code") || seg.includes("claude_code")) {
        return true;
      }
    }
  }
  return false;
}

// Parse `ps -A -o pid,ppid,command` output. Header line and blank lines are
// dropped. Command column is taken verbatim (spaces preserved) via the
// first-two-columns-then-rest split.
export function parsePsOutput(raw: string): ProcInfo[] {
  const result: ProcInfo[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trimStart();
    if (!trimmed) continue;
    if (trimmed.startsWith("PID")) continue; // header
    const m = trimmed.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    result.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      command: m[3],
    });
  }
  return result;
}

// PPID → [child pid] map. One pass, O(n).
export function buildChildMap(procs: ProcInfo[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const p of procs) {
    const list = map.get(p.ppid);
    if (list) list.push(p.pid);
    else map.set(p.ppid, [p.pid]);
  }
  return map;
}

// BFS from rootPid (inclusive? — no, descendants only). Cycle-safe via visited.
export function descendants(
  rootPid: number,
  childMap: Map<number, number[]>,
): Set<number> {
  const out = new Set<number>();
  const queue = [...(childMap.get(rootPid) ?? [])];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (out.has(pid)) continue;
    out.add(pid);
    for (const child of childMap.get(pid) ?? []) queue.push(child);
  }
  return out;
}

// Collect descendant PIDs of `rootPid` whose `command` looks like Claude Code.
// Returns the PID list (may be empty).
export function findClaudeDescendants(
  rootPid: number,
  procs: ProcInfo[],
  childMap: Map<number, number[]>,
): number[] {
  const descPids = descendants(rootPid, childMap);
  const byPid = new Map<number, ProcInfo>();
  for (const p of procs) byPid.set(p.pid, p);
  const hits: number[] = [];
  for (const pid of descPids) {
    const proc = byPid.get(pid);
    if (proc && isClaudeCommand(proc.command)) hits.push(pid);
  }
  return hits;
}

export function classifyPane(
  row: PaneRow,
  hasClaudeDescendant: boolean,
): Category {
  const flagged = row.agent === "claude";
  if (flagged && hasClaudeDescendant) return "OK";
  if (!flagged && hasClaudeDescendant) return "SUSPECT_MISSING_FLAG";
  if (flagged && !hasClaudeDescendant) return "STALE_FLAG";
  return "NORMAL";
}

// --- tmux / ps I/O ---

interface TmuxRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(cmd: string, args: string[]): Promise<TmuxRunResult> {
  const { code, stdout, stderr } = await new Deno.Command(cmd, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return {
    code,
    stdout: dec.decode(stdout),
    stderr: dec.decode(stderr),
  };
}

async function fetchPanesWithPid(): Promise<
  Array<{ row: PaneRow; panePid: number }>
> {
  const format = TMUX_FORMAT + "\x1f#{pane_pid}";
  const res = await run("tmux", ["list-panes", "-a", "-F", format]);
  if (res.code !== 0) {
    throw new Error(`tmux list-panes failed: ${res.stderr.trim()}`);
  }
  const out: Array<{ row: PaneRow; panePid: number }> = [];
  for (const line of res.stdout.split("\n")) {
    if (!line) continue;
    const lastSep = line.lastIndexOf("\x1f");
    if (lastSep < 0) continue;
    const base = line.substring(0, lastSep);
    const pidStr = line.substring(lastSep + 1);
    const row = parseRow(base);
    if (!row) continue;
    const panePid = Number(pidStr);
    if (!Number.isFinite(panePid) || panePid <= 0) continue;
    out.push({ row, panePid });
  }
  return out;
}

async function fetchAllProcs(): Promise<ProcInfo[]> {
  const res = await run("ps", ["-A", "-o", "pid,ppid,command"]);
  if (res.code !== 0) {
    throw new Error(`ps failed: ${res.stderr.trim()}`);
  }
  return parsePsOutput(res.stdout);
}

async function readLogTail(maxLines: number): Promise<string[]> {
  const home = Deno.env.get("HOME");
  if (!home) return [];
  const path = `${home}/.claude/logs/claude-pane-status.log`;
  try {
    const text = await Deno.readTextFile(path);
    const lines = text.split("\n").filter((l) => l.length > 0);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

// --- Reporting ---

// Pad/truncate `s` into exactly `width` characters, always leaving the final
// character as a space so adjacent columns never run together. Strings at or
// beyond the cap get a single-char ellipsis before the space.
function pad(s: string, width: number): string {
  if (s.length <= width - 1) {
    return s + " ".repeat(width - s.length);
  }
  return s.slice(0, width - 2) + "… ";
}

function formatReport(reports: PaneReport[]): string {
  const lines: string[] = [];
  lines.push(
    pad("pane", 8) + pad("target", 20) + pad("cmd", 16) + pad("agent", 9) +
      pad("status", 10) + "category",
  );
  for (const r of reports) {
    const agent = r.row.agent || "-";
    const status = r.row.status || "-";
    let suffix = "";
    if (r.category === "SUSPECT_MISSING_FLAG") {
      suffix = ` (claude pid=${r.claudeDescendantPids.join(",")})`;
    } else if (r.category === "STALE_FLAG") {
      suffix = " (no claude descendant)";
    }
    lines.push(
      pad(r.row.paneId, 8) +
        pad(r.row.target, 20) +
        pad(r.row.currentCommand, 16) +
        pad(agent, 9) +
        pad(status, 10) +
        r.category + suffix,
    );
  }
  return lines.join("\n");
}

function summarize(reports: PaneReport[]): string {
  const counts: Record<Category, number> = {
    OK: 0,
    SUSPECT_MISSING_FLAG: 0,
    STALE_FLAG: 0,
    NORMAL: 0,
  };
  for (const r of reports) counts[r.category]++;
  return `Summary: ${reports.length} panes | OK:${counts.OK} | SUSPECT_MISSING_FLAG:${counts.SUSPECT_MISSING_FLAG} | STALE_FLAG:${counts.STALE_FLAG} | NORMAL:${counts.NORMAL}`;
}

// --- Main ---

interface CliOptions {
  json: boolean;
  withLogs: boolean;
  logLines: number;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { json: false, withLogs: false, logLines: 50 };
  for (const a of argv) {
    if (a === "--json") opts.json = true;
    else if (a === "--with-logs") opts.withLogs = true;
    else if (a.startsWith("--log-lines=")) {
      const n = Number(a.substring("--log-lines=".length));
      if (Number.isFinite(n) && n > 0) opts.logLines = n;
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(Deno.args);
  const [panes, procs] = await Promise.all([
    fetchPanesWithPid(),
    fetchAllProcs(),
  ]);
  const childMap = buildChildMap(procs);
  const reports: PaneReport[] = panes.map(({ row, panePid }) => {
    const claudeDescendantPids = findClaudeDescendants(
      panePid,
      procs,
      childMap,
    );
    return {
      row,
      panePid,
      category: classifyPane(row, claudeDescendantPids.length > 0),
      claudeDescendantPids,
    };
  });

  if (opts.json) {
    for (const r of reports) {
      const line = JSON.stringify({
        pane_id: r.row.paneId,
        target: r.row.target,
        pane_pid: r.panePid,
        current_command: r.row.currentCommand,
        agent: r.row.agent,
        status: r.row.status,
        session_id: r.row.sessionId,
        category: r.category,
        claude_descendant_pids: r.claudeDescendantPids,
      });
      console.log(line);
    }
    return;
  }

  // Sort so invisible/stale entries float up where they're easy to spot.
  const weight: Record<Category, number> = {
    SUSPECT_MISSING_FLAG: 0,
    STALE_FLAG: 1,
    OK: 2,
    NORMAL: 3,
  };
  reports.sort((a, b) => weight[a.category] - weight[b.category]);

  console.log(formatReport(reports));
  console.log("");
  console.log(summarize(reports));

  if (opts.withLogs) {
    const tail = await readLogTail(opts.logLines);
    console.log("");
    console.log(
      `--- claude-pane-status.log (last ${tail.length} lines) ---`,
    );
    for (const l of tail) console.log(l);
  } else {
    console.log("");
    console.log("(run with --with-logs to append recent hook log tail)");
  }
}

if (import.meta.main) {
  await main();
}
