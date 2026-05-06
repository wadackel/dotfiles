#!/usr/bin/env -S deno run --allow-env=HOME --allow-read --allow-write --allow-run=git --no-prompt

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface PlanTask {
  id: string;
  subject: string;
  baseline_sha: string | null;
  evidence: string | null;
  status: TaskStatus;
}

export interface PlanEvidence {
  plan: string;
  tasks: PlanTask[];
}

const FINAL_TASK_SUBJECT = "Final Audit + Review";
const STATUSES = new Set(["pending", "in_progress", "completed"]);

function usage(): never {
  console.error(
    [
      "Usage:",
      "  codex-plan-state.ts init <path> <plan-basename> <subjects-json>",
      "  codex-plan-state.ts normalize <path>",
      "  codex-plan-state.ts start <path> <task-id>",
      "  codex-plan-state.ts append-evidence <path> <task-id>",
      "  codex-plan-state.ts complete <path> <task-id>",
    ].join("\n"),
  );
  Deno.exit(1);
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
    throw new Error(`failed to resolve directory ${path}: ${(err as Error).message}`);
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
  return {
    id,
    subject,
    baseline_sha: typeof baseline === "string" && baseline.length > 0
      ? baseline
      : null,
    evidence: normalizeEvidence(obj.evidence),
    status: normalizeStatus(obj.status),
  };
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
  if (!Array.isArray(obj.tasks)) {
    throw new Error("tasks must be an array");
  }
  const tasks = obj.tasks.map(normalizeTask);
  ensureFinalTask(tasks);
  return { plan: obj.plan, tasks };
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
  ensureFinalTask(tasks);
  return { plan, tasks };
}

async function readEvidence(path: string): Promise<PlanEvidence> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (err) {
    throw new Error(`failed to read ${path}: ${(err as Error).message}`);
  }
  try {
    return normalizePlanEvidence(JSON.parse(raw));
  } catch (err) {
    throw new Error(`failed to parse ${path}: ${(err as Error).message}`);
  }
}

async function atomicWrite(path: string, data: PlanEvidence): Promise<void> {
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash);
  const basename = path.slice(slash + 1);
  const tmp = `${dir}/.${basename}.${crypto.randomUUID()}.tmp`;
  const file = await Deno.open(tmp, {
    createNew: true,
    write: true,
    mode: 0o600,
  });
  try {
    await file.write(new TextEncoder().encode(JSON.stringify(data, null, 2) + "\n"));
  } finally {
    file.close();
  }
  try {
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

export async function run(
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
    const data = initPlanEvidence(taskOrPlan, JSON.parse(subjectsJson));
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
    task.status = "completed";
    await atomicWrite(path, data);
    console.log(`completed ${taskOrPlan}`);
    return;
  }

  usage();
}

if (import.meta.main) {
  try {
    await run(Deno.args);
  } catch (err) {
    console.error((err as Error).message);
    Deno.exit(1);
  }
}
