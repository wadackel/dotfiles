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
import { codexCwdHash } from "./picker.tsx";

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

async function writeCodexProgressFixture(
  home: string,
  cwd: string,
): Promise<void> {
  await Deno.mkdir(cwd, { recursive: true });
  const plansDir = `${home}/.codex/plans`;
  await Deno.mkdir(plansDir, { recursive: true });
  const planPath = `${plansDir}/picker-e2e-plan.md`;
  await Deno.writeTextFile(planPath, "## picker e2e plan\n");
  await Deno.writeTextFile(
    `${plansDir}/picker-e2e-plan.evidence.json`,
    JSON.stringify(
      {
        plan: "picker-e2e-plan.md",
        tasks: [
          { id: "task-1", subject: "one", status: "completed" },
          { id: "task-2", subject: "two", status: "completed" },
          { id: "task-3", subject: "three", status: "in_progress" },
        ],
      },
      null,
      2,
    ),
  );
  const hash = await codexCwdHash(cwd);
  if (!hash) throw new Error("failed to hash codex e2e cwd");
  await Deno.writeTextFile(`${plansDir}/.active-${hash}`, `${planPath}\n`);
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
//
// Also exercises the post-idle Enter path: a 2200ms wait (TICK_INTERVAL_MS=1000ms × 2+)
// lets App + Preview tick chains accumulate before Enter, so the regression
// catches event-loop drain stalls after jumpTo / Ink unmount.
Deno.test("S4: enter selects target window+pane", async () => {
  await setupServer();
  try {
    // paneA is the initial selection (index 0); paneB is the jump target.
    await createClaudePane({ status: "running", prompt: "row-a" });
    const paneB = await createClaudePane({
      status: "running",
      prompt: "row-b",
    });
    const picker = await spawnPicker();

    // Idle wait so App/Preview ticks accumulate before the Enter exit path.
    await new Promise((r) => setTimeout(r, 2200));

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
    assertEquals(
      paneActive,
      "1",
      "paneB should be the active pane of its window",
    );
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
// should render the bare tool name (gray color distinguishes past from
// current; the prior `last: ` prefix was removed). Primary fallback against
// the "empty row 2 after PostToolUse" failure mode.
Deno.test("S6: last-tool fallback renders bare tool name (no `last: ` prefix)", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "idle",
      prompt: "row-last-tool",
      lastTool: "Edit",
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    assertStringIncludes(out, "Edit");
    assertFalse(
      out.includes("last: "),
      `removed prefix 'last: ' leaked into render:\n${out}`,
    );
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
      lastEditFile:
        "/Users/alice/dotfiles/home/programs/tmux/picker/picker.tsx",
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
// Point HOME at a checked-in read-only fixture so this e2e keeps the same
// permission profile as the rest of the picker tests.
Deno.test("S8: task progress 2/3 from tasks dir", async () => {
  const originalHome = Deno.env.get("HOME");
  const fixtureHome = new URL("./fixtures/task-progress-home", import.meta.url)
    .pathname;
  const denoDir = Deno.env.get("DENO_DIR") ??
    (originalHome ? `${originalHome}/Library/Caches/deno` : undefined);
  const env: Record<string, string> = { HOME: fixtureHome };
  if (denoDir) env.DENO_DIR = denoDir;
  await setupServer();
  try {
    await createClaudePane({
      status: "idle",
      prompt: "row-progress",
      lastTool: "Read",
      sessionId: "sess-A",
    });
    const picker = await spawnPicker({ env });
    const out = await waitFor(picker, (o) => o.includes("2/3"));
    assertStringIncludes(out, "2/3");
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S8b: Codex progress reads ~/.codex/plans/.active-<cwd-hash> and its
// sibling evidence JSON. The pane carries @pane_cwd so the hash is
// deterministic and independent of tmux's default current_path.
Deno.test("S8b: codex task progress 2/3 from evidence json", async () => {
  const originalHome = Deno.env.get("HOME");
  const tempHome = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "picker-codex-e2e-",
  });
  const denoDir = Deno.env.get("DENO_DIR") ??
    (originalHome ? `${originalHome}/Library/Caches/deno` : undefined);
  const cwd = `${tempHome}/work/project`;
  await writeCodexProgressFixture(tempHome, cwd);
  const env: Record<string, string> = { HOME: tempHome };
  if (denoDir) env.DENO_DIR = denoDir;
  await setupServer();
  try {
    await createClaudePane({
      agent: "codex",
      status: "idle",
      prompt: "codex-row-progress",
      lastTool: "Read",
      cwd,
    });
    const picker = await spawnPicker({ env });
    const out = await waitFor(picker, (o) => o.includes("2/3"));
    assertStringIncludes(out, "codex-row-progress");
    assertStringIncludes(out, "2/3");
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
    await Deno.remove(tempHome, { recursive: true }).catch(() => undefined);
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
    // Highest-priority (tool-slot, bare tool name — prefix removed) must remain.
    assertStringIncludes(out, "MultiEditLongNameXYZ");
    assertFalse(
      out.includes("last: "),
      `removed prefix 'last: ' leaked into render:\n${out}`,
    );
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

// S11: Regression for the self-exclusion bug. Before the fix, fetchPanes
// excluded any row whose paneId matched the originating-pane env var, which
// caused the pane that launched prefix+w to silently drop out of the list.
// spawnPicker({ selfPane }) injects CC_PICKER_FROM_PANE=<claude-pane-id> into
// the picker's child env via `tmux new-window -e`, reproducing the interactive
// key-binding path (where tmux.conf's `bind-key w` writes the same env name to
// session env via `set-environment` before `display-popup`).
Deno.test("S11: self-launching Claude pane remains visible", async () => {
  await setupServer();
  try {
    const paneA = await createClaudePane({
      status: "running",
      prompt: "row-self-A",
    });
    await createClaudePane({ status: "running", prompt: "row-B" });
    await createClaudePane({ status: "running", prompt: "row-C" });
    await createClaudePane({ status: "running", prompt: "row-D" });
    const picker = await spawnPicker({ selfPane: paneA });
    const out = await captureOutput(picker);
    assertStringIncludes(out, "row-self-A");
    assertStringIncludes(out, "row-B");
    assertStringIncludes(out, "row-C");
    assertStringIncludes(out, "row-D");
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S12: navigation wraps at boundaries. picker.tsx:607-616 wraps Up at the
// first row to the last, and Down at the last row to the first. Verify both
// directions within a single 2-pane scenario to keep picker-verify's 30 s
// budget comfortable.
Deno.test("S12: navigation wraps at boundaries", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "row-a-xxx" });
    await createClaudePane({ status: "running", prompt: "row-b-yyy" });
    const picker = await spawnPicker();

    const selectedIncludes = (marker: string) => (out: string) => {
      const line = out.split("\n").find((l) => l.includes("❯"));
      return line?.includes(marker) ?? false;
    };

    // Initial selection is the first row (row-a). Press Up → should wrap
    // to the last row (row-b).
    await waitFor(picker, selectedIncludes("row-a-xxx"));
    await sendKey(picker, "Up");
    await waitFor(picker, selectedIncludes("row-b-yyy"));

    // Now on the last row. Press Down → should wrap back to the first.
    await sendKey(picker, "Down");
    await waitFor(picker, selectedIncludes("row-a-xxx"));

    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S13: row-2 icons (Nerd Font nf-md glyphs) prefix each segment. Under a
// 100-col width (listWidth=60) the new budget `listWidth - 2 - row.target.length`
// still leaves room for tool / tree / file segments to all fit. The actual
// Unicode code points come from picker.tsx:ROW2_ICONS — we assert by literal
// glyph so a regression that changes the constants (or drops the prefix) fails
// here. The default 80-col path had just enough budget under the old
// `listWidth - 4` formula but now lies on the drop threshold, which is why
// the scenario pins cols=100 explicitly.
Deno.test("S13: row-2 segments are prefixed with Nerd Font icons (fit)", async () => {
  await setupServer({ cols: 100, rows: 20 });
  try {
    await createClaudePane({
      status: "running",
      prompt: "row-icons",
      currentTool: "Edit",
      lastEditFile: "/a/b/icon-test.ts",
      subagents: "Explore:x1",
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    // tool icon (nf-md-cog) — prefixed to currentTool segment
    assertStringIncludes(out, "󰒓");
    // tree icon (nf-md-graph-outline) — prefixed to subagents segment
    assertStringIncludes(out, "󱙺");
    // file icon (nf-md-file-document-outline) — prefixed to lastEditFile segment
    assertStringIncludes(out, "󰈔");
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S14: Priority drop symmetry. S10 covers text-level drop (tool survives, idle
// dropped). S14 covers the same scenario at the icon layer — the tool icon
// must remain visible while the idle icon must NOT leak into the render. Guards
// against regressions where icons are emitted outside the budget-drop path.
Deno.test("S14: narrow width drops low-priority icon along with its segment", async () => {
  await setupServer({ cols: 60, rows: 20 });
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    await createClaudePane({
      status: "idle",
      prompt: "promptxxxxxxxxxxxxxxxx",
      lastTool: "MultiEditLongNameXYZ",
      lastEditFile: "/a/b/c/verylongfilename-for-overflow.tsx",
      lastActivityAtSec: nowSec - 42,
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    // Highest-priority tool segment (and its icon) must survive the budget drop.
    assertStringIncludes(out, "󰒓");
    // Lowest-priority idle icon must drop together with its segment. Asserting
    // the icon (not the "idle Ns" text) is the new guarantee S14 adds on top of S10.
    assertFalse(
      out.includes("󰏤"),
      `narrow width did not drop idle icon with its segment:\n${out}`,
    );
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S15: regression — the top-priority tool segment must not be Ink-hard-clipped
// when the Row 2 line would overflow listWidth. Previously picker.tsx used
// `listWidth - 2 - 2` for budget, ignoring row.target's actual width. Under a
// narrow listWidth and a long tool name, the line overflowed by 1–2 cells and
// Ink silently clipped the tail (symptom: "Bash" → "Bas"). The fix reserves
// row.target.length in the budget AND pre-truncates the top segment at a code
// point boundary, so the rendered output never contains a half-surrogate or a
// mid-word Ink clip artifact.
Deno.test("S15: long tool name is code-point-safe truncated without Ink hard-clip", async () => {
  // cols=60 → listWidth=40. target "test:W.P" ≈ 8. New budget ≈ 30.
  // Tool name chosen to exceed the new budget so the truncate guard fires,
  // which is exactly the condition that used to leak through to Ink.
  await setupServer({ cols: 60, rows: 20 });
  try {
    await createClaudePane({
      status: "running",
      prompt: "tool-truncation-regression",
      currentTool: "BashToolXYZWriteTailChunkABCDEF",
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    // The prefix of the tool name must remain visible — the guard drops the
    // tail, never the head.
    assertStringIncludes(out, "BashToolXYZ");
    // Icon is a single supplementary-plane codepoint — it must not be split
    // by the truncate guard (Array.from iterates by code point).
    assertStringIncludes(out, "󰒓");
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S16: regression — when a Row-2 segment has room to spare, its tail must not
// be silently clipped by Ink. Ink 5.2.1 in flex-row layout eats 1 cell from
// the first <Text> whose content is "<supplementary-plane icon> <ASCII body>"
// whenever a sibling <Text> follows (reproduced with ink_repro*.tsx, observed
// as "TaskOutput" → "TaskOutpu" in the live picker). The fix emits icon and
// body as two sibling <Text> nodes; this scenario pins the fix by asserting
// the full "TaskOutput" literal survives even when both tool and file
// segments coexist with plenty of listWidth slack.
Deno.test("S16: tool segment with icon + sibling file segment renders full tool name", async () => {
  // cols=100 → listWidth=60. tool seg (12 cells) + " · " (3) + file seg
  // (24 cells) = 39 cells; budget = 60 - 2 - target.length ≈ 50. No
  // truncation path is expected to fire — pure layout regression check.
  await setupServer({ cols: 100, rows: 20 });
  try {
    await createClaudePane({
      status: "running",
      prompt: "taskoutput-sibling-regression",
      currentTool: "TaskOutput",
      lastEditFile: "/a/b/TemplateItemsEditor.ts",
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    // Full tool name must survive. The bug surfaced as the literal
    // "TaskOutpu" (missing final "t") preceding a non-"t" character such as
    // a space or separator.
    assertStringIncludes(out, "TaskOutput");
    assertFalse(
      /TaskOutpu[^t]/.test(out),
      `"TaskOutput" was clipped to "TaskOutpu":\n${out}`,
    );
    // Both Nerd Font icons must remain — the fix must not drop the icon
    // while extracting it into a sibling Text node.
    assertStringIncludes(out, "󰒓");
    assertStringIncludes(out, "󰈔");
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S17: a pane whose @pane_agent is still "claude" but whose foreground
// process has fallen back to the login shell (cc exited without firing
// SessionEnd — the stale-pane bug from .wadackel/picker-stale-pane-bug.md)
// must be filtered out by picker. Reproduced via liveCommand: false, which
// skips the compiled `.claude-wrapped` stub so pane_current_command defaults
// to the window's `zsh`.
Deno.test("S17: stale claude pane (currentCommand=zsh) is filtered out", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "running",
      prompt: "alive-marker-ZZZ",
    });
    await createClaudePane({
      status: "idle",
      prompt: "stale-marker-QQQ",
      liveCommand: false,
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    assertStringIncludes(out, "alive-marker-ZZZ");
    assertFalse(
      out.includes("stale-marker-QQQ"),
      `stale pane appeared in picker:\n${out}`,
    );
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S18: Fresh-session pane with no tool / subagent / edit / task / idle
// activity produces an empty Row 2 segs array; picker.tsx renders
// `(no activity)` gray instead of collapsing to an indent-only blank line.
Deno.test("S18: empty row-2 renders (no activity) placeholder", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "running",
      prompt: "fresh-session-marker",
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    assertStringIncludes(out, "(no activity)");
    // None of the six row-2 segment icons may render when segs is empty.
    // Token icon (U+F01BC 󰆼) is also checked here — a pane without
    // contextUsedPct must not render the token segment. The positive
    // threshold-color path for the token segment is covered by S19.
    // ROW2_ICONS = tool 󰒓 / tree 󱙺 / file 󰈔 / progress 󰄱 / idle 󰏤 / token 󰆼.
    for (const icon of ["󰒓", "󱙺", "󰈔", "󰄱", "󰏤", "\u{F01BC}"]) {
      assertFalse(
        out.includes(icon),
        `row-2 icon ${icon} leaked into empty-state render:\n${out}`,
      );
    }
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S19: @pane_context_used_pct renders on row-2 right as
// "<token icon> NN%" with threshold-based color. Values <50 green (ok),
// 50–74 yellow (warn), ≥75 red (err). A pane without the option set must
// not render the token segment at all.
Deno.test("S19: token usage on row-2 right (icon + percent + color)", async () => {
  await setupServer({ cols: 120, rows: 20 });
  try {
    const paneGreen = await createClaudePane({
      status: "running",
      prompt: "row-green",
    });
    const paneRed = await createClaudePane({
      status: "running",
      prompt: "row-red",
    });
    await createClaudePane({
      status: "running",
      prompt: "row-notoken",
    });
    // Set context-used pane option directly (no createClaudePane knob — Rule
    // of Three: promote to harness param only when a second test needs it).
    await tmux(["set", "-p", "-t", paneGreen, "@pane_context_used_pct", "23"]);
    await tmux(["set", "-p", "-t", paneRed, "@pane_context_used_pct", "80"]);

    const picker = await spawnPicker();

    // 1. Text assertions — both percentages present.
    const out = await waitFor(
      picker,
      (o) => o.includes("23%") && o.includes("80%"),
    );
    assertStringIncludes(out, "23%");
    assertStringIncludes(out, "80%");

    // 2. Icon assertion — nf-md-database appears at least twice (once per
    // pane with context set). U+F01BC = 󰆼.
    const iconCount = out.split("\u{F01BC}").length - 1;
    assertEquals(
      iconCount >= 2,
      true,
      `expected nf-md-database icon ≥2 occurrences, got ${iconCount}:\n${out}`,
    );

    // 3. No-token row must not render the token segment. Locate the line by
    // its prompt marker and confirm the icon is absent on that line.
    const notokenLine = out.split("\n").find((l) => l.includes("row-notoken"));
    assertEquals(
      typeof notokenLine,
      "string",
      `row-notoken line not found:\n${out}`,
    );
    assertFalse(
      notokenLine!.includes("\u{F01BC}"),
      `token icon leaked onto pane without contextUsedPct:\n${notokenLine}`,
    );
    assertFalse(
      notokenLine!.includes("%"),
      `token percent leaked onto pane without contextUsedPct:\n${notokenLine}`,
    );

    // 4. Color assertion — capture raw (ANSI-preserving) and confirm the
    // SGR foreground near 23% differs from the one near 80%. This is a
    // structural distinctness check, not a hex match, since tmux's
    // 256-color approximation is environment-dependent.
    const raw = await tmux(["capture-pane", "-p", "-e", "-t", picker]);
    // Extract the SGR foreground sequence immediately preceding each percent.
    // Format: ESC [ 38 ; (5;N | 2;R;G;B) m
    const sgrBefore = (needle: string): string | null => {
      const idx = raw.indexOf(needle);
      if (idx < 0) return null;
      const prefix = raw.slice(Math.max(0, idx - 40), idx);
      // deno-lint-ignore no-control-regex
      const m = prefix.match(/\x1b\[38;(?:5;\d+|2;\d+;\d+;\d+)m(?=[^\x1b]*$)/);
      return m ? m[0] : null;
    };
    const sgrGreen = sgrBefore("23%");
    const sgrRed = sgrBefore("80%");
    assertEquals(
      sgrGreen !== null,
      true,
      `no SGR foreground found before 23% (raw includes escapes: ${
        /\x1b/.test(raw)
      })`,
    );
    assertEquals(
      sgrRed !== null,
      true,
      `no SGR foreground found before 80% (raw includes escapes: ${
        /\x1b/.test(raw)
      })`,
    );
    assertFalse(
      sgrGreen === sgrRed,
      `23% and 80% rendered with the same color SGR (${sgrGreen}); ` +
        `threshold mapping ok→err is not being applied.`,
    );

    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S20: launching pane is initially selected when present in list.
// tmux.conf's `bind-key w` writes the originating pane id into the session
// environment as `CC_PICKER_FROM_PANE` via `set-environment` immediately
// before `display-popup` runs; the popup inherits the session env at spawn
// so picker.tsx main() can resolve initialSelectedPaneId from it. Reserved
// TMUX_PANE cannot be reused (tmux clobbers it for the spawned process).
// The harness reproduces the same env-name contract by passing
// `-e CC_PICKER_FROM_PANE=<pane-id>` to `tmux new-window` in spawnPicker()
// (literal value injection — no tmux format expansion involved on this path).
// Three sub-cases cover the resolution ternary's three branches.
//
// S20 ordering note: pa/pb/pc are created sequentially via createClaudePane →
// tmux assigns ascending window indices → list-panes -a returns them in
// creation order, so pc is reliably NOT rows[0]. Sub-case B's discriminative
// power depends on this — if fetchPanes ever sorts rows, this test must be
// updated to pick a paneId that is provably not rows[0].
Deno.test("S20: launching pane is initially selected when present in list", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "row-A" });
    await createClaudePane({ status: "running", prompt: "row-B" });
    const pc = await createClaudePane({ status: "running", prompt: "row-C" });

    const selectedIncludes = (marker: string) => (out: string) => {
      const line = out.split("\n").find((l) => l.includes("❯"));
      return line?.includes(marker) ?? false;
    };

    // Sub-case A (baseline / fromPane unset): no selfPane → first row.
    let picker = await spawnPicker();
    await waitFor(picker, selectedIncludes("row-A"));
    await sendKey(picker, "Escape");
    await waitForExit();

    // Sub-case B (hit / fromPane in rows): selfPane=pc → row-C.
    picker = await spawnPicker({ selfPane: pc });
    await waitFor(picker, selectedIncludes("row-C"));
    await sendKey(picker, "Escape");
    await waitForExit();

    // Sub-case C (miss / fromPane stale): selfPane points at a non-existent
    // pane id, exercising the resolution ternary's `rows.some(...)` guard.
    // Falls back to first row.
    picker = await spawnPicker({ selfPane: "%999" });
    await waitFor(picker, selectedIncludes("row-A"));
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S21: tmux.conf bind-key w writes the source pane id to session env BEFORE
// display-popup. Static assertion against the conf text — not a runtime test.
//
// The two regressions this catches:
//   (1) `display-popup -e "CC_PICKER_FROM_PANE=#{pane_id}"` form (the original
//       buggy shape). `#{pane_id}` in the `-e` flag is expanded at run-shell
//       parse time against a stale context (observed off-by-one against the
//       prior invocation's source pane in 12/12 diagnostic samples; see plan
//       20260429T1822-picker-cursor-from-pane-fix).
//   (2) Pre-capture via `set-option -g @cc-picker-source "#{pane_id}"` followed
//       by `-e "CC_PICKER_FROM_PANE=#{@cc-picker-source}"`. tmux expands the
//       `-e` value at parse time, BEFORE the preceding set-option executes,
//       so `-e` reads the option's PRIOR value — same off-by-one symptom
//       (verified with diagnostic instrumentation during plan execution).
//
// Required pattern:
//   `set-environment -t "#{session_name}" CC_PICKER_FROM_PANE "#{pane_id}"`
//   runs before display-popup; the popup inherits session env at spawn.
//   display-popup MUST NOT carry an explicit `-e CC_PICKER_FROM_PANE=...` flag
//   (that would re-introduce stale parse-time expansion).
//
// The runtime assertion (popup actually opens with the right pane highlighted)
// stays a manual user check — that is the second tier of the two-stage
// verification (conf-shape + runtime).
Deno.test("S21: tmux.conf bind-key w uses source-pane capture pattern", async () => {
  const confPath = new URL("../config/tmux.conf", import.meta.url).pathname;
  const conf = await Deno.readTextFile(confPath);

  const bindLines = conf
    .split("\n")
    .filter((line) => /^\s*bind-key\s+w\s/.test(line));
  assertEquals(
    bindLines.length,
    1,
    `expected exactly one 'bind-key w ...' line in tmux.conf, got ${bindLines.length}`,
  );
  const bind = bindLines[0];

  // Diagnostic instrumentation must not leak into committed conf.
  assertFalse(
    /@cc-picker-debug|cc-picker-debug\.log/.test(bind),
    `diagnostic instrumentation residue in bind-key w: ${bind}`,
  );

  // Required: set-environment writes the source pane id to session env. Capture
  // its index so we can assert it appears BEFORE display-popup (order matters —
  // the popup must inherit the value at spawn).
  const setEnvRe =
    /set-environment\s+-t\s+"#\{session_name\}"\s+CC_PICKER_FROM_PANE\s+"#\{pane_id\}"/;
  const setEnvMatch = setEnvRe.exec(bind);
  const popupRe = /display-popup\b/;
  const popupMatch = popupRe.exec(bind);
  if (!setEnvMatch || !popupMatch) {
    throw new Error(
      `bind-key w must contain both set-environment (CC_PICKER_FROM_PANE = ` +
        `#{pane_id}) and display-popup. Line: ${bind}`,
    );
  }
  if (setEnvMatch.index >= popupMatch.index) {
    throw new Error(
      `set-environment must come BEFORE display-popup so the popup inherits ` +
        `the session env at spawn. Found set-environment@${setEnvMatch.index}, ` +
        `display-popup@${popupMatch.index}. Line: ${bind}`,
    );
  }

  // Forbidden: any `-e CC_PICKER_FROM_PANE=...` flag on display-popup, regardless
  // of quoting (no quotes / single quotes / double quotes). All forms reintroduce
  // the parse-time stale-expansion bug — direct `-e "VAR=#{pane_id}"`, the
  // set-option/#{@option} pre-capture variant, etc.
  const hasForbiddenE = /-e\s+["']?CC_PICKER_FROM_PANE=/.test(bind);
  if (hasForbiddenE) {
    throw new Error(
      `display-popup MUST NOT carry a '-e CC_PICKER_FROM_PANE=...' flag (any ` +
        `quoting form). The session-env transport is the only safe path. ` +
        `Line: ${bind}`,
    );
  }
});

// S22: pressing `w` inside the picker toggles a wait/idle filter. Round-trip
// the toggle in a single fixture (filter ON → only waiting/idle remain + pill
// shown → filter OFF → all four statuses back, pill gone). The pill body text
// `wait/idle` is asserted to confirm the title-bar pill renders; the
// powerline endcap glyphs (U+E0B6 / U+E0B4) are not asserted directly because
// terminal capture of PUA code points is rendering-dependent. The dynamic
// `w  clear` / `w  filter` hint is exercised indirectly by toggling twice.
//
// Note: status row text uses `wait`/`idle` without the `/` separator, so
// `wait/idle` substring matching is unambiguously the title-bar pill.
Deno.test("S22: w toggles wait/idle filter (round-trip)", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running" });
    await createClaudePane({ status: "waiting" });
    await createClaudePane({ status: "idle" });
    await createClaudePane({ status: "error" });

    const picker = await spawnPicker();
    const initial = await captureOutput(picker);
    assertStringIncludes(initial, "run");
    assertStringIncludes(initial, "wait");
    assertStringIncludes(initial, "idle");
    assertStringIncludes(initial, "err");
    assertFalse(
      initial.includes("wait/idle"),
      `pill unexpectedly present before pressing w:\n${initial}`,
    );

    // First `w` press: filter ON. Wait until the pill text appears so we know
    // the re-render landed before sampling the status texts.
    await sendKey(picker, "w");
    const filtered = await waitFor(picker, (o) => o.includes("wait/idle"));
    assertStringIncludes(filtered, "wait");
    assertStringIncludes(filtered, "idle");
    assertFalse(
      filtered.includes("run "),
      `running status leaked through filter:\n${filtered}`,
    );
    assertFalse(
      filtered.includes("err "),
      `error status leaked through filter:\n${filtered}`,
    );

    // Second `w` press: filter OFF. Wait until the pill disappears.
    await sendKey(picker, "w");
    const restored = await waitFor(picker, (o) => !o.includes("wait/idle"));
    assertStringIncludes(restored, "run");
    assertStringIncludes(restored, "wait");
    assertStringIncludes(restored, "idle");
    assertStringIncludes(restored, "err");

    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S23: filter applied with no waiting/idle panes shows a dedicated empty-state
// message and `useInput` remains live so a second `w` press clears the filter.
// The empty-state branch returns a 2-line <Box> rather than the full layout, so
// this test guards against accidentally killing keyboard input in that branch.
Deno.test(
  "S23: filter with zero matches shows hint and stays interactive",
  async () => {
    await setupServer();
    try {
      await createClaudePane({ status: "running" });

      const picker = await spawnPicker();
      const initial = await captureOutput(picker);
      assertStringIncludes(initial, "run");

      await sendKey(picker, "w");
      const empty = await waitFor(
        picker,
        (o) => o.includes("No waiting/idle panes"),
      );
      assertStringIncludes(empty, "No waiting/idle panes");
      assertStringIncludes(empty, "Press w to clear filter");

      // useInput must still be wired up in the empty-state branch — pressing
      // `w` again should clear the filter and bring the running row back.
      // Wait for the empty-state message to actually disappear (not for `run`
      // to appear, which can match unrelated text in the tmux window chrome).
      await sendKey(picker, "w");
      const restored = await waitFor(
        picker,
        (o) => !o.includes("No waiting/idle panes"),
      );
      assertStringIncludes(restored, "run");
      assertFalse(
        restored.includes("No waiting/idle panes"),
        `empty-state message persisted after clearing filter:\n${restored}`,
      );

      await sendKey(picker, "Escape");
      await waitForExit();
    } finally {
      await teardown();
    }
  },
);

// S24: opencode pane is included in the picker output. fetchPanes filter
// accepts `agent === "claude" || agent === "opencode"` AND
// isLivePaneCommand(agent, currentCommand) — opencode panes spawn under the
// `.opencode-wrapp` stub so liveCommand=true selects the right binary.
Deno.test("S24: opencode pane visible in picker", async () => {
  await setupServer();
  try {
    await createClaudePane({
      agent: "opencode",
      status: "running",
      prompt: "opencode-marker-S24",
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    assertStringIncludes(out, "opencode-marker-S24");
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S25: claude and opencode panes coexist in one list and are visually
// disambiguated by the row-1 agent column rendered immediately to the left of
// the repo column. Each agent's canonical name (`claude`, `opencode`) is
// padded to 8 cells (length of the longest name) plus a 1-cell separator so
// the repo column lines up vertically across mixed-agent rows.
Deno.test("S25: claude+opencode mixed list renders both with agent column", async () => {
  await setupServer();
  try {
    await createClaudePane({
      agent: "claude",
      status: "running",
      prompt: "claude-marker-S25",
    });
    await createClaudePane({
      agent: "opencode",
      status: "running",
      prompt: "opencode-marker-S25",
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    assertStringIncludes(out, "claude-marker-S25");
    assertStringIncludes(out, "opencode-marker-S25");
    // Chip body form: " " + agentLabel + " " (chip-width hugs the canonical
    // name). Hyphenated marker prompts ("claude-marker-S25" etc.) follow
    // "claude"/"opencode" with "-", not " ", so they cannot collide with the
    // chip body substring. S28 covers codex; S25 fixture has no codex pane.
    assertStringIncludes(out, " claude ");
    assertStringIncludes(out, " opencode ");
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S26: stale opencode pane (no live `.opencode-wrapp` process — fallback to
// the login shell zsh) must be filtered out, mirroring S17 for opencode.
Deno.test("S26: stale opencode pane (currentCommand=zsh) is filtered out", async () => {
  await setupServer();
  try {
    await createClaudePane({
      agent: "opencode",
      status: "running",
      prompt: "alive-oc-marker-S26",
    });
    await createClaudePane({
      agent: "opencode",
      status: "idle",
      prompt: "stale-oc-marker-S26",
      liveCommand: false,
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    assertStringIncludes(out, "alive-oc-marker-S26");
    assertFalse(
      out.includes("stale-oc-marker-S26"),
      `stale opencode pane appeared in picker:\n${out}`,
    );
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S27: codex pane is included in the picker output. Codex panes spawn under
// the `.codex-wrapped` stub so liveCommand=true selects the right binary.
Deno.test("S27: codex pane visible in picker", async () => {
  await setupServer();
  try {
    await createClaudePane({
      agent: "codex",
      status: "running",
      prompt: "codex-marker-S27",
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    assertStringIncludes(out, "codex-marker-S27");
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S28: claude, opencode, and codex panes coexist in one list and are visually
// disambiguated by the row-1 agent column rendering each canonical name
// (`claude`, `opencode`, `codex`) padded to 8 cells immediately before the
// repo column. Pads keep the repo column aligned vertically across all 3
// agent rows.
Deno.test("S28: claude+opencode+codex mixed list renders all agent columns", async () => {
  await setupServer();
  try {
    await createClaudePane({
      agent: "claude",
      status: "running",
      prompt: "claude-marker-S28",
    });
    await createClaudePane({
      agent: "opencode",
      status: "running",
      prompt: "opencode-marker-S28",
    });
    await createClaudePane({
      agent: "codex",
      status: "running",
      prompt: "codex-marker-S28",
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    assertStringIncludes(out, "claude-marker-S28");
    assertStringIncludes(out, "opencode-marker-S28");
    assertStringIncludes(out, "codex-marker-S28");
    // Chip body form: " " + agentLabel + " ". Hyphenated marker prompts
    // ("claude-marker-S28" etc.) follow each agent name with "-", not " ",
    // so they cannot collide with the chip body substring.
    assertStringIncludes(out, " claude ");
    assertStringIncludes(out, " opencode ");
    assertStringIncludes(out, " codex ");
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S29: stale codex pane (no live `.codex-wrapped` process — fallback to the
// login shell zsh) must be filtered out, mirroring S17/S26.
Deno.test("S29: stale codex pane (currentCommand=zsh) is filtered out", async () => {
  await setupServer();
  try {
    await createClaudePane({
      agent: "codex",
      status: "running",
      prompt: "alive-codex-marker-S29",
    });
    await createClaudePane({
      agent: "codex",
      status: "idle",
      prompt: "stale-codex-marker-S29",
      liveCommand: false,
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);
    assertStringIncludes(out, "alive-codex-marker-S29");
    assertFalse(
      out.includes("stale-codex-marker-S29"),
      `stale codex pane appeared in picker:\n${out}`,
    );
    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S30: picker layout follows tmux resize-window. Picker reads stdout.columns
// once at render and previously did not re-render on terminal resize. The
// resize-tracking useEffect subscribes to stdout 'resize' so the layout
// (listWidth / previewWidth / bodyHeight / showFilterUI) updates live.
//
// Signal: the " filter  " title-bar hint (picker.tsx:590-600) is gated only on
// showFilterUI (= totalCols >= 80). It is independent of filterEnabled state,
// unlike the wait/idle PILL badge which also requires `w` to be pressed.
// The `w` filter toggle is intentionally NOT sent here — pressing it would
// flip the hint string to " clear  " and obscure the resize signal.
Deno.test("S30: picker re-layouts after tmux resize-window", async () => {
  await setupServer({ cols: 60, rows: 20 });
  try {
    await createClaudePane({ status: "waiting", prompt: "row-a" });
    const picker = await spawnPicker();

    // Initial narrow render: showFilterUI false → " filter  " absent.
    const narrowOut = await captureOutput(picker);
    assertFalse(
      narrowOut.includes(" filter  "),
      `unexpected ' filter  ' hint at narrow width:\n${narrowOut}`,
    );

    // Widen the tmux window — picker must repaint and surface the hint.
    // Target is the same SESSION:WINDOW path that spawnPicker uses; the
    // harness's SESSION const is "test" and PICKER_WINDOW_NAME is "picker".
    await tmux(["resize-window", "-t", picker, "-x", "120", "-y", "30"]);
    await waitFor(picker, (out) => out.includes(" filter  "));

    // Narrow again — picker must repaint and hide the hint.
    await tmux(["resize-window", "-t", picker, "-x", "60", "-y", "20"]);
    await waitFor(picker, (out) => !out.includes(" filter  "));

    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S-N1: User-defined label overrides PaneStatus in row-1 display.
// When @pane_user_label is set, picker renders the label's text + icon
// instead of the pane's automatic status (run/wait/idle/err).
Deno.test("S-N1: userLabel='feedback' renders label text in row-1", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "running", // would normally render `run`
      userLabel: "feedback", // takes priority
      prompt: "labeled-row",
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);

    // Label text replaces status text.
    assertStringIncludes(out, "feedback");
    // Status text from the underlying PaneStatus is suppressed.
    assertFalse(
      out.includes(" run "),
      `status text 'run' leaked into labeled row:\n${out}`,
    );

    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S-N2: m keypress on a row writes @pane_user_label via set-option, and
// the next fetchPanes tick reflects it in the capture. We don't poll
// tmux directly — the on-screen label text is the user-visible contract.
Deno.test("S-N2: m keypress cycles userLabel none → review", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "running",
      prompt: "cycle-me",
    });
    const picker = await spawnPicker();
    // Wait for the initial render so 'm' targets the right row.
    await waitFor(picker, (out) => out.includes("cycle-me"));

    await sendKey(picker, "m");
    // The label text appears after the next 1s tick + repaint.
    await waitFor(picker, (out) => out.includes("review"), 4000);

    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S-N3: Column alignment is preserved when labeled and unlabeled rows
// coexist. The fixed-width status-or-label column (9 cells) ensures the
// agent chip and repo columns start at the same horizontal offset on
// both rows. We assert this indirectly by checking both labels render
// AND both rows reach the repo column.
Deno.test("S-N3: mixed labeled/unlabeled rows preserve column alignment", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "running",
      userLabel: "feedback", // 8-char max-width label
      prompt: "labeled-row",
      cwd: "/repo/alpha",
    });
    await createClaudePane({
      status: "idle", // no label, shows "idle"
      prompt: "plain-row",
      cwd: "/repo/beta",
    });
    const picker = await spawnPicker();
    const out = await captureOutput(picker);

    // Both label text and status text coexist (label only on first row).
    assertStringIncludes(out, "feedback");
    assertStringIncludes(out, "idle");
    // Both repo basenames reach the repo column (no truncation collapse).
    assertStringIncludes(out, "alpha");
    assertStringIncludes(out, "beta");

    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S-N4: M keypress clears userLabel back to none. Counterpart to S-N2
// (m cycles forward). Start with userLabel='wip' rendered, then send 'M'
// and assert the label text disappears after the next tick + repaint.
// 'wip' is chosen over 'review' because the Preview header text contains
// the substring 'review' ("P[review]w"), which would make a naive
// includes() assertion trivially true even after the label is cleared.
Deno.test("S-N4: M keypress clears userLabel back to none", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "running",
      userLabel: "wip",
      prompt: "clear-me",
    });
    const picker = await spawnPicker();
    // Confirm the initial label is rendered before sending the reset key.
    await waitFor(picker, (out) => out.includes("wip"));

    await sendKey(picker, "M");
    // The label text disappears after the next 1s tick + repaint.
    await waitFor(picker, (out) => !out.includes("wip"), 4000);

    await sendKey(picker, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});
