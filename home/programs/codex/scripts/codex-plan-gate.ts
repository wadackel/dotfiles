#!/usr/bin/env -S deno run --allow-read --allow-env

// PreToolUse hook for Codex CLI:
// Gates apply_patch edits that touch files under cwd on a $plan-generated
// cwd-hash marker. Mirrors ~/.claude/scripts/plan-gate.ts but adapted for Codex's
// hook contract:
//   - argv[0] = event name ("PreToolUse")
//   - stdin = JSON payload with { hook_event_name, tool_name, tool_input, cwd, ... }
//   - exit 2 + stderr blocks the tool call (Codex hook convention)
//   - Codex's apply_patch tool_input has a single field `command` containing a
//     unified-diff style patch with "*** Add File:", "*** Update File:",
//     "*** Delete File:" markers (multiple files possible per call).
//
// Decision rules (in order):
//   1. tool_name not "apply_patch"           → allow (other tools out of scope)
//   2. patch edits only bootstrap gate files → allow (bootstrap exception)
//   3. all patched files are outside cwd     → allow (per-cwd gate scope)
//   4. ~/.codex/plans/.active-<hash> valid   → allow (active marker; mtime < 24h)
//   5. session/cwd bypass marker valid       → allow (user typed $bypass-plan-gate)
//   6. otherwise                             → block with hint mentioning
//                                              $plan or $impl

const CWD_MARKER_TTL_MS = 24 * 60 * 60 * 1000;

const BOOTSTRAP_INFRA_REGEX =
  /^\/Users\/[^/]+\/dotfiles\/home\/programs\/codex\/(?:hooks\.json|scripts\/(?:codex-plan-gate|codex-impl-approval-tracker|codex-plan-marker|codex-bypass-plan-gate-tracker)\.ts)$/;

export interface GateInput {
  hook_event_name?: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: { command?: string };
  cwd?: string;
}

export type GateDecision =
  | {
    kind: "allow";
    reason:
      | "non-gated-tool"
      | "infra"
      | "outside-cwd"
      | "marker-valid"
      | "bypass-valid"
      | "missing-fields";
  }
  | { kind: "block"; reason: string };

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

// Canonicalize a path even if its leaf does not yet exist (e.g. files about to
// be created by apply_patch). Walks up to the nearest existing ancestor,
// canonicalizes that, then re-appends the unresolved tail. This matters on
// macOS where /var/folders symlinks to /private/var/folders — a non-canonical
// leaf would silently fail prefix-match against a canonical cwd.
export async function canonical(p: string): Promise<string> {
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

export function isInfraPath(abs: string): boolean {
  return BOOTSTRAP_INFRA_REGEX.test(abs);
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

export async function sessionHash(sessionId: string): Promise<string> {
  const data = new TextEncoder().encode(sessionId);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export type CwdMarkerState = "valid" | "expired" | "absent";

function activeMarkerPath(home: string, hash: string): string {
  return `${home}/.codex/plans/.active-${hash}`;
}

function pendingMarkerPath(home: string, hash: string): string {
  return `${home}/.codex/plans/.pending-${hash}`;
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
  const plansDir = `${home}/.codex/plans`;
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
  let info: BypassMarkerInfo;
  try {
    info = await bypassMarkerInfo(cwd, sessionId);
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

export async function activeMarkerState(cwd: string): Promise<CwdMarkerState> {
  const home = Deno.env.get("HOME") ?? "";
  const hash = await cwdHash(cwd);
  try {
    const stat = await Deno.stat(activeMarkerPath(home, hash));
    const mtime = stat.mtime?.getTime() ?? 0;
    return Date.now() - mtime < CWD_MARKER_TTL_MS ? "valid" : "expired";
  } catch {
    return "absent";
  }
}

async function hasPending(cwd: string): Promise<boolean> {
  const home = Deno.env.get("HOME") ?? "";
  const hash = await cwdHash(cwd);
  try {
    await Deno.stat(pendingMarkerPath(home, hash));
    return true;
  } catch {
    return false;
  }
}

// Codex's apply_patch command embeds file paths via "*** Add File: <path>",
// "*** Update File: <path>", and "*** Delete File: <path>" markers. Returns
// every file path mentioned (no canonicalization yet — caller may resolve).
export function extractPatchFiles(command: string): string[] {
  const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
  const out: string[] = [];
  for (const m of command.matchAll(re)) {
    out.push(m[1].trim());
  }
  return out;
}

async function isUnderCwd(filePath: string, absCwd: string): Promise<boolean> {
  const abs = await canonical(
    filePath.startsWith("/") ? filePath : `${absCwd}/${filePath}`,
  );
  return abs === absCwd || abs.startsWith(absCwd + "/");
}

async function absolutePatchPath(
  filePath: string,
  absCwd: string,
): Promise<string> {
  return await canonical(
    filePath.startsWith("/") ? filePath : `${absCwd}/${filePath}`,
  );
}

export async function gateDecision(input: GateInput): Promise<GateDecision> {
  const tool = input.tool_name ?? "";
  if (tool !== "apply_patch") {
    return { kind: "allow", reason: "non-gated-tool" };
  }

  const cwd = input.cwd ?? "";
  const command = input.tool_input?.command ?? "";
  if (!cwd || !command) {
    return { kind: "allow", reason: "missing-fields" };
  }

  const absCwd = await canonical(cwd);

  const files = extractPatchFiles(command);
  if (files.length === 0) {
    // Fail-closed: apply_patch with no recognizable file markers means we
    // cannot reason about what it touches. Block to be safe.
    return {
      kind: "block",
      reason:
        "apply_patch のパッチから対象ファイルを抽出できませんでした (Begin/Add/Update/Delete File マーカー無し)。安全のため block します。",
    };
  }

  // Bootstrap allowance: editing only the gate's own hook entrypoints is always
  // permitted, otherwise a broken gate could not be repaired. Codex skills and
  // other prompt/control-plane files remain gated even when cwd is
  // home/programs/codex.
  let allBootstrapInfra = true;
  for (const f of files) {
    if (!isInfraPath(await absolutePatchPath(f, absCwd))) {
      allBootstrapInfra = false;
      break;
    }
  }
  if (allBootstrapInfra) {
    return { kind: "allow", reason: "infra" };
  }

  // Allow only if every patched file is outside cwd.
  let anyUnderCwd = false;
  for (const f of files) {
    if (await isUnderCwd(f, absCwd)) {
      anyUnderCwd = true;
      break;
    }
  }
  if (!anyUnderCwd) {
    return { kind: "allow", reason: "outside-cwd" };
  }

  const state = await activeMarkerState(cwd);
  if (state === "valid") {
    return { kind: "allow", reason: "marker-valid" };
  }

  const pendingExists = state === "absent" ? await hasPending(cwd) : false;
  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
  if (await hasValidBypassMarker(cwd, sessionId)) {
    return { kind: "allow", reason: "bypass-valid" };
  }

  let reason: string;
  if (state === "expired") {
    reason = [
      "$plan の cwd marker が 24 時間を経過して期限切れです。",
      "cwd 配下のファイル編集 (apply_patch) は block されます。",
      "`$plan <実装したい内容>` で再実行してください。",
    ].join("\n");
  } else if (pendingExists) {
    reason = [
      "計画は作成されていますが、まだユーザーによって承認されていません。",
      "cwd 配下のファイル編集 (apply_patch) は block されます。",
      "`$impl` と打鍵して plan を承認してください。",
      "（auto mode では bypass されません — ユーザーの明示的な打鍵が必要です）",
    ].join("\n");
  } else {
    reason = [
      "このセッションではまだ $plan が実行されていません。",
      "cwd 配下のファイル編集 (apply_patch) は block されます。",
      "`$plan <実装したい内容>` を先に実行してください。",
      "（trivial な変更でも $plan を通す運用です）",
    ].join("\n");
  }

  return { kind: "block", reason };
}

if (import.meta.main) {
  let payload: GateInput = {};
  try {
    const raw = await new Response(Deno.stdin.readable).text();
    if (raw.trim()) {
      payload = JSON.parse(raw) as GateInput;
    }
  } catch (e) {
    // Fail-closed on parse error: Codex sees exit 2 + stderr and blocks the tool.
    console.error(
      `[codex-plan-gate] failed to parse stdin: ${(e as Error).message}`,
    );
    Deno.exit(2);
  }

  let decision: GateDecision;
  try {
    decision = await gateDecision(payload);
  } catch (e) {
    console.error(`[codex-plan-gate] internal error: ${(e as Error).message}`);
    Deno.exit(2);
  }

  if (decision.kind === "allow") {
    Deno.exit(0);
  }
  console.error(decision.reason);
  Deno.exit(2);
}
