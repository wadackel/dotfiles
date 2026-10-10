// Hermes discards a pre-run script's stderr unless it exits non-zero, and
// even then on a timeout or gateway restart, so a hung script leaves nothing
// behind; ~/Library/Logs/hermes-scripts.log is what remains to read.
// Writing must never break a script: the log directory may be missing or
// unwritable, as it is in a test.

import {
  closeSync,
  fstatSync,
  openSync,
  renameSync,
  statSync,
  writeSync,
} from "node:fs";
import { pathToFileURL } from "node:url";

const LIMIT_BYTES = 5 * 1024 * 1024;

export function logPath(): string | undefined {
  const home = process.env.HOME;
  return home ? `${home}/Library/Logs/hermes-scripts.log` : undefined;
}

function stamp(d: Date): string {
  const offset = -d.getTimezoneOffset();
  const local = new Date(d.getTime() + offset * 60_000).toISOString()
    .slice(0, 23);
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${local}${offset >= 0 ? "+" : "-"}${hh}:${mm}`;
}

function scriptName(): string {
  const file = pathToFileURL(process.argv[1]).pathname.split("/").pop() ?? "";
  return file.replace(/\.ts$/, "");
}

// Two processes can both see the log over the limit. Renaming only when the
// path still names the file this process opened keeps the second one, all
// but a narrow window aside, from moving the fresh log onto .1 and deleting
// the generation just rotated.
export function rotateIfOver(
  fd: number,
  path: string,
  limit: number,
): boolean {
  const opened = fstatSync(fd);
  if (opened.size <= limit) return false;
  if (statSync(path).ino !== opened.ino) return false;
  renameSync(path, `${path}.1`);
  return true;
}

// Error messages can quote a request URL, and the query of an Apps Script
// result URL is a key that reads the result. Control characters from a feed
// or an error page would otherwise drive the terminal that tails this file.
function clean(message: string): string {
  return message
    .replace(/(https?:\/\/[^\s?#"')]+)\?[^\s"')]*/g, "$1")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const open = (path: string) => openSync(path, "a", 0o600);

export function trace(
  message: string,
  { limit = LIMIT_BYTES }: { limit?: number } = {},
): void {
  let fd: number | undefined;
  try {
    const path = logPath();
    if (!path) return;
    const line = `${stamp(new Date())} ${scriptName()}[${process.pid}] ${
      clean(message)
    }\n`;
    fd = open(path);
    if (rotateIfOver(fd, path, limit)) {
      closeSync(fd);
      fd = open(path);
    }
    writeSync(fd, line);
  } catch {
    // See the header: a refused or missing log is not the script's failure.
  } finally {
    try {
      if (fd !== undefined) closeSync(fd);
    } catch {
      // Already closed by a failed rotation.
    }
  }
}

// A script killed by a signal never reaches the exit event, so a start with
// no exit line is a hang or a kill. An uncaught exception or a rejected
// top-level await writes `exit 1`; a rejection nobody awaited can still end
// the process with status 1 after an `exit 0` line.
export function startTrace(): void {
  const started = Date.now();
  trace("start");
  process.on("exit", (code) => {
    trace(`exit ${code} after ${Date.now() - started}ms`);
  });
}
