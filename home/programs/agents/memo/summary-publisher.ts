import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, rm, writeFile } from "node:fs/promises";
import {
  cleanSummary,
  readSummaryState,
  summaryDirectory,
  type SummaryIdentity,
  type SummaryState,
} from "./summary-cache.ts";

export interface SummaryTicket extends SummaryIdentity {
  epoch: string;
  generation: number;
}

type Reporter = (message: string) => void | Promise<void>;

async function report(
  onError: Reporter | undefined,
  error: unknown,
): Promise<void> {
  try {
    await onError?.(`summary cache: ${error}`);
  } catch {}
}

export async function withSummaryLock<T>(
  id: SummaryIdentity,
  operation: () => Promise<T>,
): Promise<T> {
  const paths = await summaryDirectory(id, true);
  const handle = await open(
    paths.lock,
    constants.O_RDWR | constants.O_CREAT | constants.O_NONBLOCK |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) {
      throw new Error("summary lock is not a regular private file");
    }
    await handle.chmod(0o600);
    // Unlinking a lock lets existing waiters and new callers lock different inodes.
    await new Promise<void>((resolve, reject) => {
      const child = spawn("/usr/bin/lockf", ["-s", "-t", "1", "3"], {
        stdio: ["ignore", "ignore", "ignore", handle.fd],
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 2500);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`summary lock acquisition failed (${code})`));
      });
    });
    return await operation();
  } finally {
    await handle.close();
  }
}

async function writeState(
  id: SummaryIdentity,
  state: SummaryState,
): Promise<void> {
  const paths = await summaryDirectory(id);
  const temp = `${paths.file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(state) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temp, paths.file);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

export async function beginSummaryPublication(
  id: SummaryIdentity,
  onError?: Reporter,
): Promise<SummaryTicket | null> {
  try {
    return await withSummaryLock(id, async () => {
      const state = await readSummaryState(id) ?? {
        version: 2,
        agent: id.agent,
        sessionId: id.sessionId,
        epoch: randomUUID(),
        nextGeneration: 1,
        publishedGeneration: 0,
        updatedAt: 0,
        summary: "",
      } satisfies SummaryState;
      const generation = state.nextGeneration;
      if (generation >= Number.MAX_SAFE_INTEGER) {
        throw new Error("summary generation exhausted");
      }
      await writeState(id, { ...state, nextGeneration: generation + 1 });
      return { ...id, epoch: state.epoch, generation };
    });
  } catch (error) {
    await report(onError, error);
    return null;
  }
}

export async function publishSummary(
  ticket: SummaryTicket | null,
  summary: string,
  onError?: Reporter,
): Promise<void> {
  if (!ticket) return;
  try {
    const cleaned = cleanSummary(summary);
    if (
      !cleaned || !Number.isSafeInteger(ticket.generation) ||
      ticket.generation < 1
    ) return;
    await withSummaryLock(ticket, async () => {
      const state = await readSummaryState(ticket);
      if (
        !state || state.epoch !== ticket.epoch ||
        ticket.generation >= state.nextGeneration ||
        ticket.generation <= state.publishedGeneration
      ) return;
      await writeState(ticket, {
        ...state,
        publishedGeneration: ticket.generation,
        summary: cleaned,
        updatedAt: Date.now(),
      });
    });
  } catch (error) {
    await report(onError, error);
  }
}
