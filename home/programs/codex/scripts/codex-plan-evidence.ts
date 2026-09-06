import type { PlanEvidence, PlanTask } from "./codex-plan-state.ts";

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
  gate?: string;
}

const KINDS = new Set([
  "file-state",
  "orchestrator-only",
  "live",
  "audit",
  "review",
]);
const RESULTS = new Set(["pass", "fail", "blocked", "waived"]);

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

export function check(value: unknown): Check {
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
    const key of ["observed", "expected", "authorization", "gate"] as const
  ) {
    if (obj[key] !== undefined) result[key] = nonempty(obj[key], key);
  }
  if (result.status === "waived" && !result.authorization) {
    throw new Error("waived checks require explicit user authorization");
  }
  return result;
}

async function git(args: string[], cwd = Deno.cwd()): Promise<string> {
  const result = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error(
      `git ${args[0]} failed: ${
        new TextDecoder().decode(result.stderr).trim()
      }`,
    );
  }
  return new TextDecoder().decode(result.stdout);
}

export async function repository(): Promise<string> {
  return await Deno.realPath(
    (await git(["rev-parse", "--show-toplevel"])).trim(),
  );
}

export async function assertRepository(data: PlanEvidence): Promise<string> {
  const root = await repository();
  if (!data.repository) {
    throw new Error("repository is not bound; start a task first");
  }
  if (data.repository !== root) throw new Error("repository mismatch");
  return root;
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

export async function artifactSnapshot(
  path: string,
  data: PlanEvidence,
): Promise<string> {
  const root = await assertRepository(data);
  const planPath = `${path.slice(0, path.lastIndexOf("/"))}/${data.plan}`;
  const planInfo = await Deno.lstat(planPath);
  if (!planInfo.isFile || planInfo.isSymlink) {
    throw new Error("plan must be a regular file");
  }
  const names = (await git(
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    root,
  ))
    .split("\0").filter(Boolean);
  const entries: unknown[] = [];
  for (const name of [...new Set(names)].sort()) {
    const file = `${root}/${name}`;
    try {
      const parent = await Deno.realPath(file.slice(0, file.lastIndexOf("/")));
      if (parent !== root && !parent.startsWith(`${root}/`)) {
        throw new Error(`snapshot path escapes repository: ${name}`);
      }
      const info = await Deno.lstat(file);
      if (info.isSymlink) {
        entries.push([name, "link", await Deno.readLink(file)]);
      } else if (info.isFile) {
        entries.push([
          name,
          (info.mode ?? 0) & 0o111,
          await digest(await Deno.readFile(file)),
        ]);
      } else {
        throw new Error(`cannot fingerprint non-file or submodule: ${name}`);
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
      entries.push([name, "missing"]);
    }
  }
  return await digest(JSON.stringify([
    root,
    (await git(["rev-parse", "HEAD"], root)).trim(),
    await git(["ls-files", "--stage", "-z"], root),
    await Deno.realPath(planPath),
    await digest(await Deno.readFile(planPath)),
    entries,
  ]));
}

export async function verificationSnapshot(path: string, data: PlanEvidence) {
  const target = await artifactSnapshot(path, data);
  return {
    target,
    token: await digest(JSON.stringify([target, data.gate ?? null])),
  };
}

export async function snapshot(
  path: string,
  data: PlanEvidence,
): Promise<string> {
  return (await verificationSnapshot(path, data)).token;
}

export async function assertVerified(
  task: PlanTask,
  target: string,
  gate?: string,
): Promise<void> {
  if (!task.required?.length) {
    throw new Error(`${task.id}: no required checks declared`);
  }
  for (const required of task.required) {
    const record = task.checks?.findLast((item) => item.id === required.id);
    if (!record) {
      throw new Error(`${task.id}/${required.id}: missing verification`);
    }
    if (record.target !== target) {
      throw new Error(`${task.id}/${required.id}: stale verification`);
    }
    if (
      gate && ["live", "audit", "review"].includes(required.kind) &&
      record.gate !== gate
    ) {
      throw new Error(
        `${task.id}/${required.id}: fresh final-gate evidence required`,
      );
    }
    if (record.status !== "pass" && record.status !== "waived") {
      throw new Error(`${task.id}/${required.id}: ${record.status}`);
    }
    if (record.status === "waived" && !record.authorization) {
      throw new Error("waiver missing authorization");
    }
    if (record.status === "pass" && required.kind === "live") {
      await assertLive(record, required);
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
    expected = (await git(["rev-parse", "HEAD"])).trim();
  } else if ("identity" in source) expected = source.identity;
  else {
    const root = await repository();
    const file = await Deno.realPath(`${root}/${source.file}`);
    if (!file.startsWith(`${root}/`)) {
      throw new Error("expected artifact must be inside repository");
    }
    expected = await digest(await Deno.readFile(file));
  }
  if (record.expected !== expected) {
    throw new Error(
      "expected identity is stale or does not match declared source",
    );
  }
}
