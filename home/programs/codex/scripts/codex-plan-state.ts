#!/usr/bin/env -S deno run --allow-env=HOME --allow-read --allow-write --allow-run=git --no-prompt

import {
  artifactSnapshot,
  assertLive,
  assertRepository,
  assertVerdict,
  assertVerified,
  type Check,
  check,
  repository,
  type Requirement,
  requirements,
  snapshot,
  verificationSnapshot,
} from "./codex-plan-evidence.ts";

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
  gate?: string;
}

const FINAL_TASK_SUBJECT = "Final Audit + Review";
const STATUSES = new Set(["pending", "in_progress", "completed"]);

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  codex-plan-state.ts init <path> <plan-basename> <subjects-json>",
      "  codex-plan-state.ts normalize <path>",
      "  codex-plan-state.ts start <path> <task-id>",
      "  codex-plan-state.ts append-evidence <path> <task-id>",
      "  codex-plan-state.ts complete <path> <task-id>",
      "  codex-plan-state.ts require <path> <task-id>  # requirements JSON on stdin",
      "  codex-plan-state.ts record <path> <task-id>   # check JSON on stdin",
      "  codex-plan-state.ts snapshot <path>",
      "  codex-plan-state.ts reconcile <path>",
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
    return await Deno.realPath(path);
  } catch (err) {
    throw new Error(
      `failed to resolve directory ${path}: ${(err as Error).message}`,
    );
  }
}

async function assertEvidencePath(path: string): Promise<void> {
  if (!path.endsWith(".evidence.json")) {
    throw new Error("evidence path must end with .evidence.json");
  }

  const home = Deno.env.get("HOME");
  if (!home) {
    throw new Error("HOME is not set");
  }
  const plansDir = await canonicalExistingDir(`${home}/.codex/plans`);
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
  if (realDir !== plansDir) {
    throw new Error(`evidence path must be under ${plansDir}`);
  }

  try {
    const info = await Deno.lstat(path);
    if (info.isSymlink) {
      throw new Error("evidence path must not be a symlink");
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
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
    task.checks = obj.checks.map(check);
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
  if (obj.gate !== undefined) {
    if (typeof obj.gate !== "string" || !obj.gate) {
      throw new Error("invalid gate generation");
    }
    data.gate = obj.gate;
  }
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

async function readEvidence(path: string): Promise<PlanEvidence> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
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
    await Deno.writeTextFile(tmp, JSON.stringify(data, null, 2) + "\n", {
      createNew: true,
      mode: 0o600,
    });
    const info = await Deno.lstat(tmp);
    if (!info.isFile || info.isSymlink) {
      throw new Error("temporary evidence file is not a regular file");
    }
    await Deno.rename(tmp, path);
  } catch (err) {
    try {
      await Deno.remove(tmp);
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
  const topLevel = await new Deno.Command("git", {
    args: ["rev-parse", "--show-toplevel"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!topLevel.success) {
    const stderr = new TextDecoder().decode(topLevel.stderr).trim();
    throw new Error(
      `git rev-parse --show-toplevel failed${stderr ? `: ${stderr}` : ""}`,
    );
  }

  const head = await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!head.success) {
    const stderr = new TextDecoder().decode(head.stderr).trim();
    throw new Error(
      `git rev-parse HEAD failed${stderr ? `: ${stderr}` : ""}`,
    );
  }
  return new TextDecoder().decode(head.stdout).trim();
}

async function execute(
  args: string[],
  stdin: ReadableStream<Uint8Array> = Deno.stdin.readable,
): Promise<void> {
  const [command, path, taskOrPlan, subjectsJson] = args;
  if (!command) {
    usage();
  }

  if (path) {
    await assertEvidencePath(path);
  }

  if (command === "init") {
    if (!path || !taskOrPlan || !subjectsJson) {
      usage();
    }
    try {
      await Deno.lstat(path);
      throw new Error(
        "evidence already exists; preserve it or choose a new plan name",
      );
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
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
    if (task === data.tasks.at(-1)) data.gate = crypto.randomUUID();
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
    const target = await artifactSnapshot(path, data);
    if (task === data.tasks.at(-1)) {
      if (!data.gate) throw new Error("start the final gate before completion");
      if (
        !task.required.some((r) => r.kind === "audit") ||
        !task.required.some((r) => r.kind === "review")
      ) {
        throw new Error("final gate requires audit and review checks");
      }
      for (const implementation of data.tasks.slice(0, -1)) {
        await assertVerified(implementation, target, data.gate);
        if (implementation.status !== "completed") {
          throw new Error("implementation tasks are incomplete");
        }
      }
    }
    await assertVerified(
      task,
      target,
      task === data.tasks.at(-1) ? data.gate : undefined,
    );
    task.status = "completed";
    await atomicWrite(path, data);
    console.log(`completed ${taskOrPlan}`);
    return;
  }

  if (command === "snapshot" || command === "reconcile") {
    if (!path) usage();
    const data = await readEvidence(path);
    if (command === "snapshot") {
      console.log(await snapshot(path, data));
      return;
    }
    const target = await artifactSnapshot(path, data);
    const reopened = [];
    for (const task of data.tasks) {
      if (task.status !== "completed") continue;
      try {
        await assertVerified(task, target);
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
      const current = await verificationSnapshot(path, data);
      if (record.target !== current.token) {
        throw new Error(
          "target changed during verification (artifact or gate generation)",
        );
      }
      record.target = current.target;
      if (required.kind === "live" && record.status === "pass") {
        await assertLive(record, required);
      }
      if (record.status === "pass") assertVerdict(record, required);
      delete record.gate;
      if (data.gate) record.gate = data.gate;
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
  stdin: ReadableStream<Uint8Array> = Deno.stdin.readable,
): Promise<void> {
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
  const lockPath = `${path}.lock`;
  let lock: Deno.FsFile;
  try {
    lock = await Deno.open(lockPath, {
      createNew: true,
      write: true,
      mode: 0o600,
    });
  } catch (err) {
    if (err instanceof Deno.errors.AlreadyExists) {
      throw new Error(
        `evidence is locked; check the writer before recovering ${lockPath}`,
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
    await execute(args, stdin);
  } finally {
    lock.close();
    await Deno.remove(lockPath);
  }
}

if (import.meta.main) {
  try {
    await run(Deno.args);
  } catch (err) {
    console.error((err as Error).message);
    Deno.exit(1);
  }
}
