// Appends one line per event to ~/Library/Logs/hermes-scripts.log, shared by
// the Hermes cron pre-run scripts and MCP servers.
//
// Hermes throws a pre-run script's stderr away unless it exits non-zero, and
// on a timeout or a gateway restart even then, so a script that hangs leaves
// nothing behind. This file is what is left to read afterwards.
//
// Writing must never break a script: until darwin-rebuild grants the log
// path, every write is refused, and a test may run without the directory.

const LIMIT_BYTES = 5 * 1024 * 1024;
const encoder = new TextEncoder();

export function logPath(): string | undefined {
  const home = Deno.env.get("HOME");
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
  const file = new URL(Deno.mainModule).pathname.split("/").pop() ?? "";
  return file.replace(/\.ts$/, "");
}

// Two processes can both see the log over the limit. Renaming only when the
// path still names the file this process opened keeps the second one from
// moving the fresh log onto .1 and deleting the generation just rotated.
export function rotateIfOver(
  file: Deno.FsFile,
  path: string,
  limit: number,
): boolean {
  if (file.seekSync(0, Deno.SeekMode.End) <= limit) return false;
  if (Deno.statSync(path).ino !== file.statSync().ino) return false;
  Deno.renameSync(path, `${path}.1`);
  return true;
}

const open = (path: string) =>
  Deno.openSync(path, { append: true, create: true, mode: 0o600 });

export function trace(
  message: string,
  { limit = LIMIT_BYTES }: { limit?: number } = {},
): void {
  const path = logPath();
  if (!path) return;
  const line = `${stamp(new Date())} ${scriptName()}[${Deno.pid}] ${
    message.replace(/\s+/g, " ").trim()
  }\n`;
  let file: Deno.FsFile | undefined;
  try {
    file = open(path);
    if (rotateIfOver(file, path, limit)) {
      file.close();
      file = open(path);
    }
    file.writeSync(encoder.encode(line));
  } catch {
    // See the header: a refused or missing log is not the script's failure.
  } finally {
    try {
      file?.close();
    } catch {
      // Already closed by a failed rotation.
    }
  }
}

// A script killed by a signal or an uncaught error never reaches unload, so
// a start with no exit line is a hang, a kill or a crash; Hermes keeps the
// stderr of the last two.
export function startTrace(): void {
  const started = Date.now();
  trace("start");
  globalThis.addEventListener("unload", () => {
    trace(`exit ${Deno.exitCode} after ${Date.now() - started}ms`);
  });
}
