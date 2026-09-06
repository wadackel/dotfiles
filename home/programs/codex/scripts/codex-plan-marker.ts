#!/usr/bin/env -S deno run --allow-env=HOME --allow-read --allow-write --no-prompt

// The picker reads the marker format and TTL independently; changing them here
// would leave display behavior inconsistent with plan resolution.

// The shebang uses broad write permission because Deno shebang arguments cannot
// expand HOME; all write paths are still constrained by markerPaths().
const MARKER_TTL_MS = 24 * 60 * 60 * 1000;

// Canonicalize a path even if its leaf does not yet exist. Walks up to the
// nearest existing ancestor, canonicalizes that, then re-appends the unresolved
// tail. This matters on macOS where /var/folders symlinks to /private/var/folders
// — a non-canonical leaf would hash differently from the picker's canonical cwd.
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

export async function cwdHash(cwd: string): Promise<string> {
  const real = await canonical(cwd);
  const data = new TextEncoder().encode(real);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

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
      "  codex-plan-marker.ts activate-pending <plan-path> [cwd]",
      "  codex-plan-marker.ts promote [cwd]",
      "  codex-plan-marker.ts status [cwd]",
      "  codex-plan-marker.ts require-active [cwd]",
      "  codex-plan-marker.ts clear-active [cwd]",
      "  codex-plan-marker.ts resolve [plan-path|-] [cwd]",
      "  codex-plan-marker.ts clear-matching <plan-path> [cwd]",
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
  const plansDir = `${homeDir()}/.codex/plans`;
  return {
    hash,
    plansDir,
    activePath: `${plansDir}/.active-${hash}`,
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
        ? "plan pending promotion to active"
        : "pending marker is expired",
    };
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw err;
    }
    return absentStatus(paths);
  }
}

async function activatePendingUnlocked(
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
      throw new Error("active plan marker for this cwd is expired");
    case "pending":
      throw new Error(
        "pending plan marker for this cwd was not promoted to active",
      );
    case "pending-expired":
      throw new Error("pending plan marker for this cwd is expired");
    case "absent":
      throw new Error("no plan marker for this cwd");
    default:
      return assertNever(status.state);
  }
}

async function clearActiveUnlocked(cwd: string): Promise<boolean> {
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

async function resolvePlanUnlocked(
  planPath?: string,
  cwd = Deno.cwd(),
): Promise<string> {
  const paths = await markerPaths(cwd);
  const dir = await existingPlansDir(paths.plansDir);
  if (!dir) throw new Error("no plan directory; select or create a plan");
  if (planPath) {
    const selected = await validatePlanPath(planPath, dir);
    const active = await readMarkerPlanPath(paths.activePath, dir);
    const pending = await readMarkerPlanPath(paths.pendingPath, dir);
    if (
      (!active || active === selected) && (!pending || pending === selected)
    ) {
      await atomicWriteText(paths.activePath, `${selected}\n`);
      if (pending === selected) await Deno.remove(paths.pendingPath);
    }
    return selected;
  }
  const candidates = await Promise.all([
    readMarkerPlanPath(paths.activePath, dir),
    readMarkerPlanPath(paths.pendingPath, dir),
  ]);
  const unique = [
    ...new Set(candidates.filter((p): p is string => p !== null)),
  ];
  if (unique.length !== 1) {
    throw new Error(
      "select an explicit plan path; marker is absent or ambiguous",
    );
  }
  await atomicWriteText(paths.activePath, `${unique[0]}\n`);
  if (candidates[1]) await Deno.remove(paths.pendingPath);
  return unique[0];
}

async function clearMatchingUnlocked(
  planPath: string,
  cwd = Deno.cwd(),
): Promise<boolean> {
  const paths = await markerPaths(cwd);
  const dir = await existingPlansDir(paths.plansDir);
  if (!dir) return false;
  const expected = await validatePlanPath(planPath, dir);
  let removed = false;
  for (const path of [paths.activePath, paths.pendingPath]) {
    if (await readMarkerPlanPath(path, dir) === expected) {
      await Deno.remove(path);
      removed = true;
    }
  }
  return removed;
}

async function promoteUnlocked(cwd: string): Promise<PromoteResult> {
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
        await atomicWriteText(status.activePath, `${status.planPath}\n`);
        await Deno.remove(status.pendingPath);
        return { promoted: true, reason: "promoted" };
      } catch (err) {
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

async function withMarkerLock<T>(
  cwd: string,
  operation: () => Promise<T>,
): Promise<T> {
  const paths = await markerPaths(cwd);
  await ensurePlansDir(paths.plansDir);
  const path = `${paths.plansDir}/.marker-lock-${paths.hash}`;
  let lock: Deno.FsFile;
  try {
    lock = await Deno.open(path, { createNew: true, write: true, mode: 0o600 });
  } catch (err) {
    if (err instanceof Deno.errors.AlreadyExists) {
      throw new Error(
        `marker is locked; check the writer before recovering ${path}`,
      );
    }
    throw err;
  }
  try {
    await lock.write(
      new TextEncoder().encode(
        JSON.stringify({ pid: Deno.pid, started: new Date().toISOString() }),
      ),
    );
    return await operation();
  } finally {
    lock.close();
    await Deno.remove(path);
  }
}

export function activatePending(
  planPath: string,
  cwd = Deno.cwd(),
): Promise<MarkerPaths> {
  return withMarkerLock(cwd, () => activatePendingUnlocked(planPath, cwd));
}

export function clearActive(cwd = Deno.cwd()): Promise<boolean> {
  return withMarkerLock(cwd, () => clearActiveUnlocked(cwd));
}

export function resolvePlan(
  planPath?: string,
  cwd = Deno.cwd(),
): Promise<string> {
  return withMarkerLock(cwd, () => resolvePlanUnlocked(planPath, cwd));
}

export function clearMatching(
  planPath: string,
  cwd = Deno.cwd(),
): Promise<boolean> {
  return withMarkerLock(cwd, () => clearMatchingUnlocked(planPath, cwd));
}

export async function promote(cwd = Deno.cwd()): Promise<PromoteResult> {
  try {
    return await withMarkerLock(cwd, () => promoteUnlocked(cwd));
  } catch (err) {
    return {
      promoted: false,
      reason: "io-error",
      error: (err as Error).message,
    };
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

  if (command === "promote") {
    const result = await promote(first ?? Deno.cwd());
    console.log(result.reason);
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

  if (command === "resolve") {
    console.log(
      await resolvePlan(
        first === "-" ? undefined : first,
        second ?? Deno.cwd(),
      ),
    );
    return;
  }

  if (command === "clear-matching") {
    if (!first) usage();
    console.log(
      await clearMatching(first, second ?? Deno.cwd())
        ? "active-cleared"
        : "active-preserved",
    );
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
