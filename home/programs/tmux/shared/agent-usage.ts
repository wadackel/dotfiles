// Cross-session rate-limit usage SSOT. Written by statusline.sh (Claude, via
// jq) and codex-pane-status.ts (Codex, via writeAgentUsage), read by the tmux
// picker to render its bottom usage footer. Reachable from ~/.codex/ through
// the same in-worktree symlink + home-manager wiring as pane-shared.ts.
//
// Unlike pane-shared.ts, this module DOES use Deno.* — file I/O is its whole
// point, and no Bun-hosted caller imports it (opencode has no rolling-window
// limits, so it is not covered here).
//
// No import statements. A relative import here would resolve against
// ~/.codex/ when Codex loads this file through its symlink, not against the
// real directory — the same constraint that keeps pane-shared.ts import-free.

// --- Schema ---

export type UsageAgent = "claude" | "codex";

export interface UsageWindow {
  label: string;
  usedPct: number;
  resetsAt: number;
}

export interface AgentUsage {
  agent: string;
  updatedAt: number;
  windows: UsageWindow[];
}

// --- Freshness ---

// A 5h window advances ~1% every 3 minutes, so anything coarser than this is
// old enough that showing the number without a caveat would mislead.
export const STALE_AFTER_SEC = 15 * 60;

export function isWindowExpired(w: UsageWindow, nowSec: number): boolean {
  return w.resetsAt <= nowSec;
}

export function isUsageStale(usage: AgentUsage, nowSec: number): boolean {
  return nowSec - usage.updatedAt >= STALE_AFTER_SEC;
}

// --- Normalization ---

// Codex reports window sizes in minutes rather than naming them, so its writer
// maps them here. The Claude side names its windows already and spells the same
// two labels directly into its jq expression — keeping the vocabulary in one
// place would mean giving bash a way to call TypeScript.
export function labelFromWindowMinutes(minutes: number): string {
  if (minutes === 300) return "5h";
  if (minutes === 10080) return "7d";
  return `${minutes}m`;
}

// --- Paths ---

// XDG_STATE_HOME is deliberately not consulted: codex-pane-status.ts runs with
// --allow-env=HOME,TMUX_PANE, so reading it would throw NotCapable inside a
// hook whose failures are invisible.
export function usageDir(homeDir: string): string {
  return `${homeDir}/.local/state/agent-usage`;
}

export function usageFilePath(homeDir: string, agent: UsageAgent): string {
  return `${usageDir(homeDir)}/${agent}.json`;
}

// --- Read ---

// The label reaches the terminal verbatim, so a stray newline in it would make
// the footer two rows tall and break the layout arithmetic that reserves
// exactly one. Percentages outside 0–100 are equally untrustworthy: the picker
// would happily render "412%". Exported so writers can screen a derived label
// before emitting it — a rejection here costs the whole file, not one window.
export const USAGE_LABEL_RE = /^[0-9a-z]{1,8}$/;

// Both writers emit a few hundred bytes and at most two windows. The ceilings
// exist for what the picker does on the read side: it re-reads on every tick,
// where readTextFile against a FIFO would hang the frame forever and a bloated
// windows array would be re-tokenized once a second.
const MAX_USAGE_BYTES = 64 * 1024;
const MAX_WINDOWS = 8;

function isUsageWindow(v: unknown): v is UsageWindow {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const w = v as Record<string, unknown>;
  return typeof w.label === "string" && USAGE_LABEL_RE.test(w.label) &&
    typeof w.usedPct === "number" && Number.isFinite(w.usedPct) &&
    w.usedPct >= 0 && w.usedPct <= 100 &&
    typeof w.resetsAt === "number" && Number.isFinite(w.resetsAt);
}

function isAgentUsage(v: unknown): v is AgentUsage {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const u = v as Record<string, unknown>;
  if (typeof u.agent !== "string") return false;
  if (typeof u.updatedAt !== "number" || !Number.isFinite(u.updatedAt)) {
    return false;
  }
  return Array.isArray(u.windows) && u.windows.length <= MAX_WINDOWS &&
    u.windows.every(isUsageWindow);
}

// Never throws: the picker calls this inside a tick whose single try block also
// guards the pane refresh, so an exception here would stall the whole list.
export async function readAgentUsage(
  homeDir: string,
  agent: UsageAgent,
): Promise<AgentUsage | null> {
  try {
    const path = usageFilePath(homeDir, agent);
    // stat before read: readTextFile on a FIFO never returns, and the picker
    // awaits this before its first frame.
    const stat = await Deno.stat(path);
    if (!stat.isFile || stat.size > MAX_USAGE_BYTES) return null;
    const raw: unknown = JSON.parse(await Deno.readTextFile(path));
    if (!isAgentUsage(raw)) return null;
    // A body that disagrees with its own filename would render the wrong label
    // in the footer — two "codex" segments, say. Neither side is trustworthy
    // enough to pick a winner, so treat the file as corrupt.
    return raw.agent === agent ? raw : null;
  } catch {
    return null;
  }
}

// --- Write ---

// The temp file goes next to the target rather than through
// Deno.makeTempFile(): TMPDIR is outside codex-pane-status.ts's --allow-env
// scope, and rename is only atomic within one filesystem. The pid suffix keeps
// concurrent writers — several Codex hooks, several Claude statusline renders —
// from truncating each other's temp before the rename lands.
// Exported so both properties are testable without racing an actual write.
export function usageTempPath(
  homeDir: string,
  agent: UsageAgent,
  pid: number,
): string {
  return `${usageFilePath(homeDir, agent)}.${pid}.tmp`;
}

export async function writeAgentUsage(
  homeDir: string,
  agent: UsageAgent,
  usage: AgentUsage,
): Promise<void> {
  const temp = usageTempPath(homeDir, agent, Deno.pid);
  await Deno.mkdir(usageDir(homeDir), { recursive: true });
  try {
    await Deno.writeTextFile(temp, `${JSON.stringify(usage)}\n`);
    await Deno.rename(temp, usageFilePath(homeDir, agent));
  } catch (e) {
    // The sole caller swallows write failures, so a leftover temp would sit in
    // the state dir unnoticed until a pid happened to repeat.
    await Deno.remove(temp).catch(() => {});
    throw e;
  }
}
