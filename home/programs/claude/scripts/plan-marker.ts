#!/usr/bin/env -S deno run --allow-env=HOME --allow-read --allow-write --no-prompt

import { cwdHash, cwdMarkerPath } from "./plan-gate.ts";

// The shebang uses broad write permission because Deno shebang arguments cannot
// expand HOME; all write paths are still constrained by markerPaths().
const MARKER_TTL_MS = 24 * 60 * 60 * 1000;

export type MarkerState =
  | "active"
  | "active-expired"
  | "pending"
  | "pending-expired"
  | "absent";

export interface MarkerPaths {
  hash: string;
  plansDir: string;
  activePath: string;
  pendingPath: string;
}

export interface MarkerStatus extends MarkerPaths {
  state: MarkerState;
  planPath: string | null;
  reason: string;
}

export interface PromoteResult {
  promoted: boolean;
  reason: "promoted" | "no-pending" | "expired" | "already-active" | "io-error";
  error?: string;
}

function usage(): never {
  console.error(
    [
      "Usage:",
      "  plan-marker.ts activate-pending <plan-path> [cwd]",
      "  plan-marker.ts status [cwd]",
      "  plan-marker.ts require-active [cwd]",
      "  plan-marker.ts clear-active [cwd]",
    ].join("\n"),
  );
  Deno.exit(1);
}

function homeDir(): string {
  const home = Deno.env.get("HOME");
  if (!home) {
    throw new Error("HOME is not set");
  }
  return home;
}

async function markerPaths(cwd: string): Promise<MarkerPaths> {
  const hash = await cwdHash(cwd);
  const plansDir = `${homeDir()}/.claude/plans`;
  return {
    hash,
    plansDir,
    activePath: cwdMarkerPath(hash),
    pendingPath: `${plansDir}/.pending-${hash}`,
  };
}

function absentStatus(paths: MarkerPaths): MarkerStatus {
  return {
    ...paths,
    state: "absent",
    planPath: null,
    reason: "no plan marker exists for cwd",
  };
}

async function ensurePlansDir(plansDir: string): Promise<string> {
  await Deno.mkdir(plansDir, { recursive: true });
  return await assertPlansDir(plansDir);
}

async function existingPlansDir(plansDir: string): Promise<string | null> {
  try {
    return await assertPlansDir(plansDir);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return null;
    }
    throw err;
  }
}

async function assertPlansDir(plansDir: string): Promise<string> {
  const info = await Deno.lstat(plansDir);
  if (!info.isDirectory || info.isSymlink) {
    throw new Error(`plans directory must be a regular directory: ${plansDir}`);
  }
  return await Deno.realPath(plansDir);
}

function assertNever(value: never): never {
  throw new Error(`unhandled marker state: ${value}`);
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
    const info = await Deno.lstat(tmp);
    if (!info.isFile || info.isSymlink) {
      throw new Error("temporary marker is not a regular file");
    }
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

async function atomicCreateTextNoClobber(
  path: string,
  content: string,
): Promise<void> {
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
    const info = await Deno.lstat(tmp);
    if (!info.isFile || info.isSymlink) {
      throw new Error("temporary marker is not a regular file");
    }
    await Deno.link(tmp, path);
  } finally {
    try {
      await Deno.remove(tmp);
    } catch {
      // tmp may not exist if creation failed before it was written.
    }
  }
}

async function assertRegularFile(
  path: string,
  label: string,
): Promise<Deno.FileInfo> {
  const info = await Deno.lstat(path);
  if (!info.isFile || info.isSymlink) {
    throw new Error(`${label} must be a regular file: ${path}`);
  }
  return info;
}

async function validatePlanPath(
  planPath: string,
  realPlansDir: string,
): Promise<string> {
  if (!planPath.startsWith("/") || !planPath.endsWith(".md")) {
    throw new Error("plan path must be an absolute .md file");
  }
  await assertRegularFile(planPath, "plan file");
  const realPlanPath = await Deno.realPath(planPath);
  if (!realPlanPath.endsWith(".md")) {
    throw new Error("plan path must resolve to a .md file");
  }
  if (
    realPlanPath !== realPlansDir &&
    !realPlanPath.startsWith(`${realPlansDir}/`)
  ) {
    throw new Error(`plan path must be under ${realPlansDir}`);
  }
  return realPlanPath;
}

async function readMarkerPlanPath(
  path: string,
  realPlansDir: string,
): Promise<string | null> {
  try {
    await assertRegularFile(path, "marker");
    const planPath = (await Deno.readTextFile(path)).trim();
    return await validatePlanPath(planPath, realPlansDir);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return null;
    }
    throw err;
  }
}

function isFresh(info: Deno.FileInfo): boolean {
  const mtime = info.mtime?.getTime() ?? 0;
  return Date.now() - mtime < MARKER_TTL_MS;
}

export async function getStatus(cwd = Deno.cwd()): Promise<MarkerStatus> {
  const paths = await markerPaths(cwd);
  const realPlansDir = await existingPlansDir(paths.plansDir);
  if (!realPlansDir) {
    return absentStatus(paths);
  }

  try {
    const active = await assertRegularFile(paths.activePath, "active marker");
    const fresh = isFresh(active);
    return {
      ...paths,
      state: fresh ? "active" : "active-expired",
      planPath: await readMarkerPlanPath(paths.activePath, realPlansDir),
      reason: fresh ? "active marker is valid" : "active marker is expired",
    };
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw err;
    }
  }

  try {
    const pending = await assertRegularFile(
      paths.pendingPath,
      "pending marker",
    );
    const fresh = isFresh(pending);
    return {
      ...paths,
      state: fresh ? "pending" : "pending-expired",
      planPath: await readMarkerPlanPath(paths.pendingPath, realPlansDir),
      reason: fresh
        ? "plan exists but is not approved"
        : "pending marker is expired",
    };
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw err;
    }
    return absentStatus(paths);
  }
}

export async function activatePending(
  planPath: string,
  cwd = Deno.cwd(),
): Promise<MarkerPaths> {
  if (!planPath.startsWith("/")) {
    throw new Error("plan path must be absolute");
  }
  const paths = await markerPaths(cwd);
  const realPlansDir = await ensurePlansDir(paths.plansDir);
  const realPlanPath = await validatePlanPath(planPath, realPlansDir);
  try {
    await Deno.remove(paths.activePath);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw err;
    }
  }
  await atomicWriteText(paths.pendingPath, `${realPlanPath}\n`);
  return paths;
}

export async function requireActive(cwd = Deno.cwd()): Promise<string> {
  const status = await getStatus(cwd);
  switch (status.state) {
    case "active":
      if (status.planPath) {
        return status.planPath;
      }
      throw new Error("active marker did not contain a valid plan path");
    case "active-expired":
      throw new Error(".active marker expired. Run `/plan <request>` again.");
    case "pending":
      throw new Error(
        "Plan exists but is not approved. Type `/impl` as a top-level prompt to approve.",
      );
    case "pending-expired":
      throw new Error(".pending marker expired. Run `/plan <request>` again.");
    case "absent":
      throw new Error(
        "Run `/plan <request>` first. No active plan for this cwd.",
      );
    default:
      return assertNever(status.state);
  }
}

export async function clearActive(cwd = Deno.cwd()): Promise<boolean> {
  const paths = await markerPaths(cwd);
  try {
    await Deno.remove(paths.activePath);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

export async function promote(cwd = Deno.cwd()): Promise<PromoteResult> {
  const paths = await markerPaths(cwd);
  try {
    await Deno.lstat(paths.activePath);
    return { promoted: false, reason: "already-active" };
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      return {
        promoted: false,
        reason: "io-error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  let status: MarkerStatus;
  try {
    status = await getStatus(cwd);
  } catch (err) {
    return {
      promoted: false,
      reason: "io-error",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  switch (status.state) {
    case "absent":
      return { promoted: false, reason: "no-pending" };
    case "active":
    case "active-expired":
      return { promoted: false, reason: "already-active" };
    case "pending-expired":
      return { promoted: false, reason: "expired" };
    case "pending":
      if (!status.planPath) {
        return {
          promoted: false,
          reason: "io-error",
          error: "pending marker did not contain a valid plan path",
        };
      }
      try {
        await atomicCreateTextNoClobber(
          status.activePath,
          `${status.planPath}\n`,
        );
        await Deno.remove(status.pendingPath);
        return { promoted: true, reason: "promoted" };
      } catch (err) {
        if (err instanceof Deno.errors.AlreadyExists) {
          return { promoted: false, reason: "already-active" };
        }
        return {
          promoted: false,
          reason: "io-error",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    default:
      return assertNever(status.state);
  }
}

export async function run(args: string[]): Promise<void> {
  const [command, first, second] = args;
  if (!command) {
    usage();
  }

  if (command === "activate-pending") {
    if (!first) {
      usage();
    }
    const paths = await activatePending(first, second ?? Deno.cwd());
    console.log(paths.pendingPath);
    return;
  }

  if (command === "status") {
    console.log(JSON.stringify(await getStatus(first ?? Deno.cwd()), null, 2));
    return;
  }

  if (command === "require-active") {
    console.log(await requireActive(first ?? Deno.cwd()));
    return;
  }

  if (command === "clear-active") {
    const removed = await clearActive(first ?? Deno.cwd());
    console.log(removed ? "active-cleared" : "active-absent");
    return;
  }

  usage();
}

if (import.meta.main) {
  try {
    await run(Deno.args);
  } catch (err) {
    console.error((err as Error).message);
    Deno.exit(1);
  }
}
