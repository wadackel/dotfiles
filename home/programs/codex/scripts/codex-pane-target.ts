import { spawn } from "node:child_process";
import { constants } from "node:os";
import {
  AGENT_NAMES as AGENTS,
  CODEX_UUID_PATTERN,
  parseProcesses as processes,
  parseTitleIdentity,
  processAncestry as ancestry,
  topLevelCodexPid,
} from "../../tmux/shared/agent-presence.ts";
export { parseTitleIdentity } from "../../tmux/shared/agent-presence.ts";

const UUID_RE = new RegExp(`^${CODEX_UUID_PATTERN}$`);

export interface PaneTarget {
  paneId: string;
  panePid: number;
  tuiPid: number;
  sessionId: string;
  source: "title" | "direct";
}

export type TargetCommand = (
  cmd: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface TargetResolution {
  targets: PaneTarget[];
  reason: string;
}

export const runTargetCommand: TargetCommand = async (cmd, args) => {
  try {
    const output = await new Promise<
      { code: number; stdout: Buffer; stderr: Buffer }
    >((resolve, reject) => {
      const child = spawn(cmd, args, {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 500,
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
      child.on("error", reject);
      child.on("close", (code, signal) =>
        resolve({
          code: code ?? 128 + (signal ? constants.signals[signal] : 0),
          stdout: Buffer.concat(out),
          stderr: Buffer.concat(err),
        }));
    });
    return {
      code: output.code,
      stdout: new TextDecoder().decode(output.stdout).trim(),
      stderr: new TextDecoder().decode(output.stderr).trim(),
    };
  } catch (error) {
    return { code: 1, stdout: "", stderr: String(error) };
  }
};

export class CodexPaneResolver {
  readonly tmuxPath: string;
  readonly tmuxArgs: string[];
  private readonly run: TargetCommand;
  private readonly codexHome: string;
  private readonly callerPid: number;

  constructor(options: {
    codexHome: string;
    tmuxPath?: string;
    tmuxArgs?: string[];
    run?: TargetCommand;
    callerPid?: number;
  }) {
    this.codexHome = options.codexHome;
    this.tmuxPath = options.tmuxPath ?? "tmux";
    // A shared daemon retains the socket of whichever terminal first launched it.
    this.tmuxArgs = options.tmuxArgs ?? ["-L", "default"];
    this.run = options.run ?? runTargetCommand;
    this.callerPid = options.callerPid ?? process.pid;
  }

  private async query(sql: string): Promise<Array<{ id: string }>> {
    const result = await this.run("/usr/bin/sqlite3", [
      "-readonly",
      "-json",
      `${this.codexHome}/state_5.sqlite`,
      sql,
    ]);
    if (result.code !== 0) throw new Error("database-unavailable");
    const rows: unknown = JSON.parse(result.stdout || "[]");
    if (
      !Array.isArray(rows) ||
      rows.some((r) => !r || typeof r.id !== "string" || !UUID_RE.test(r.id))
    ) throw new Error("database-schema-mismatch");
    return rows;
  }

  private async threadChain(id: string): Promise<string[]> {
    const rows = await this.query(
      `WITH RECURSIVE ancestors(id, depth) AS (
        VALUES ('${id}', 0)
        UNION ALL
        SELECT parent_thread_id, depth + 1 FROM thread_spawn_edges
        JOIN ancestors ON child_thread_id = ancestors.id WHERE depth < 32
      ) SELECT id FROM ancestors ORDER BY depth`,
    );
    const ids = rows.map((r) => r.id);
    if (ids.length > 32 || new Set(ids).size !== ids.length) {
      throw new Error("invalid-parent-chain");
    }
    return ids;
  }

  private async expandIdentity(reference: string): Promise<string | null> {
    if (UUID_RE.test(reference)) return reference;
    const rows = await this.query(
      `SELECT id FROM threads WHERE id >= '${reference}' AND id < '${reference}g' LIMIT 2`,
    );
    if (rows.length > 1) throw new Error("ambiguous-title-id");
    return rows[0]?.id ?? null;
  }

  async resolve(sessionId: string): Promise<TargetResolution> {
    if (!UUID_RE.test(sessionId)) {
      return { targets: [], reason: "invalid-session-id" };
    }
    const [panes, ps] = await Promise.all([
      this.run(this.tmuxPath, [
        ...this.tmuxArgs,
        "list-panes",
        "-a",
        "-F",
        "#{pane_id}\x1f#{pane_pid}\x1f#{pane_current_command}\x1f#{pane_title}",
      ]),
      this.run("ps", ["-A", "-o", "pid=,ppid=,comm="]),
    ]);
    if (panes.code !== 0 || ps.code !== 0) {
      return { targets: [], reason: "pane-snapshot-failed" };
    }
    const procs = processes(ps.stdout);
    const callerChain = ancestry(this.callerPid, procs);
    const targets: PaneTarget[] = [];
    let threadChain: string[] | undefined;
    let failure: string | undefined;
    for (const line of panes.stdout.split("\n")) {
      const [paneId, rawPid, command, title] = line.split("\x1f");
      if (!/^%\d+$/.test(paneId) || !/^\d+$/.test(rawPid)) continue;
      if (command !== "codex" && command !== ".codex-wrapped") continue;
      const panePid = Number(rawPid);
      const tuiPid = topLevelCodexPid(panePid, procs);
      if (tuiPid === null) continue;
      const reference = parseTitleIdentity(title ?? "");
      if (!reference) {
        // The hook's ancestry proves ownership only when it runs inside this TUI.
        if (
          callerChain.some((p) => p.pid === tuiPid) &&
          callerChain.filter((p) => AGENTS.has(p.name)).length === 1
        ) {
          targets.push({
            paneId,
            panePid,
            tuiPid,
            sessionId,
            source: "direct",
          });
        }
        continue;
      }
      try {
        threadChain ??= await this.threadChain(sessionId);
        const displayed = await this.expandIdentity(reference);
        if (displayed && threadChain.includes(displayed)) {
          targets.push({
            paneId,
            panePid,
            tuiPid,
            sessionId: displayed,
            source: "title",
          });
        }
      } catch (error) {
        failure = error instanceof Error
          ? error.message
          : "target-resolution-failed";
      }
    }
    return {
      targets,
      reason: targets.length ? "resolved" : failure ?? "no-matching-pane",
    };
  }

  async isCurrent(target: PaneTarget, sessionId: string): Promise<boolean> {
    return (await this.resolve(sessionId)).targets.some((next) =>
      next.paneId === target.paneId && next.panePid === target.panePid &&
      next.tuiPid === target.tuiPid && next.sessionId === target.sessionId &&
      next.source === target.source
    );
  }
}
