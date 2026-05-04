#!/usr/bin/env -S deno run --allow-read --allow-env

// PreToolUse hook for Codex CLI:
// Gates apply_patch edits that touch files under cwd on a /plan-codex-generated
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
//   2. cwd is under codex infra-path         → allow (bootstrap exception)
//   3. all patched files are outside cwd     → allow (per-cwd gate scope)
//   4. ~/.codex/plans/.active-<hash> valid   → allow (active marker; mtime < 24h)
//   5. otherwise                             → block with hint mentioning
//                                              $plan-codex or $impl-codex

const CWD_MARKER_TTL_MS = 24 * 60 * 60 * 1000;

const INFRA_REGEX =
  /^\/Users\/[^/]+\/dotfiles\/home\/programs\/codex(\/|$)/;

export interface GateInput {
  hook_event_name?: string;
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
      | "missing-fields";
  }
  | { kind: "block"; reason: string };

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
  return INFRA_REGEX.test(abs);
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

function activeMarkerPath(home: string, hash: string): string {
  return `${home}/.codex/plans/.active-${hash}`;
}

function pendingMarkerPath(home: string, hash: string): string {
  return `${home}/.codex/plans/.pending-${hash}`;
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
  const abs = await canonical(filePath.startsWith("/") ? filePath : `${absCwd}/${filePath}`);
  return abs === absCwd || abs.startsWith(absCwd + "/");
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

  // Bootstrap allowance: editing the codex infra itself is always permitted,
  // otherwise we cannot fix a broken gate.
  if (isInfraPath(absCwd)) {
    return { kind: "allow", reason: "infra" };
  }

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

  let reason: string;
  if (state === "expired") {
    reason = [
      "/plan-codex の cwd marker が 24 時間を経過して期限切れです。",
      "cwd 配下のファイル編集 (apply_patch) は block されます。",
      "`$plan-codex <実装したい内容>` で再実行してください。",
    ].join("\n");
  } else if (pendingExists) {
    reason = [
      "計画は作成されていますが、まだユーザーによって承認されていません。",
      "cwd 配下のファイル編集 (apply_patch) は block されます。",
      "`$impl-codex` と打鍵して plan を承認してください。",
      "（auto mode では bypass されません — ユーザーの明示的な打鍵が必要です）",
    ].join("\n");
  } else {
    reason = [
      "このセッションではまだ /plan-codex が実行されていません。",
      "cwd 配下のファイル編集 (apply_patch) は block されます。",
      "`$plan-codex <実装したい内容>` を先に実行してください。",
      "（trivial な変更でも /plan-codex を通す運用です）",
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
    console.error(`[codex-plan-gate] failed to parse stdin: ${(e as Error).message}`);
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
