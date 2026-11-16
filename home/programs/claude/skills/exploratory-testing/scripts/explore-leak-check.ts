#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null
// Compares the real side before and after an exploratory session. Usage: SKILL.md, or `explore-leak-check.ts help`.

import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { run } from "../../../../agents/lib/proc.ts";
import { loadSandbox, sandboxProcesses } from "./explore-sandbox.ts";

export type Baseline = {
  time: string;
  real: string;
  git: Record<GitItem, string[]>;
  watch: Record<string, Record<string, string>>;
  /** Watched directories with more files than the limit; changes past it are not seen. */
  truncated: string[];
  ports: string[];
};

type GitItem = "status" | "worktrees" | "refs" | "stash" | "config";

const WATCH_LIMIT = 2000;

async function gitLines(repo: string, args: string[]): Promise<string[]> {
  const result = await run("git", ["-C", repo, ...args]);
  if (result.code !== 0) throw new Error(`git ${args.join(" ")} in ${repo}: ${result.stderr.trim()}`);
  return result.stdout.split("\n").filter((line) => line !== "");
}

async function gitState(repo: string): Promise<Record<GitItem, string[]>> {
  const commonDir = (await gitLines(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))[0]!;
  const config = await readFile(join(commonDir, "config"), "utf8");
  return {
    status: await gitLines(repo, ["status", "--porcelain=v1", "-uall"]),
    worktrees: await gitLines(repo, ["worktree", "list", "--porcelain"]),
    refs: await gitLines(repo, [
      "for-each-ref",
      "--format=%(refname) %(objectname:short) %(committerdate:iso-strict) %(authorname)",
      "refs/heads",
      "refs/tags",
      // A push from the real repository moves only its remote-tracking ref.
      "refs/remotes",
    ]),
    stash: await gitLines(repo, ["stash", "list"]),
    config: config.split("\n").filter((line) => line.trim() !== ""),
  };
}

async function hashTree(dir: string): Promise<{ files: Record<string, string>; truncated: boolean }> {
  const out: Record<string, string> = {};
  let truncated = false;
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (Object.keys(out).length >= WATCH_LIMIT) {
        truncated = true;
        return;
      }
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        out[relative(dir, path)] = createHash("sha256").update(await readFile(path)).digest("hex").slice(0, 16);
      }
    }
  };
  await walk(dir);
  return { files: out, truncated };
}

async function listeningPorts(): Promise<string[]> {
  const result = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fcn"]);
  const ports = new Set<string>();
  let command = "";
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("c")) command = line.slice(1);
    else if (line.startsWith("n")) ports.add(`${command} ${line.slice(1)}`);
  }
  return [...ports].sort();
}

export async function takeBaseline(real: string, watch: string[]): Promise<Baseline> {
  const watched: Record<string, Record<string, string>> = {};
  const truncated: string[] = [];
  for (const dir of watch) {
    const tree = await hashTree(dir);
    watched[dir] = tree.files;
    if (tree.truncated) truncated.push(dir);
  }
  return {
    time: new Date().toISOString(),
    real: await realpath(real),
    git: await gitState(real),
    watch: watched,
    truncated,
    ports: await listeningPorts(),
  };
}

function lineDiff(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return { added: after.filter((l) => !b.has(l)), removed: before.filter((l) => !a.has(l)) };
}

export type CheckOptions = {
  sandboxPaths: string[];
  /** The tmux server to search; the default is the one the caller reaches, which is the user's own. */
  tmuxSocket?: string;
  github?: string;
};

export type Report = {
  stop: boolean;
  leaks: string[];
  git: Partial<Record<GitItem, { added: string[]; removed: string[] }>>;
  watch: Record<string, { added: string[]; removed: string[]; changed: string[] }>;
  processes: Array<{ pid: number; command: string; cwd: string }>;
  portsNew: string[];
  issuesNew: Array<{ number: number; title: string }> | null;
  notes: string[];
};

/** A shell records the logical path (/var/folders/...), lsof and realpath the physical one. */
export function pathForms(paths: string[]): string[] {
  return [...new Set(paths.flatMap((p) => [p, p.replace(/^\/private\/(tmp|var|etc)\//, "/$1/")]))];
}

function pathsHits(lines: string[], paths: string[], label: string): string[] {
  return lines.filter((line) => paths.some((p) => line.includes(p))).map((line) => `${label}: ${line}`);
}

export async function check(baseline: Baseline, opts: CheckOptions): Promise<Report> {
  const report: Report = {
    stop: false,
    leaks: [],
    git: {},
    watch: {},
    processes: [],
    portsNew: [],
    issuesNew: null,
    notes: [],
  };
  const paths = pathForms(opts.sandboxPaths);

  const tmuxArgs = [
    ...(opts.tmuxSocket ? ["-S", opts.tmuxSocket] : []),
    "list-panes",
    "-a",
    "-F",
    "#{session_name}\t#{window_id}\t#{pane_current_path}\t#{pane_start_command}",
  ];
  const tmux = await run("tmux", tmuxArgs).catch((error: Error) => ({ code: -1, stdout: "", stderr: error.message }));
  if (tmux.code === 0) report.leaks.push(...pathsHits(tmux.stdout.split("\n"), paths, "tmux pane"));
  else report.notes.push(`tmux not searched: ${tmux.stderr.trim() || `exit ${tmux.code}`}`);

  const zoxide = await run("zoxide", ["query", "-l"]).catch(() => null);
  if (zoxide && zoxide.code === 0) report.leaks.push(...pathsHits(zoxide.stdout.split("\n"), paths, "zoxide"));
  else report.notes.push("zoxide not searched");

  const now = await gitState(baseline.real);
  report.leaks.push(...pathsHits(now.worktrees, paths, "worktree of the real repository"));
  for (const item of Object.keys(now) as GitItem[]) {
    const diff = lineDiff(baseline.git[item], now[item]);
    if (diff.added.length || diff.removed.length) report.git[item] = diff;
  }

  for (const dir of baseline.truncated ?? []) {
    report.notes.push(`watch ${dir} holds more than ${WATCH_LIMIT} files; changes past them are not seen`);
  }
  for (const [dir, before] of Object.entries(baseline.watch)) {
    const after = (await hashTree(dir)).files;
    const added = Object.keys(after).filter((k) => !(k in before));
    const removed = Object.keys(before).filter((k) => !(k in after));
    const changed = Object.keys(after).filter((k) => k in before && before[k] !== after[k]);
    if (added.length || removed.length || changed.length) report.watch[dir] = { added, removed, changed };
  }

  report.processes = await sandboxProcesses(paths);
  report.portsNew = lineDiff(baseline.ports, await listeningPorts()).added;

  if (opts.github) {
    const issues = await run("gh", [
      "issue",
      "list",
      "-R",
      opts.github,
      "--author",
      "@me",
      "--state",
      "all",
      "--search",
      `created:>=${baseline.time.slice(0, 19)}Z`,
      "--json",
      "number,title",
    ]);
    if (issues.code === 0) report.issuesNew = JSON.parse(issues.stdout) as Array<{ number: number; title: string }>;
    else report.notes.push(`issues not listed: ${issues.stderr.trim()}`);
  }

  report.stop = report.leaks.length > 0;
  return report;
}

const HELP = `explore-leak-check.ts <command> ...

  snapshot --real REPO --out FILE [--watch DIR]...
      record the real repository's git state, the watched directories and the listening ports
  check --baseline FILE --sandbox ROOT [--github OWNER/REPO] [--tmux-socket PATH]
      compare with the baseline and print a JSON report; exit 3 when a sandbox path shows up
      on the real side (tmux panes, zoxide, the real repository's worktrees)`;

function flagValues(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1]) values.push(args[++i]!);
  return values;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "snapshot") {
    const [real] = flagValues(rest, "--real");
    const [out] = flagValues(rest, "--out");
    if (!real || !out) {
      process.stderr.write(`${HELP}\n`);
      return 2;
    }
    const watch: string[] = [];
    for (const dir of flagValues(rest, "--watch")) {
      if ((await stat(dir).catch(() => null))?.isDirectory()) watch.push(await realpath(dir));
      else process.stderr.write(`explore-leak-check: --watch ${dir} is not a directory; skipped\n`);
    }
    await writeFile(out, `${JSON.stringify(await takeBaseline(real, watch))}\n`);
    return 0;
  }
  if (command === "check") {
    const [baselinePath] = flagValues(rest, "--baseline");
    const [root] = flagValues(rest, "--sandbox");
    if (!baselinePath || !root) {
      process.stderr.write(`${HELP}\n`);
      return 2;
    }
    const sb = await loadSandbox(root);
    const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as Baseline;
    const report = await check(baseline, {
      sandboxPaths: [sb.root, sb.shortDir],
      github: flagValues(rest, "--github")[0],
      tmuxSocket: flagValues(rest, "--tmux-socket")[0],
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.stop ? 3 : 0;
  }
  process.stdout.write(`${HELP}\n`);
  return command === "help" || command === "--help" ? 0 : 2;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`explore-leak-check: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
