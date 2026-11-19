#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null
// A disposable environment for the program under test. Usage: SKILL.md, or `explore-sandbox.ts help`.

import { spawn } from "node:child_process";
import { lstatSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:os";
import { basename, join, resolve } from "node:path";
import { run } from "../../../../agents/lib/proc.ts";

export type Sandbox = {
  root: string;
  state: string;
  template: string;
  /** Short on purpose: tmux and other sockets live here, and a socket path past ~104 bytes fails. */
  shortDir: string;
  env: Record<string, { value: string; reason: string }>;
  created: string;
};

const PROTECTED = new Set([
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "TMPDIR",
  "TMUX",
  "TMUX_PANE",
  "TMUX_TMPDIR",
  "SSH_AUTH_SOCK",
  "GIT_SSH_COMMAND",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_GLOBAL",
  "GIT_CEILING_DIRECTORIES",
  "GIT_TERMINAL_PROMPT",
  "GH_TOKEN",
  "GITHUB_TOKEN",
]);
// GIT_CONFIG_* can bring the credential helper back, GIT_DIR and GIT_WORK_TREE point past
// the ceiling at the real repository, and GH_CONFIG_DIR at the user's logged-in gh.
const PROTECTED_PREFIXES = ["GIT_", "GH_", "GITHUB_", "SSH_", "TMUX"];

const isProtected = (key: string) =>
  PROTECTED.has(key) || PROTECTED_PREFIXES.some((p) => key.startsWith(p));

const SHORT_DIR = /^\/private\/tmp\/xs-[^/]+$/;

const sshOptions = (state: string) =>
  `-F /dev/null -o IdentitiesOnly=yes -o IdentityFile=/dev/null -o BatchMode=yes -o UserKnownHostsFile=${
    join(state, "home", ".ssh", "known_hosts")
  }`;

const metaPath = (root: string) => join(root, "sandbox.json");

/**
 * The product runs with the same uid next to sandbox.json and could rewrite it, so the paths
 * come from the root given on the command line and the file only supplies shortDir and env.
 */
export async function loadSandbox(rootArg: string): Promise<Sandbox> {
  const root = await realpath(rootArg);
  const meta = JSON.parse(await readFile(metaPath(root), "utf8")) as Partial<
    Sandbox
  >;
  const shortDir = String(meta.shortDir ?? "");
  // A link named like one (/private/tmp/xs-q -> /private/tmp) would point tmux at the user's server.
  const st = SHORT_DIR.test(shortDir)
    ? lstatSync(shortDir, { throwIfNoEntry: false })
    : undefined;
  const owned = st?.isDirectory() && !st.isSymbolicLink() &&
    st.uid === process.getuid?.();
  if (!owned || (await realpath(shortDir)) !== shortDir) {
    throw new Error(`sandbox.json names an unexpected shortDir: ${shortDir}`);
  }
  const env: Sandbox["env"] = {};
  for (const [key, entry] of Object.entries(meta.env ?? {})) {
    if (!isProtected(key)) env[key] = entry;
  }
  return {
    root,
    state: join(root, "state"),
    template: join(root, "template"),
    shortDir,
    env,
    created: String(meta.created ?? ""),
  };
}

async function saveSandbox(sb: Sandbox): Promise<void> {
  await writeFile(metaPath(sb.root), `${JSON.stringify(sb, null, 2)}\n`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function initSandbox(rootArg: string): Promise<Sandbox> {
  await mkdir(rootArg, { recursive: true });
  const root = await realpath(rootArg);
  if ((await readdir(root)).length > 0) {
    throw new Error(`${root} is not empty`);
  }
  const shortDir = await realpath(await mkdtemp("/tmp/xs-"));
  const state = join(root, "state");
  const sb: Sandbox = {
    root,
    state,
    template: join(root, "template"),
    shortDir,
    env: {},
    created: new Date().toISOString(),
  };
  for (
    const dir of ["home", "xdg/config", "xdg/data", "xdg/state", "xdg/cache"]
  ) {
    await mkdir(join(state, dir), { recursive: true });
  }
  await mkdir(join(shortDir, "tmp"), { recursive: true });
  await mkdir(join(shortDir, "bin"), { recursive: true });
  await writeFile(
    join(state, "home", ".gitconfig"),
    "[user]\n\tname = explore-sandbox\n\temail = explore-sandbox@example.invalid\n[init]\n\tdefaultBranch = main\n",
  );
  await mkdir(join(state, "home", ".ssh"), { recursive: true });
  // A target that runs ssh itself bypasses GIT_SSH_COMMAND, and ssh reads keys from the
  // passwd home, not $HOME: with HOME swapped it still authenticated as the user.
  // scp and sftp start /usr/bin/ssh by absolute path, so they get shims of their own.
  const bin = join(shortDir, "bin");
  const shims: Record<string, string> = {
    ssh: `exec /usr/bin/ssh ${sshOptions(state)} "$@"`,
    scp: `exec /usr/bin/scp -S ${join(bin, "ssh")} "$@"`,
    sftp: `exec /usr/bin/sftp -S ${join(bin, "ssh")} "$@"`,
  };
  for (const [name, body] of Object.entries(shims)) {
    await writeFile(join(bin, name), `#!/bin/sh\n${body}\n`);
    await chmod(join(bin, name), 0o755);
  }
  await saveSandbox(sb);
  return sb;
}

export function sandboxEnv(
  sb: Sandbox,
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {
    TERM: parent.TERM ?? "xterm-256color",
    LANG: parent.LANG ?? "en_US.UTF-8",
  };
  for (const key of ["USER", "LOGNAME"]) {
    const value = parent[key];
    if (value) env[key] = value;
  }
  for (const [key, { value }] of Object.entries(sb.env)) {
    if (!isProtected(key)) env[key] = value;
  }
  // Applied after the recorded variables, so none of them can undo the isolation.
  Object.assign(env, {
    PATH: `${join(sb.shortDir, "bin")}:${
      env.PATH ?? parent.PATH ?? "/usr/bin:/bin"
    }`,
    // The user's zsh rebuilds PATH from nix-darwin's set-environment unless told it already ran,
    // which dropped the ssh shim in a pane or a `$SHELL -c`; /bin/sh reads no such file.
    SHELL: "/bin/sh",
    __NIX_DARWIN_SET_ENVIRONMENT_DONE: "1",
    HOME: join(sb.state, "home"),
    XDG_CONFIG_HOME: join(sb.state, "xdg", "config"),
    XDG_DATA_HOME: join(sb.state, "xdg", "data"),
    XDG_STATE_HOME: join(sb.state, "xdg", "state"),
    XDG_CACHE_HOME: join(sb.state, "xdg", "cache"),
    TMPDIR: join(sb.shortDir, "tmp"),
    TMUX_TMPDIR: sb.shortDir,
    GIT_SSH_COMMAND: `/usr/bin/ssh ${sshOptions(sb.state)}`,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CEILING_DIRECTORIES: sb.root,
  });
  return env;
}

export async function addEnv(
  sb: Sandbox,
  assignment: string,
  reason: string,
): Promise<Sandbox> {
  const eq = assignment.indexOf("=");
  if (eq <= 0) throw new Error(`expected KEY=VALUE, got ${assignment}`);
  const key = assignment.slice(0, eq);
  if (isProtected(key)) {
    throw new Error(`${key} is part of the isolation and cannot be set`);
  }
  if (!reason.trim()) {
    throw new Error("--reason is required: say why the target needs it");
  }
  sb.env[key] = { value: assignment.slice(eq + 1), reason };
  await saveSandbox(sb);
  return sb;
}

export type ExecOptions = { timeoutSec: number; cwd?: string };

/** Runs the command in its own process group so a timeout also stops what it started. */
export async function sandboxCwd(
  sb: Sandbox,
  cwdArg?: string,
): Promise<string> {
  const cwd = await realpath(cwdArg ? resolve(sb.state, cwdArg) : sb.state);
  const inside = [sb.root, sb.shortDir].some((p) =>
    cwd === p || cwd.startsWith(`${p}/`)
  );
  if (!inside) {
    throw new Error(
      `--cwd ${cwd} is outside the sandbox; clone or copy what the product needs into it`,
    );
  }
  return cwd;
}

export async function execInSandbox(
  sb: Sandbox,
  cmd: string[],
  opts: ExecOptions,
): Promise<number> {
  const cwd = await sandboxCwd(sb, opts.cwd);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd[0]!, cmd.slice(1), {
      cwd,
      env: sandboxEnv(sb),
      stdio: "inherit",
      detached: true,
    });
    let timedOut = false;
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, signal);
      } catch {
        // The group is already gone.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 2000).unref();
    }, opts.timeoutSec * 1000);
    const forward = (signal: NodeJS.Signals) => () => killGroup(signal);
    const onInt = forward("SIGINT");
    const onTerm = forward("SIGTERM");
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
      // The group is not killed on a normal exit: a daemon the product starts must survive it,
      // or "start, then status" fails only inside the sandbox. destroy stops what is left.
      if (timedOut) {
        process.stderr.write(
          `explore-sandbox: timed out after ${opts.timeoutSec}s: ${
            cmd.join(" ")
          }\n`,
        );
        resolvePromise(124);
        return;
      }
      resolvePromise(code ?? 128 + (signal ? constants.signals[signal] : 0));
    });
  });
}

async function git(sb: Sandbox, args: string[], cwd?: string): Promise<string> {
  const result = await run("git", args, {
    cwd: cwd ?? sb.state,
    env: sandboxEnv(sb),
    clearEnv: true,
  });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** A clone whose origin is a bare repository inside the sandbox, so a push or sync never reaches the source. */
export async function cloneInto(
  sb: Sandbox,
  source: string,
  name: string,
): Promise<{ clone: string; origin: string }> {
  const src = await realpath(source);
  const clone = join(sb.state, name);
  const origin = join(sb.state, `${name}.origin.git`);
  await git(sb, ["clone", "--quiet", "--bare", src, origin]);
  // A bare clone keeps the source as its own origin; a push from inside it would reach the source.
  await git(sb, ["-C", origin, "remote", "remove", "origin"]);
  await git(sb, ["clone", "--quiet", origin, clone]);
  return { clone, origin };
}

/** Sockets and FIFOs are runtime artifacts of a running process; cp cannot copy them. */
const regularTree = (src: string) => {
  const st = lstatSync(src);
  return !st.isSocket() && !st.isFIFO() && !st.isCharacterDevice() &&
    !st.isBlockDevice();
};

/** Copies beside the destination and swaps it in, so a failed copy leaves the old one whole. */
async function replaceTree(from: string, to: string): Promise<void> {
  const next = `${to}.next`;
  const old = `${to}.old`;
  await rm(next, { recursive: true, force: true });
  await cp(from, next, {
    recursive: true,
    verbatimSymlinks: true,
    filter: regularTree,
  });
  await rm(old, { recursive: true, force: true });
  if (await exists(to)) await rename(to, old);
  await rename(next, to);
  await rm(old, { recursive: true, force: true });
}

export async function snapshotState(sb: Sandbox): Promise<void> {
  await replaceTree(sb.state, sb.template);
}

export async function resetState(sb: Sandbox): Promise<void> {
  if (!(await exists(sb.template))) {
    throw new Error("no template: run snapshot first");
  }
  await replaceTree(sb.template, sb.state);
}

async function ancestors(): Promise<Set<number>> {
  const table = await run("ps", ["-axo", "pid=,ppid="]);
  const parent = new Map<number, number>();
  for (const line of table.stdout.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid) parent.set(pid, ppid ?? 0);
  }
  const mine = new Set<number>();
  for (
    let pid = process.pid;
    pid > 1 && !mine.has(pid);
    pid = parent.get(pid) ?? 0
  ) mine.add(pid);
  return mine;
}

/**
 * Processes that belong to the sandbox: a working directory inside it (lsof; pgrep misses a
 * relative start), or a sandbox path in the command line or environment (ps eww), which also
 * finds a daemon that moved its cwd to /. This process and its ancestors are left out: the
 * shell that ran `destroy <root>` carries the root in its command line.
 */
export async function sandboxProcesses(
  paths: string[],
): Promise<Array<{ pid: number; command: string; cwd: string }>> {
  const inside = (p: string) =>
    paths.some((root) => p === root || p.startsWith(`${root}/`));
  const skip = await ancestors();
  const found = new Map<
    number,
    { pid: number; command: string; cwd: string }
  >();
  const uid = process.getuid?.() ?? 0;
  const lsof = await run("lsof", [
    "-a",
    "-d",
    "cwd",
    "-u",
    String(uid),
    "-Fpcn",
  ]);
  let pid = 0;
  let command = "";
  for (const line of lsof.stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("c")) command = line.slice(1);
    else if (line.startsWith("n") && inside(line.slice(1)) && !skip.has(pid)) {
      found.set(pid, { pid, command, cwd: line.slice(1) });
    }
  }
  const ps = await run("ps", ["eww", "-axo", "pid=,command="]);
  for (const line of ps.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const id = Number(match[1]);
    if (
      skip.has(id) || found.has(id) || !paths.some((p) => match[2]!.includes(p))
    ) continue;
    found.set(id, {
      pid: id,
      command: basename(match[2]!.split(/\s+/)[0] ?? ""),
      cwd: "(command line or environment)",
    });
  }
  return [...found.values()];
}

export async function destroySandbox(sb: Sandbox): Promise<string[]> {
  const done: string[] = [];
  const socketDir = join(sb.shortDir, `tmux-${process.getuid?.() ?? 0}`);
  for (
    const name of (await exists(socketDir)) ? await readdir(socketDir) : []
  ) {
    const socket = join(socketDir, name);
    const who = await run("tmux", [
      "-S",
      socket,
      "display",
      "-p",
      "#{socket_path}",
    ]).catch(() => null);
    if (who?.code === 0 && who.stdout.trim().startsWith(sb.shortDir)) {
      await run("tmux", ["-S", socket, "kill-server"]);
      done.push(`killed tmux server ${socket}`);
    }
  }
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const procs = await sandboxProcesses([sb.root, sb.shortDir]);
  for (const proc of procs) {
    try {
      process.kill(proc.pid, "SIGTERM");
    } catch {
      // Exited between the listing and the kill.
    }
  }
  const settle = async (rounds: number) => {
    for (let i = 0; i < rounds && procs.some((p) => alive(p.pid)); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  await settle(30);
  for (const proc of procs) {
    if (!alive(proc.pid)) continue;
    try {
      process.kill(proc.pid, "SIGKILL");
    } catch {
      // Exited just now.
    }
  }
  await settle(10);
  for (const proc of procs) {
    done.push(
      `${
        alive(proc.pid) ? "could not stop" : "stopped"
      } ${proc.command} (${proc.pid}) in ${proc.cwd}`,
    );
  }
  await rm(sb.shortDir, { recursive: true, force: true });
  await rm(sb.root, { recursive: true, force: true });
  done.push(`removed ${sb.root} and ${sb.shortDir}`);
  return done;
}

const HELP = `explore-sandbox.ts <command> <root> ...

  init <root>                              create the sandbox (root must be empty)
  exec <root> [--timeout S] [--cwd DIR] -- CMD...
                                           run CMD inside it (default timeout 120s, exit 124 on timeout;
                                           DIR must be inside the sandbox)
  clone <root> <source-repo> <name>        clone into state/<name>, origin = state/<name>.origin.git
  env-add <root> KEY=VALUE --reason TEXT   add a variable the target needs (isolation keys are refused)
  env <root>                               print the environment exec uses
  snapshot <root>                          save state/ as the template
  reset <root>                             restore state/ from the template
  info <root>                              print sandbox.json
  destroy <root>                           stop its tmux servers and processes, remove it`;

export async function main(argv: string[]): Promise<number> {
  const [command, rootArg, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(`${HELP}\n`);
    return command ? 0 : 2;
  }
  if (!rootArg) {
    process.stderr.write(`${HELP}\n`);
    return 2;
  }
  if (command === "init") {
    const sb = await initSandbox(rootArg);
    process.stdout.write(
      `${
        JSON.stringify({
          root: sb.root,
          state: sb.state,
          shortDir: sb.shortDir,
        })
      }\n`,
    );
    return 0;
  }
  const sb = await loadSandbox(rootArg);
  switch (command) {
    case "exec": {
      const dash = rest.indexOf("--");
      if (dash < 0 || dash === rest.length - 1) {
        process.stderr.write("exec needs -- followed by the command\n");
        return 2;
      }
      const flags = rest.slice(0, dash);
      let timeoutSec = 120;
      let cwd: string | undefined;
      for (let i = 0; i < flags.length; i += 2) {
        if (flags[i] === "--timeout") timeoutSec = Number(flags[i + 1]);
        else if (flags[i] === "--cwd") cwd = flags[i + 1];
        else {
          process.stderr.write(`unknown flag ${flags[i]}\n`);
          return 2;
        }
      }
      // setTimeout holds a signed 32-bit millisecond count; past it the timer fires at once.
      if (
        !Number.isFinite(timeoutSec) || timeoutSec <= 0 ||
        timeoutSec > 2_147_483
      ) {
        process.stderr.write(
          "--timeout must be between 1 and 2147483 seconds\n",
        );
        return 2;
      }
      try {
        await sandboxCwd(sb, cwd);
      } catch (error) {
        process.stderr.write(`explore-sandbox: ${(error as Error).message}\n`);
        return 2;
      }
      return execInSandbox(sb, rest.slice(dash + 1), { timeoutSec, cwd });
    }
    case "clone": {
      const [source, name] = rest;
      if (!source || !name) {
        process.stderr.write("clone <root> <source-repo> <name>\n");
        return 2;
      }
      process.stdout.write(
        `${JSON.stringify(await cloneInto(sb, source, name))}\n`,
      );
      return 0;
    }
    case "env-add": {
      const [assignment, flag, reason] = rest;
      if (!assignment || flag !== "--reason" || reason === undefined) {
        process.stderr.write("env-add <root> KEY=VALUE --reason TEXT\n");
        return 2;
      }
      await addEnv(sb, assignment, reason);
      return 0;
    }
    case "env":
      for (const [key, value] of Object.entries(sandboxEnv(sb))) {
        process.stdout.write(`${key}=${value}\n`);
      }
      return 0;
    case "snapshot":
      await snapshotState(sb);
      return 0;
    case "reset":
      await resetState(sb);
      return 0;
    case "info":
      process.stdout.write(`${JSON.stringify(sb, null, 2)}\n`);
      return 0;
    case "destroy":
      for (const line of await destroySandbox(sb)) {
        process.stdout.write(`${line}\n`);
      }
      return 0;
    default:
      process.stderr.write(`unknown command ${command}\n${HELP}\n`);
      return 2;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(
        `explore-sandbox: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
      process.exit(1);
    },
  );
}
