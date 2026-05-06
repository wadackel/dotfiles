import { assertEquals } from "jsr:@std/assert@1";
import {
  codexCwdHash,
  isLivePaneCommand,
  type PaneRow,
  parseRow,
  parseTarget,
  readTaskProgress,
  readTaskProgressForRow,
  TMUX_FORMAT,
} from "./picker.tsx";
import { type Row2Seg, truncateTopSegBody } from "./components.tsx";
import { cwdHash as gateCwdHash } from "../../codex/scripts/codex-plan-gate.ts";

Deno.test("TMUX_FORMAT contains 21 US-separated field tokens", () => {
  const fields = TMUX_FORMAT.split("\x1f");
  assertEquals(fields.length, 21);
});

Deno.test("parseRow: full row with all fields present", () => {
  const line = [
    "%42",
    "0:1.2",
    "node",
    "/Users/wadackel/dotfiles",
    "claude",
    "waiting",
    "1700000000",
    "/Users/wadackel/dotfiles",
    "main",
    "Explore:a1|Plan:b2",
    "hello world",
    "permission-denied",
    "Bash",
    "sess-abc",
    "Edit",
    "/x/y/file.ts",
    "1700001234",
    "pnpm test",
    "picker.tsx",
    "Exit code 1",
    "42",
  ].join("\x1f");
  const row = parseRow(line);
  const expected: PaneRow = {
    paneId: "%42",
    target: "0:1.2",
    currentCommand: "node",
    currentPath: "/Users/wadackel/dotfiles",
    agent: "claude",
    status: "waiting",
    startedAtSec: 1700000000,
    cwd: "/Users/wadackel/dotfiles",
    worktreeBranch: "main",
    subagents: "Explore:a1|Plan:b2",
    prompt: "hello world",
    waitReason: "permission-denied",
    currentTool: "Bash",
    sessionId: "sess-abc",
    lastTool: "Edit",
    lastEditFile: "/x/y/file.ts",
    lastActivityAtSec: 1700001234,
    currentToolSubject: "pnpm test",
    lastToolSubject: "picker.tsx",
    lastToolError: "Exit code 1",
    contextUsedPct: 42,
  };
  assertEquals(row, expected);
});

Deno.test("parseRow: empty @pane_* fields stay as empty strings / null", () => {
  const line = Array(21).fill("").map((v, i) =>
    i === 0 ? "%1" : (i === 3 ? "/home/me" : v)
  )
    .join("\x1f");
  const row = parseRow(line);
  assertEquals(row?.agent, "");
  assertEquals(row?.status, "");
  assertEquals(row?.startedAtSec, null);
  assertEquals(row?.subagents, "");
  assertEquals(row?.currentTool, "");
  assertEquals(row?.worktreeBranch, "");
  assertEquals(row?.currentPath, "/home/me");
  assertEquals(row?.sessionId, "");
  assertEquals(row?.lastTool, "");
  assertEquals(row?.lastEditFile, "");
  assertEquals(row?.lastActivityAtSec, null);
  assertEquals(row?.currentToolSubject, "");
  assertEquals(row?.lastToolSubject, "");
  assertEquals(row?.lastToolError, "");
  assertEquals(row?.contextUsedPct, null);
});

Deno.test("parseRow: unknown status normalized to empty string", () => {
  const line = Array(21).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 1 ? "0:0.0" : i === 2 ? "zsh" : i === 5 ? "bogus" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.status, "");
});

Deno.test("parseRow: non-numeric started_at → null (safe parse)", () => {
  const line = Array(21).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 1 ? "0:0.0" : i === 5 ? "idle" : i === 6 ? "nope" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.startedAtSec, null);
});

Deno.test("parseRow: non-numeric last_activity_at → null (safe parse)", () => {
  const line = Array(21).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 16 ? "nope" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.lastActivityAtSec, null);
});

Deno.test("parseRow: non-numeric context_used_pct → null (safe parse)", () => {
  const line = Array(21).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 20 ? "nope" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.contextUsedPct, null);
});

Deno.test("parseRow: valid context_used_pct parsed as integer", () => {
  const line = Array(21).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 20 ? "75" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.contextUsedPct, 75);
});

Deno.test("parseRow: control bytes (ESC/BEL/NUL) in string fields are stripped to space", () => {
  // Adversarial input: attacker-controlled cwd / branch / prompt embed ESC, BEL,
  // NUL bytes. parseRow must replace each with a space so Ink rendering cannot
  // execute terminal escape sequences. `\x1b` `\x07` `\x00` differ from `\x1f`
  // (US, field separator), so the 21-field structure survives.
  const fields = [
    "%9", // 0 paneId
    "0:0.0", // 1 target
    "node", // 2 currentCommand
    "/tmp/\x1b]0;pwn\x07/dir", // 3 currentPath — ESC + BEL escape sequence
    "claude", // 4 agent
    "running", // 5 status
    "1700000000", // 6 startedAt
    "/repo/\x1b[2Jproject", // 7 cwd — ESC + screen-clear
    "feat\x07branch", // 8 worktreeBranch — BEL
    "Type:id\x00x", // 9 subagents — NUL
    "hi\x1b[Aworld", // 10 prompt
    "stuck\x07", // 11 waitReason
    "Bash\x00", // 12 currentTool
    "sid-001", // 13 sessionId
    "Edit", // 14 lastTool
    "/path/to/\x1b[2Kfile.ts", // 15 lastEditFile
    "1700000010", // 16 lastActivityAt
    "subj\x1b[A", // 17 currentToolSubject
    "lasts\x07", // 18 lastToolSubject
    "err\x00msg", // 19 lastToolError
    "10", // 20 contextUsedPct
  ];
  const row = parseRow(fields.join("\x1f"));
  // All ESC / BEL / NUL bytes replaced with " ". \x1f is excluded from the
  // strip set (it is the separator) but never appears within field values
  // because split() consumed it.
  assertEquals(row?.currentPath, "/tmp/ ]0;pwn /dir");
  assertEquals(row?.cwd, "/repo/ [2Jproject");
  assertEquals(row?.worktreeBranch, "feat branch");
  assertEquals(row?.subagents, "Type:id x");
  assertEquals(row?.prompt, "hi [Aworld");
  assertEquals(row?.waitReason, "stuck ");
  assertEquals(row?.currentTool, "Bash ");
  assertEquals(row?.lastEditFile, "/path/to/ [2Kfile.ts");
  assertEquals(row?.currentToolSubject, "subj [A");
  assertEquals(row?.lastToolSubject, "lasts ");
  assertEquals(row?.lastToolError, "err msg");
});

Deno.test("parseRow: malformed input returns null", () => {
  assertEquals(parseRow(""), null);
  assertEquals(parseRow("only\x1ftwo"), null);
  // 20 fields (one short of 21) → null
  const twenty = Array(20).fill("x").join("\x1f");
  assertEquals(parseRow(twenty), null);
  // 21 fields but paneId empty → null (matches bash SELF_PANE_ID skip logic)
  const emptyId = Array(21).fill("").join("\x1f");
  assertEquals(parseRow(emptyId), null);
});

Deno.test("isLivePaneCommand: accepts live claude entry points", () => {
  assertEquals(isLivePaneCommand("claude", ".claude-wrapped"), true);
  assertEquals(isLivePaneCommand("claude", "claude"), true);
  assertEquals(isLivePaneCommand("claude", "node"), true);
});

Deno.test("isLivePaneCommand: accepts live opencode entry points", () => {
  assertEquals(isLivePaneCommand("opencode", ".opencode-wrapp"), true);
  assertEquals(isLivePaneCommand("opencode", ".opencode-wrapped"), true);
  assertEquals(isLivePaneCommand("opencode", "opencode"), true);
});

Deno.test("isLivePaneCommand: accepts live codex entry points", () => {
  assertEquals(isLivePaneCommand("codex", ".codex-wrapped"), true);
  assertEquals(isLivePaneCommand("codex", "codex"), true);
});

Deno.test("isLivePaneCommand: cross-agent rejection", () => {
  // claude pane running opencode binary or vice versa is not a live session
  assertEquals(isLivePaneCommand("claude", ".opencode-wrapp"), false);
  assertEquals(isLivePaneCommand("opencode", ".claude-wrapped"), false);
  assertEquals(isLivePaneCommand("claude", ".codex-wrapped"), false);
  assertEquals(isLivePaneCommand("codex", ".claude-wrapped"), false);
});

Deno.test("isLivePaneCommand: rejects non-AI commands", () => {
  assertEquals(isLivePaneCommand("claude", "zsh"), false);
  assertEquals(isLivePaneCommand("claude", "bash"), false);
  assertEquals(isLivePaneCommand("opencode", "zsh"), false);
  assertEquals(isLivePaneCommand("codex", "zsh"), false);
  assertEquals(isLivePaneCommand("claude", ""), false);
});

Deno.test("isLivePaneCommand: rejects unknown agent", () => {
  assertEquals(isLivePaneCommand("shell", ".claude-wrapped"), false);
  assertEquals(isLivePaneCommand("", ".claude-wrapped"), false);
  assertEquals(isLivePaneCommand("opencode_v2", ".opencode-wrapp"), false);
});

Deno.test("parseTarget: basic session:window.pane", () => {
  assertEquals(parseTarget("0:1.2"), { session: "0", window: "0:1" });
});

Deno.test("parseTarget: session name containing dot", () => {
  // Bash picker: `${target%%:*}` = "work.foo", `${win_pane%%.*}` = "1"
  // → select-window target is "work.foo:1"
  assertEquals(parseTarget("work.foo:1.2"), {
    session: "work.foo",
    window: "work.foo:1",
  });
});

Deno.test("parseTarget: malformed target falls back to identity", () => {
  assertEquals(parseTarget("broken"), { session: "broken", window: "broken" });
  assertEquals(parseTarget(":1.2"), { session: "", window: ":1" });
});

Deno.test("parseTarget: dot before colon is not treated as pane separator", () => {
  // `a.b:0.1` — lastDotIdx=6 (after colon), colonIdx=3
  assertEquals(parseTarget("a.b:0.1"), { session: "a.b", window: "a.b:0" });
});

// --- readTaskProgress ---

async function withFixtureHome<T>(
  fn: (homeDir: string) => Promise<T>,
): Promise<T> {
  const fixtureHome = new URL("./fixtures/task-progress-home", import.meta.url)
    .pathname;
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", fixtureHome);
  try {
    return await fn(fixtureHome);
  } finally {
    if (originalHome !== undefined) Deno.env.set("HOME", originalHome);
    else Deno.env.delete("HOME");
  }
}

async function withTempHome<T>(
  fn: (homeDir: string) => Promise<T>,
): Promise<T> {
  const home = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "picker-codex-home-",
  });
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    return await fn(home);
  } finally {
    if (originalHome !== undefined) Deno.env.set("HOME", originalHome);
    else Deno.env.delete("HOME");
    await Deno.remove(home, { recursive: true }).catch(() => undefined);
  }
}

function codexRow(cwd: string): PaneRow {
  return {
    paneId: "%1",
    target: "test:0.0",
    currentCommand: "codex",
    currentPath: cwd,
    agent: "codex",
    status: "running",
    startedAtSec: null,
    cwd,
    worktreeBranch: "",
    subagents: "",
    prompt: "",
    waitReason: "",
    currentTool: "",
    sessionId: "codex-session",
    lastTool: "",
    lastEditFile: "",
    lastActivityAtSec: null,
    currentToolSubject: "",
    lastToolSubject: "",
    lastToolError: "",
    contextUsedPct: null,
  };
}

async function writeCodexPlanState(
  home: string,
  cwd: string,
  opts: {
    marker: "active" | "pending";
    tasks?: Array<"pending" | "in_progress" | "completed" | undefined>;
    markerContent?: string;
    evidenceText?: string;
    expired?: boolean;
  },
): Promise<{ markerPath: string; planPath: string; evidencePath: string }> {
  const plansDir = `${home}/.codex/plans`;
  await Deno.mkdir(plansDir, { recursive: true });
  await Deno.mkdir(cwd, { recursive: true });
  const hash = await codexCwdHash(cwd);
  if (!hash) throw new Error("failed to hash codex cwd");

  const planPath = `${plansDir}/sample-plan.md`;
  const evidencePath = `${plansDir}/sample-plan.evidence.json`;
  await Deno.writeTextFile(planPath, "## sample plan\n");
  const tasks = opts.tasks ?? ["completed", "in_progress", "pending"];
  const taskObjects = tasks.map((status, i) => {
    const task: Record<string, unknown> = {
      id: `task-${i + 1}`,
      subject: `Task ${i + 1}`,
    };
    if (status !== undefined) task.status = status;
    return task;
  });
  await Deno.writeTextFile(
    evidencePath,
    opts.evidenceText ??
      JSON.stringify({ plan: "sample-plan.md", tasks: taskObjects }, null, 2),
  );

  const markerPath = `${plansDir}/.${opts.marker}-${hash}`;
  await Deno.writeTextFile(markerPath, opts.markerContent ?? `${planPath}\n`);
  if (opts.expired) {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await Deno.utime(markerPath, old, old);
  }
  return { markerPath, planPath, evidencePath };
}

Deno.test("readTaskProgress: empty sessionId → null", async () => {
  assertEquals(await readTaskProgress(""), null);
});

Deno.test("readTaskProgress: sessionId with path-traversal chars → null", async () => {
  assertEquals(await readTaskProgress("../etc"), null);
  assertEquals(await readTaskProgress("./."), null);
  assertEquals(await readTaskProgress("foo/bar"), null);
  assertEquals(await readTaskProgress(".."), null);
});

Deno.test("readTaskProgress: missing dir → null", async () => {
  await withFixtureHome(async () => {
    const result = await readTaskProgress("nonexistent-session");
    assertEquals(result, null);
  });
});

Deno.test("readTaskProgress: aggregates completed/total counts", async () => {
  await withFixtureHome(async () => {
    const sessionId = "sess-A";
    const result = await readTaskProgress(sessionId);
    assertEquals(result, { done: 2, total: 3 });
  });
});

Deno.test("readTaskProgress: empty dir → null", async () => {
  await withFixtureHome(async () => {
    const sessionId = "sess-empty";
    const result = await readTaskProgress(sessionId);
    assertEquals(result, null);
  });
});

Deno.test("readTaskProgress: skips malformed json", async () => {
  await withFixtureHome(async () => {
    const sessionId = "sess-broken";
    const result = await readTaskProgress(sessionId);
    assertEquals(result, { done: 1, total: 1 });
  });
});

Deno.test("readTaskProgress: non-json files ignored", async () => {
  await withFixtureHome(async () => {
    const sessionId = "sess-mixed";
    const result = await readTaskProgress(sessionId);
    assertEquals(result, { done: 0, total: 1 });
  });
});

Deno.test("readTaskProgressForRow: codex active marker aggregates evidence tasks", async () => {
  await withTempHome(async (home) => {
    const cwd = `${home}/work/project`;
    await writeCodexPlanState(home, cwd, {
      marker: "active",
      tasks: ["completed", "completed", "in_progress"],
    });
    assertEquals(await readTaskProgressForRow(codexRow(cwd)), {
      done: 2,
      total: 3,
    });
  });
});

Deno.test("codexCwdHash: matches codex-plan-gate cwdHash", async () => {
  await withTempHome(async (home) => {
    const cwd = `${home}/work/project`;
    await Deno.mkdir(cwd, { recursive: true });
    assertEquals(await codexCwdHash(cwd), await gateCwdHash(cwd));
  });
});

Deno.test("readTaskProgressForRow: codex pending marker used when active absent", async () => {
  await withTempHome(async (home) => {
    const cwd = `${home}/work/project`;
    await writeCodexPlanState(home, cwd, {
      marker: "pending",
      tasks: ["completed", "pending", "pending"],
    });
    assertEquals(await readTaskProgressForRow(codexRow(cwd)), {
      done: 1,
      total: 3,
    });
  });
});

Deno.test("readTaskProgressForRow: codex expired active marker blocks pending fallback", async () => {
  await withTempHome(async (home) => {
    const cwd = `${home}/work/project`;
    await writeCodexPlanState(home, cwd, {
      marker: "pending",
      tasks: ["completed", "completed", "completed"],
    });
    await writeCodexPlanState(home, cwd, {
      marker: "active",
      tasks: ["completed"],
      expired: true,
    });
    assertEquals(await readTaskProgressForRow(codexRow(cwd)), null);
  });
});

Deno.test("readTaskProgressForRow: codex invalid marker path returns null", async () => {
  await withTempHome(async (home) => {
    const cwd = `${home}/work/project`;
    await writeCodexPlanState(home, cwd, {
      marker: "active",
      markerContent: "/tmp/outside-plan.md\n",
    });
    assertEquals(await readTaskProgressForRow(codexRow(cwd)), null);
  });
});

Deno.test({
  name: "readTaskProgressForRow: codex symlink evidence returns null",
  // Deno.symlink requires unscoped write permission on macOS even when both
  // paths sit under /tmp (the target canonicalizes through /private/tmp and
  // test permissions cannot escalate a parent --allow-write=/tmp profile).
  // The plan's unit verification command intentionally uses --allow-write.
  async fn() {
    await withTempHome(async (home) => {
      const cwd = `${home}/work/project`;
      const { evidencePath } = await writeCodexPlanState(home, cwd, {
        marker: "active",
      });
      const outside = `${home}/outside-evidence.json`;
      await Deno.writeTextFile(
        outside,
        JSON.stringify({
          plan: "sample-plan.md",
          tasks: [{ id: "task-1", subject: "one", status: "completed" }],
        }),
      );
      const outsideReal = await Deno.realPath(outside);
      await Deno.remove(evidencePath);
      await Deno.symlink(outsideReal, evidencePath);
      assertEquals(await readTaskProgressForRow(codexRow(cwd)), null);
    });
  },
});

Deno.test({
  name: "readTaskProgressForRow: codex symlink plan marker returns null",
  async fn() {
    await withTempHome(async (home) => {
      const cwd = `${home}/work/project`;
      const { markerPath } = await writeCodexPlanState(home, cwd, {
        marker: "active",
      });
      const plansDir = `${home}/.codex/plans`;
      const outside = `${home}/outside-plan.md`;
      const linked = `${plansDir}/linked-plan.md`;
      await Deno.writeTextFile(outside, "## outside\n");
      const outsideReal = await Deno.realPath(outside);
      await Deno.symlink(outsideReal, linked);
      await Deno.writeTextFile(markerPath, `${linked}\n`);
      assertEquals(await readTaskProgressForRow(codexRow(cwd)), null);
    });
  },
});

Deno.test({
  name:
    "readTaskProgressForRow: codex active marker symlink blocks pending fallback",
  async fn() {
    await withTempHome(async (home) => {
      const cwd = `${home}/work/project`;
      const { markerPath } = await writeCodexPlanState(home, cwd, {
        marker: "pending",
        tasks: ["completed", "completed", "completed"],
      });
      const hash = await codexCwdHash(cwd);
      if (!hash) throw new Error("failed to hash codex cwd");
      const activePath = `${home}/.codex/plans/.active-${hash}`;
      await Deno.symlink(`${home}/missing-active-marker`, activePath);
      assertEquals(markerPath.endsWith(hash), true);
      assertEquals(await readTaskProgressForRow(codexRow(cwd)), null);
    });
  },
});

Deno.test("readTaskProgressForRow: codex malformed evidence returns null", async () => {
  await withTempHome(async (home) => {
    const cwd = `${home}/work/project`;
    await writeCodexPlanState(home, cwd, {
      marker: "active",
      evidenceText: "{not json",
    });
    assertEquals(await readTaskProgressForRow(codexRow(cwd)), null);
  });
});

Deno.test("readTaskProgressForRow: codex legacy missing status counts as pending", async () => {
  await withTempHome(async (home) => {
    const cwd = `${home}/work/project`;
    await writeCodexPlanState(home, cwd, {
      marker: "active",
      tasks: ["completed", undefined, "pending"],
    });
    assertEquals(await readTaskProgressForRow(codexRow(cwd)), {
      done: 1,
      total: 3,
    });
  });
});

Deno.test("readTaskProgressForRow: codex missing marker returns null", async () => {
  await withTempHome(async (home) => {
    const cwd = `${home}/work/project`;
    await Deno.mkdir(cwd, { recursive: true });
    assertEquals(await readTaskProgressForRow(codexRow(cwd)), null);
  });
});
// --- truncateTopSegBody ---

function mkSeg(overrides: Partial<Row2Seg> = {}): Row2Seg {
  return {
    key: "tool",
    icon: "󰒓",
    body: "",
    color: "cyan",
    ...overrides,
  };
}

Deno.test("truncateTopSegBody: tool seg with `)` terminator → appends `…)` preserving paren", () => {
  // budget 15 → maxBodyCells 13 → keep first 11 cps + "…)"
  const seg = mkSeg({ body: "Bash(pnpm test here ok)" });
  assertEquals(truncateTopSegBody(seg, 15), "Bash(pnpm t…)");
});

Deno.test("truncateTopSegBody: bare tool name (no paren) → generic slice", () => {
  // No `)` terminator → fall through to raw code-point slice, no ellipsis.
  // budget 12 → maxBodyCells 10 → first 10 cps.
  const seg = mkSeg({ body: "BashToolXYZWriteTailChunk" });
  assertEquals(truncateTopSegBody(seg, 12), "BashToolXY");
});

Deno.test("truncateTopSegBody: tool seg with error suffix → generic slice", () => {
  // Body ends with error text, not `)`, so paren-preservation does not fire.
  // budget 16 → maxBodyCells 14 → cut inside the error tail, no ellipsis.
  const seg = mkSeg({ body: "Bash(test) ✖ Exit code 1" });
  assertEquals(truncateTopSegBody(seg, 16), "Bash(test) ✖ E");
});

Deno.test("truncateTopSegBody: budget with slack → body returned unchanged", () => {
  // maxBodyCells >= cps.length → slice returns full body.
  const seg = mkSeg({ body: "Bash(ok)" });
  assertEquals(truncateTopSegBody(seg, 100), "Bash(ok)");
});

Deno.test("default.nix passes --no-prompt to deno compile (prevents picker hang from Deno permission prompter)", async () => {
  // Regression guard. Without --no-prompt, an unauthorized runtime op causes
  // Deno's TtyPrompter::prompt to call clear_stdin (runtime/permissions/
  // prompter.rs), which loops on tcflush + select with a 100ms timeout. Inside
  // a tmux popup, stdin is steadily readable, so select never returns 0 and
  // the loop never exits. The picker's main thread spins inside this loop,
  // starving the JS event loop. ESC/q bytes arrive at stdin but useInput
  // never fires; only SIGINT (Ctrl+C) breaks out via signal-exit. Adding
  // --no-prompt converts unauthorized ops into thrown errors caught by the
  // tick try/catch (picker.tsx:781-783), preserving input responsiveness.
  const url = new URL("../default.nix", import.meta.url);
  const text = await Deno.readTextFile(url);
  const m = text.match(
    /run \$\{pkgs\.deno\}\/bin\/deno compile[\s\S]*?--output/,
  );
  if (!m) {
    throw new Error("Could not locate deno compile invocation in default.nix");
  }
  if (!m[0].includes("--no-prompt")) {
    throw new Error(
      "Missing --no-prompt in deno compile invocation. Without it, Deno's " +
        "permission prompter can infinite-loop on tcflush+select inside " +
        "TtyPrompter::prompt, hanging the picker.",
    );
  }
});

Deno.test("truncateTopSegBody: budget too small for `…)` → generic slice fallback", () => {
  // maxBodyCells < 3 → paren-preservation guard fails, fall back to slice.
  const seg = mkSeg({ body: "Bash(x)" });
  assertEquals(truncateTopSegBody(seg, 4), "Ba");
});
