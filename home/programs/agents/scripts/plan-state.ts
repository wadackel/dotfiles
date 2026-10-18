#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

// Shared by Codex `$impl` and Claude `/impl`. Refusing `complete` without current
// evidence is the audit; an LLM-written `audit` record on top of it caught no
// defect in 18 measured gates, so `audit` is accepted but not required and the
// final task needs only a review.

import {
  type FileHandle,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import {
  artifactSnapshot,
  assertArgvPermitted,
  assertLive,
  assertRepository,
  assertVerdict,
  assertVerified,
  changedPaths,
  type Check,
  check,
  executeArgv,
  repository,
  type Requirement,
  requirements,
  runGit,
  splitRunArgs,
  truncateOutput,
} from "./plan-evidence.ts";

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface PlanTask {
  id: string;
  subject: string;
  baseline_sha: string | null;
  evidence: string | null;
  status: TaskStatus;
  required?: Requirement[];
  checks?: Check[];
}

export interface PlanEvidence {
  plan: string;
  tasks: PlanTask[];
  version?: 2;
  repository?: string;
}

const FINAL_TASK_SUBJECT = "Final Audit + Review";
const STATUSES = new Set(["pending", "in_progress", "completed"]);

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

// Reading starts with the first pull, not here: Readable.toWeb(process.stdin)
// as the default would keep a command that never reads stdin (`snapshot`,
// `start`) from exiting when stdin is a pipe. highWaterMark 0 keeps the stream
// from pulling before anyone reads.
function processStdin(): ReadableStream<Uint8Array> {
  let chunks: AsyncIterator<Uint8Array> | undefined;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      chunks ??= process.stdin[Symbol.asyncIterator]();
      const { done, value } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
  }, { highWaterMark: 0 });
}

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  plan-state.ts init <path> <plan-basename> <subjects-json>",
      "  plan-state.ts normalize <path>",
      "  plan-state.ts start <path> <task-id>",
      "  plan-state.ts append-evidence <path> <task-id>",
      "  plan-state.ts complete <path> <task-id>",
      "  plan-state.ts require <path> <task-id>  # requirements JSON on stdin",
      "  plan-state.ts record <path> <task-id>   # check JSON on stdin",
      "  plan-state.ts snapshot <path>",
      "  plan-state.ts reconcile <path>",
      "  plan-state.ts coverage <path>",
      "  plan-state.ts run <path> <task-id> <check-id> [--expect-exit N] [--tail N] [--grep RE] [--env K=V]... [--cwd DIR] [--expect-unchanged] -- <command> [args...]",
      "      snapshot, execute the command without a shell, snapshot again, record (file-state / orchestrator-only checks only)",
      "  plan-state.ts rerun <path>       # re-execute every recorded argv whose target is stale or whose status is fail",
      "",
      'require stdin: [{"id":"cc-1","kind":"file-state|orchestrator-only|live|audit|review","expected":{"file":"path"}|{"git_head":true}|{"identity":"name"}}]',
      'record stdin:  {"id":"cc-1","status":"pass|fail|blocked|waived","target":"<snapshot output>","command":"<what ran>","output":"<raw output>","expected":"<digest or identity>","observed":"<digest or identity>","authorization":"<quoted user waiver>"}',
      "  statuses: pass fail blocked waived (waived needs authorization; audit / review cannot be waived)",
    ].join("\n"),
  );
}

function taskId(index: number): string {
  return `task-${index + 1}`;
}

function normalizeEvidence(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function normalizeStatus(value: unknown): TaskStatus {
  if (value === null || value === undefined) {
    return "pending";
  }
  if (typeof value === "string" && STATUSES.has(value)) {
    return value as TaskStatus;
  }
  throw new Error(`invalid task status: ${String(value)}`);
}

async function canonicalExistingDir(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (err) {
    throw new Error(
      `failed to resolve directory ${path}: ${(err as Error).message}`,
    );
  }
}

// Each agent keeps its own plans directory and a machine may have only one of
// them (Codex not installed, or a fresh Claude setup), so a missing directory is
// skipped rather than treated as an error.
async function plansDirs(home: string): Promise<string[]> {
  const dirs: string[] = [];
  for (const agent of [".codex", ".claude"]) {
    try {
      dirs.push(await realpath(`${home}/${agent}/plans`));
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
  if (dirs.length === 0) {
    throw new Error(
      `neither ${home}/.codex/plans nor ${home}/.claude/plans exists`,
    );
  }
  return dirs;
}

async function assertEvidencePath(path: string): Promise<void> {
  if (!path.endsWith(".evidence.json")) {
    throw new Error("evidence path must end with .evidence.json");
  }

  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is not set");
  }
  const dirs = await plansDirs(home);
  if (!path.startsWith("/")) {
    throw new Error("evidence path must be absolute");
  }
  const slash = path.lastIndexOf("/");
  if (slash < 0) {
    throw new Error("evidence path must be absolute");
  }
  const dir = path.slice(0, slash);
  const basename = path.slice(slash + 1);
  if (basename.startsWith(".")) {
    throw new Error("evidence path must not be a dotfile marker");
  }
  const realDir = await canonicalExistingDir(dir);
  if (!dirs.includes(realDir)) {
    throw new Error(`evidence path must be under ${dirs.join(" or ")}`);
  }

  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      throw new Error("evidence path must not be a symlink");
    }
  } catch (err) {
    if (!isNotFound(err)) {
      throw err;
    }
  }
}

function normalizeTask(value: unknown, index: number): PlanTask {
  if (!value || typeof value !== "object") {
    throw new Error(`task ${index + 1} is not an object`);
  }
  const obj = value as Record<string, unknown>;
  const subject = obj.subject ?? obj.name;
  if (typeof subject !== "string" || subject.length === 0) {
    throw new Error(`task ${index + 1} is missing subject`);
  }
  const id = typeof obj.id === "string" && obj.id.length > 0
    ? obj.id
    : taskId(index);
  const baseline = obj.baseline_sha;
  const task: PlanTask = {
    id,
    subject,
    baseline_sha: typeof baseline === "string" && baseline.length > 0
      ? baseline
      : null,
    evidence: normalizeEvidence(obj.evidence),
    status: normalizeStatus(obj.status),
  };
  if (obj.required !== undefined) task.required = requirements(obj.required);
  if (obj.checks !== undefined) {
    if (!Array.isArray(obj.checks)) throw new Error("checks must be an array");
    task.checks = obj.checks.map((item) => check(item, "file"));
  }
  return task;
}

function ensureFinalTask(tasks: PlanTask[]): void {
  if (tasks.length === 0) {
    throw new Error("tasks must not be empty");
  }
  if (tasks[tasks.length - 1].subject !== FINAL_TASK_SUBJECT) {
    throw new Error(`last task must be ${FINAL_TASK_SUBJECT}`);
  }
}

export function normalizePlanEvidence(raw: unknown): PlanEvidence {
  if (!raw || typeof raw !== "object") {
    throw new Error("plan evidence must be an object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.plan !== "string" || obj.plan.length === 0) {
    throw new Error("plan must be a non-empty string");
  }
  if (
    obj.plan.includes("/") || obj.plan.startsWith(".") ||
    !obj.plan.endsWith(".md")
  ) {
    throw new Error("plan must be a regular .md basename");
  }
  if (obj.version !== undefined && obj.version !== 2) {
    throw new Error("unsupported evidence version");
  }
  if (!Array.isArray(obj.tasks)) {
    throw new Error("tasks must be an array");
  }
  const tasks = obj.tasks.map(normalizeTask);
  if (new Set(tasks.map((t) => t.id)).size !== tasks.length) {
    throw new Error("duplicate task id");
  }
  ensureFinalTask(tasks);
  const data: PlanEvidence = { plan: obj.plan, tasks };
  if (obj.version === 2) data.version = 2;
  if (obj.repository !== undefined) {
    if (typeof obj.repository !== "string" || !obj.repository.startsWith("/")) {
      throw new Error("repository must be absolute");
    }
    data.repository = obj.repository;
  }
  return data;
}

export function initPlanEvidence(
  plan: string,
  subjects: unknown,
): PlanEvidence {
  if (!Array.isArray(subjects) || subjects.length === 0) {
    throw new Error("subjects must be a non-empty array");
  }
  const tasks = subjects.map((subject, index): PlanTask => {
    if (typeof subject !== "string" || subject.length === 0) {
      throw new Error(`subject ${index + 1} must be a non-empty string`);
    }
    return {
      id: taskId(index),
      subject,
      baseline_sha: null,
      evidence: null,
      status: "pending",
    };
  });
  return normalizePlanEvidence({ plan, tasks });
}

// The n-th bullet must have a required check id `cc-<n>` somewhere in the plan
// (contract.md). Fence lines are dropped before the heading is searched, the way
// check-plan.ts does it: a plan that quotes the heading or a `- [live]` sample
// inside a fenced example would otherwise anchor the scan on the example.
// `[outcome]` bullets are numbered but never required — they are the review
// verdict itself, which the gate records under its own `review-<n>` id.
export function autonomousBullets(
  plan: string,
): { tag: string; text: string }[] {
  const lines: string[] = [];
  let inFence = false;
  for (const line of plan.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) lines.push(line);
  }
  const start = lines.findIndex((line) =>
    /^### Autonomous Verification\s*$/.test(line)
  );
  if (start < 0) return [];
  const bullets: { tag: string; text: string }[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,3} /.test(line)) break;
    const m = line.match(/^\s*-[ \t]+(\[[a-z-]+\])\s*(.*)$/);
    if (m) bullets.push({ tag: m[1], text: m[2].trim() });
  }
  return bullets;
}

async function readEvidence(path: string): Promise<PlanEvidence> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`failed to read ${path}: ${(err as Error).message}`);
  }
  try {
    const data = normalizePlanEvidence(JSON.parse(raw));
    assertPlanIdentity(path, data);
    return data;
  } catch (err) {
    throw new Error(`failed to parse ${path}: ${(err as Error).message}`);
  }
}

function assertPlanIdentity(path: string, data: PlanEvidence): void {
  if (
    path.slice(path.lastIndexOf("/") + 1) !==
      data.plan.replace(/\.md$/, ".evidence.json")
  ) {
    throw new Error("sidecar basename must match plan identity");
  }
}

async function atomicWrite(path: string, data: PlanEvidence): Promise<void> {
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash);
  const basename = path.slice(slash + 1);
  const tmp = `${dir}/.${basename}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    const info = await lstat(tmp);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("temporary evidence file is not a regular file");
    }
    await rename(tmp, path);
  } catch (err) {
    try {
      await rm(tmp);
    } catch {
      // tmp may already have been renamed.
    }
    throw err;
  }
}

function findTask(data: PlanEvidence, taskId: string): PlanTask {
  const task = data.tasks.find((task) => task.id === taskId);
  if (!task) {
    throw new Error(`task not found: ${taskId}`);
  }
  return task;
}

async function currentGitHead(): Promise<string> {
  const topLevel = await runGit(["rev-parse", "--show-toplevel"]);
  if (!topLevel.success) {
    const stderr = topLevel.stderr.trim();
    throw new Error(
      `git rev-parse --show-toplevel failed${stderr ? `: ${stderr}` : ""}`,
    );
  }

  const head = await runGit(["rev-parse", "HEAD"]);
  if (!head.success) {
    const stderr = head.stderr.trim();
    throw new Error(
      `git rev-parse HEAD failed${stderr ? `: ${stderr}` : ""}`,
    );
  }
  return head.stdout.trim();
}

// Overridable so a test that plants a foreign lock does not wait the full 10 s.
const LOCK_RETRY_MS = (() => {
  const n = Number(process.env.PLAN_STATE_LOCK_WAIT_MS);
  return Number.isFinite(n) && n >= 0 ? n : 10_000;
})();

/** Exclusive sibling lock around a read-modify-write; waits with backoff up to LOCK_RETRY_MS. */
async function withLock<T>(path: string, body: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  let lock: FileHandle | null = null;
  const deadline = Date.now() + LOCK_RETRY_MS;
  for (let wait = 50; lock === null;) {
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw err;
      if (Date.now() >= deadline) {
        throw new Error(
          `evidence is locked; check the writer before recovering ${lockPath}`,
        );
      }
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 1_000);
    }
  }
  try {
    await lock.write(
      new TextEncoder().encode(
        JSON.stringify({ pid: process.pid, started: new Date().toISOString() }),
      ),
    );
    return await body();
  } finally {
    try {
      await lock.close();
    } finally {
      await rm(lockPath);
    }
  }
}

function excerpt(output: string, grep: string | null, tail: number): string[] {
  const lines = output.replace(/\n$/, "").split("\n");
  if (grep !== null) {
    const re = new RegExp(grep);
    return lines.filter((line) => re.test(line));
  }
  return tail === 0 ? [] : lines.slice(-tail);
}

/** snapshot → execute → snapshot → append, the lock held only for the append. */
async function runCheck(args: string[]): Promise<number> {
  const parsed = splitRunArgs(args);
  const { path } = parsed;
  await assertEvidencePath(path);
  const data = await readEvidence(path);
  const task = findTask(data, parsed.task);
  const required = task.required?.find((r) => r.id === parsed.id);
  if (!required) throw new Error(`check is not declared: ${parsed.id}`);
  if (required.kind !== "file-state" && required.kind !== "orchestrator-only") {
    throw new Error(
      `${parsed.id} is a ${required.kind} check; observe it and use record`,
    );
  }
  const root = await assertRepository(data);
  const cwd = parsed.cwd ? await realpath(resolve(root, parsed.cwd)) : root;
  await assertArgvPermitted({ argv: parsed.argv, env: parsed.env, cwd, root });
  const before = await artifactSnapshot(path, data);
  const result = await executeArgv({ argv: parsed.argv, cwd, env: parsed.env });
  const after = await artifactSnapshot(path, data);
  const mutated = await changedPaths(path, before.tree, after.tree);
  const passed = result.exit === parsed.expectExit &&
    !(parsed.expectUnchanged && mutated.length > 0);
  const { text, truncated } = truncateOutput(result.output);
  const record: Check = {
    id: parsed.id,
    status: passed ? "pass" : "fail",
    target: after.target,
    tree: after.tree,
    command: parsed.argv.join(" "),
    output: text,
    argv: parsed.argv,
    cwd,
    exit: result.exit,
    expectExit: parsed.expectExit,
    durationMs: result.durationMs,
  };
  if (Object.keys(parsed.env).length) record.env = parsed.env;
  if (parsed.expectUnchanged) record.expectUnchanged = true;
  if (mutated.length) record.mutated = mutated;
  if (truncated) record.truncated = true;
  const notice = await withLock(path, async () => {
    const fresh = await readEvidence(path);
    const freshTask = findTask(fresh, parsed.task);
    if (!freshTask.required?.some((r) => r.id === parsed.id)) {
      throw new Error(`check is not declared: ${parsed.id}`);
    }
    const previous = freshTask.checks?.findLast((c) => c.id === parsed.id);
    freshTask.checks ??= [];
    freshTask.checks.push(record);
    await atomicWrite(path, fresh);
    return previous?.argv &&
        JSON.stringify(previous.argv) !== JSON.stringify(parsed.argv)
      ? `supersedes previous argv: ${previous.argv.join(" ")}`
      : null;
  });
  console.log(
    `${record.status} ${parsed.id} exit=${result.exit}${
      parsed.expectExit !== 0 ? ` (expected ${parsed.expectExit})` : ""
    } ${result.durationMs}ms mutated=${mutated.length}${
      mutated.length ? ` ${mutated.join(" ")}` : ""
    }`,
  );
  if (notice) console.log(notice);
  for (const line of excerpt(result.output, parsed.grep, parsed.tail)) {
    console.log(line);
  }
  return passed ? 0 : 1;
}

interface RerunRow {
  task: string;
  check: string;
  status: string;
  exit: number | "-";
  mutated: number;
}

/**
 * Re-executes every recorded argv whose latest record is stale or failed; a
 * check that passes at the current target is already fresh and is skipped. The
 * argv set is fixed at the first read, so a record appended while a long suite
 * runs is not picked up by this invocation.
 */
async function rerunChecks(path: string): Promise<number> {
  await assertEvidencePath(path);
  const data = await readEvidence(path);
  await assertRepository(data);
  const current = await artifactSnapshot(path, data);
  const rows: RerunRow[] = [];
  const groups = new Map<
    string,
    { record: Check; members: { task: string; check: string }[] }
  >();
  for (const task of data.tasks) {
    for (const required of task.required ?? []) {
      const latest = task.checks?.findLast((c) => c.id === required.id);
      if (!latest) {
        rows.push({
          task: task.id,
          check: required.id,
          status: "skipped (missing)",
          exit: "-",
          mutated: 0,
        });
      } else if (!latest.argv) {
        rows.push({
          task: task.id,
          check: required.id,
          status: "skipped (record)",
          exit: "-",
          mutated: 0,
        });
      } else if (latest.target === current.target && latest.status === "pass") {
        rows.push({
          task: task.id,
          check: required.id,
          status: "fresh",
          exit: latest.exit ?? "-",
          mutated: 0,
        });
      } else {
        const key = JSON.stringify([
          latest.argv,
          latest.cwd,
          latest.env ?? {},
          latest.expectExit ?? 0,
          latest.expectUnchanged ?? false,
        ]);
        const group = groups.get(key) ?? { record: latest, members: [] };
        group.members.push({ task: task.id, check: required.id });
        groups.set(key, group);
      }
    }
  }
  let failed = false;
  for (const { record: previous, members } of groups.values()) {
    const argv = previous.argv!;
    const root = await assertRepository(data);
    const cwd = previous.cwd ? await realpath(previous.cwd) : root;
    const env = previous.env ?? {};
    const expectExit = previous.expectExit ?? 0;
    const expectUnchanged = previous.expectUnchanged ?? false;
    await assertArgvPermitted({ argv, env, cwd, root });
    const before = await artifactSnapshot(path, data);
    const result = await executeArgv({ argv, cwd, env });
    const after = await artifactSnapshot(path, data);
    const mutated = await changedPaths(path, before.tree, after.tree);
    const passed = result.exit === expectExit &&
      !(expectUnchanged && mutated.length > 0);
    if (!passed) failed = true;
    const { text, truncated } = truncateOutput(result.output);
    await withLock(path, async () => {
      const fresh = await readEvidence(path);
      for (const member of members) {
        const task = findTask(fresh, member.task);
        const record: Check = {
          id: member.check,
          status: passed ? "pass" : "fail",
          target: after.target,
          tree: after.tree,
          command: argv.join(" "),
          output: text,
          argv,
          cwd,
          exit: result.exit,
          expectExit,
          durationMs: result.durationMs,
        };
        if (Object.keys(env).length) record.env = env;
        if (expectUnchanged) record.expectUnchanged = true;
        if (mutated.length) record.mutated = mutated;
        if (truncated) record.truncated = true;
        task.checks ??= [];
        task.checks.push(record);
        rows.push({
          task: member.task,
          check: member.check,
          status: passed ? "pass" : "fail",
          exit: result.exit,
          mutated: mutated.length,
        });
      }
      await atomicWrite(path, fresh);
    });
  }
  console.log("| task | check | status | exit | mutated |");
  console.log("|---|---|---|---|---|");
  for (const row of rows) {
    console.log(
      `| ${row.task} | ${row.check} | ${row.status} | ${row.exit} | ${row.mutated} |`,
    );
  }
  return failed ? 1 : 0;
}

async function execute(
  args: string[],
  stdin: ReadableStream<Uint8Array> = processStdin(),
): Promise<number | void> {
  const [command, path, taskOrPlan, subjectsJson] = args;
  if (!command) {
    usage();
  }

  if (command === "run") return await runCheck(args.slice(1));
  if (command === "rerun") {
    if (!path) usage();
    return await rerunChecks(path);
  }

  if (path) {
    await assertEvidencePath(path);
  }

  if (command === "init") {
    if (!path || !taskOrPlan || !subjectsJson) {
      usage();
    }
    try {
      await lstat(path);
      throw new Error(
        "evidence already exists; preserve it or choose a new plan name",
      );
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    const data = initPlanEvidence(taskOrPlan, JSON.parse(subjectsJson));
    assertPlanIdentity(path, data);
    await atomicWrite(path, data);
    console.log(`initialized ${path}`);
    return;
  }

  if (command === "normalize") {
    if (!path) {
      usage();
    }
    console.log(JSON.stringify(await readEvidence(path), null, 2));
    return;
  }

  if (command === "start") {
    if (!path || !taskOrPlan) {
      usage();
    }
    const data = await readEvidence(path);
    const task = findTask(data, taskOrPlan);
    const root = await repository();
    if (data.repository && data.repository !== root) {
      throw new Error("repository mismatch");
    }
    data.repository = root;
    data.version = 2;
    const sha = await currentGitHead();
    if (!task.baseline_sha) {
      task.baseline_sha = sha;
    }
    task.status = "in_progress";
    await atomicWrite(path, data);
    console.log(`baseline=${task.baseline_sha}`);
    return;
  }

  if (command === "append-evidence") {
    if (!path || !taskOrPlan) {
      usage();
    }
    const data = await readEvidence(path);
    const task = findTask(data, taskOrPlan);
    const evidence = await new Response(stdin).text();
    task.evidence = task.evidence
      ? `${task.evidence}\n---\n${evidence}`
      : evidence;
    await atomicWrite(path, data);
    console.log(`evidence-appended ${taskOrPlan}`);
    return;
  }

  if (command === "complete") {
    if (!path || !taskOrPlan) {
      usage();
    }
    const data = await readEvidence(path);
    const task = findTask(data, taskOrPlan);
    if (!task.required?.length) {
      throw new Error(`${task.id}: no required checks declared`);
    }
    const current = await artifactSnapshot(path, data);
    if (task === data.tasks.at(-1)) {
      if (!task.required.some((r) => r.kind === "review")) {
        throw new Error("final gate requires a review check");
      }
      for (const implementation of data.tasks.slice(0, -1)) {
        await assertVerified(implementation, current, path);
        if (implementation.status !== "completed") {
          throw new Error("implementation tasks are incomplete");
        }
      }
    }
    await assertVerified(task, current, path);
    task.status = "completed";
    await atomicWrite(path, data);
    console.log(`completed ${taskOrPlan}`);
    return;
  }

  if (command === "coverage") {
    if (!path) usage();
    const data = await readEvidence(path);
    const planPath = `${path.slice(0, path.lastIndexOf("/"))}/${data.plan}`;
    let plan: string;
    try {
      const file = await open(planPath);
      try {
        if (!(await file.stat()).isFile()) {
          throw new Error("plan must be a regular file");
        }
        plan = new TextDecoder().decode(await file.readFile());
      } finally {
        await file.close();
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`failed to read plan ${planPath}: ${reason}`);
    }
    const bullets = autonomousBullets(plan);
    const declared = new Map<string, string>();
    for (const task of data.tasks) {
      for (const r of task.required ?? []) declared.set(r.id, r.kind);
    }
    const numbered = bullets.map((bullet, index) => ({
      id: `cc-${index + 1}`,
      ...bullet,
    })).filter((bullet) => bullet.tag !== "[outcome]");
    const missing = numbered.filter((bullet) => !declared.has(bullet.id));
    // A `[live]` bullet declared as `file-state` would pass `complete` without
    // any live observation, which is the downgrade this command exists to catch.
    const mismatched = numbered.filter((bullet) =>
      declared.has(bullet.id) &&
      declared.get(bullet.id) !== bullet.tag.slice(1, -1)
    ).map((bullet) => ({ ...bullet, declared: declared.get(bullet.id) }));
    console.log(
      JSON.stringify({ bullets: bullets.length, missing, mismatched }),
    );
    if (bullets.length === 0) {
      throw new Error("plan has no ### Autonomous Verification bullets");
    }
    if (missing.length > 0 || mismatched.length > 0) {
      throw new Error(
        `${missing.length} bullet(s) without a required check (${
          missing.map((m) => m.id).join(", ") || "-"
        }), ${mismatched.length} declared with another kind (${
          mismatched.map((m) => `${m.id}: ${m.declared} for ${m.tag}`).join(
            ", ",
          ) || "-"
        })`,
      );
    }
    return;
  }

  if (command === "snapshot" || command === "reconcile") {
    if (!path) usage();
    const data = await readEvidence(path);
    const current = await artifactSnapshot(path, data);
    if (command === "snapshot") {
      console.log(current.target);
      return;
    }
    const target = current.target;
    const reopened = [];
    for (const task of data.tasks) {
      if (task.status !== "completed") continue;
      try {
        await assertVerified(task, current, path);
      } catch (err) {
        task.status = "in_progress";
        reopened.push({ id: task.id, reason: (err as Error).message });
      }
    }
    await atomicWrite(path, data);
    console.log(JSON.stringify({ target, reopened }));
    return;
  }

  if (command === "require" || command === "record") {
    if (!path || !taskOrPlan) usage();
    const data = await readEvidence(path);
    const task = findTask(data, taskOrPlan);
    await assertRepository(data);
    const value = JSON.parse(await new Response(stdin).text());
    if (command === "require") {
      const additions = requirements(value);
      task.required ??= [];
      for (const addition of additions) {
        const existing = task.required.find((r) => r.id === addition.id);
        if (existing && existing.kind !== addition.kind) {
          throw new Error("cannot change required check kind");
        }
        if (
          existing &&
          JSON.stringify(existing.expected) !==
            JSON.stringify(addition.expected)
        ) {
          throw new Error(
            "cannot change expected identity source; revise the plan for new acceptance",
          );
        }
        if (!existing) task.required.push(addition);
      }
    } else {
      const record = check(value);
      const required = task.required?.find((r) => r.id === record.id);
      if (!required) throw new Error("check is not declared");
      const current = await artifactSnapshot(path, data);
      if (record.target !== current.target) {
        throw new Error("target changed during verification");
      }
      record.target = current.target;
      record.tree = current.tree;
      if (required.kind === "live" && record.status === "pass") {
        await assertLive(record, required);
      }
      if (record.status === "pass") assertVerdict(record, required);
      task.checks ??= [];
      task.checks.push(record);
    }
    await atomicWrite(path, data);
    console.log(`${command} ${taskOrPlan}`);
    return;
  }

  usage();
}

export async function run(
  args: string[],
  stdin: ReadableStream<Uint8Array> = processStdin(),
): Promise<number | void> {
  // run / rerun take the lock themselves, only around the append.
  const mutations = new Set([
    "init",
    "start",
    "append-evidence",
    "complete",
    "require",
    "record",
    "reconcile",
  ]);
  if (!mutations.has(args[0]) || !args[1]) return await execute(args, stdin);
  const path = args[1];
  await assertEvidencePath(path);
  return await withLock(path, () => execute(args, stdin));
}

if (import.meta.main) {
  try {
    const code = await run(process.argv.slice(2));
    if (code) process.exit(code);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
