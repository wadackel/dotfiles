import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import {
  captureOutput,
  createClaudePane,
  sendKey,
  setupServer,
  spawnPicker,
  teardown,
  tmux,
  waitFor,
  waitForExit,
} from "./picker_e2e_harness.ts";

// Helper: resolve a paneId (%N) to its "session:window.pane" target string.
async function paneTarget(paneId: string): Promise<string> {
  return (await tmux([
    "display-message",
    "-t",
    paneId,
    "-p",
    "#{session_name}:#{window_index}.#{pane_index}",
  ])).trim();
}

// S0: Smoke test — exercises the harness itself. No Claude panes in the
// session, so picker should immediately render "No panes available." and
// exit cleanly on Escape. If this fails, the harness is broken — not picker.
Deno.test("S0: harness smoke (no panes)", async () => {
  await setupServer();
  try {
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    assertStringIncludes(out, "No panes available.");
    await sendKey(picker, "Escape");
    await waitForExit();
    // Sanity: harness made it to teardown without exception.
    assertEquals(true, true);
  } finally {
    await teardown();
  }
});

// S2: summaryOf in picker.tsx:220-226 picks waitReason when status is
// waiting/error (even if prompt is set), otherwise picks prompt. Assert both
// branches fire in a single capture to avoid a second cold start.
Deno.test("S2: summary switches between waitReason and prompt by status", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "waiting",
      waitReason: "perm-X",
      prompt: "ignore-X",
    });
    await createClaudePane({ status: "running", prompt: "go-Y" });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    assertStringIncludes(out, "perm-X");
    assertStringIncludes(out, "go-Y");
    assertFalse(
      out.includes("ignore-X"),
      `waiting pane showed prompt instead of waitReason:\n${out}`,
    );
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S3: j/k and arrow keys move the "❯" pointer between rows. Pointer is
// rendered by picker.tsx:401 only on the row whose index matches state.
Deno.test("S3: navigation (Down/Up/jk moves the pointer)", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "row-a-xxx" });
    await createClaudePane({ status: "running", prompt: "row-b-yyy" });
    const picker = await spawnPicker();

    const selectedIncludes = (marker: string) => (out: string) => {
      const line = out.split("\n").find((l) => l.includes("❯"));
      return line?.includes(marker) ?? false;
    };

    const initial = await captureOutput(picker);
    assertStringIncludes(
      initial.split("\n").find((l) => l.includes("❯")) ?? "",
      "row-a-xxx",
    );

    await sendKey(picker, "Down");
    await waitFor(picker, selectedIncludes("row-b-yyy"));

    await sendKey(picker, "k");
    await waitFor(picker, selectedIncludes("row-a-xxx"));

    await sendKey(picker, "j");
    await waitFor(picker, selectedIncludes("row-b-yyy"));

    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S4: Enter sends select-window + select-pane + switch-client (picker.tsx:349-354).
// In a detached test server switch-client silently fails (no current client), so
// we only verify the select-window / select-pane side-effects via the tmux
// #{pane_active} / #{window_active} flags — both set regardless of attached clients.
Deno.test("S4: enter selects target window+pane", async () => {
  await setupServer();
  try {
    // paneA is the initial selection (index 0); paneB is the jump target.
    await createClaudePane({ status: "running", prompt: "row-a" });
    const paneB = await createClaudePane({ status: "running", prompt: "row-b" });
    const picker = await spawnPicker();

    // Move selection to paneB row.
    await sendKey(picker, "Down");
    await waitFor(picker, (out) => {
      const line = out.split("\n").find((l) => l.includes("❯"));
      return line?.includes("row-b") ?? false;
    });

    await sendKey(picker, "Enter");
    await waitForExit();

    const paneActive = (
      await tmux(["display-message", "-t", paneB, "-p", "#{pane_active}"])
    ).trim();
    const windowActive = (
      await tmux(["display-message", "-t", paneB, "-p", "#{window_active}"])
    ).trim();
    assertEquals(paneActive, "1", "paneB should be the active pane of its window");
    assertEquals(
      windowActive,
      "1",
      "paneB's window should be the active window of the session",
    );
  } finally {
    await teardown();
  }
});

// S5: All four status short names render simultaneously, and a garbage
// (agent=shell) pane does NOT leak into the output. Doubles as regression
// detection for the `agent === "claude"` filter.
Deno.test("S5: multi-status + self-filter", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running" });
    await createClaudePane({ status: "waiting" });
    await createClaudePane({ status: "idle" });
    await createClaudePane({ status: "error" });
    const garbage = await createClaudePane({ agent: "shell" });
    const garbageTarget = await paneTarget(garbage);

    const picker = await spawnPicker();
    const out = await captureOutput(picker);

    assertStringIncludes(out, "run");
    assertStringIncludes(out, "wait");
    assertStringIncludes(out, "idle");
    assertStringIncludes(out, "err");
    assertFalse(
      out.includes(garbageTarget),
      `garbage target ${garbageTarget} leaked into multi-status capture:\n${out}`,
    );

    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S1: A non-claude pane (agent="shell") must be filtered out by picker.
// fetchPanes keeps only `agent === "claude"` (picker.tsx:313), so a "shell"
// pane should produce the same empty-list UI as S0. Also double-checks that
// the garbage pane's target never leaks into the capture.
Deno.test("S1: empty list (agent filter excludes non-claude)", async () => {
  await setupServer();
  try {
    const garbage = await createClaudePane({ agent: "shell" });
    const garbageTarget = await paneTarget(garbage);
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    assertStringIncludes(out, "No panes available.");
    assertFalse(
      out.includes(garbageTarget),
      `garbage target ${garbageTarget} leaked into picker output:\n${out}`,
    );
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S6: When @pane_current_tool is empty but @pane_last_tool is set, row 2
// should render `last: <tool>` — the primary fallback that replaces the
// bare-blink "empty row 2 after PostToolUse" failure mode.
Deno.test("S6: last-tool fallback renders `last: Edit`", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "idle",
      prompt: "row-last-tool",
      lastTool: "Edit",
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    assertStringIncludes(out, "last: Edit");
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S7: @pane_last_edit_file holds a raw file path; picker applies basename
// at render time. Verify the directory components are stripped.
Deno.test("S7: last-edit-file renders basename only", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "idle",
      prompt: "row-basename",
      lastTool: "Edit",
      lastEditFile: "/Users/alice/dotfiles/home/programs/tmux/picker.tsx",
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    assertStringIncludes(out, "picker.tsx");
    assertFalse(
      out.includes("/Users/alice"),
      `basename failed — raw path leaked into row 2:\n${out}`,
    );
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S8: readTaskProgress enumerates ~/.claude/tasks/<sessionId>/*.json.
// Seed a disposable session dir under $HOME/.claude/tasks (picker inherits
// $HOME from the tmux/user env). Use Deno.makeTempDir to guarantee a unique
// basename and eliminate path-traversal risk structurally.
Deno.test("S8: task progress 2/3 from tasks dir", async () => {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME unset — cannot run S8");
  const tasksRoot = `${home}/.claude/tasks`;
  await Deno.mkdir(tasksRoot, { recursive: true });
  const dir = await Deno.makeTempDir({
    dir: tasksRoot,
    prefix: "picker-e2e-test-",
  });
  const sessionId = dir.split("/").pop()!;
  try {
    await Deno.writeTextFile(
      `${dir}/1.json`,
      JSON.stringify({ id: "1", status: "completed" }),
    );
    await Deno.writeTextFile(
      `${dir}/2.json`,
      JSON.stringify({ id: "2", status: "completed" }),
    );
    await Deno.writeTextFile(
      `${dir}/3.json`,
      JSON.stringify({ id: "3", status: "in_progress" }),
    );
    await setupServer();
    try {
      await createClaudePane({
        status: "idle",
        prompt: "row-progress",
        lastTool: "Read",
        sessionId,
      });
      const picker = await spawnPicker();
      const out = await waitFor(picker, (o) => o.includes("2/3"));
      assertStringIncludes(out, "2/3");
      await sendKey(picker, "Escape");
      await waitForExit();
    } finally {
      await teardown();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// S9: idle duration renders as `idle Ns` when status=idle and activity_at
// is set. Using a fixed timestamp 42s in the past keeps the assertion
// deterministic without depending on precise scheduling.
Deno.test("S9: idle duration renders `idle 42s`", async () => {
  await setupServer();
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    await createClaudePane({
      status: "idle",
      prompt: "row-idle",
      lastTool: "Bash",
      lastActivityAtSec: nowSec - 42,
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    // Allow ±1s jitter from render timing (42s → 42 or 43).
    const matched = out.includes("idle 42s") || out.includes("idle 43s");
    assertEquals(
      matched,
      true,
      `row 2 did not render expected idle duration:\n${out}`,
    );
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S10: Under a narrow list width, low-priority row-2 segments drop first.
// List width is ~60% of the terminal. Force overflow by making every segment
// long and using a 60-col terminal — tool-slot must remain, idle should drop.
Deno.test("S10: narrow width drops low-priority segments first", async () => {
  await setupServer({ cols: 60, rows: 20 });
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    await createClaudePane({
      status: "idle",
      prompt: "promptxxxxxxxxxxxxxxxx",
      lastTool: "MultiEditLongNameXYZ", // takes > half the budget
      lastEditFile: "/a/b/c/verylongfilename-for-overflow.tsx",
      lastActivityAtSec: nowSec - 42,
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    // Highest-priority (tool-slot via last:) must remain.
    assertStringIncludes(out, "last: MultiEditLongNameXYZ");
    // Lowest-priority (idle) should have been dropped. The specific "idle 42s"
    // / "idle 43s" literal must not appear in the rendered row.
    assertFalse(
      out.includes("idle 42s") || out.includes("idle 43s"),
      `narrow width did not drop idle segment:\n${out}`,
    );
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});
