#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=HOME --allow-run=claude --no-prompt

import { TextLineStream } from "jsr:@std/streams@1/text-line-stream";

const BACKUP_SUFFIX = ".measure-trigger.bak";

export type EvalItem = { query: string; shouldTrigger: boolean };
export type ToolUse = { name: string; skill?: string };
export type QueryResult = {
  query: string;
  shouldTrigger: boolean;
  runs: number;
  fired: number;
  firstTools: string[];
};

const USAGE = `measure-trigger.ts --skill=<name|path> --eval=<file.json>
                   [--description=<file>] [--runs=3] [--concurrency=10]
                   [--timeout=180] [--json]

The eval file is [{"query": "...", "should_trigger": true}, ...]. --description
swaps that text into the real SKILL.md frontmatter for the run and restores it
afterwards.

Exit 0: every query landed on the expected side more often than not.
Exit 1: at least one did not. Exit 2: input or environment error, or a leftover
backup from an aborted run.`;

const die = (message: string, code = 2): never => {
  console.error(message);
  Deno.exit(code);
};

// ---------------------------------------------------------------- frontmatter

const frontmatterOf = (skillMd: string): string => {
  const match = skillMd.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("SKILL.md has no frontmatter");
  return match[1];
};

const descriptionRange = (lines: string[]): [number, number] => {
  const start = lines.findIndex((l) => /^description\s*:/.test(l));
  if (start < 0) throw new Error("no description key in frontmatter");
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z_][\w-]*\s*:/.test(lines[end])) end++;
  return [start, end];
};

export const extractDescription = (skillMd: string): string => {
  const lines = frontmatterOf(skillMd).split("\n");
  const [start, end] = descriptionRange(lines);
  const head = lines[start].replace(/^description\s*:\s*/, "").trim();
  const tail = lines.slice(start + 1, end)
    .map((l) => l.replace(/^ {2}/, ""))
    .join("\n")
    .trim();
  if (["|", ">", "|-", ">-"].includes(head)) return tail;
  return [head, tail].filter((s) => s !== "").join("\n");
};

export const replaceDescription = (
  skillMd: string,
  description: string,
): string => {
  const body = frontmatterOf(skillMd);
  const lines = body.split("\n");
  const [start, end] = descriptionRange(lines);
  const block = [
    "description: |",
    ...description.trim().split("\n").map((l) => (l === "" ? "" : `  ${l}`)),
  ];
  const next = [...lines.slice(0, start), ...block, ...lines.slice(end)].join(
    "\n",
  );
  // A replacement string would expand $&, $`, $' and $1 out of the candidate
  // text; the function form is taken literally.
  return skillMd.replace(body, () => next);
};

// ------------------------------------------------------------------- eval set

export const parseEvalSet = (json: string): EvalItem[] => {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(`eval set is not valid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("eval set must be a non-empty array");
  }
  return raw.map((entry, i) => {
    const item = entry as Record<string, unknown>;
    if (typeof item?.query !== "string" || item.query.trim() === "") {
      throw new Error(`eval[${i}]: query must be a non-empty string`);
    }
    if (typeof item?.should_trigger !== "boolean") {
      throw new Error(`eval[${i}]: should_trigger must be a boolean`);
    }
    return { query: item.query, shouldTrigger: item.should_trigger };
  });
};

// ------------------------------------------------------------ trigger verdict

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;

const asToolUse = (block: unknown): ToolUse | null => {
  const record = asRecord(block);
  if (record?.type !== "tool_use" || typeof record.name !== "string") {
    return null;
  }
  const skill = asRecord(record.input)?.skill;
  return {
    name: record.name,
    skill: typeof skill === "string" ? skill : undefined,
  };
};

const toolUseOf = (event: unknown): ToolUse | null => {
  const record = asRecord(event);
  if (record?.type === "assistant") {
    const content = asRecord(record.message)?.content;
    if (!Array.isArray(content)) return null;
    for (const block of content) {
      const use = asToolUse(block);
      if (use) return use;
    }
    return null;
  }
  const inner = asRecord(record?.event) ?? record;
  if (inner?.type !== "content_block_start") return null;
  return asToolUse(inner.content_block);
};

// --include-partial-messages is deliberately not passed: content_block_start
// arrives with an empty input, so the skill name would only appear later as
// json deltas. The plain assistant event already carries the full input.
const toolUseFromLine = (line: string): ToolUse | null => {
  const text = line.trim();
  if (!text.startsWith("{")) return null;
  try {
    return toolUseOf(JSON.parse(text));
  } catch {
    return null;
  }
};

export const firstToolUse = (stdout: string): ToolUse | null => {
  for (const line of stdout.split("\n")) {
    const use = toolUseFromLine(line);
    if (use) return use;
  }
  return null;
};

export const firedBy = (use: ToolUse | null, skillName: string): boolean =>
  use?.name === "Skill" && use.skill === skillName;

export const firedFor = (stdout: string, skillName: string): boolean =>
  firedBy(firstToolUse(stdout), skillName);

// The raw counts in the report are what a version comparison reads; this
// verdict only decides the exit code. An even split at an even --runs counts
// against should-trigger and for should-not-trigger, so that a tie never reads
// as evidence that the skill fires.
export const passes = (result: QueryResult): boolean =>
  result.shouldTrigger
    ? result.fired * 2 > result.runs
    : result.fired * 2 <= result.runs;

// ----------------------------------------------------------------- measuring

const live = new Set<Deno.ChildProcess>();

const terminate = (
  child: Deno.ChildProcess,
  signal: Deno.Signal = "SIGTERM",
) => {
  try {
    child.kill(signal);
  } catch {
    // already exited
  }
};

const killLiveChildren = () => {
  for (const child of live) terminate(child);
};

type Attempt = { use: ToolUse | null; stderr: string };

// A grandchild that inherited the child's stderr keeps the pipe open past the
// child's own exit, so reading it to EOF needs its own bound: without one the
// run hangs with the candidate description still installed.
const settleWithin = <T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });

const runQuery = async (query: string, timeoutMs: number): Promise<Attempt> => {
  const child = new Deno.Command("claude", {
    args: [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--max-turns",
      "1",
      "--no-session-persistence",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  live.add(child);
  // Killing the child does not end the read: stdout reaches EOF only once every
  // process holding the write end has closed it, and a grandchild the child
  // left behind holds it open. The timeout has to close this side too, or an
  // attempt outlives its own limit with the candidate still installed.
  const reader = child.stdout
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream())
    .getReader();
  const timer = setTimeout(() => {
    terminate(child);
    reader.cancel().catch(() => {});
  }, timeoutMs);
  // Consumed from the start so a full stderr pipe cannot block the child, and
  // caught so a stream error cannot surface as an unhandled rejection while the
  // real SKILL.md still holds the candidate.
  const stderrText = new Response(child.stderr).text().catch(() => "");
  let use: ToolUse | null = null;
  let failure = "";
  try {
    const writer = child.stdin.getWriter();
    // The query goes in over stdin rather than argv: `claude` reads a leading
    // `-` as a flag, so an eval file could otherwise smuggle in --mcp-config
    // and start a process of its own choosing.
    await writer.write(new TextEncoder().encode(query));
    await writer.close();
    while (!use) {
      const { done, value } = await reader.read();
      if (done) break;
      use = toolUseFromLine(value);
    }
  } catch (error) {
    // A child that dies before reading stdin is one missed attempt, not a
    // failed run — its stderr is what the report prints as the diagnosis.
    failure = (error as Error).message;
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    live.delete(child);
    terminate(child);
    // The grace period starts here rather than at spawn, so a child that
    // ignores SIGTERM is killed 5 s after being asked rather than 5 s after
    // the full timeout it may never have reached.
    const hardTimer = setTimeout(() => terminate(child, "SIGKILL"), 5_000);
    await child.status.catch(() => undefined);
    clearTimeout(hardTimer);
  }
  const stderr = await settleWithin(stderrText, 2_000, "");
  return { use, stderr: [failure, stderr].filter((s) => s !== "").join("\n") };
};

const measure = async (
  items: EvalItem[],
  skillName: string,
  opts: {
    runs: number;
    concurrency: number;
    timeoutMs: number;
    quiet: boolean;
  },
): Promise<{ results: QueryResult[]; failures: string[] }> => {
  const jobs = items.flatMap((item, index) =>
    Array.from({ length: opts.runs }, () => index)
  );
  const results: QueryResult[] = items.map((item) => ({
    query: item.query,
    shouldTrigger: item.shouldTrigger,
    runs: opts.runs,
    fired: 0,
    firstTools: [],
  }));
  const failures: string[] = [];
  let cursor = 0;
  let done = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const index = jobs[cursor++];
      const attempt = await runQuery(items[index].query, opts.timeoutMs);
      results[index].firstTools.push(attempt.use ? attempt.use.name : "(none)");
      if (firedBy(attempt.use, skillName)) results[index].fired++;
      if (!attempt.use && attempt.stderr.trim() !== "") {
        failures.push(attempt.stderr.trim().split("\n").slice(-3).join("\n"));
      }
      done++;
      if (!opts.quiet) console.error(`  ${done}/${jobs.length} done`);
    }
  };
  const outcomes = await Promise.allSettled(
    Array.from({ length: Math.min(opts.concurrency, jobs.length) }, worker),
  );
  const crashed = outcomes.find((o): o is PromiseRejectedResult =>
    o.status === "rejected"
  );
  if (crashed) throw crashed.reason;
  return { results, failures };
};

// ------------------------------------------------------------------- reporting

const report = (results: QueryResult[], skillName: string): string => {
  const lines: string[] = [`skill: ${skillName}`, ""];
  for (const group of [true, false]) {
    const rows = results.filter((r) => r.shouldTrigger === group);
    if (rows.length === 0) continue;
    lines.push(group ? "should trigger" : "should not trigger");
    for (const row of rows) {
      const mark = passes(row) ? " " : "!";
      const tools = [...new Set(row.firstTools)].join(",");
      lines.push(
        `  ${mark} ${row.fired}/${row.runs}  ${row.query}  [first: ${tools}]`,
      );
    }
    const fired = rows.reduce((sum, r) => sum + r.fired, 0);
    const total = rows.reduce((sum, r) => sum + r.runs, 0);
    lines.push(`  total ${fired}/${total}`, "");
  }
  return lines.join("\n");
};

// ------------------------------------------------------------------ resolving

// Project skills shadow personal ones in Claude Code, so the project directory
// is tried first — otherwise the file being swapped is not the file being read.
const resolveSkill = (target: string): { dir: string; name: string } => {
  const candidates = target.includes("/") ? [target] : [
    `.claude/skills/${target}`,
    `${Deno.env.get("HOME") ?? ""}/.claude/skills/${target}`,
  ];
  for (const dir of candidates) {
    try {
      if (Deno.statSync(`${dir}/SKILL.md`).isFile) {
        return { dir, name: target.split("/").filter((s) => s !== "").pop()! };
      }
    } catch {
      // a candidate without a SKILL.md is not the skill
    }
  }
  return die(`SKILL.md not found for --skill=${target}`);
};

// ----------------------------------------------------------------------- main

const KNOWN_FLAGS = [
  "skill",
  "eval",
  "description",
  "runs",
  "concurrency",
  "timeout",
];

const main = async (args: string[]): Promise<number> => {
  const flag = (name: string): string | undefined => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit?.slice(name.length + 3);
  };
  const num = (name: string, fallback: number): number => {
    const raw = flag(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      die(`--${name} must be an integer >= 1`);
    }
    return value;
  };
  for (const arg of args) {
    const name = arg.match(/^--([\w-]+)(=|$)/)?.[1];
    if (arg === "--json") continue;
    if (!name || !KNOWN_FLAGS.includes(name)) {
      die(`unknown argument: ${arg}\n\n${USAGE}`);
    }
  }

  const skillArg = flag("skill") ?? die(`--skill is required\n\n${USAGE}`);
  const evalArg = flag("eval") ?? die(`--eval is required\n\n${USAGE}`);
  const { dir, name } = resolveSkill(skillArg);
  const skillPath = `${dir}/SKILL.md`;
  const backupPath = `${skillPath}${BACKUP_SUFFIX}`;

  const readEvalSet = (path: string): EvalItem[] => {
    try {
      return parseEvalSet(Deno.readTextFileSync(path));
    } catch (error) {
      return die(`${path}: ${(error as Error).message}`);
    }
  };
  const items = readEvalSet(evalArg);

  try {
    Deno.statSync(backupPath);
    die(
      `${backupPath} exists — a previous run was interrupted.\n` +
        `Compare it against ${skillPath} with diff, then restore whichever is intact.`,
    );
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  try {
    Deno.removeSync(`${backupPath}.partial`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }

  const descriptionFile = flag("description");
  const candidate = descriptionFile === undefined ? undefined : (() => {
    try {
      return Deno.readTextFileSync(descriptionFile);
    } catch (error) {
      return die(`${descriptionFile}: ${(error as Error).message}`);
    }
  })();

  const runs = num("runs", 3);
  const concurrency = num("concurrency", 10);
  const timeoutMs = num("timeout", 180) * 1000;

  const asJson = args.includes("--json");
  const original = Deno.readTextFileSync(skillPath);
  let swapped = false;

  const restore = () => {
    if (!swapped) return;
    Deno.writeTextFileSync(skillPath, original);
    Deno.removeSync(backupPath);
    swapped = false;
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    Deno.addSignalListener(signal, () => {
      try {
        killLiveChildren();
        restore();
      } catch (error) {
        console.error(
          `restore failed — the original is in ${backupPath}: ${error}`,
        );
      } finally {
        Deno.exit(130);
      }
    });
  }

  // Nothing below may call die(): Deno.exit() inside the try block would skip
  // the finally and leave the candidate description in the real skill. Every
  // argument that can be rejected is settled above.
  let code = 0;
  try {
    if (candidate !== undefined) {
      // The candidate is written into the real skill rather than a renamed
      // copy: a copy leaves the original installed as a near-identical
      // competitor, so a run that picks the original scores the candidate as a
      // miss. Each query is capped at one turn in return, since the skill
      // under test is now the real one.
      //
      // A truncated backup is worse than none: a half-written file is what the
      // interrupted-run message would tell the next run to restore from.
      Deno.writeTextFileSync(`${backupPath}.partial`, original);
      Deno.renameSync(`${backupPath}.partial`, backupPath);
      swapped = true;
      Deno.writeTextFileSync(
        skillPath,
        replaceDescription(original, candidate),
      );
    }
    const { results, failures } = await measure(items, name, {
      runs,
      concurrency,
      timeoutMs,
      quiet: asJson,
    });
    console.log(
      asJson
        ? JSON.stringify(
          { skill: name, description: descriptionFile ?? null, results },
          null,
          2,
        )
        : report(results, name),
    );
    if (results.every((r) => r.fired === 0) && failures.length > 0) {
      console.error(
        `\nNothing fired and claude wrote to stderr:\n${failures[0]}`,
      );
    }
    code = results.every(passes) ? 0 : 1;
  } finally {
    restore();
  }
  return code;
};

if (import.meta.main) {
  const args = Deno.args;
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    Deno.exit(0);
  }
  try {
    Deno.exit(await main(args));
  } catch (error) {
    // Exit 1 is reserved for "a query landed on the wrong side"; anything
    // thrown here is the environment, not the description.
    die(`${(error as Error).message}`);
  }
}
