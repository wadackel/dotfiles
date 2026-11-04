import { spawn } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { constants as osConstants, homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { PlanEvidence, PlanTask } from "./plan-state.ts";

export interface Requirement {
  id: string;
  kind: "file-state" | "orchestrator-only" | "live" | "audit" | "review";
  expected?: { file: string } | { git_head: true } | { identity: string };
}

export interface Check {
  id: string;
  status: "pass" | "fail" | "blocked" | "waived";
  target: string;
  command: string;
  output: string;
  observed?: string;
  expected?: string;
  authorization?: string;
  /** Written by the helper, never accepted from `record`'s stdin: the tree OID the target was taken from and, for `run`, how the command ran. */
  tree?: string;
  argv?: string[];
  cwd?: string;
  env?: Record<string, string>;
  exit?: number;
  expectExit?: number;
  expectUnchanged?: boolean;
  durationMs?: number;
  mutated?: string[];
  truncated?: boolean;
  /** `run --red`: the check failed before the source change, as the plan asked; it never verifies a task. */
  red?: boolean;
}

const KINDS = new Set([
  "file-state",
  "orchestrator-only",
  "live",
  "audit",
  "review",
]);
const RESULTS = new Set(["pass", "fail", "blocked", "waived"]);

/** Environment keys `run --env` may set. Anything else (GIT_SSH_COMMAND,
 * NODE_OPTIONS, DYLD_INSERT_LIBRARIES, …) turns an allowed argv into
 * arbitrary code, so both the helper and the bash-policy hook refuse it. */
export const RUN_ENV_KEYS: ReadonlySet<string> = new Set([
  "CLAUDECODE",
  "CI",
  "NO_COLOR",
  "FORCE_COLOR",
  "TZ",
  "LANG",
  "LC_ALL",
]);

export interface RunArgs {
  path: string;
  task: string;
  id: string;
  expectExit: number;
  tail: number;
  grep: string | null;
  env: Record<string, string>;
  cwd: string | null;
  expectUnchanged: boolean;
  red: boolean;
  argv: string[];
}

/**
 * Parses the tokens after `run`: `<path> <task> <id> [options] -- <argv>`.
 * The bash-policy hook and plan-state.ts both call this, so the argv the hook
 * inspects is the argv the helper spawns. The first bare `--` ends the options;
 * an option value may not start with `--`, so no value can be mistaken for it.
 */
export function splitRunArgs(tokens: string[]): RunArgs {
  const [path, task, id, ...rest] = tokens;
  if (!path || !task || !id) {
    throw new Error("run needs <evidence> <task-id> <check-id>");
  }
  const args: RunArgs = {
    path,
    task,
    id,
    expectExit: 0,
    tail: 20,
    grep: null,
    env: {},
    cwd: null,
    expectUnchanged: false,
    red: false,
    argv: [],
  };
  let expectExitGiven = false;
  let i = 0;
  const value = (name: string): string => {
    const v = rest[i + 1];
    if (v === undefined || v.startsWith("--")) {
      throw new Error(`${name} needs a value`);
    }
    i += 2;
    return v;
  };
  while (i < rest.length) {
    const token = rest[i];
    if (token === "--") {
      args.argv = rest.slice(i + 1);
      break;
    }
    switch (token) {
      case "--expect-exit": {
        const n = Number(value(token));
        if (!Number.isInteger(n) || n < 0 || n > 255) {
          throw new Error("--expect-exit needs an integer 0-255");
        }
        args.expectExit = n;
        expectExitGiven = true;
        break;
      }
      case "--tail": {
        const n = Number(value(token));
        if (!Number.isInteger(n) || n < 0) {
          throw new Error("--tail needs a non-negative integer");
        }
        args.tail = n;
        break;
      }
      case "--grep": {
        const re = value(token);
        try {
          new RegExp(re);
        } catch (err) {
          throw new Error(
            `--grep: invalid regular expression: ${(err as Error).message}`,
          );
        }
        args.grep = re;
        break;
      }
      case "--env": {
        const kv = value(token);
        const eq = kv.indexOf("=");
        if (eq <= 0) throw new Error("--env needs KEY=VALUE");
        const key = kv.slice(0, eq);
        if (!RUN_ENV_KEYS.has(key)) {
          throw new Error(
            `--env ${key} is not allowed; keys: ${[...RUN_ENV_KEYS].join(" ")}`,
          );
        }
        args.env[key] = kv.slice(eq + 1);
        break;
      }
      case "--cwd":
        args.cwd = value(token);
        break;
      case "--expect-unchanged":
        args.expectUnchanged = true;
        i += 1;
        break;
      case "--red":
        args.red = true;
        i += 1;
        break;
      default:
        throw new Error(
          `unknown run option ${token}; options end at -- <command>`,
        );
    }
  }
  if (args.argv.length === 0) {
    throw new Error("run needs `-- <command> [args…]` after the options");
  }
  if (args.red && expectExitGiven) {
    throw new Error("--red and --expect-exit cannot be combined");
  }
  if (args.red && args.expectUnchanged) {
    throw new Error("--red and --expect-unchanged cannot be combined");
  }
  for (const word of args.argv) {
    if (word.slice(word.lastIndexOf("/") + 1) === "plan-state.ts") {
      throw new Error("run may not invoke plan-state.ts itself");
    }
  }
  return args;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected an object");
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be non-empty`);
  }
  return value;
}

export function requirements(value: unknown): Requirement[] {
  if (!Array.isArray(value)) {
    throw new Error("required checks must be an array");
  }
  const result = value.map((item): Requirement => {
    const obj = object(item);
    const id = nonempty(obj.id, "id");
    if (!KINDS.has(String(obj.kind))) throw new Error("invalid check kind");
    const result: Requirement = { id, kind: obj.kind as Requirement["kind"] };
    if (result.kind === "live") {
      const expected = object(obj.expected);
      if (Object.keys(expected).length !== 1) {
        throw new Error("expected must have one identity source");
      }
      if (expected.file !== undefined) {
        result.expected = { file: nonempty(expected.file, "expected file") };
      } else if (expected.git_head === true) {
        result.expected = { git_head: true };
      } else if (expected.identity !== undefined) {
        result.expected = {
          identity: nonempty(expected.identity, "expected identity"),
        };
      } else throw new Error("invalid expected identity source");
    }
    return result;
  });
  if (new Set(result.map((r) => r.id)).size !== result.length) {
    throw new Error("duplicate required check id");
  }
  return result;
}

// ---- argv permission (the helper's own copy of the hook's check) ----
//
// The bash-policy hook judges the argv as the shell shows it; the helper judges
// the argv it actually received, right before spawning. Both read the same
// settings and rules. This file may import only node:* (the Codex eval harness
// copies it alone), so the glob matcher and the rule parser live here as well.

function globPattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(
    /\*/g,
    "[\\s\\S]*",
  ).replace(/\?/g, "[\\s\\S]");
  return new RegExp(`^${escaped}$`);
}

/** `.claude/bash-policy.yaml` in the root and every ancestor. The hook stops at the first one it finds; reading them all keeps the helper the stricter side. */
function projectPolicyPaths(root: string): string[] {
  const paths: string[] = [];
  let dir = root;
  while (true) {
    paths.push(join(dir, ".claude", "bash-policy.yaml"));
    const parent = dirname(dir);
    if (parent === dir) return paths;
    dir = parent;
  }
}

function matchesGlob(segment: string, pattern: string): boolean {
  if (globPattern(pattern).test(segment)) return true;
  return pattern.endsWith(" *") && segment === pattern.slice(0, -2);
}

/** `Bash(<glob>)` → `<glob>`, the way `extractAllowedPattern` in claude/scripts/shell-utils.ts reads it. */
function permissionGlob(entry: string): string | null {
  const m = entry.match(/^Bash\((.+)\)$/);
  if (!m) return null;
  let content = m[1];
  const colon = content.indexOf(":");
  if (colon !== -1) {
    content = `${content.slice(0, colon)} ${content.slice(colon + 1)}`;
  }
  const tokens = content.split(/\s+/);
  let start = 0;
  while (
    start < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[start])
  ) start++;
  if (start >= tokens.length) return null;
  const first = tokens[start].replace(/^\*+/, "").replace(/\*+$/, "");
  if (
    first === "" || first.startsWith("-") || first.startsWith("//") ||
    /^[><#!]/.test(first)
  ) {
    return null;
  }
  return tokens.slice(start).join(" ");
}

async function permissionGlobs(
  paths: string[],
  key: "allow" | "deny" | "ask",
): Promise<string[]> {
  const result: string[] = [];
  for (const path of paths) {
    let json: { permissions?: Record<string, unknown> };
    try {
      json = JSON.parse(await readFile(path, "utf8"));
    } catch {
      continue;
    }
    const list = json?.permissions?.[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const glob = typeof entry === "string" ? permissionGlob(entry) : null;
      if (glob && !result.includes(glob)) result.push(glob);
    }
  }
  return result;
}

interface PolicyRule {
  pattern: string;
  message: string;
  exclude: string[];
}

/** bash-policy.yaml holds only `- pattern: "<glob>"` / `message:` / `exclude:` lines (config-lint pins the shape). */
async function policyRules(paths: string[]): Promise<PolicyRule[]> {
  const rules: PolicyRule[] = [];
  for (const path of paths) {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      continue;
    }
    let current: PolicyRule | null = null;
    let inExclude = false;
    for (const line of text.split("\n")) {
      const pattern = line.match(/^\s*-\s*pattern:\s*"(.*)"\s*$/);
      if (pattern) {
        current = { pattern: pattern[1], message: "", exclude: [] };
        rules.push(current);
        inExclude = false;
        continue;
      }
      if (!current) continue;
      const message = line.match(/^\s*message:\s*"(.*)"\s*$/);
      if (message) {
        current.message = message[1];
        inExclude = false;
        continue;
      }
      if (/^\s*exclude:\s*$/.test(line)) {
        inExclude = true;
        continue;
      }
      const item = line.match(/^\s*-\s*"(.*)"\s*$/);
      if (inExclude && item) current.exclude.push(item[1]);
    }
  }
  return rules;
}

const GIT_FLAGS_WITH_ARG = new Set(["-c", "-C", "--git-dir", "--work-tree"]);
const GIT_FLAGS_STANDALONE = new Set([
  "--no-pager",
  "--bare",
  "--no-replace-objects",
]);

function withoutGitGlobalFlags(argv: string[]): string[] {
  if (argv[0] !== "git") return argv;
  const out = ["git"];
  let i = 1;
  while (i < argv.length) {
    const t = argv[i];
    if (GIT_FLAGS_WITH_ARG.has(t)) i += 2;
    else if (
      GIT_FLAGS_STANDALONE.has(t) || /^-c.+=/.test(t) || /^-C./.test(t)
    ) i += 1;
    else break;
  }
  return out.concat(argv.slice(i));
}

/**
 * Refuses an argv that a direct Bash call could not run: a bash-policy rule,
 * then permissions.deny / ask, then absence from permissions.allow. Applied
 * whenever `~/.claude/settings.json` exists, not only under `CLAUDECODE`:
 * a wrapper can clear that variable, and Codex on this machine runs every
 * command without confirmation anyway.
 */
export async function assertArgvPermitted(opts: {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  root: string;
}): Promise<void> {
  for (const key of Object.keys(opts.env)) {
    if (!RUN_ENV_KEYS.has(key)) {
      throw new Error(
        `--env ${key} is not allowed; keys: ${[...RUN_ENV_KEYS].join(" ")}`,
      );
    }
  }
  if (opts.cwd !== opts.root && !opts.cwd.startsWith(`${opts.root}/`)) {
    throw new Error("--cwd must be inside the repository");
  }
  for (const word of opts.argv) {
    if (word.slice(word.lastIndexOf("/") + 1) === "plan-state.ts") {
      throw new Error("run may not invoke plan-state.ts itself");
    }
  }
  const head = opts.argv[0] ?? "";
  if (ARGV_WRAPPERS.has(head.slice(head.lastIndexOf("/") + 1))) {
    throw new Error(
      `run may not start with the wrapper "${head}"; name the command itself`,
    );
  }
  // Active wherever Claude Code is set up, so no environment variable a caller
  // controls can switch it off; a machine without ~/.claude/settings.json has
  // no allow list to mirror.
  const home = process.env.HOME ?? homedir();
  try {
    await stat(`${home}/.claude/settings.json`);
  } catch {
    return;
  }
  const forms = [
    opts.argv.join(" "),
    withoutGitGlobalFlags(opts.argv).join(" "),
  ];
  const rules = await policyRules([
    `${home}/.claude/scripts/bash-policy.yaml`,
    ...projectPolicyPaths(opts.root),
  ]);
  for (const rule of rules) {
    if (!forms.some((f) => matchesGlob(f, rule.pattern))) continue;
    if (forms.some((f) => rule.exclude.some((e) => matchesGlob(f, e)))) {
      continue;
    }
    throw new Error(
      `command matches bash-policy rule "${rule.pattern}": ${rule.message}`,
    );
  }
  const settings = [
    `${home}/.claude/settings.json`,
    `${opts.root}/.claude/settings.json`,
    `${opts.root}/.claude/settings.local.json`,
  ];
  for (const key of ["deny", "ask"] as const) {
    const globs = await permissionGlobs(settings, key);
    if (forms.some((f) => globs.some((g) => matchesGlob(f, g)))) {
      throw new Error(`command "${forms[0]}" matches permissions.${key}`);
    }
  }
  const allow = await permissionGlobs(settings, "allow");
  if (!forms.some((f) => allow.some((g) => matchesGlob(f, g)))) {
    throw new Error(
      `command "${
        forms[0]
      }" is not in permissions.allow of ~/.claude/settings.json; add an allow rule, or in Claude Code run it directly once to get permission`,
    );
  }
}

/**
 * Commands that run their arguments. Deny entries and the rules are anchored at
 * the first word, so `timeout 9 git push -f origin main` would match only the
 * allow entry for `timeout`; the argv has to name the command itself.
 */
export const ARGV_WRAPPERS = new Set([
  "timeout",
  "time",
  "nice",
  "nohup",
  "stdbuf",
  "caffeinate",
  "env",
  "command",
  "exec",
  "builtin",
  "eval",
  "sudo",
  "xargs",
  "sh",
  "bash",
  "zsh",
  "dash",
]);

/** Fields the helper writes itself; a `record` from stdin may not carry them. */
export const HELPER_FIELDS = [
  "tree",
  "argv",
  "cwd",
  "env",
  "exit",
  "expectExit",
  "expectUnchanged",
  "durationMs",
  "mutated",
  "truncated",
  "red",
] as const;

function helperField(
  key: (typeof HELPER_FIELDS)[number],
  value: unknown,
): Check[typeof key] {
  switch (key) {
    case "tree":
    case "cwd":
      return nonempty(value, key) as never;
    case "argv":
    case "mutated":
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        throw new Error(`${key} must be a string array`);
      }
      return value as never;
    case "env":
      if (
        !value || typeof value !== "object" || Array.isArray(value) ||
        Object.values(value).some((v) => typeof v !== "string")
      ) {
        throw new Error("env must be a string map");
      }
      return value as never;
    case "exit":
    case "expectExit":
    case "durationMs":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${key} must be a number`);
      }
      return value as never;
    case "expectUnchanged":
    case "truncated":
    case "red":
      if (typeof value !== "boolean") {
        throw new Error(`${key} must be a boolean`);
      }
      return value as never;
  }
}

export function check(
  value: unknown,
  source: "stdin" | "file" = "stdin",
): Check {
  const obj = object(value);
  if (!RESULTS.has(String(obj.status))) throw new Error("invalid check status");
  const result: Check = {
    id: nonempty(obj.id, "id"),
    status: obj.status as Check["status"],
    target: nonempty(obj.target, "target"),
    command: nonempty(obj.command, "command"),
    output: nonempty(obj.output, "output"),
  };
  for (
    const key of ["observed", "expected", "authorization"] as const
  ) {
    if (obj[key] !== undefined) result[key] = nonempty(obj[key], key);
  }
  for (const key of HELPER_FIELDS) {
    if (obj[key] === undefined) continue;
    if (source === "stdin") {
      throw new Error(`${key} is written by run; use run instead of record`);
    }
    Object.assign(result, { [key]: helperField(key, obj[key]) });
  }
  if (result.status === "waived" && !result.authorization) {
    throw new Error("waived checks require explicit user authorization");
  }
  return result;
}

// spawn rather than execFile: execFile throws once the output passes its 1 MiB
// maxBuffer, which a large `git ls-files` reaches.
export function runGit(
  args: string[],
  cwd = process.cwd(),
  env: Record<string, string> = {},
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        success: code === 0,
        stdout: new TextDecoder().decode(Buffer.concat(out)),
        stderr: new TextDecoder().decode(Buffer.concat(err)),
      });
    });
  });
}

async function git(
  args: string[],
  cwd = process.cwd(),
  env: Record<string, string> = {},
): Promise<string> {
  const result = await runGit(args, cwd, env);
  if (!result.success) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

export async function repository(cwd = process.cwd()): Promise<string> {
  return await realpath(
    (await git(["rev-parse", "--show-toplevel"], cwd)).trim(),
  );
}

/** The repository the first `start` bound, whatever the current directory:
 * a session's cwd drifts (a `cd` into a scratch dir, a multi-repo plan), and
 * comparing it with the record only turned that drift into a failed command. */
export async function assertRepository(data: PlanEvidence): Promise<string> {
  if (!data.repository) {
    throw new Error("repository is not bound; start a task first");
  }
  let root: string;
  try {
    root = await repository(data.repository);
  } catch (err) {
    throw new Error(
      `recorded repository ${data.repository} is not a git work tree: ${
        (err as Error).message
      }`,
    );
  }
  if (root !== data.repository) {
    throw new Error(
      `recorded repository ${data.repository} is not a work tree root`,
    );
  }
  return root;
}

// Each agent keeps its own plans directory and a machine may have only one of
// them (Codex not installed, or a fresh Claude setup), so a missing directory is
// skipped rather than treated as an error.
export async function plansDirs(home: string): Promise<string[]> {
  const dirs: string[] = [];
  for (const agent of [".codex", ".claude"]) {
    try {
      dirs.push(await realpath(`${home}/${agent}/plans`));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  if (dirs.length === 0) {
    throw new Error(
      `neither ${home}/.codex/plans nor ${home}/.claude/plans exists`,
    );
  }
  return dirs;
}

/**
 * A word with no `/` that does not end in `.evidence.json` names a plan: its
 * sidecar is looked up in the plans directories, and a name present in both is
 * refused rather than picked. Anything else is returned as given. The hook and
 * the helper both resolve through this, so the sidecar the hook inspects is the
 * one the helper runs.
 */
export async function resolveEvidencePath(
  word: string,
  home = process.env.HOME,
): Promise<string> {
  if (word.includes("/") || word.endsWith(".evidence.json")) return word;
  if (!home) throw new Error("HOME is not set");
  const found: string[] = [];
  for (const dir of await plansDirs(home)) {
    try {
      await lstat(`${dir}/${word}.evidence.json`);
      found.push(`${dir}/${word}.evidence.json`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  if (found.length === 0) throw new Error(`no sidecar named ${word}`);
  if (found.length > 1) {
    throw new Error(
      `${word} names a sidecar in both ${found.join(" and ")}; pass the path`,
    );
  }
  return found[0];
}

async function digest(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string"
    ? new TextEncoder().encode(data)
    : data;
  const hash = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return Array.from(
    new Uint8Array(hash),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

export interface Snapshot {
  target: string;
  tree: string;
  root: string;
}

/** Objects written while fingerprinting live next to the sidecar, never in
 * `.git`: the repository's object store may be read-only (Codex's
 * workspace-write sandbox), and keeping the trees lets a stale rejection name
 * the paths that changed since the record. */
export function objectDir(path: string): string {
  return path.replace(/\.evidence\.json$/, ".objects");
}

async function gitEnv(
  path: string,
  root: string,
  index?: string,
): Promise<Record<string, string>> {
  const common = (await git(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    root,
  )).trim();
  const objects = objectDir(path);
  await mkdir(objects, { recursive: true });
  const env: Record<string, string> = {
    GIT_OBJECT_DIRECTORY: objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(common, "objects"),
  };
  if (index) env.GIT_INDEX_FILE = index;
  return env;
}

/**
 * The target is the tree OID of the working tree (tracked and non-ignored
 * untracked files, modes, symlink targets) plus the plan file. HEAD and the
 * index are not part of it, so a commit or a stage of the same content keeps
 * every record current. The index is copied so git's stat cache decides which
 * files to re-hash; a fresh index would re-hash the whole repository.
 */
export async function artifactSnapshot(
  path: string,
  data: PlanEvidence,
): Promise<Snapshot> {
  const root = await assertRepository(data);
  const planPath = `${path.slice(0, path.lastIndexOf("/"))}/${data.plan}`;
  const planInfo = await lstat(planPath);
  if (!planInfo.isFile() || planInfo.isSymbolicLink()) {
    throw new Error("plan must be a regular file");
  }
  const tree = await workingTree(path, root);
  const target = await digest(JSON.stringify([
    root,
    tree,
    await realpath(planPath),
    await digest(await readFile(planPath)),
  ]));
  return { target, tree, root };
}

// The repository's hooks, fsmonitor and LFS smudge never run from here: a
// review copy must not execute code the change under review could define,
// and a snapshot of a temp index must not fire post-index-change.
const QUIET_GIT = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
  "--no-optional-locks",
];

/** The tree OID of the working tree alone, without the plan: `start` records it before a plan file may exist. */
export async function workingTree(path: string, root: string): Promise<string> {
  const tmp = await mkdtemp(join(tmpdir(), "plan-evidence-index-"));
  try {
    const index = join(tmp, "index");
    const indexPath = (await git(
      ["rev-parse", "--path-format=absolute", "--git-path", "index"],
      root,
    )).trim();
    try {
      // git re-hashes a file whose mtime is not older than the index's own
      // mtime (racily clean entries); a fresh copy would be newer than every
      // file and a same-size edit made just now would be trusted as unchanged.
      const info = await stat(indexPath);
      await copyFile(indexPath, index);
      await utimes(index, info.atime, info.mtime);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const env = await gitEnv(path, root, index);
    const add = await runGit([...QUIET_GIT, "add", "-A", "."], root, env);
    if (!add.success) {
      const stderr = add.stderr.trim();
      if (
        /does not have a commit checked out|embedded git repository/.test(
          stderr,
        )
      ) {
        throw new Error(`cannot fingerprint non-file or submodule: ${stderr}`);
      }
      throw new Error(`git add -A failed: ${stderr}`);
    }
    const stage = await git([...QUIET_GIT, "ls-files", "--stage", "-z"], root, env);
    for (const line of stage.split("\0").filter(Boolean)) {
      if (line.startsWith("160000 ")) {
        const name = line.slice(line.indexOf("\t") + 1);
        throw new Error(`cannot fingerprint non-file or submodule: ${name}`);
      }
    }
    return (await git([...QUIET_GIT, "write-tree"], root, env)).trim();
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function snapshot(
  path: string,
  data: PlanEvidence,
): Promise<string> {
  return (await artifactSnapshot(path, data)).target;
}

export const OUTPUT_HEAD = 4096;
export const OUTPUT_TAIL = 16384;

/** Keeps the start and the end of a long output; the middle is where test
 * runners repeat themselves and the sidecar would otherwise carry 100k chars. */
export function truncateOutput(
  text: string,
): { text: string; truncated: boolean } {
  if (text.length <= OUTPUT_HEAD + OUTPUT_TAIL) {
    return { text, truncated: false };
  }
  const omitted = text.length - OUTPUT_HEAD - OUTPUT_TAIL;
  return {
    text: `${text.slice(0, OUTPUT_HEAD)}\n…[${omitted} chars omitted]…\n${
      text.slice(-OUTPUT_TAIL)
    }`,
    truncated: true,
  };
}

export interface ExecResult {
  exit: number;
  output: string;
  durationMs: number;
}

/**
 * Runs argv with no shell: what the hook inspected is what gets executed.
 * stdout and stderr are kept in arrival order; the child has no stdin and
 * leads its own process group so a SIGINT / SIGTERM to the helper reaches
 * grandchildren too.
 */
export function executeArgv(
  opts: { argv: string[]; cwd: string; env: Record<string, string> },
): Promise<ExecResult> {
  const [cmd, ...rest] = opts.argv;
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, rest, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    const forward = (signal: NodeJS.Signals) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      }
    };
    const onInt = () => forward("SIGINT");
    const onTerm = () => forward("SIGTERM");
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    const done = () => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
    };
    child.on("error", (err) => {
      done();
      resolve({
        exit: 127,
        output: `cannot start ${cmd}: ${err.message}`,
        durationMs: Date.now() - started,
      });
    });
    child.on("close", (code, signal) => {
      done();
      const output = new TextDecoder().decode(Buffer.concat(chunks));
      resolve({
        exit: code ??
          (signal ? 128 + (osConstants.signals[signal] ?? 15) : 1),
        output: output.length ? output : "(no output)",
        durationMs: Date.now() - started,
      });
    });
  });
}

/** Paths that differ between two recorded trees, or [] when either tree is gone. */
export async function changedPaths(
  path: string,
  before: string,
  after: string,
  root: string,
): Promise<string[]> {
  if (before === after) return [];
  const result = await runGit(
    ["diff-tree", "--name-only", "-r", "--end-of-options", before, after],
    root,
    await gitEnv(path, root),
  );
  if (!result.success) return [];
  return result.stdout.split("\n").filter(Boolean);
}

const NO_SMUDGE = { GIT_LFS_SKIP_SMUDGE: "1" };

/** A unified diff between two recorded trees (or commits), whatever the repository's diff settings say. */
export async function treeDiff(
  opts: {
    path: string;
    root: string;
    from: string;
    to: string;
    nameOnly?: boolean;
  },
): Promise<string> {
  const { path, root, from, to, nameOnly = false } = opts;
  return await git([
    ...QUIET_GIT,
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--no-relative",
    "--no-renames",
    "--unified=3",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    ...(nameOnly ? ["--name-only", "-z"] : []),
    "--end-of-options",
    from,
    to,
  ], root, await gitEnv(path, root));
}

async function exists(path: string): Promise<boolean> {
  return await lstat(path).then(() => true, () => false);
}

export function breakerDir(path: string): string {
  return path.replace(/\.evidence\.json$/, ".breaker");
}

const OBJECT_ID = /^[0-9a-f]{40,64}$/;

/**
 * Replaces `path` with a new file and a rename: everything under the plans
 * directory can be rewritten without a prompt, and opening the old name would
 * write through a symlink or a hard link planted there into another file.
 */
export async function replaceFile(path: string, data: string): Promise<void> {
  const slash = path.lastIndexOf("/");
  const tmp = `${path.slice(0, slash)}/.${path.slice(slash + 1)}.${crypto.randomUUID()}.tmp`;
  await writeFile(tmp, data, { flag: "wx", mode: 0o644 });
  try {
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/**
 * The registered path of the breaker worktree, or null when `dir` is anything
 * else. `dir` itself must be a real directory: resolving it as a whole would
 * let a symlink there pass for whichever worktree it points at.
 */
async function breakerWorktree(root: string, dir: string): Promise<string | null> {
  const info = await lstat(dir).catch(() => null);
  if (info && (info.isSymbolicLink() || !info.isDirectory())) return null;
  const canonical = join(await realpath(dirname(dir)), basename(dir));
  const linked = (await git(["worktree", "list", "--porcelain"], root))
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .slice(1);
  return [dir, canonical].find((p) => linked.includes(p)) ?? null;
}

async function readMarker(marker: string): Promise<string | null> {
  const text = (await readFile(marker, "utf8").catch(() => "")).trim();
  if (!text) return null;
  if (!OBJECT_ID.test(text)) {
    throw new Error(
      `${marker} is not a tree id; run materialize --remove and fill it again`,
    );
  }
  return text;
}

/**
 * Fills the plan's breaker worktree with `tree`. The worktree's own index stays
 * at `baseSha`, so `git status` inside shows the change and never needs a blob
 * that lives only in `<plan>.objects`; the files are switched through a
 * temporary index holding the previous fill, and git itself removes what the
 * new tree lacks, refusing to follow a directory replaced by a symlink.
 */
export async function materializeWorktree(
  opts: { path: string; root: string; baseSha: string; tree: string },
): Promise<string> {
  const { path, root, baseSha, tree } = opts;
  const dir = breakerDir(path);
  if (await exists(dir)) {
    if (!(await breakerWorktree(root, dir))) {
      throw new Error(`${dir} exists and is not the breaker worktree`);
    }
  } else {
    // -f: a worktree registered here whose directory is gone is ours to reuse.
    await git([
      ...QUIET_GIT,
      "worktree",
      "add",
      "-f",
      "--detach",
      "--no-checkout",
      "--end-of-options",
      dir,
      baseSha,
    ], root, NO_SMUDGE);
    await git(
      [...QUIET_GIT, "read-tree", "--end-of-options", baseSha],
      dir,
      NO_SMUDGE,
    );
  }
  const marker = `${dir}.tree`;
  const previous = await readMarker(marker);
  const tmp = await mkdtemp(join(tmpdir(), "plan-evidence-fill-"));
  try {
    const env = {
      ...(await gitEnv(path, root, join(tmp, "index"))),
      ...NO_SMUDGE,
    };
    if (previous) {
      await git(
        [...QUIET_GIT, "read-tree", "--end-of-options", previous],
        root,
        env,
      );
    }
    await git([
      ...QUIET_GIT,
      `--work-tree=${dir}`,
      "read-tree",
      "--reset",
      "-u",
      "--end-of-options",
      tree,
    ], root, env);
    // What the breaker wrote inside goes too, ignored build output and nested
    // repositories included, so a re-run sees the tree alone; the node_modules
    // link is the one entry that stays.
    await git([
      ...QUIET_GIT,
      `--work-tree=${dir}`,
      "clean",
      "-f",
      "-f",
      "-d",
      "-x",
      "-q",
      "-e",
      "/node_modules",
    ], root, env);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  await replaceFile(marker, `${tree}\n`);
  const modules = join(root, "node_modules");
  const link = join(dir, "node_modules");
  if (
    await lstat(modules).then((info) => info.isDirectory(), () => false) &&
    !(await exists(link))
  ) {
    await symlink(modules, link);
  }
  return dir;
}

export async function removeWorktree(path: string, root: string): Promise<string> {
  const dir = breakerDir(path);
  // A registration whose directory is gone is removed too, by its own path,
  // instead of a repository-wide prune that would drop other worktrees.
  const registered = await breakerWorktree(root, dir);
  if (await exists(dir) && !registered) {
    throw new Error(`${dir} exists and is not the breaker worktree`);
  }
  if (registered) {
    await git(
      [...QUIET_GIT, "worktree", "remove", "--force", registered],
      root,
    );
  }
  await rm(`${dir}.tree`, { force: true });
  return dir;
}

export async function assertVerified(
  task: PlanTask,
  current: Snapshot,
  path: string,
): Promise<void> {
  if (!task.required?.length) {
    throw new Error(`${task.id}: no required checks declared`);
  }
  for (const required of task.required) {
    const record = task.checks?.findLast((item) => item.id === required.id);
    if (!record) {
      throw new Error(`${task.id}/${required.id}: missing verification`);
    }
    if (record.target !== current.target) {
      const changed = record.tree
        ? await changedPaths(path, record.tree, current.tree, current.root)
        : [];
      const remedy =
        required.kind === "file-state" || required.kind === "orchestrator-only"
          ? "run it again"
          : "observe it again and record";
      throw new Error(
        `${task.id}/${required.id}: stale verification; ${
          changed.length
            ? `changed since the record: ${changed.join(", ")}; `
            : ""
        }${remedy}`,
      );
    }
    if (record.status !== "pass" && record.status !== "waived") {
      throw new Error(`${task.id}/${required.id}: ${record.status}`);
    }
    if (record.red) {
      throw new Error(`${task.id}/${required.id}: red only; run it green`);
    }
    if (record.status === "waived" && !record.authorization) {
      throw new Error("waiver missing authorization");
    }
    if (record.status === "pass" && required.kind === "live") {
      await assertLive(record, required, current.root);
    }
    if (record.status === "pass") assertVerdict(record, required);
    if (
      (required.kind === "audit" || required.kind === "review") &&
      record.status !== "pass"
    ) {
      throw new Error("audit and review cannot be waived");
    }
  }
}

export function assertVerdict(record: Check, required: Requirement): void {
  if (
    required.kind === "audit" &&
    record.output.trim().split("\n").at(-1) !== "AUDIT_VERDICT: PASS"
  ) {
    throw new Error("missing audit PASS verdict");
  }
  if (required.kind === "review") {
    if (record.output.trim().split("\n").at(-1) !== "VERDICT: PASS") {
      throw new Error("missing final review PASS verdict");
    }
    const sections = [
      ...record.output.matchAll(
        /^#{1,3} MUST_FIX\s*\n([\s\S]*?)(?=^#{1,3} |^VERDICT:|(?![\s\S]))/gm,
      ),
    ];
    const blockers = sections[0]?.[1]?.trim();
    if (
      sections.length !== 1 || !blockers ||
      !/^(?:-\s*)?(?:None|\(none\))\.?$/i.test(blockers)
    ) {
      throw new Error("review must explicitly report MUST_FIX as None");
    }
  }
}

export async function assertLive(
  record: Check,
  required: Requirement,
  root: string,
): Promise<void> {
  if (!record.observed || !record.expected) {
    throw new Error(
      "live check requires expected and observed artifact or runtime identity",
    );
  }
  if (record.observed !== record.expected) {
    throw new Error("observed artifact does not match expected target");
  }
  const source = required.expected;
  if (!source) {
    throw new Error("live requirement has no expected identity source");
  }
  let expected: string;
  if ("git_head" in source) {
    expected = (await git(["rev-parse", "HEAD"], root)).trim();
  } else if ("identity" in source) expected = source.identity;
  else {
    const file = await realpath(`${root}/${source.file}`);
    if (!file.startsWith(`${root}/`)) {
      throw new Error("expected artifact must be inside repository");
    }
    expected = await digest(await readFile(file));
  }
  if (record.expected !== expected) {
    throw new Error(
      "expected identity is stale or does not match declared source",
    );
  }
}
