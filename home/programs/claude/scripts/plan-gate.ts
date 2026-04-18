#!/usr/bin/env -S deno run --allow-read --allow-env

// PreToolUse hook (matcher: "Edit|Write|MultiEdit"):
// Gates edits to files under cwd on /plan-generated cwd-hash marker.
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
}

export type GateDecision =
  | { kind: "allow"; reason: "missing-fields" | "infra" | "outside-cwd" | "marker-valid" }
  | { kind: "block"; reason: string };

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

export async function isUnderCwd(filePath: string, cwd: string): Promise<boolean> {
  const absFile = await canonical(filePath.startsWith("/") ? filePath : `${cwd}/${filePath}`);
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

// --- Main gate logic (testable) ---

export async function checkGate(input: HookInput): Promise<GateDecision> {
  const filePath = input.tool_input?.file_path ?? "";
  const cwd = input.cwd ?? "";

  if (!filePath || !cwd) {
    return { kind: "allow", reason: "missing-fields" };
  }

  const abs = await canonical(filePath.startsWith("/") ? filePath : `${cwd}/${filePath}`);

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

  const reason =
    state === "expired"
      ? [
          "/plan の cwd marker が 24 時間を経過して期限切れです。",
          `${filePath} への編集は block されます。`,
          "`/plan <実装したい内容>` で再実行してください。",
        ].join("\n")
      : [
          "このセッションではまだ /plan が実行されていません。",
          `cwd 配下の ${filePath} への編集は block されます。`,
          "`/plan <実装したい内容>` を先に実行してください。",
          "（trivial な変更でも /plan を通す運用です）",
        ].join("\n");

  return { kind: "block", reason };
}

// --- Entry point ---

if (import.meta.main) {
  const input: HookInput = JSON.parse(await new Response(Deno.stdin.readable).text());
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
