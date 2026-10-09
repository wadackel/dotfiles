import { spawn } from "node:child_process";
import { constants } from "node:os";

export type RunOptions = {
  cwd?: string;
  /** Layered over the parent environment unless `clearEnv` is set. */
  env?: Record<string, string>;
  /** Without a `PATH` in `env`, give `cmd` as an absolute path. */
  clearEnv?: boolean;
  /** Written to the child's stdin, which is then closed. Omitted: no stdin. */
  stdin?: string;
};

export type RunResult = {
  /** 128 + the signal number when the child was killed by a signal. */
  code: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

// spawn rather than execFile: execFile's default maxBuffer is 1 MiB and it
// throws past that, which only shows up on a large `git diff` in real use.
export function run(
  cmd: string,
  args: string[] = [],
  opts: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.clearEnv ? opts.env ?? {} : { ...process.env, ...opts.env },
      stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout!.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr!.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        code: code ?? 128 + (signal ? constants.signals[signal] : 0),
        signal,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
    if (child.stdin) {
      // A child that exits without reading leaves EPIPE on this stream; the
      // exit code already tells the caller what happened.
      child.stdin.on("error", () => {});
      child.stdin.end(opts.stdin);
    }
  });
}
