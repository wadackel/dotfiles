#!/usr/bin/env -S deno run --allow-read --allow-env

// PreToolUse hook (matcher: "Edit|Write|MultiEdit"):
// Gates edits to files under cwd on /plan-generated cwd-hash marker.
// - Marker files under ~/.claude/plans/ (basename matching .active-*, .pending-*, .bypass-plan-gate-*) are always denied.
// - Files under an infra allowlist (dotfiles/home/programs/claude/{CLAUDE.md,settings.json,scripts/**}) are always allowed.
// - Files outside cwd are always allowed.
// - Files under cwd require a valid cwd-hash marker at ~/.claude/plans/.active-<hash> (mtime < 24h).
// - Missing marker or expired marker → block with instruction to run `/plan`.

// --- Constants ---

const CWD_MARKER_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// infra allowlist: dotfiles 実ソース配下の CLAUDE.md / settings.json / scripts/** のみ対象。
// ~/.claude/** は nix store への read-only symlink なので編集不可、allowlist 対象外。
const INFRA_REGEX =
  /^\/Users\/[^/]+\/dotfiles\/home\/programs\/claude\/(CLAUDE\.md|settings\.json|scripts\/)/;

// --- Types ---

export interface HookInput {
  tool_input?: { file_path?: string };
  cwd?: string;
  session_id?: string;
}

export type GateDecision =
  | {
    kind: "allow";
    reason:
      | "missing-fields"
      | "infra"
      | "outside-cwd"
      | "marker-valid"
      | "bypass-valid";
  }
  | { kind: "block"; reason: string };

// AI cannot bypass the gate by writing marker files directly via Edit/Write.
// `~/.claude/plans/` is the gate's own state directory; only basenames matching
// a known marker pattern (.active-*, .pending-*, .bypass-plan-gate-*) are
// denied regardless of cwd / infra / marker state. Plan body markdown
// (`<slug>.md`, `<slug>.log.md`) is not a marker and falls through to the
// normal cwd / infra / marker / bypass evaluation. The legitimate marker
// writers (plan-marker.ts, bypass-plan-gate.ts) run via Bash, which this hook
// does not see.
const PLANS_MARKER_BASENAME_REGEX = /^\.(active|pending|bypass-plan-gate)-/;

export function plansDirPath(): string {
  return `${Deno.env.get("HOME") ?? ""}/.claude/plans`;
}

export function isPlansMarkerPath(abs: string): boolean {
  const dir = plansDirPath();
  if (!abs.startsWith(dir + "/")) {
    return false;
  }
  const basename = abs.slice(dir.length + 1);
  if (basename.includes("/")) {
    return false;
  }
  return PLANS_MARKER_BASENAME_REGEX.test(basename);
}

export interface BypassMarkerInfo {
  plansDir: string;
  path: string;
  cwdHash: string;
  sessionHash: string;
}

export interface BypassMarker {
  version: 1;
  createdAt: string;
  cwd: string;
  cwdHash: string;
  session_id: string;
  sessionHash: string;
  prompt: string;
}

// --- Helpers ---

export async function canonical(p: string): Promise<string> {
  try {
    return await Deno.realPath(p);
  } catch {
    return p;
  }
}

export function isInfraPath(abs: string): boolean {
  return INFRA_REGEX.test(abs);
}

export async function isUnderCwd(
  filePath: string,
  cwd: string,
): Promise<boolean> {
  const absFile = await canonical(
    filePath.startsWith("/") ? filePath : `${cwd}/${filePath}`,
  );
  const absCwd = await canonical(cwd);
  return absFile === absCwd || absFile.startsWith(absCwd + "/");
}

export async function cwdHash(cwd: string): Promise<string> {
  const real = await canonical(cwd);
  const data = new TextEncoder().encode(real);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export type CwdMarkerState = "valid" | "expired" | "absent";

export function cwdMarkerPath(hash: string): string {
  const home = Deno.env.get("HOME") ?? "";
  return `${home}/.claude/plans/.active-${hash}`;
}

export async function cwdMarkerState(cwd: string): Promise<CwdMarkerState> {
  const hash = await cwdHash(cwd);
  const path = cwdMarkerPath(hash);
  try {
    const stat = await Deno.stat(path);
    const mtime = stat.mtime?.getTime() ?? 0;
    return Date.now() - mtime < CWD_MARKER_TTL_MS ? "valid" : "expired";
  } catch {
    return "absent";
  }
}

async function hasPendingMarker(hash: string): Promise<boolean> {
  const home = Deno.env.get("HOME") ?? "";
  const path = `${home}/.claude/plans/.pending-${hash}`;
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

// --- Bypass marker helpers (codex-compatible schema) ---

export async function sessionHash(sessionId: string): Promise<string> {
  const data = new TextEncoder().encode(sessionId);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function homeDir(): string {
  const home = Deno.env.get("HOME");
  if (!home) {
    throw new Error("HOME is not set");
  }
  return home;
}

export async function bypassMarkerInfo(
  cwd: string,
  sessionId: string,
): Promise<BypassMarkerInfo> {
  if (!sessionId) {
    throw new Error("session_id is required");
  }
  const home = homeDir();
  const cwdMarkerHash = await cwdHash(cwd);
  const sessionMarkerHash = await sessionHash(sessionId);
  const plansDir = `${home}/.claude/plans`;
  return {
    plansDir,
    cwdHash: cwdMarkerHash,
    sessionHash: sessionMarkerHash,
    path:
      `${plansDir}/.bypass-plan-gate-${cwdMarkerHash}-${sessionMarkerHash}.json`,
  };
}

async function assertRegularFile(path: string): Promise<Deno.FileInfo> {
  const info = await Deno.lstat(path);
  if (!info.isFile || info.isSymlink) {
    throw new Error(`marker must be a regular file: ${path}`);
  }
  return info;
}

async function atomicWriteText(path: string, content: string): Promise<void> {
  const slash = path.lastIndexOf("/");
  if (slash < 1) {
    throw new Error(`refusing to write marker outside a directory: ${path}`);
  }
  const dir = path.slice(0, slash);
  const basename = path.slice(slash + 1);
  const tmp = `${dir}/.${basename}.${crypto.randomUUID()}.tmp`;
  try {
    await Deno.writeTextFile(tmp, content, {
      createNew: true,
      mode: 0o600,
    });
    await assertRegularFile(tmp);
    await Deno.rename(tmp, path);
  } catch (err) {
    try {
      await Deno.remove(tmp);
    } catch {
      // tmp may not exist or may already have been renamed.
    }
    throw err;
  }
}

export async function activateBypassMarker(input: {
  cwd: string;
  session_id: string;
  prompt?: string;
}): Promise<BypassMarkerInfo> {
  const info = await bypassMarkerInfo(input.cwd, input.session_id);
  await Deno.mkdir(info.plansDir, { recursive: true });
  const marker: BypassMarker = {
    version: 1,
    createdAt: new Date().toISOString(),
    cwd: await canonical(input.cwd),
    cwdHash: info.cwdHash,
    session_id: input.session_id,
    sessionHash: info.sessionHash,
    prompt: input.prompt ?? "",
  };
  await atomicWriteText(info.path, JSON.stringify(marker, null, 2) + "\n");
  return info;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function hasValidBypassMarker(
  cwd: string,
  sessionId: string,
): Promise<boolean> {
  if (!sessionId) {
    return false;
  }
  try {
    const info = await bypassMarkerInfo(cwd, sessionId);
    await assertRegularFile(info.path);
    const parsed: unknown = JSON.parse(await Deno.readTextFile(info.path));
    if (!isRecord(parsed)) {
      return false;
    }
    const canonicalCwd = await canonical(cwd);
    return parsed.version === 1 &&
      typeof parsed.createdAt === "string" &&
      parsed.createdAt.length > 0 &&
      parsed.cwd === canonicalCwd &&
      parsed.cwdHash === info.cwdHash &&
      typeof parsed.prompt === "string" &&
      parsed.sessionHash === info.sessionHash &&
      parsed.session_id === sessionId;
  } catch {
    return false;
  }
}

// --- Main gate logic (testable) ---

export async function checkGate(input: HookInput): Promise<GateDecision> {
  const filePath = input.tool_input?.file_path ?? "";
  const cwd = input.cwd ?? "";

  if (!filePath || !cwd) {
    return { kind: "allow", reason: "missing-fields" };
  }

  const abs = await canonical(
    filePath.startsWith("/") ? filePath : `${cwd}/${filePath}`,
  );

  if (isPlansMarkerPath(abs)) {
    return {
      kind: "block",
      reason: [
        `${filePath} は plan-gate 自身の marker file です。`,
        "active / pending / bypass-plan-gate マーカーの直接編集は機構的に禁止されています。",
        "marker を変更したい場合は対応する skill (/plan, /impl, /bypass-plan-gate) を経由してください。",
      ].join("\n"),
    };
  }

  if (isInfraPath(abs)) {
    return { kind: "allow", reason: "infra" };
  }

  if (!(await isUnderCwd(filePath, cwd))) {
    return { kind: "allow", reason: "outside-cwd" };
  }

  const state = await cwdMarkerState(cwd);
  if (state === "valid") {
    return { kind: "allow", reason: "marker-valid" };
  }

  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
  if (await hasValidBypassMarker(cwd, sessionId)) {
    return { kind: "allow", reason: "bypass-valid" };
  }

  let reason: string;
  if (state === "expired") {
    reason = [
      "/plan の cwd marker が 24 時間を経過して期限切れです。",
      `${filePath} への編集は block されます。`,
      "`/plan <実装したい内容>` で再実行してください。",
    ].join("\n");
  } else {
    const hash = await cwdHash(cwd);
    const pendingExists = await hasPendingMarker(hash);
    reason = pendingExists
      ? [
        "計画は作成されていますが、まだユーザーによって承認されていません。",
        `cwd 配下の ${filePath} への編集は block されます。`,
        "`/impl` と打鍵して plan を承認してください。",
        "（auto mode では bypass されません — ユーザーの明示的な打鍵が必要です）",
      ].join("\n")
      : [
        "このセッションではまだ /plan が実行されていません。",
        `cwd 配下の ${filePath} への編集は block されます。`,
        "`/plan <実装したい内容>` を先に実行してください。",
        "（trivial な変更でも /plan を通す運用です）",
      ].join("\n");
  }

  return { kind: "block", reason };
}

// --- Entry point ---

if (import.meta.main) {
  const input: HookInput = JSON.parse(
    await new Response(Deno.stdin.readable).text(),
  );
  const decision = await checkGate(input);

  if (decision.kind === "allow") {
    if (decision.reason === "missing-fields") {
      console.error("[plan-gate] missing fields, allowing");
    }
    Deno.exit(0);
  }

  console.log(JSON.stringify({ decision: "block", reason: decision.reason }));
  Deno.exit(0);
}
