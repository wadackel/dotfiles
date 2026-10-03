// Embedded-agent detection for tmux pane-status writers.
//
// When a Claude / Codex / opencode hook fires, the writer must skip pane writes
// if the firing process is itself running under a different agent's process tree
// (e.g. codex spawned via Claude's `/codex-cli` skill). Without this gate the
// embedded session's lifecycle hooks overwrite @pane_* options that belong to
// the outer agent, and Agentower shows the wrong status.
//
// Detection: walk the process ancestry via `ps -p PID -o ppid=,comm=` and count
// occurrences of known agent CLIs (`claude`, `codex`, `opencode`). The hook's
// own agent CLI is always one ancestor; a second match means we are embedded.

export const AGENT_NAMES: ReadonlySet<string> = new Set([
  "claude",
  "codex",
  "opencode",
]);

export interface PsRow {
  ppid: number;
  comm: string;
}

// Parse a single line of `ps -p <pid> -o ppid=,comm=` output.
// Inputs vary:
//   "62800 claude"
//   "  62800 /etc/profiles/per-user/wadackel/bin/codex  "
//   "1 (launchd)"   <- kernel-managed; never matches AGENT_NAMES, passed through.
export function parsePsLine(stdout: string): PsRow | null {
  const m = stdout.trim().match(/^(\d+)\s+(.+)$/);
  if (!m) return null;
  const comm = (m[2].trim().split("/").pop() ?? "").trim();
  return { ppid: Number(m[1]), comm };
}

// Walk ancestors from `startPid`, counting agent-CLI occurrences. Returns true
// (embedded) once a second match is seen. `getRow` is dependency-injected so
// tests can supply a synthetic ancestor map without spawning `ps`.
export async function isEmbedded(
  startPid: number,
  getRow: (pid: number) => Promise<PsRow | null>,
): Promise<boolean> {
  let pid = startPid;
  let agentCount = 0;
  for (let i = 0; i < 32; i++) {
    if (pid <= 1) break;
    const row = await getRow(pid);
    if (!row) break;
    if (AGENT_NAMES.has(row.comm)) {
      agentCount++;
      if (agentCount >= 2) return true;
    }
    pid = row.ppid;
  }
  return false;
}

export const CODEX_UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TITLE_ID_RE = new RegExp(
  `^codex \\| (${CODEX_UUID_PATTERN}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{5}\\.\\.\\.)(?= |$)`,
);

export function parseTitleIdentity(title: string): string | null {
  const normalized = title.replace(/^● /, "").replace(
    /^\[ [!.] \] Action Required \| /,
    "",
  );
  const id = TITLE_ID_RE.exec(normalized)?.[1];
  return id?.replace(/\.\.\.$/, "") ?? null;
}

export interface AgentProcess {
  pid: number;
  ppid: number;
  name: string;
}

export function parseProcesses(raw: string): Map<number, AgentProcess> {
  const result = new Map<number, AgentProcess>();
  for (const line of raw.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) continue;
    const name = match[3].split("/").at(-1)!.replace(
      /^\.(.+)-wrapp(?:ed)?$/,
      "$1",
    );
    const pid = Number(match[1]);
    result.set(pid, { pid, ppid: Number(match[2]), name });
  }
  return result;
}

export function processAncestry(
  pid: number,
  procs: Map<number, AgentProcess>,
): AgentProcess[] {
  const chain: AgentProcess[] = [];
  const visited = new Set<number>();
  while (pid > 1 && !visited.has(pid) && chain.length < 64) {
    visited.add(pid);
    const proc = procs.get(pid);
    if (!proc) break;
    chain.push(proc);
    pid = proc.ppid;
  }
  return chain;
}

export function topLevelCodexPid(
  panePid: number,
  procs: Map<number, AgentProcess>,
): number | null {
  const candidates = [...procs.values()].filter((p) => {
    if (p.name !== "codex") return false;
    const chain = processAncestry(p.pid, procs);
    return chain.some((a) => a.pid === panePid) &&
      chain.filter((a) => AGENT_NAMES.has(a.name)).length === 1;
  });
  return candidates.length === 1 ? candidates[0].pid : null;
}
