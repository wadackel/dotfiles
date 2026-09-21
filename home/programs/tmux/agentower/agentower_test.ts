import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  bodyHeightFor,
  cardIndexAt,
  clampStep,
  codexCwdHash,
  COMPACT_CARD,
  isCompact,
  isKeyBurst,
  isLivePaneCommand,
  listGeometry,
  MOUSE_LEFT,
  MOUSE_RIGHT,
  MOUSE_WHEEL_DOWN,
  MOUSE_WHEEL_UP,
  nextUserLabel,
  nextWaitingIndex,
  type PaneRow,
  parseMouse,
  parsePrefixKey,
  parseRow,
  parseTarget,
  readTaskProgress,
  readTaskProgressForRow,
  row1Columns,
  showUsageCard,
  splitLayout,
  TMUX_FORMAT,
  topRowsFor,
  visibleWindow,
  wrapStep,
} from "./agentower.tsx";
import {
  clampUsageTokens,
  DOGRUN,
  hintTokens,
  ROW1_FIXED_OVERHEAD,
  type Row2Seg,
  truncateTopSegBody,
  usageLayout,
  usageRows,
  usageRowWidth,
  type UsageToken,
} from "./components.tsx";
import { type AgentUsage } from "../shared/agent-usage.ts";
import { stringCells } from "./cell_width.ts";
import { cwdHash as markerCwdHash } from "../../codex/scripts/codex-plan-marker.ts";

Deno.test("TMUX_FORMAT contains 23 US-separated field tokens", () => {
  const fields = TMUX_FORMAT.split("\x1f");
  assertEquals(fields.length, 23);
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
    "agentower.tsx",
    "Exit code 1",
    "42",
    "review",
    "sess-abc",
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
    lastToolSubject: "agentower.tsx",
    lastToolError: "Exit code 1",
    contextUsedPct: 42,
    userLabel: "review",
  };
  assertEquals(row, expected);
});

Deno.test("parseRow: empty @pane_* fields stay as empty strings / null", () => {
  const line = Array(23).fill("").map((v, i) =>
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
  assertEquals(row?.userLabel, "");
});

Deno.test("parseRow: unknown status normalized to empty string", () => {
  const line = Array(23).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 1 ? "0:0.0" : i === 2 ? "zsh" : i === 5 ? "bogus" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.status, "");
});

Deno.test("parseRow: unknown userLabel normalized to empty string", () => {
  const line = Array(23).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 21 ? "bogus" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.userLabel, "");
});

Deno.test("parseRow: valid userLabel preserved", () => {
  for (const label of ["review", "parked", "feedback", "pending"] as const) {
    const line = Array(23).fill("").map((v, i) =>
      i === 0 ? "%1" : i === 21 ? label : v
    ).join("\x1f");
    assertEquals(parseRow(line)?.userLabel, label);
  }
});

// --- userLabel session-binding gate ---
// parseRow honors @pane_user_label only when @pane_user_label_session (field
// 22) matches @pane_session_id (field 13). A new agent session writes a fresh
// session id, so a label bound to a closed session falls through to "".

function rowWithLabelSession(
  sessionId: string,
  userLabel: string,
  userLabelSession: string,
): string {
  return Array(23).fill("").map((v, i) =>
    i === 0
      ? "%1"
      : i === 13
      ? sessionId
      : i === 21
      ? userLabel
      : i === 22
      ? userLabelSession
      : v
  ).join("\x1f");
}

Deno.test("parseRow: userLabel kept when label session matches current session", () => {
  const line = rowWithLabelSession("sess-A", "review", "sess-A");
  assertEquals(parseRow(line)?.userLabel, "review");
});

Deno.test("parseRow: userLabel dropped when label session != current session", () => {
  // Stale label left over from a previous session on the same pane.
  const line = rowWithLabelSession("sess-NEW", "review", "sess-OLD");
  assertEquals(parseRow(line)?.userLabel, "");
});

Deno.test("parseRow: userLabel none when both session ids empty", () => {
  const line = rowWithLabelSession("", "", "");
  assertEquals(parseRow(line)?.userLabel, "");
});

Deno.test("parseRow: non-numeric started_at → null (safe parse)", () => {
  const line = Array(23).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 1 ? "0:0.0" : i === 5 ? "idle" : i === 6 ? "nope" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.startedAtSec, null);
});

Deno.test("parseRow: non-numeric last_activity_at → null (safe parse)", () => {
  const line = Array(23).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 16 ? "nope" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.lastActivityAtSec, null);
});

Deno.test("parseRow: non-numeric context_used_pct → null (safe parse)", () => {
  const line = Array(23).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 20 ? "nope" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.contextUsedPct, null);
});

Deno.test("parseRow: valid context_used_pct parsed as integer", () => {
  const line = Array(23).fill("").map((v, i) =>
    i === 0 ? "%1" : i === 20 ? "75" : v
  ).join("\x1f");
  assertEquals(parseRow(line)?.contextUsedPct, 75);
});

Deno.test("nextUserLabel: cycles none → review → parked → feedback → pending → none", () => {
  assertEquals(nextUserLabel(""), "review");
  assertEquals(nextUserLabel("review"), "parked");
  assertEquals(nextUserLabel("parked"), "feedback");
  assertEquals(nextUserLabel("feedback"), "pending");
  assertEquals(nextUserLabel("pending"), "");
});

Deno.test("parseRow: control bytes (ESC/BEL/NUL) in string fields are stripped to space", () => {
  // Adversarial input: attacker-controlled cwd / branch / prompt embed ESC, BEL,
  // NUL bytes. parseRow must replace each with a space so Ink rendering cannot
  // execute terminal escape sequences. `\x1b` `\x07` `\x00` differ from `\x1f`
  // (US, field separator), so the 23-field structure survives.
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
    "review", // 21 userLabel
    "sid-001", // 22 userLabelSession (matches sessionId → label honored)
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
  // 22 fields (one short of 23) → null
  const twentyTwo = Array(22).fill("x").join("\x1f");
  assertEquals(parseRow(twentyTwo), null);
  // 23 fields but paneId empty → null (matches bash SELF_PANE_ID skip logic)
  const emptyId = Array(23).fill("").join("\x1f");
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
    prefix: "agentower-codex-home-",
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
    userLabel: "",
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

Deno.test("codexCwdHash: matches codex-plan-marker cwdHash", async () => {
  await withTempHome(async (home) => {
    const cwd = `${home}/work/project`;
    await Deno.mkdir(cwd, { recursive: true });
    assertEquals(await codexCwdHash(cwd), await markerCwdHash(cwd));
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
  const seg = mkSeg({ body: "Bash(test) \u{F0156} Exit code 1" });
  assertEquals(truncateTopSegBody(seg, 16), "Bash(test) \u{F0156} E");
});

Deno.test("truncateTopSegBody: budget with slack → body returned unchanged", () => {
  // maxBodyCells >= cps.length → slice returns full body.
  const seg = mkSeg({ body: "Bash(ok)" });
  assertEquals(truncateTopSegBody(seg, 100), "Bash(ok)");
});

Deno.test("default.nix passes --no-prompt to deno compile (prevents Agentower hang from Deno permission prompter)", async () => {
  // Regression guard. Without --no-prompt, an unauthorized runtime op causes
  // Deno's TtyPrompter::prompt to call clear_stdin (runtime/permissions/
  // prompter.rs), which loops on tcflush + select with a 100ms timeout. Inside
  // a tmux popup, stdin is steadily readable, so select never returns 0 and
  // the loop never exits. Agentower's main thread spins inside this loop,
  // starving the JS event loop. ESC/q bytes arrive at stdin but useInput
  // never fires; only SIGINT (Ctrl+C) breaks out via signal-exit. Adding
  // --no-prompt converts unauthorized ops into thrown errors caught by the
  // fetchPanes tick try/catch in agentower.tsx, preserving input responsiveness.
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
        "TtyPrompter::prompt, hanging Agentower.",
    );
  }
});

Deno.test("truncateTopSegBody: budget too small for `…)` → generic slice fallback", () => {
  // maxBodyCells < 3 → paren-preservation guard fails, fall back to slice.
  const seg = mkSeg({ body: "Bash(x)" });
  assertEquals(truncateTopSegBody(seg, 4), "Ba");
});

// --- Usage card ---

const USAGE_NOW = 1786248126;

function mkUsage(
  agent: string,
  overrides: Partial<AgentUsage> = {},
): AgentUsage {
  return {
    agent,
    updatedAt: USAGE_NOW,
    windows: [
      { label: "5h", usedPct: 42, resetsAt: USAGE_NOW + 6420 },
      { label: "7d", usedPct: 13, resetsAt: USAGE_NOW + 500000 },
    ],
    ...overrides,
  };
}

// Codex's current upstream shape: one 7d window, no 5h.
function mkCodex7d(overrides: Partial<AgentUsage> = {}): AgentUsage {
  return mkUsage("codex", {
    windows: [{ label: "7d", usedPct: 17, resetsAt: USAGE_NOW + 500000 }],
    ...overrides,
  });
}

// Wide enough that every layout keeps its bars.
const WIDE = 200;

// Same literal the e2e assertions use; components.tsx keeps its own copy
// private.
const COUNTDOWN_ICON = "\u{F0450}";

function rowText(row: UsageToken[]): string {
  return row.map((t) => t.text).join("");
}

function colStart(row: UsageToken[], label: string): number {
  const text = rowText(row);
  const at = text.indexOf(label);
  // split()[0] on a missing label returns the whole row, so two rows that never
  // carry the label would compare equal and the alignment assertion would pass
  // without observing anything.
  if (at < 0) throw new Error(`no ${label} column in row: ${text}`);
  return stringCells(text.slice(0, at));
}

Deno.test("showUsageCard: hidden without data regardless of size", () => {
  assertEquals(showUsageCard([], 74, 48), false);
  assertEquals(showUsageCard([mkUsage("claude")], 74, 48), true);
});

Deno.test("showUsageCard: needs an inner width that fits a bar-less row", () => {
  const usages = [mkUsage("claude"), mkCodex7d()];
  // Preview 46 leaves 42 inside the card, the bar-less row width.
  assertEquals(showUsageCard(usages, 45, 48), false);
  assertEquals(showUsageCard(usages, 46, 48), true);
});

Deno.test("showUsageCard: the preview keeps 8 rows under the card", () => {
  assertEquals(showUsageCard([mkUsage("claude")], 74, 10), false);
  assertEquals(showUsageCard([mkUsage("claude")], 74, 11), true);
  assertEquals(showUsageCard([mkUsage("claude"), mkCodex7d()], 74, 11), false);
  assertEquals(showUsageCard([mkUsage("claude"), mkCodex7d()], 74, 12), true);
});

Deno.test("bodyHeightFor: a top blank row plus the key-hint bar and its margin take three rows", () => {
  assertEquals(bodyHeightFor(50), 47);
});

Deno.test("bodyHeightFor: floor stays at 5", () => {
  assertEquals(bodyHeightFor(6), 5);
});

Deno.test("splitLayout: columns plus gutter never exceed the terminal", () => {
  for (const cols of [20, 30, 41, 60, 61, 67, 80, 113, 150, 200]) {
    const { listWidth, previewWidth } = splitLayout(cols);
    const used = listWidth + (previewWidth > 0 ? 2 + previewWidth : 0);
    assertEquals(
      used <= cols,
      true,
      `cols=${cols} used=${used} (list=${listWidth} preview=${previewWidth})`,
    );
  }
});

Deno.test("splitLayout: cols 60 keeps the 40-cell list the e2e fixtures assume", () => {
  assertEquals(splitLayout(60), { listWidth: 40, previewWidth: 18 });
});

Deno.test("splitLayout: cols 150 gives the list the full 90-cell row-1 budget", () => {
  assertEquals(splitLayout(150), { listWidth: 90, previewWidth: 58 });
});

Deno.test("row1Columns: repo plus branch never overflow the list column", () => {
  for (const listWidth of [34, 36, 40, 45, 50, 67, 90, 118]) {
    const { repoMax, branchMax } = row1Columns(listWidth, 8, 4);
    assertEquals(
      ROW1_FIXED_OVERHEAD + repoMax + branchMax <= listWidth,
      true,
      `listWidth=${listWidth} repo=${repoMax} branch=${branchMax}`,
    );
  }
});

Deno.test("row1Columns: a wide list seats both columns at their natural width", () => {
  assertEquals(row1Columns(90, 8, 20), { repoMax: 8, branchMax: 20 });
  assertEquals(row1Columns(112, 30, 40), { repoMax: 24, branchMax: 28 });
});

Deno.test("row1Columns: the 152-column popup keeps repo(worktree) whole and narrows branch", () => {
  assertEquals(row1Columns(90, 30, 40), { repoMax: 24, branchMax: 20 });
});

Deno.test("row1Columns: branch shrinks before repo when the summary is starved", () => {
  assertEquals(row1Columns(60, 8, 20), { repoMax: 8, branchMax: 6 });
});

Deno.test("row1Columns: the 4-cell floors give way rather than overflow", () => {
  assertEquals(row1Columns(40, 8, 4), { repoMax: 8, branchMax: 1 });
  assertEquals(row1Columns(31, 8, 4), { repoMax: 0, branchMax: 0 });
});

Deno.test("splitLayout: preview drops once the remainder is too thin", () => {
  assertEquals(splitLayout(30), { listWidth: 30, previewWidth: 0 });
  assertEquals(splitLayout(55), { listWidth: 40, previewWidth: 0 });
  assertEquals(splitLayout(56), { listWidth: 40, previewWidth: 14 });
});

Deno.test("usageRowWidth: the sub-slot sum is 60 with bars and 42 without", () => {
  const base = { cols: ["5h", "7d"], agentW: 8, labelW: 2 };
  assertEquals(usageRowWidth({ ...base, bars: true }), 60);
  assertEquals(usageRowWidth({ ...base, bars: false }), 42);
});

Deno.test("usageLayout: bars survive at the exact row width and drop one cell under", () => {
  const usages = [mkUsage("claude"), mkCodex7d()];
  assertEquals(usageLayout(usages, 60)?.bars, true);
  assertEquals(usageLayout(usages, 59)?.bars, false);
});

Deno.test("usageLayout: columns are the union in encounter order", () => {
  assertEquals(usageLayout([mkCodex7d(), mkUsage("claude")], WIDE)?.cols, [
    "7d",
    "5h",
  ]);
  assertEquals(usageLayout([mkUsage("claude"), mkCodex7d()], WIDE)?.cols, [
    "5h",
    "7d",
  ]);
});

Deno.test("usageLayout: agent and label columns size to their widest member", () => {
  const layout = usageLayout([mkUsage("claude"), mkCodex7d()], WIDE);
  assertEquals(layout?.agentW, 8);
  assertEquals(layout?.labelW, 2);
});

Deno.test("usageLayout: no agent with windows yields no layout", () => {
  assertEquals(usageLayout([], WIDE), null);
  assertEquals(usageLayout([mkUsage("claude", { windows: [] })], WIDE), null);
});

Deno.test("usageRows: one row per agent, agents without windows skipped", () => {
  const rows = usageRows(
    [mkUsage("claude"), mkUsage("opencode", { windows: [] }), mkCodex7d()],
    USAGE_NOW,
    WIDE,
  );
  assertEquals(rows.length, 2);
  assertEquals(rowText(rows[0]).startsWith("claude"), true);
  assertEquals(rowText(rows[1]).startsWith("codex"), true);
});

Deno.test("usageRows: a missing window leaves a same-width gap so 7d stays aligned", () => {
  const [claude, codex] = usageRows(
    [mkUsage("claude"), mkCodex7d()],
    USAGE_NOW,
    WIDE,
  );
  assertEquals(colStart(claude, "7d"), 34);
  assertEquals(colStart(codex, "7d"), 34);
});

Deno.test("usageRows: the 7d column stays aligned once bars are dropped", () => {
  const [claude, codex] = usageRows(
    [mkUsage("claude"), mkCodex7d()],
    USAGE_NOW,
    59,
  );
  assertEquals(colStart(claude, "7d"), 25);
  assertEquals(colStart(codex, "7d"), 25);
});

Deno.test("usageRows: bars appear only when the row width fits the budget", () => {
  const withBars = usageRows([mkUsage("claude")], USAGE_NOW, WIDE);
  const without = usageRows([mkUsage("claude")], USAGE_NOW, 59);
  assertEquals(rowText(withBars[0]).includes("━"), true);
  assertEquals(rowText(withBars[0]).includes("─"), true);
  assertEquals(rowText(without[0]).includes("━"), false);
  assertEquals(rowText(without[0]).includes("─"), false);
});

Deno.test("usageRows: a countdown rides the 5h window alone", () => {
  const [row] = usageRows([mkUsage("claude")], USAGE_NOW, WIDE);
  const text = rowText(row);
  assertEquals(text.split(COUNTDOWN_ICON).length - 1, 1);
  assertStringIncludes(text, `${COUNTDOWN_ICON} 1h47m`);
});

Deno.test("usageRows: a used window lights at least one cell", () => {
  const barOf = (pct: number) => {
    const usage = mkUsage("claude", {
      windows: [{ label: "5h", usedPct: pct, resetsAt: USAGE_NOW + 6420 }],
    });
    return rowText(usageRows([usage], USAGE_NOW, WIDE)[0]);
  };
  assertStringIncludes(barOf(1), "5h ━─────── ");
  assertStringIncludes(barOf(0), "5h ──────── ");
  assertStringIncludes(barOf(100), "5h ━━━━━━━━ ");
});

Deno.test("usageRows: an expired window drops its bar and countdown but keeps the slots", () => {
  const expired = mkUsage("claude", {
    windows: [
      { label: "5h", usedPct: 42, resetsAt: USAGE_NOW - 10 },
      { label: "7d", usedPct: 13, resetsAt: USAGE_NOW + 500000 },
    ],
  });
  const [row] = usageRows([expired, mkCodex7d()], USAGE_NOW, WIDE);
  const text = rowText(row);
  assertStringIncludes(text, "--");
  assertEquals(text.includes(COUNTDOWN_ICON), false);
  // The reserved bar and countdown slots keep the later column in place.
  assertEquals(colStart(row, "7d"), 34);
});

Deno.test("usageRows: only a percentage at or above 80 takes the alert color", () => {
  const usage = mkUsage("claude", {
    windows: [
      { label: "5h", usedPct: 79, resetsAt: USAGE_NOW + 6420 },
      { label: "7d", usedPct: 80, resetsAt: USAGE_NOW + 500000 },
    ],
  });
  const [row] = usageRows([usage], USAGE_NOW, WIDE);
  const alerted = row.filter((t) => t.color === DOGRUN.err).map((t) => t.text);
  assertEquals(alerted, ["━━━━━━", " 80%"]);
  assertEquals(row.find((t) => t.text === " 79%")?.color, DOGRUN.fgDim);
});

Deno.test("usageRows: the unused track is dimmer than the filled run", () => {
  const [row] = usageRows([mkUsage("claude")], USAGE_NOW, WIDE);
  const track = row.find((t) => t.text.startsWith("─"));
  const filled = row.find((t) => t.text.startsWith("━"));
  assertEquals(track?.color, DOGRUN.dim);
  assertEquals(filled?.color, DOGRUN.fgDim);
});

Deno.test("usageRows: stale data carries an age suffix, fresh data does not", () => {
  const stale = mkUsage("claude", { updatedAt: USAGE_NOW - 29 * 86400 });
  assertStringIncludes(
    rowText(usageRows([stale], USAGE_NOW, WIDE)[0]),
    "(29d ago)",
  );
  assertEquals(
    rowText(usageRows([mkUsage("claude")], USAGE_NOW, WIDE)[0]).includes("ago"),
    false,
  );
});

Deno.test("clampUsageTokens: budget with slack keeps every token", () => {
  const [row] = usageRows([mkUsage("claude")], USAGE_NOW, WIDE);
  assertEquals(clampUsageTokens(row, 200), row);
});

Deno.test("clampUsageTokens: trims the straddling token and drops the rest", () => {
  const [row] = usageRows([mkUsage("claude")], USAGE_NOW, WIDE);
  const clamped = clampUsageTokens(row, 10);
  const text = clamped.map((t) => t.text).join("");
  assertEquals(stringCells(text) <= 10, true);
  assertEquals(text.startsWith("claude"), true);
});

Deno.test("clampUsageTokens: zero budget yields nothing", () => {
  const [row] = usageRows([mkUsage("claude")], USAGE_NOW, WIDE);
  assertEquals(clampUsageTokens(row, 0), []);
});

Deno.test("clampUsageTokens: a row one cell over budget is truncated, not wrapped", () => {
  // usageRows reserves the stale suffix on every row but only emits it when the
  // file is actually stale, so the over-budget case has to be built by hand.
  const stale = mkUsage("claude", { updatedAt: USAGE_NOW - 29 * 86400 });
  const [row] = usageRows([stale], USAGE_NOW, 60);
  const full = stringCells(rowText(row));
  assertEquals(full, 60);
  const text = clampUsageTokens(row, full - 1).map((t) => t.text).join("");
  assertEquals(stringCells(text), full - 1);
  assertEquals(text.endsWith("…"), true);
});

// --- nextWaitingIndex ---

function statusRows(...statuses: PaneRow["status"][]): PaneRow[] {
  return statuses.map((status, i) => ({
    ...parseRow(`%${i}${"\x1f".repeat(22)}`)!,
    status,
  }));
}

Deno.test("nextWaitingIndex: skips non-waiting rows forward", () => {
  const rows = statusRows("running", "idle", "waiting", "waiting");
  assertEquals(nextWaitingIndex(rows, 0), 2);
  assertEquals(nextWaitingIndex(rows, 2), 3);
});

Deno.test("nextWaitingIndex: wraps past the end", () => {
  assertEquals(
    nextWaitingIndex(statusRows("waiting", "idle", "running"), 1),
    0,
  );
});

Deno.test("nextWaitingIndex: the only waiting row selected stays put", () => {
  assertEquals(nextWaitingIndex(statusRows("idle", "waiting"), 1), 1);
});

Deno.test("nextWaitingIndex: no waiting row → no move", () => {
  assertEquals(nextWaitingIndex(statusRows("running", "idle"), 1), 1);
  assertEquals(nextWaitingIndex([], 0), 0);
});

// --- hintTokens ---

const hintText = (filter: boolean) =>
  hintTokens(filter).map((t) => t.text).join("");

Deno.test("hintTokens: jump leads so a right-side clip never removes it", () => {
  const text = hintText(false);
  assertEquals(text.indexOf("jump") < text.indexOf("move"), true);
  assertEquals(
    clampUsageTokens(hintTokens(false), 20).map((t) => t.text).join("")
      .includes("jump"),
    true,
  );
});

Deno.test("hintTokens: the wait/idle pill and `clear` appear only with the filter on", () => {
  assertEquals(hintText(false).includes("wait/idle"), false);
  assertStringIncludes(hintText(false), " filter");
  assertStringIncludes(hintText(true), "wait/idle");
  assertStringIncludes(hintText(true), " clear");
});

Deno.test("hintTokens: key chips carry the chip fill", () => {
  const chip = hintTokens(false).find((t) => t.text === "n")!;
  assertEquals(chip.backgroundColor, DOGRUN.bgChip);
});

// --- visibleWindow ---

Deno.test("visibleWindow: a list that fits shows every card without indicators", () => {
  assertEquals(visibleWindow(0, 0, 10, 0), {
    offset: 0,
    count: 0,
    above: 0,
    below: 0,
    scrolling: false,
  });
  // 5 cards × 4 rows = 20.
  assertEquals(visibleWindow(5, 4, 20, 0).scrolling, false);
  assertEquals(visibleWindow(5, 4, 20, 0).count, 5);
});

Deno.test("visibleWindow: one row short scrolls and reserves both indicators", () => {
  // 19 rows: 2 indicators + 4 cards (16 rows).
  assertEquals(visibleWindow(5, 0, 19, 0), {
    offset: 0,
    count: 4,
    above: 0,
    below: 1,
    scrolling: true,
  });
});

Deno.test("visibleWindow: the cards plus indicators never exceed the height", () => {
  for (let height = 6; height <= 60; height++) {
    const view = visibleWindow(40, 0, height, 0);
    const rows = 2 + view.count * 4;
    assertEquals(rows <= height, true, `height=${height} rows=${rows}`);
  }
});

Deno.test("visibleWindow: capacity covers each remainder of (height - 2) / 4", () => {
  assertEquals(visibleWindow(20, 0, 22, 0).count, 5);
  assertEquals(visibleWindow(20, 0, 23, 0).count, 5);
  assertEquals(visibleWindow(20, 0, 24, 0).count, 5);
  assertEquals(visibleWindow(20, 0, 25, 0).count, 5);
  assertEquals(visibleWindow(20, 0, 26, 0).count, 6);
});

Deno.test("visibleWindow: selecting the last card scrolls just far enough", () => {
  assertEquals(visibleWindow(20, 19, 48, 0), {
    offset: 9,
    count: 11,
    above: 9,
    below: 0,
    scrolling: true,
  });
});

Deno.test("visibleWindow: moving inside the window keeps the offset", () => {
  assertEquals(visibleWindow(20, 12, 48, 5).offset, 5);
  assertEquals(visibleWindow(20, 4, 48, 5).offset, 4);
});

Deno.test("visibleWindow: a shrinking list clamps a stale offset", () => {
  // Offset 10 was valid for 30 cards; with 15 the window can start at 4 at most.
  assertEquals(visibleWindow(15, 5, 48, 10).offset, 4);
});

Deno.test("visibleWindow: a tiny height still shows the selected card", () => {
  const view = visibleWindow(10, 7, 3, 0);
  assertEquals(view.count, 1);
  assertEquals(view.offset, 7);
});

// --- compact layout ---

Deno.test("isCompact: a popup under 30 rows uses the compact layout", () => {
  assertEquals(isCompact(29), true);
  assertEquals(isCompact(30), false);
});

Deno.test("topRowsFor / bodyHeightFor: the compact layout starts on the top row", () => {
  assertEquals(topRowsFor(24), 0);
  assertEquals(bodyHeightFor(24), 22);
  assertEquals(topRowsFor(50), 1);
  assertEquals(bodyHeightFor(50), 47);
});

Deno.test("visibleWindow: compact cards cost two rows plus a gap between them", () => {
  // 5 compact cards = 5 × 2 + 4 gaps = 14.
  assertEquals(visibleWindow(5, 0, 14, 0, COMPACT_CARD).scrolling, false);
  assertEquals(visibleWindow(5, 0, 13, 0, COMPACT_CARD), {
    offset: 0,
    count: 4,
    above: 0,
    below: 1,
    scrolling: true,
  });
});

Deno.test("visibleWindow: compact cards plus indicators never exceed the height", () => {
  for (let height = 5; height <= 40; height++) {
    const view = visibleWindow(40, 0, height, 0, COMPACT_CARD);
    const rows = 2 + view.count * 3 - 1;
    assertEquals(rows <= height, true, `height=${height} rows=${rows}`);
  }
});

Deno.test("parsePrefixKey: only a Ctrl+letter prefix enables the close chord", () => {
  assertEquals(parsePrefixKey("C-s\n"), "s");
  assertEquals(parsePrefixKey("C-b"), "b");
  assertEquals(parsePrefixKey("C-m"), null);
  assertEquals(parsePrefixKey("M-a"), null);
  assertEquals(parsePrefixKey("None"), null);
  assertEquals(parsePrefixKey(""), null);
});

// --- mouse ---

Deno.test("parseMouse: an SGR report becomes a 0-based press or release", () => {
  assertEquals(parseMouse("[<0;3;6M"), {
    button: MOUSE_LEFT,
    x: 2,
    y: 5,
    press: true,
  });
  assertEquals(parseMouse("[<0;3;6m")?.press, false);
  assertEquals(parseMouse("[<65;1;1M")?.button, MOUSE_WHEEL_DOWN);
  assertEquals(parseMouse("[<64;1;1M")?.button, MOUSE_WHEEL_UP);
  assertEquals(parseMouse("[<2;1;1M")?.button, MOUSE_RIGHT);
});

Deno.test("parseMouse: anything but a whole SGR report is not a mouse event", () => {
  assertEquals(parseMouse("m"), null);
  assertEquals(parseMouse("M"), null);
  assertEquals(parseMouse("[<0;3;6"), null);
  assertEquals(parseMouse("[M !!"), null);
  assertEquals(parseMouse("[A"), null);
});

// The three sizes below are the ones the e2e scenarios render at, so the
// expected rows match what S41 / S42 / S43 see on screen.
const geometryAt = (
  columns: number,
  rows: number,
  total: number,
  selected = 0,
) => listGeometry({ columns, rows, total, selected, prevOffset: 0 });

Deno.test("cardIndexAt: full cards own their padding rows", () => {
  const g = geometryAt(200, 50, 2);
  assertEquals(cardIndexAt(g, { x: 0, y: 0 }), null);
  assertEquals(cardIndexAt(g, { x: 0, y: 1 }), 0);
  assertEquals(cardIndexAt(g, { x: 0, y: 4 }), 0);
  assertEquals(cardIndexAt(g, { x: 0, y: 5 }), 1);
  assertEquals(cardIndexAt(g, { x: 0, y: 8 }), 1);
  assertEquals(cardIndexAt(g, { x: 0, y: 9 }), null);
  // Hint bar on the last row.
  assertEquals(cardIndexAt(g, { x: 0, y: 49 }), null);
});

Deno.test("cardIndexAt: the preview column and the gutter are not cards", () => {
  const g = geometryAt(200, 50, 2);
  assertEquals(cardIndexAt(g, { x: g.listWidth - 1, y: 1 }), 0);
  assertEquals(cardIndexAt(g, { x: g.listWidth, y: 1 }), null);
});

Deno.test("cardIndexAt: a scrolled list skips the indicators and adds the offset", () => {
  const g = geometryAt(200, 50, 20, 15);
  assertEquals(g.view.offset, 5);
  assertEquals(cardIndexAt(g, { x: 0, y: 1 }), null);
  assertEquals(cardIndexAt(g, { x: 0, y: 2 }), 5);
  assertEquals(cardIndexAt(g, { x: 0, y: 45 }), 15);
  assertEquals(cardIndexAt(g, { x: 0, y: 46 }), null);
});

Deno.test("cardIndexAt: compact gap rows belong to no card", () => {
  const g = geometryAt(150, 24, 2);
  assertEquals(cardIndexAt(g, { x: 0, y: 0 }), 0);
  assertEquals(cardIndexAt(g, { x: 0, y: 1 }), 0);
  assertEquals(cardIndexAt(g, { x: 0, y: 2 }), null);
  assertEquals(cardIndexAt(g, { x: 0, y: 3 }), 1);
  assertEquals(cardIndexAt(g, { x: 0, y: 5 }), null);
});

// --- isKeyBurst ---

Deno.test("isKeyBurst: a run of navigation keys splits", () => {
  assertEquals(isKeyBurst("jj"), true);
  assertEquals(isKeyBurst("jjj"), true);
  assertEquals(isKeyBurst("kkn"), true);
  assertEquals(isKeyBurst("jjjjjjjj"), true);
});

Deno.test("isKeyBurst: a terminal reply Ink stripped the ESC from does not", () => {
  // `\x1b[0n` (DSR) reaches useInput as `[0n`; splitting it would fire `n`.
  assertEquals(isKeyBurst("[0n"), false);
  assertEquals(isKeyBurst("[24;80R"), false);
});

Deno.test("isKeyBurst: pastes and single keys do not", () => {
  assertEquals(isKeyBurst("jjjjjjjjj"), false);
  assertEquals(isKeyBurst("j"), false);
  assertEquals(isKeyBurst("mm"), false);
  assertEquals(isKeyBurst("qq"), false);
  assertEquals(isKeyBurst(""), false);
});

// --- selection resolvers ---

Deno.test("wrapStep: moves and wraps at both ends", () => {
  const rows = statusRows("running", "running", "running");
  assertEquals(wrapStep(1)(0, rows), 1);
  assertEquals(wrapStep(1)(2, rows), 0);
  assertEquals(wrapStep(-1)(0, rows), 2);
  assertEquals(wrapStep(-1)(1, rows), 0);
});

Deno.test("clampStep: stops at both ends instead of wrapping", () => {
  const rows = statusRows("running", "running", "running");
  assertEquals(clampStep(1)(2, rows), 2);
  assertEquals(clampStep(-1)(0, rows), 0);
  assertEquals(clampStep(1)(0, rows), 1);
});

Deno.test("resolvers: a burst advances step by step", () => {
  const rows = statusRows("running", "running", "running", "running");
  let cur = 0;
  for (let i = 0; i < 3; i++) cur = wrapStep(1)(cur, rows);
  assertEquals(cur, 3);
  cur = 0;
  for (let i = 0; i < 3; i++) cur = clampStep(1)(cur, rows);
  assertEquals(cur, 3);
});

Deno.test("resolvers: a missing prevId resolves from index 0", () => {
  // App falls back to 0 when the selected pane left the list; the resolvers
  // must behave the same as they would on a real starting index.
  const rows = statusRows("running", "running");
  assertEquals(wrapStep(1)(0, rows), 1);
  assertEquals(clampStep(-1)(0, rows), 0);
  assertEquals(nextWaitingIndex(rows, 0), 0);
});
