// Embedded-agent detection for tmux pane-status writers.
//
// When a Claude / Codex / opencode hook fires, the writer must skip pane writes
// if the firing process is itself running under a different agent's process tree
// (e.g. codex spawned via Claude's `/codex-cli` skill). Without this gate the
// embedded session's lifecycle hooks overwrite @pane_* options that belong to
// the outer agent, and the picker shows the wrong status.
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
