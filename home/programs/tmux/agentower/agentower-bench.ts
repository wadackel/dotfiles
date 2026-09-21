#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write=/tmp --allow-run --no-prompt

// Startup and input-latency bench for Agentower. Each number maps to one line
// of agentower-bench-baseline.md, so a regression lands on a phase instead of
// "the popup feels slow". It drives the real binary inside the e2e harness's
// isolated tmux server and reads the AGENTOWER_TRACE marks it writes to stderr.
// Absolute values move with the machine — read the before/after pair.

import { MOUSE_WHEEL_DOWN } from "./agentower.tsx";
import {
  captureOutput,
  createClaudePane,
  sandboxHomePath,
  sendBurst,
  sendKey,
  setupServer,
  spawnAgentower,
  teardown,
  waitFor,
  waitForExit,
} from "./agentower_e2e_harness.ts";

const ROWS = ["row-a", "row-b", "row-c", "row-d"];
const REPEATS = 5;

interface Marks {
  [mark: string]: number[];
}

function parseMarks(text: string): Marks {
  const marks: Marks = {};
  for (const line of text.split("\n")) {
    const m = /^AGT (\S+) (\d+)$/.exec(line);
    if (!m) continue;
    (marks[m[1]] ??= []).push(Number(m[2]));
  }
  return marks;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

async function readTrace(path: string): Promise<Marks> {
  return parseMarks(await Deno.readTextFile(path));
}

async function withSandbox<T>(
  bin: string,
  body: () => Promise<T>,
): Promise<T> {
  Deno.env.set("AGENTOWER_E2E_BIN", bin);
  await setupServer();
  try {
    for (const prompt of ROWS) {
      await createClaudePane({ status: "running", prompt });
    }
    await writeUsageFixture();
    return await body();
  } finally {
    await teardown();
  }
}

// The tick reads these every second. Without them the usage read returns on
// the same macrotask as the progress read and React batches the two updates
// anyway, which would hide the repaint count the bench is there to measure.
async function writeUsageFixture(): Promise<void> {
  const dir = `${await sandboxHomePath()}/.local/state/agent-usage`;
  await Deno.mkdir(dir, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  for (const agent of ["claude", "codex"]) {
    await Deno.writeTextFile(
      `${dir}/${agent}.json`,
      JSON.stringify({
        agent,
        updatedAt: now,
        windows: [{ label: "5h", usedPct: 42, resetsAt: now + 3600 }],
      }),
    );
  }
}

// ---- phase timings ----

interface Phases {
  raw_on_ms: number | null;
  module_eval_ms: number | null;
  io_done_ms: number | null;
  first_commit_ms: number | null;
  // Frames Ink actually painted after the first, over the single tick that
  // fired. commits_per_tick counts App's commits only, so a frame driven by
  // Preview alone never reaches it; this counts the frames.
  frames_per_tick: number | null;
  // Ink's own timing of one render(rootNode). The sandbox's panes are asleep,
  // so their capture is nearly empty and this understates a real session,
  // where the preview text dominates the frame.
  render_us_p50: number | null;
  tick_us_p50: number | null;
  commits_per_tick: number | null;
}

async function measurePhases(bin: string): Promise<Phases> {
  const rawOn: number[] = [];
  const moduleEval: number[] = [];
  const ioDone: number[] = [];
  const firstCommit: number[] = [];
  const tickCommits: number[] = [];
  const framesPerTick: number[] = [];
  const renderUs: number[] = [];
  const tickUs: number[] = [];

  await withSandbox(bin, async () => {
    for (let i = 0; i < REPEATS; i++) {
      const traceFile = await Deno.makeTempFile({
        dir: "/tmp",
        prefix: "agentower-bench-trace-",
      });
      const target = await spawnAgentower({
        env: { AGENTOWER_TRACE: "1" },
        traceFile,
      });
      // One full tick, so the repaint count per tick is observable.
      await new Promise((r) => setTimeout(r, 1400));
      await sendKey(target, "Escape");
      await waitForExit();

      const marks = await readTrace(traceFile);
      await Deno.remove(traceFile);
      if (marks["raw-on"]) rawOn.push(marks["raw-on"][0]);
      if (marks["ink-module-eval-done"]) {
        moduleEval.push(marks["ink-module-eval-done"][0]);
      }
      if (marks["io-done"]) ioDone.push(marks["io-done"][0]);
      if (marks["first-commit"]) firstCommit.push(marks["first-commit"][0]);
      // Repaints after the first, over the single tick that fired.
      if (marks["tick-commit"]) tickCommits.push(marks["tick-commit"].length);
      const frames = marks["render-us"];
      if (frames) {
        framesPerTick.push(frames.length - 1);
        renderUs.push(...frames);
      }
      if (marks["tick-us"]) tickUs.push(...marks["tick-us"]);
    }
  });

  return {
    raw_on_ms: median(rawOn),
    module_eval_ms: median(moduleEval),
    io_done_ms: median(ioDone),
    first_commit_ms: median(firstCommit),
    frames_per_tick: median(framesPerTick),
    render_us_p50: median(renderUs),
    tick_us_p50: median(tickUs),
    commits_per_tick: median(tickCommits),
  };
}

// ---- input behaviour ----

// The selected card carries the marker on all four of its rows and the prompt
// sits on the second, so the whole marked block is searched rather than one
// line of it.
function selectedRow(out: string): string {
  const marked = out.split("\n").filter((l) => l.includes("▌")).join("\n");
  return ROWS.find((r) => marked.includes(r)) ?? "";
}

// How many rows the selection advanced from the top, after one write.
async function movesFor(bin: string, seq: string): Promise<number> {
  return await withSandbox(bin, async () => {
    const target = await spawnAgentower();
    await sendBurst(target, seq);
    await new Promise((r) => setTimeout(r, 500));
    const row = selectedRow(await captureOutput(target));
    await sendKey(target, "Escape");
    await waitForExit();
    return ROWS.indexOf(row);
  });
}

interface PreFrameKey {
  moves: number;
  // Milliseconds from the first frame to useInput seeing the key. Null when the
  // key never arrived, which is what the pre-change build does: it holds the
  // byte until the next keypress.
  latency_ms: number | null;
}

// A key that reaches the tty before the process starts.
async function preFrameKey(bin: string): Promise<PreFrameKey> {
  return await withSandbox(bin, async () => {
    const traceFile = await Deno.makeTempFile({
      dir: "/tmp",
      prefix: "agentower-bench-input-",
    });
    const target = await spawnAgentower({
      env: { AGENTOWER_TRACE: "1" },
      traceFile,
      waitForReady: false,
      startDelayMs: 600,
    });
    await sendKey(target, "j");
    let row = "";
    try {
      await waitFor(target, (out) => selectedRow(out) === "row-b", 6000);
      row = "row-b";
    } catch {
      row = selectedRow(await captureOutput(target));
    }
    await sendKey(target, "Escape");
    await waitForExit();

    const marks = await readTrace(traceFile);
    await Deno.remove(traceFile);
    const firstCommit = marks["first-commit"]?.[0];
    const received = marks["input-received"]?.[0];
    return {
      moves: ROWS.indexOf(row),
      latency_ms: firstCommit !== undefined && received !== undefined
        ? received - firstCommit
        : null,
    };
  });
}

async function ctrlCDuringLoadExits(bin: string): Promise<boolean> {
  return await withSandbox(bin, async () => {
    const target = await spawnAgentower({ waitForReady: false });
    await sendKey(target, "C-c");
    try {
      await waitForExit();
      return true;
    } catch {
      await sendKey(target, "Escape");
      await waitForExit().catch(() => {});
      return false;
    }
  });
}

// ---- fresh-binary exec cost ----

// The activation writes a new Mach-O and renames it into place; macOS charges
// the first exec of those bytes over a second, every rebuild. A warm-up run
// inside the activation moves that cost off the next prefix+w.
async function freshExec(
  bin: string,
  warmUpFirst: boolean,
): Promise<number> {
  // A 0700 directory rather than makeTempFile: copyFile carries the source's
  // mode over, so the copy is briefly world-readable before any chmod lands.
  const dir = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "agentower-bench-fresh-",
  });
  const copy = `${dir}/agentower`;
  try {
    await Deno.copyFile(bin, copy);
    // PATH alone: the binary only has to reach its TMUX guard, and handing a
    // path named on the command line the whole shell environment would put
    // every token in it inside a process this script did not write.
    const env = { PATH: Deno.env.get("PATH") ?? "" };
    // Exit 2 is main()'s own guard on the missing TMUX, so it doubles as proof
    // that the module graph evaluated. Any other code means the binary died
    // early, which would otherwise be timed as a very fast startup.
    const run = async () => {
      const { code, stderr } = await new Deno.Command(copy, {
        env,
        clearEnv: true,
        stdout: "null",
        stderr: "piped",
      }).output();
      if (code !== 2) {
        throw new Error(
          `${bin} exited ${code}, expected 2: ${
            new TextDecoder().decode(stderr).trim()
          }`,
        );
      }
    };
    if (warmUpFirst) await run();
    const started = performance.now();
    await run();
    return Number(((performance.now() - started) / 1000).toFixed(3));
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

// ---- report ----

function parseArgs(argv: string[]): {
  after: string;
  before: string | null;
  pretty: boolean;
} {
  let after = "";
  let before: string | null = null;
  let pretty = false;
  const value = (flag: string, raw: string | undefined): string => {
    if (raw === undefined || raw.startsWith("--")) {
      throw new Error(`${flag} needs a binary path`);
    }
    return raw;
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--after") after = value("--after", argv[++i]);
    else if (argv[i] === "--before") before = value("--before", argv[++i]);
    else if (argv[i] === "--pretty") pretty = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!after) throw new Error("--after <binary> is required");
  return { after, before, pretty };
}

async function measure(bin: string) {
  return {
    binary: bin,
    phases: await measurePhases(bin),
    input: {
      pre_frame_key: await preFrameKey(bin),
      burst_jjj_moves: await movesFor(bin, "jjj"),
      arrow_twice_moves: await movesFor(bin, "\x1b[B\x1b[B"),
      wheel_thrice_moves: await movesFor(
        bin,
        `\x1b[<${MOUSE_WHEEL_DOWN};3;3M`.repeat(3),
      ),
      ctrl_c_during_load_exits: await ctrlCDuringLoadExits(bin),
    },
    exec: {
      fresh_first_exec_s: await freshExec(bin, false),
      fresh_after_warmup_s: await freshExec(bin, true),
    },
  };
}

if (import.meta.main) {
  const { after, before, pretty } = parseArgs(Deno.args);
  const result = {
    check: "agentower-bench",
    repeats: REPEATS,
    measured_at: new Date().toISOString(),
    deno: Deno.version.deno,
    after: await measure(after),
    before: before ? await measure(before) : null,
  };
  console.log(JSON.stringify(result, null, pretty ? 2 : 0));
}
