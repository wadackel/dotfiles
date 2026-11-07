import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { stripVTControlCharacters } from "node:util";

export interface SummaryIdentity {
  homeDir: string;
  agent: string;
  sessionId: string;
}

export interface SummaryState {
  version: 2;
  agent: string;
  sessionId: string;
  epoch: string;
  nextGeneration: number;
  publishedGeneration: number;
  updatedAt: number;
  summary: string;
}

const AGENTS = new Set(["claude", "codex", "opencode"]);
const MAX_BYTES = 16 * 1024;
const EPOCH = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export function summaryPaths(id: SummaryIdentity): {
  directory: string;
  file: string;
  lock: string;
} | null {
  if (
    !isAbsolute(id.homeDir) || !AGENTS.has(id.agent) ||
    !id.sessionId || id.sessionId.length > 256
  ) return null;
  const directory = join(
    id.homeDir,
    ".cache",
    "agentower",
    "summaries",
    id.agent,
  );
  const hash = createHash("sha256").update(id.sessionId).digest("hex");
  return {
    directory,
    file: join(directory, `${hash}.json`),
    lock: join(directory, `${hash}.lock`),
  };
}

export async function summaryDirectory(id: SummaryIdentity, create = false) {
  const paths = summaryPaths(id);
  if (!paths) throw new Error("invalid summary identity");
  let path = id.homeDir;
  // Recursive mkdir follows pre-existing symlinks into unrelated directories.
  for (const part of [".cache", "agentower", "summaries", id.agent]) {
    path = join(path, part);
    if (create) {
      await mkdir(path, { mode: 0o700 }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        },
      );
    }
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("summary directory is not a regular directory");
    }
  }
  return paths;
}

export function cleanSummary(text: string): string {
  return Array.from(
    stripVTControlCharacters(text).replace(/[\x00-\x1f\x7f-\x9f]+/g, " ")
      .trim(),
  )
    .slice(0, 200).join("");
}

function parseState(value: unknown, id: SummaryIdentity): SummaryState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    v.version !== 2 || v.agent !== id.agent || v.sessionId !== id.sessionId ||
    typeof v.epoch !== "string" || !EPOCH.test(v.epoch) ||
    typeof v.nextGeneration !== "number" ||
    !Number.isSafeInteger(v.nextGeneration) || v.nextGeneration < 1 ||
    typeof v.publishedGeneration !== "number" ||
    !Number.isSafeInteger(v.publishedGeneration) ||
    v.publishedGeneration < 0 || v.publishedGeneration >= v.nextGeneration ||
    typeof v.updatedAt !== "number" || !Number.isSafeInteger(v.updatedAt) ||
    v.updatedAt < 0 ||
    typeof v.summary !== "string" || v.summary.length > 2000
  ) return null;
  return {
    version: 2,
    agent: id.agent,
    sessionId: id.sessionId,
    epoch: v.epoch,
    nextGeneration: v.nextGeneration,
    publishedGeneration: v.publishedGeneration,
    updatedAt: v.updatedAt,
    summary: v.summary,
  };
}

export async function readSummaryState(
  id: SummaryIdentity,
): Promise<SummaryState | null> {
  try {
    const paths = await summaryDirectory(id);
    // A stat-then-read can block on a FIFO swapped in between the two calls.
    const handle = await open(
      paths.file,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_BYTES) return null;
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_BYTES) return null;
      return parseState(JSON.parse(buffer.toString("utf8", 0, bytesRead)), id);
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export async function readSessionSummary(
  id: SummaryIdentity,
): Promise<string | null> {
  const state = await readSummaryState(id);
  return state && state.publishedGeneration > 0
    ? cleanSummary(state.summary) || null
    : null;
}
