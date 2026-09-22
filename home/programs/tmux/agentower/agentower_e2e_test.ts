import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import {
  captureOutput,
  createClaudePane,
  sandboxHomePath,
  sendBurst,
  sendKey,
  setupServer,
  spawnAgentower,
  teardown,
  tmux,
  waitFor,
  waitForExit,
} from "./agentower_e2e_harness.ts";
import { codexCwdHash, MOUSE_WHEEL_DOWN } from "./agentower.tsx";
import { stringCells } from "./cell_width.ts";

// Row 1 of the selected pane, which carries the prompt the scenarios identify
// panes by. The "▌" marker runs down all four rows of the selected card, and
// the first of them is the card's padding row, so row 1 is the second.
function selectedLine(out: string): string {
  return out.split("\n").filter((l) => l.includes("▌"))[1] ?? "";
}

const selectedIncludes = (marker: string) => (out: string) =>
  selectedLine(out).includes(marker);

// Status text is looked up on list rows only, because the key-hint bar carries
// "next wait", which would satisfy a whole-screen "wait" match on its own.
function listStatuses(out: string): string[] {
  const rows = out.split("\n").filter((l) => l.includes("claude"));
  return ["run", "wait", "idle", "err"].filter((s) =>
    rows.some((l) => l.includes(` ${s} `))
  );
}

async function writeCodexProgressFixture(
  home: string,
  cwd: string,
): Promise<void> {
  await Deno.mkdir(cwd, { recursive: true });
  const plansDir = `${home}/.codex/plans`;
  await Deno.mkdir(plansDir, { recursive: true });
  const planPath = `${plansDir}/agentower-e2e-plan.md`;
  await Deno.writeTextFile(planPath, "## agentower e2e plan\n");
  await Deno.writeTextFile(
    `${plansDir}/agentower-e2e-plan.evidence.json`,
    JSON.stringify(
      {
        plan: "agentower-e2e-plan.md",
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
// session, so Agentower should immediately render "No panes available." and
// exit cleanly on Escape. If this fails, the harness is broken — not Agentower.
Deno.test("S0: harness smoke (no panes)", async () => {
  await setupServer();
  try {
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    assertStringIncludes(out, "No panes available.");
    await sendKey(agentower, "Escape");
    await waitForExit();
    // Sanity: harness made it to teardown without exception.
    assertEquals(true, true);
  } finally {
    await teardown();
  }
});

// S2: summaryOf in agentower.tsx:220-226 picks waitReason when status is
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
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    assertStringIncludes(out, "perm-X");
    assertStringIncludes(out, "go-Y");
    assertFalse(
      out.includes("ignore-X"),
      `waiting pane showed prompt instead of waitReason:\n${out}`,
    );
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S3: j/k and arrow keys move the "▌" selection marker between rows. Pointer is
// rendered by agentower.tsx:401 only on the row whose index matches state.
Deno.test("S3: navigation (Down/Up/jk moves the pointer)", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "row-a-xxx" });
    await createClaudePane({ status: "running", prompt: "row-b-yyy" });
    const agentower = await spawnAgentower();

    const initial = await captureOutput(agentower);
    assertStringIncludes(
      selectedLine(initial),
      "row-a-xxx",
    );

    await sendKey(agentower, "Down");
    await waitFor(agentower, selectedIncludes("row-b-yyy"));

    await sendKey(agentower, "k");
    await waitFor(agentower, selectedIncludes("row-a-xxx"));

    await sendKey(agentower, "j");
    await waitFor(agentower, selectedIncludes("row-b-yyy"));

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S4: Enter sends select-window + select-pane + switch-client (agentower.tsx:349-354).
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
    const agentower = await spawnAgentower();

    // Idle wait so App/Preview ticks accumulate before the Enter exit path.
    await new Promise((r) => setTimeout(r, 2200));

    // Move selection to paneB row.
    await sendKey(agentower, "Down");
    await waitFor(agentower, selectedIncludes("row-b"));

    await sendKey(agentower, "Enter");
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
    await createClaudePane({ agent: "shell", prompt: "garbage-pane" });

    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    assertEquals(listStatuses(out), ["run", "wait", "idle", "err"]);
    assertFalse(
      out.includes("garbage-pane"),
      `shell pane leaked into multi-status capture:\n${out}`,
    );

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S1: A non-claude pane (agent="shell") must be filtered out by Agentower.
// fetchPanes keeps only `agent === "claude"` (agentower.tsx:313), so a "shell"
// pane should produce the same empty-list UI as S0. Also double-checks that
// the garbage pane's prompt never leaks into the capture.
Deno.test("S1: empty list (agent filter excludes non-claude)", async () => {
  await setupServer();
  try {
    await createClaudePane({ agent: "shell", prompt: "garbage-pane" });
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    assertStringIncludes(out, "No panes available.");
    assertFalse(
      out.includes("garbage-pane"),
      `shell pane leaked into Agentower output:\n${out}`,
    );
    await sendKey(agentower, "Escape");
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
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    assertStringIncludes(out, "Edit");
    assertFalse(
      out.includes("last: "),
      `removed prefix 'last: ' leaked into render:\n${out}`,
    );
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S7: @pane_last_edit_file holds a raw file path; Agentower applies basename
// at render time. Verify the directory components are stripped.
Deno.test("S7: last-edit-file renders basename only", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "idle",
      prompt: "row-basename",
      lastTool: "Edit",
      lastEditFile:
        "/Users/alice/dotfiles/home/programs/tmux/agentower/agentower.tsx",
    });
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    assertStringIncludes(out, "agentower.tsx");
    assertFalse(
      out.includes("/Users/alice"),
      `basename failed — raw path leaked into row 2:\n${out}`,
    );
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S8: readTaskProgress enumerates ~/.claude/tasks/<sessionId>/*.json.
// Point HOME at a checked-in read-only fixture so this e2e keeps the same
// permission profile as the rest of the Agentower tests.
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
    const agentower = await spawnAgentower({ env });
    const out = await waitFor(agentower, (o) => o.includes("2/3"));
    assertStringIncludes(out, "2/3");
    await sendKey(agentower, "Escape");
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
    prefix: "agentower-codex-e2e-",
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
    const agentower = await spawnAgentower({ env });
    const out = await waitFor(agentower, (o) => o.includes("2/3"));
    assertStringIncludes(out, "codex-row-progress");
    assertStringIncludes(out, "2/3");
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
    await Deno.remove(tempHome, { recursive: true }).catch(() => undefined);
  }
});

// S9: an idle pane's elapsed column counts from its last activity. Using a
// fixed timestamp 42s in the past keeps the assertion deterministic without
// depending on precise scheduling.
Deno.test("S9: idle pane shows time since last activity in the elapsed column", async () => {
  await setupServer();
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    await createClaudePane({
      status: "idle",
      prompt: "row-idle",
      lastTool: "Bash",
      lastActivityAtSec: nowSec - 42,
    });
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    // Allow ±1s jitter from render timing (42s → 42 or 43).
    const matched = / 4[23]s {2}/.test(out);
    assertEquals(
      matched,
      true,
      `elapsed column did not render the idle duration:\n${out}`,
    );
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S10: Under a narrow list width, low-priority row-2 segments drop first.
// cols 60 gives listWidth 40 and a row-2 segment budget of 18 once the fixed
// right block is reserved: the tool segment (14 cells) fits, the file segment
// behind it does not.
Deno.test("S10: narrow width drops low-priority segments first", async () => {
  await setupServer({ cols: 60, rows: 20 });
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    await createClaudePane({
      status: "idle",
      prompt: "promptxxxxxxxxxxxxxxxx",
      lastTool: "MultiEditXYZ",
      lastEditFile: "/a/b/c/verylongfilename-for-overflow.tsx",
      lastActivityAtSec: nowSec - 42,
    });
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    // Highest-priority (tool-slot, bare tool name — prefix removed) must remain.
    assertStringIncludes(out, "MultiEditXYZ");
    assertFalse(
      out.includes("last: "),
      `removed prefix 'last: ' leaked into render:\n${out}`,
    );
    // The lower-priority file segment should have been dropped.
    assertFalse(
      out.includes("verylongfilename"),
      `narrow width did not drop the file segment:\n${out}`,
    );
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S11: Regression for the self-exclusion bug. Before the fix, fetchPanes
// excluded any row whose paneId matched the originating-pane env var, which
// caused the pane that launched prefix+w to silently drop out of the list.
// spawnAgentower({ selfPane }) injects AGENTOWER_FROM_PANE=<claude-pane-id> into
// Agentower's child env via `tmux new-window -e`, reproducing the interactive
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
    const agentower = await spawnAgentower({ selfPane: paneA });
    const out = await captureOutput(agentower);
    assertStringIncludes(out, "row-self-A");
    assertStringIncludes(out, "row-B");
    assertStringIncludes(out, "row-C");
    assertStringIncludes(out, "row-D");
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S12: navigation wraps at boundaries. agentower.tsx:607-616 wraps Up at the
// first row to the last, and Down at the last row to the first. Verify both
// directions within a single 2-pane scenario to keep agentower-verify's 30 s
// budget comfortable.
Deno.test("S12: navigation wraps at boundaries", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "row-a-xxx" });
    await createClaudePane({ status: "running", prompt: "row-b-yyy" });
    const agentower = await spawnAgentower();

    // Initial selection is the first row (row-a). Press Up → should wrap
    // to the last row (row-b).
    await waitFor(agentower, selectedIncludes("row-a-xxx"));
    await sendKey(agentower, "Up");
    await waitFor(agentower, selectedIncludes("row-b-yyy"));

    // Now on the last row. Press Down → should wrap back to the first.
    await sendKey(agentower, "Down");
    await waitFor(agentower, selectedIncludes("row-a-xxx"));

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S13: row-2 icons (Nerd Font nf-md glyphs) prefix each segment. Under a
// 100-col width (listWidth=60) the new budget `listWidth - 2 - row.target.length`
// still leaves room for tool / tree / file segments to all fit. The actual
// Unicode code points come from agentower.tsx:ROW2_ICONS — we assert by literal
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
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    // tool icon (nf-md-cog) — prefixed to currentTool segment
    assertStringIncludes(out, "󰒓");
    // tree icon (nf-md-graph-outline) — prefixed to subagents segment
    assertStringIncludes(out, "󱙺");
    // file icon (nf-md-file-document-outline) — prefixed to lastEditFile segment
    assertStringIncludes(out, "󰈔");
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S14: Priority drop symmetry. S10 covers text-level drop (tool survives, file
// dropped). S14 covers the same scenario at the icon layer — the tool icon
// must remain visible while the file icon must NOT leak into the render. Guards
// against regressions where icons are emitted outside the budget-drop path.
Deno.test("S14: narrow width drops low-priority icon along with its segment", async () => {
  await setupServer({ cols: 60, rows: 20 });
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    await createClaudePane({
      status: "idle",
      prompt: "promptxxxxxxxxxxxxxxxx",
      lastTool: "MultiEditXYZ",
      lastEditFile: "/a/b/c/verylongfilename-for-overflow.tsx",
      lastActivityAtSec: nowSec - 42,
    });
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    // Highest-priority tool segment (and its icon) must survive the budget drop.
    assertStringIncludes(out, "󰒓");
    // The lower-priority file icon must drop together with its segment.
    // Asserting the icon (not the file name) is the guarantee S14 adds on top
    // of S10.
    assertFalse(
      out.includes("󰈔"),
      `narrow width did not drop file icon with its segment:\n${out}`,
    );
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S15: regression — the top-priority tool segment must not be Ink-hard-clipped
// when the Row 2 line would overflow listWidth. Previously agentower.tsx used
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
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    // The prefix of the tool name must remain visible — the guard drops the
    // tail, never the head.
    assertStringIncludes(out, "BashToolXYZ");
    // Icon is a single supplementary-plane codepoint — it must not be split
    // by the truncate guard (Array.from iterates by code point).
    assertStringIncludes(out, "󰒓");
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S16: regression — when a Row-2 segment has room to spare, its tail must not
// be silently clipped by Ink. Ink 5.2.1 in flex-row layout eats 1 cell from
// the first <Text> whose content is "<supplementary-plane icon> <ASCII body>"
// whenever a sibling <Text> follows (reproduced with ink_repro*.tsx, observed
// as "TaskOutput" → "TaskOutpu" in the live Agentower). The fix emits icon and
// body as two sibling <Text> nodes; this scenario pins the fix by asserting
// the full "TaskOutput" literal survives even when both tool and file
// segments coexist with plenty of listWidth slack.
Deno.test("S16: tool segment with icon + sibling file segment renders full tool name", async () => {
  // cols=120 → listWidth=72. tool seg (12 cells) + " · " (3) + file seg
  // (24 cells) = 39 cells; budget = 72 - 2 - 20 (right block) = 50. No
  // truncation path is expected to fire — pure layout regression check.
  await setupServer({ cols: 120, rows: 20 });
  try {
    await createClaudePane({
      status: "running",
      prompt: "taskoutput-sibling-regression",
      currentTool: "TaskOutput",
      lastEditFile: "/a/b/TemplateItemsEditor.ts",
    });
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
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
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S17: a pane whose @pane_agent is still "claude" but whose foreground
// process has fallen back to the login shell (cc exited without firing
// SessionEnd — the stale-pane bug from .wadackel/picker-stale-pane-bug.md)
// must be filtered out by Agentower. Reproduced via liveCommand: false, which
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
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    assertStringIncludes(out, "alive-marker-ZZZ");
    assertFalse(
      out.includes("stale-marker-QQQ"),
      `stale pane appeared in Agentower:\n${out}`,
    );
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S18: Fresh-session pane with no tool / subagent / edit / task / idle
// activity produces an empty Row 2 segs array; agentower.tsx renders
// `(no activity)` gray instead of collapsing to an indent-only blank line.
Deno.test("S18: empty row-2 renders (no activity) placeholder", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "running",
      prompt: "fresh-session-marker",
    });
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    assertStringIncludes(out, "(no activity)");
    // None of the row-2 segment icons may render when segs is empty, and a
    // pane without contextUsedPct must not draw the gauge. The positive
    // threshold-color path for the gauge is covered by S19.
    // ROW2_ICONS = tool 󰒓 / tree 󱙺 / file 󰈔 / progress 󰄱; gauge ━ / ─.
    // The preview card to the right draws its own "─" border, so only the list
    // column is checked.
    const list = out.split("\n").map((l) => l.split(/[│╭╰]/)[0]).join("\n");
    for (const icon of ["󰒓", "󱙺", "󰈔", "󰄱", "━", "─"]) {
      assertFalse(
        list.includes(icon),
        `row-2 icon ${icon} leaked into empty-state render:\n${out}`,
      );
    }
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S19: @pane_context_used_pct renders in row 2's fixed right block as
// "<gauge> NN%" with threshold-based color. Values <50 green (ok), 50–74
// yellow (warn), ≥75 red (err). The percentages share one column down the
// list, and a pane without the option set draws neither gauge nor percent.
Deno.test("S19: context gauge sits in a fixed right column (gauge + percent + color)", async () => {
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

    const agentower = await spawnAgentower();

    // 1. Text assertions — both percentages present.
    const out = await waitFor(
      agentower,
      (o) => o.includes("23%") && o.includes("80%"),
    );
    assertStringIncludes(out, "23%");
    assertStringIncludes(out, "80%");

    // 2. Gauge + alignment — both rows draw the heavy-line fill, and the
    // percent signs land in the same cell column.
    const lines = out.split("\n");
    const pctLine = (n: string) => lines.find((l) => l.includes(n)) ?? "";
    for (const n of ["23%", "80%"]) {
      assertStringIncludes(pctLine(n), "━", `no gauge beside ${n}:\n${out}`);
    }
    assertEquals(
      stringCells(pctLine("23%").split("23%")[0]),
      stringCells(pctLine("80%").split("80%")[0]),
      `23% and 80% are not in one column:\n${out}`,
    );

    // 3. No-token row must not render the gauge. Locate row 1 by its prompt
    // marker; the gauge and percent live on the row below it.
    const notokenLine = out.split("\n").find((l) => l.includes("row-notoken"));
    assertEquals(
      typeof notokenLine,
      "string",
      `row-notoken line not found:\n${out}`,
    );
    const notokenRow2 = lines[lines.indexOf(notokenLine!) + 1] ?? "";
    assertFalse(
      notokenRow2.includes("━") || notokenRow2.includes("─"),
      `gauge leaked onto pane without contextUsedPct:\n${notokenRow2}`,
    );
    assertFalse(
      notokenRow2.includes("%"),
      `percent leaked onto pane without contextUsedPct:\n${notokenRow2}`,
    );

    // 4. Color assertion — capture raw (ANSI-preserving) and confirm the
    // SGR foreground near 23% differs from the one near 80%. This is a
    // structural distinctness check, not a hex match, since tmux's
    // 256-color approximation is environment-dependent.
    const raw = await tmux(["capture-pane", "-p", "-e", "-t", agentower]);
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

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S20: launching pane is initially selected when present in list.
// tmux.conf's `bind-key w` writes the originating pane id into the session
// environment as `AGENTOWER_FROM_PANE` via `set-environment` immediately
// before `display-popup` runs; the popup inherits the session env at spawn
// so agentower.tsx main() can resolve initialSelectedPaneId from it. Reserved
// TMUX_PANE cannot be reused (tmux clobbers it for the spawned process).
// The harness reproduces the same env-name contract by passing
// `-e AGENTOWER_FROM_PANE=<pane-id>` to `tmux new-window` in spawnAgentower()
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

    // Sub-case A (baseline / fromPane unset): no selfPane → first row.
    let agentower = await spawnAgentower();
    await waitFor(agentower, selectedIncludes("row-A"));
    await sendKey(agentower, "Escape");
    await waitForExit();

    // Sub-case B (hit / fromPane in rows): selfPane=pc → row-C.
    agentower = await spawnAgentower({ selfPane: pc });
    await waitFor(agentower, selectedIncludes("row-C"));
    await sendKey(agentower, "Escape");
    await waitForExit();

    // Sub-case C (miss / fromPane stale): selfPane points at a non-existent
    // pane id, exercising the resolution ternary's `rows.some(...)` guard.
    // Falls back to first row.
    agentower = await spawnAgentower({ selfPane: "%999" });
    await waitFor(agentower, selectedIncludes("row-A"));
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S21: tmux.conf bind-key w writes the source pane id to session env BEFORE
// display-popup. Static assertion against the conf text — not a runtime test.
//
// The two regressions this catches:
//   (1) `display-popup -e "AGENTOWER_FROM_PANE=#{pane_id}"` form (the original
//       buggy shape). `#{pane_id}` in the `-e` flag is expanded at run-shell
//       parse time against a stale context (observed off-by-one against the
//       prior invocation's source pane in 12/12 diagnostic samples; see plan
//       20260429T1822-picker-cursor-from-pane-fix).
//   (2) Pre-capture via `set-option -g @cc-picker-source "#{pane_id}"` followed
//       by `-e "AGENTOWER_FROM_PANE=#{@cc-picker-source}"`. tmux expands the
//       `-e` value at parse time, BEFORE the preceding set-option executes,
//       so `-e` reads the option's PRIOR value — same off-by-one symptom
//       (verified with diagnostic instrumentation during plan execution).
//
// Required pattern:
//   `set-environment -t "#{session_name}" AGENTOWER_FROM_PANE "#{pane_id}"`
//   runs before display-popup; the popup inherits session env at spawn.
//   display-popup MUST NOT carry an explicit `-e AGENTOWER_FROM_PANE=...` flag
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
    /set-environment\s+-t\s+"#\{session_name\}"\s+AGENTOWER_FROM_PANE\s+"#\{pane_id\}"/;
  const setEnvMatch = setEnvRe.exec(bind);
  const popupRe = /display-popup\b/;
  const popupMatch = popupRe.exec(bind);
  if (!setEnvMatch || !popupMatch) {
    throw new Error(
      `bind-key w must contain both set-environment (AGENTOWER_FROM_PANE = ` +
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

  // Forbidden: any `-e AGENTOWER_FROM_PANE=...` flag on display-popup, regardless
  // of quoting (no quotes / single quotes / double quotes). All forms reintroduce
  // the parse-time stale-expansion bug — direct `-e "VAR=#{pane_id}"`, the
  // set-option/#{@option} pre-capture variant, etc.
  const hasForbiddenE = /-e\s+["']?AGENTOWER_FROM_PANE=/.test(bind);
  if (hasForbiddenE) {
    throw new Error(
      `display-popup MUST NOT carry a '-e AGENTOWER_FROM_PANE=...' flag (any ` +
        `quoting form). The session-env transport is the only safe path. ` +
        `Line: ${bind}`,
    );
  }
});

// S22: pressing `w` inside Agentower toggles a wait/idle filter. Round-trip
// the toggle in a single fixture (filter ON → only waiting/idle remain + pill
// shown → filter OFF → all four statuses back, pill gone). The pill body text
// `wait/idle` is asserted to confirm the hint-bar pill renders; the
// powerline endcap glyphs (U+E0B6 / U+E0B4) are not asserted directly because
// terminal capture of PUA code points is rendering-dependent. The dynamic
// `w  clear` / `w  filter` hint is exercised indirectly by toggling twice.
//
// Note: status row text uses `wait`/`idle` without the `/` separator, so
// `wait/idle` substring matching is unambiguously the hint-bar pill.

Deno.test("S22: w toggles wait/idle filter (round-trip)", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running" });
    await createClaudePane({ status: "waiting" });
    await createClaudePane({ status: "idle" });
    await createClaudePane({ status: "error" });

    const agentower = await spawnAgentower();
    const initial = await captureOutput(agentower);
    assertEquals(listStatuses(initial), ["run", "wait", "idle", "err"]);
    assertFalse(
      initial.includes("wait/idle"),
      `pill unexpectedly present before pressing w:\n${initial}`,
    );

    // First `w` press: filter ON. Wait until the pill text appears so we know
    // the re-render landed before sampling the status texts.
    await sendKey(agentower, "w");
    const filtered = await waitFor(agentower, (o) => o.includes("wait/idle"));
    assertEquals(
      listStatuses(filtered),
      ["wait", "idle"],
      `filter let other statuses through:\n${filtered}`,
    );

    // Second `w` press: filter OFF. Wait until the pill disappears.
    await sendKey(agentower, "w");
    const restored = await waitFor(agentower, (o) => !o.includes("wait/idle"));
    assertEquals(listStatuses(restored), ["run", "wait", "idle", "err"]);

    await sendKey(agentower, "Escape");
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

      const agentower = await spawnAgentower();
      const initial = await captureOutput(agentower);
      assertStringIncludes(initial, "run");

      await sendKey(agentower, "w");
      const empty = await waitFor(
        agentower,
        (o) => o.includes("No waiting/idle panes"),
      );
      assertStringIncludes(empty, "No waiting/idle panes");
      assertStringIncludes(empty, "Press w to clear filter");

      // useInput must still be wired up in the empty-state branch — pressing
      // `w` again should clear the filter and bring the running row back.
      // Wait for the empty-state message to actually disappear (not for `run`
      // to appear, which can match unrelated text in the tmux window chrome).
      await sendKey(agentower, "w");
      const restored = await waitFor(
        agentower,
        (o) => !o.includes("No waiting/idle panes"),
      );
      assertStringIncludes(restored, "run");
      assertFalse(
        restored.includes("No waiting/idle panes"),
        `empty-state message persisted after clearing filter:\n${restored}`,
      );

      await sendKey(agentower, "Escape");
      await waitForExit();
    } finally {
      await teardown();
    }
  },
);

// S24: opencode pane is included in Agentower output. fetchPanes filter
// accepts `agent === "claude" || agent === "opencode"` AND
// isLivePaneCommand(agent, currentCommand) — opencode panes spawn under the
// `.opencode-wrapp` stub so liveCommand=true selects the right binary.
Deno.test("S24: opencode pane visible in Agentower", async () => {
  await setupServer();
  try {
    await createClaudePane({
      agent: "opencode",
      status: "running",
      prompt: "opencode-marker-S24",
    });
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    assertStringIncludes(out, "opencode-marker-S24");
    await sendKey(agentower, "Escape");
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
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    assertStringIncludes(out, "claude-marker-S25");
    assertStringIncludes(out, "opencode-marker-S25");
    // Chip body form: " " + agentLabel + " " (chip-width hugs the canonical
    // name). Hyphenated marker prompts ("claude-marker-S25" etc.) follow
    // "claude"/"opencode" with "-", not " ", so they cannot collide with the
    // chip body substring. S28 covers codex; S25 fixture has no codex pane.
    assertStringIncludes(out, " claude ");
    assertStringIncludes(out, " opencode ");
    await sendKey(agentower, "Escape");
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
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    assertStringIncludes(out, "alive-oc-marker-S26");
    assertFalse(
      out.includes("stale-oc-marker-S26"),
      `stale opencode pane appeared in Agentower:\n${out}`,
    );
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S27: codex pane is included in Agentower output. Codex panes spawn under
// the `.codex-wrapped` stub so liveCommand=true selects the right binary.
Deno.test("S27: codex pane visible in Agentower", async () => {
  await setupServer();
  try {
    await createClaudePane({
      agent: "codex",
      status: "running",
      prompt: "codex-marker-S27",
    });
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    assertStringIncludes(out, "codex-marker-S27");
    await sendKey(agentower, "Escape");
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
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    assertStringIncludes(out, "claude-marker-S28");
    assertStringIncludes(out, "opencode-marker-S28");
    assertStringIncludes(out, "codex-marker-S28");
    // Chip body form: " " + agentLabel + " ". Hyphenated marker prompts
    // ("claude-marker-S28" etc.) follow each agent name with "-", not " ",
    // so they cannot collide with the chip body substring.
    assertStringIncludes(out, " claude ");
    assertStringIncludes(out, " opencode ");
    assertStringIncludes(out, " codex ");
    await sendKey(agentower, "Escape");
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
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);
    assertStringIncludes(out, "alive-codex-marker-S29");
    assertFalse(
      out.includes("stale-codex-marker-S29"),
      `stale codex pane appeared in Agentower:\n${out}`,
    );
    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S30: Agentower layout follows tmux resize-window. Agentower reads stdout.columns
// once at render and previously did not re-render on terminal resize. The
// resize-tracking useEffect subscribes to stdout 'resize' so the layout
// (listWidth / previewWidth / bodyHeight / hint bar width) updates live.
//
// Signal: the key-hint bar is ~73 cells, spans the list column, and is clipped
// from the right, so its last hint " quit" is cut at cols 60 (list 40) and
// shown at cols 150 (list 90).
Deno.test("S30: Agentower re-layouts after tmux resize-window", async () => {
  await setupServer({ cols: 60, rows: 20 });
  try {
    await createClaudePane({ status: "waiting", prompt: "row-a" });
    const agentower = await spawnAgentower();

    // Initial narrow render: the hint bar is clipped before " quit".
    const narrowOut = await captureOutput(agentower);
    assertFalse(
      narrowOut.includes(" quit"),
      `unexpected ' quit' hint at narrow width:\n${narrowOut}`,
    );

    // Widen the tmux window — Agentower must repaint and surface the hint.
    // Target is the same SESSION:WINDOW path that spawnAgentower uses; the
    // harness's SESSION const is "test" and AGENTOWER_WINDOW_NAME is "agentower".
    await tmux(["resize-window", "-t", agentower, "-x", "150", "-y", "30"]);
    await waitFor(agentower, (out) => out.includes(" quit"));

    // Narrow again — Agentower must repaint and hide the hint.
    await tmux(["resize-window", "-t", agentower, "-x", "60", "-y", "20"]);
    await waitFor(agentower, (out) => !out.includes(" quit"));

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S-N1: User-defined label overrides PaneStatus in row-1 display.
// When @pane_user_label is set, Agentower renders the label's text + icon
// instead of the pane's automatic status (run/wait/idle/err).
Deno.test("S-N1: userLabel='feedback' renders label text in row-1", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "running", // would normally render `run`
      userLabel: "feedback", // takes priority
      prompt: "labeled-row",
    });
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);

    // Label text replaces status text.
    assertStringIncludes(out, "feedback");
    // Status text from the underlying PaneStatus is suppressed.
    assertFalse(
      out.includes(" run "),
      `status text 'run' leaked into labeled row:\n${out}`,
    );

    await sendKey(agentower, "Escape");
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
    const agentower = await spawnAgentower();
    // Wait for the initial render so 'm' targets the right row.
    await waitFor(agentower, (out) => out.includes("cycle-me"));

    await sendKey(agentower, "m");
    // The label text appears after the next 1s tick + repaint.
    await waitFor(agentower, (out) => out.includes("review"), 4000);

    await sendKey(agentower, "Escape");
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
    const agentower = await spawnAgentower();
    const out = await captureOutput(agentower);

    // Both label text and status text coexist (label only on first row).
    assertStringIncludes(out, "feedback");
    assertStringIncludes(out, "idle");
    // Both repo basenames reach the repo column (no truncation collapse).
    assertStringIncludes(out, "alpha");
    assertStringIncludes(out, "beta");

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S-N4: M keypress clears userLabel back to none. Counterpart to S-N2
// (m cycles forward). Start with userLabel='parked' rendered, then send 'M'
// and assert the label text disappears after the next tick + repaint.
// 'parked' is chosen over 'review' because the Preview header text contains
// the substring 'review' ("P[review]w"), which would make a naive
// includes() assertion trivially true even after the label is cleared.
Deno.test("S-N4: M keypress clears userLabel back to none", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "running",
      userLabel: "parked",
      prompt: "clear-me",
    });
    const agentower = await spawnAgentower();
    // Confirm the initial label is rendered before sending the reset key.
    await waitFor(agentower, (out) => out.includes("parked"));

    await sendKey(agentower, "M");
    // The label text disappears after the next 1s tick + repaint.
    await waitFor(agentower, (out) => !out.includes("parked"), 4000);

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S-N5: A label bound to a closed session does not leak into a new session
// on the same pane. The pane's current @pane_session_id ("sess-new") differs
// from the session the label was attached to (@pane_user_label_session =
// "sess-old"), so parseRow drops the stale label and Agentower renders the
// automatic status instead. This is the core fix: stale labels are gated on
// session identity, not on unreliable close hooks. 'parked' is used for the same
// reason as S-N4 (the Preview header contains the substring 'review').
Deno.test("S-N5: stale label from a closed session is not shown after a new session starts", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "running", // automatic status that should surface instead
      userLabel: "parked", // left over from the previous (closed) session
      userLabelSession: "sess-old", // session the label was bound to
      sessionId: "sess-new", // the freshly started session on this pane
      prompt: "stale-label-row",
    });
    const agentower = await spawnAgentower();
    await waitFor(agentower, (out) => out.includes("stale-label-row"));

    const out = await captureOutput(agentower);
    // The stale label must not render.
    assertFalse(
      out.includes("parked"),
      `stale label 'parked' leaked despite session change:\n${out}`,
    );
    // The automatic status takes over now that the label is gated out.
    assertStringIncludes(out, "run");

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// --- Usage footer (S31–S35) ---
//
// Fixtures are built at test time with offsets from now, never with committed
// absolute timestamps: a fixed resetsAt written today drifts into the past and
// would silently turn the "normal render" case into the "expired" case with no
// failure to announce it. Same reasoning as S8b's makeTempDir.

interface UsageWindowFixture {
  label: string;
  usedPct: number;
  resetsInSec: number;
}

async function writeUsageFixture(
  agent: "claude" | "codex",
  windows: UsageWindowFixture[],
  updatedSecAgo = 0,
): Promise<void> {
  const dir = `${await sandboxHomePath()}/.local/state/agent-usage`;
  await Deno.mkdir(dir, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  await Deno.writeTextFile(
    `${dir}/${agent}.json`,
    JSON.stringify({
      agent,
      updatedAt: now - updatedSecAgo,
      windows: windows.map((w) => ({
        label: w.label,
        usedPct: w.usedPct,
        resetsAt: now + w.resetsInSec,
      })),
    }),
  );
}

// Footer rows are the only lines that open with exactly two spaces and an
// agent name: pane row-1 leads with the pointer and a status glyph, row-2 with
// a segment icon, and the preview starts past listWidth. A bare
// includes("claude") would also match a pane summary.
// Usage rows live inside the Usage card under the preview, so each one is the
// text between the card's side borders. Column positions are measured from the
// card's inner left edge.
function footerLines(out: string): string[] {
  return out.split("\n").flatMap((l) => {
    const m = l.match(/│ ((?:claude|codex)\b.*?)\s*│\s*$/);
    return m ? [m[1]] : [];
  });
}

// The countdown glyph is a supplementary-plane code point, so a raw indexOf
// reports the claude row one unit further right than the codex row even when
// the two are perfectly aligned.
function columnStart(line: string, label: string): number {
  const at = line.indexOf(label);
  // split()[0] on a missing label returns the whole line, which would let two
  // rows that never carry the label compare equal.
  if (at < 0) throw new Error(`no ${label} column in line: ${line}`);
  return stringCells(line.slice(0, at));
}

Deno.test("S31: usage card gives each agent its own row with aligned columns", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "footer-row-xxx" });
    // 6450, not 6420: the assertion below pins "1h47m", and 6420 is the exact
    // bottom of that bucket — one second of drift between writing the fixture
    // and the first render would flip it to 1h46m. 6450 leaves 30s of slack.
    await writeUsageFixture("claude", [
      { label: "5h", usedPct: 42, resetsInSec: 6450 },
      { label: "7d", usedPct: 13, resetsInSec: 500000 },
    ]);
    await writeUsageFixture("codex", [
      { label: "5h", usedPct: 7, resetsInSec: 3000 },
      { label: "7d", usedPct: 2, resetsInSec: 400000 },
    ]);
    const agentower = await spawnAgentower();
    const out = await waitFor(agentower, (o) => footerLines(o).length === 2);

    const lines = footerLines(out);
    assertEquals(lines.length, 2);
    assertStringIncludes(lines[0], "claude");
    assertStringIncludes(lines[0], `42% \u{F0450} 1h47m`);
    assertStringIncludes(lines[1], "codex");
    // At cols 200 the card is 74 cells wide inside, enough for the gauges.
    assertStringIncludes(lines[0], "━");
    assertStringIncludes(lines[1], "━");
    assertEquals(columnStart(lines[0], "7d"), columnStart(lines[1], "7d"));
    // The pane row has to survive the rows the card takes off the preview.
    assertStringIncludes(out, "footer-row-xxx");

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

Deno.test("S32: expired window renders -- instead of a percentage", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "expired-xxx" });
    await writeUsageFixture("claude", [
      { label: "5h", usedPct: 42, resetsInSec: -10 },
      { label: "7d", usedPct: 13, resetsInSec: 500000 },
    ]);
    const agentower = await spawnAgentower();
    const out = await waitFor(agentower, (o) => footerLines(o).length === 1);

    const line = footerLines(out)[0];
    assertStringIncludes(line, "--");
    assertStringIncludes(line, "13%");
    // An expired window drops its countdown and its bar along with its
    // percentage, but keeps both slots so 7d does not slide left.
    assertFalse(line.includes("\u{F0450}"));
    assertEquals(columnStart(line, "7d"), 34);

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

Deno.test("S33: no usage files → no usage card, body keeps its rows", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "no-footer-xxx" });
    const agentower = await spawnAgentower();
    const out = await waitFor(agentower, (o) => o.includes("no-footer-xxx"));

    assertEquals(footerLines(out).length, 0);
    // The pane's own row-2 renders below its row-1 rather than being clipped
    // away.
    assertStringIncludes(out, "no-footer-xxx");
    assertStringIncludes(out, "(no activity)");

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

Deno.test("S34: narrow width suppresses the usage card and draws no title row", async () => {
  await setupServer({ cols: 60, rows: 20 });
  try {
    await createClaudePane({ status: "running", prompt: "narrow-xxx" });
    await writeUsageFixture("claude", [
      { label: "5h", usedPct: 42, resetsInSec: 6420 },
      { label: "7d", usedPct: 13, resetsInSec: 500000 },
    ]);
    const agentower = await spawnAgentower();
    // spawnAgentower already waited for the hint bar, so the frame is up. Give it
    // two more ticks: a card that only appeared on refresh would surface by now.
    await new Promise((r) => setTimeout(r, 2200));
    const out = await captureOutput(agentower);

    assertEquals(footerLines(out).length, 0);
    // The title lives on the popup border (tmux.conf's `-T`), so Agentower
    // itself must not spend a row on it.
    assertFalse(out.includes("Agentower"), `title row drawn:\n${out}`);

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

Deno.test("S35: the 152-column popup drops the bars and keeps one line per agent", async () => {
  // cols 150 is the inner width of the narrowest 152-column popup: the preview
  // is 58 wide, 54 inside the card — room for bar-less rows (42) but not for
  // the gauges (60).
  await setupServer({ cols: 150, rows: 20 });
  try {
    await createClaudePane({ status: "running", prompt: "widest-xxx" });
    // Worst case the renderer can produce: both agents present, every window
    // populated, and both carrying a staleness suffix.
    await writeUsageFixture("claude", [
      { label: "5h", usedPct: 100, resetsInSec: 17999 },
      { label: "7d", usedPct: 100, resetsInSec: 500000 },
    ], 29 * 86400);
    await writeUsageFixture("codex", [
      { label: "5h", usedPct: 100, resetsInSec: 17999 },
      { label: "7d", usedPct: 100, resetsInSec: 500000 },
    ], 29 * 86400);
    const agentower = await spawnAgentower();
    const out = await waitFor(agentower, (o) => footerLines(o).length === 2);

    const lines = footerLines(out);
    assertEquals(lines.length, 2);
    // The layout falls back to numbers while keeping the per-agent rows and
    // the column grid.
    assertFalse(lines[0].includes("━"));
    assertFalse(lines[0].includes("─"));
    assertEquals(columnStart(lines[0], "7d"), columnStart(lines[1], "7d"));
    // The pane row survives the rows the card takes.
    assertStringIncludes(out, "widest-xxx");

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

Deno.test("S37: an agent missing a window leaves the column blank, not shifted", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "asymmetric-xxx" });
    await writeUsageFixture("claude", [
      { label: "5h", usedPct: 42, resetsInSec: 6450 },
      { label: "7d", usedPct: 13, resetsInSec: 500000 },
    ]);
    // Codex's current upstream shape: primary is the 7d window and secondary
    // is null, so Agentower sees one window where claude has two.
    await writeUsageFixture("codex", [
      { label: "7d", usedPct: 17, resetsInSec: 400000 },
    ]);
    const agentower = await spawnAgentower();
    const out = await waitFor(agentower, (o) => footerLines(o).length === 2);

    const [claude, codex] = footerLines(out);
    assertStringIncludes(claude, "5h");
    // The gap is what makes the missing window legible; a left-packed codex row
    // would put its 7d where claude's 5h sits.
    assertFalse(codex.includes("5h"));
    assertEquals(columnStart(claude, "7d"), columnStart(codex, "7d"));
    assertStringIncludes(out, "asymmetric-xxx");

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// --- Row-2 tool error (S36) ---

// The known clipping condition is a glyph sharing one <Text> with the body that
// follows it; every other call site dodges it by giving the glyph its own <Text>.
// The error mark can do neither — it sits mid-string inside the tool body — so
// the behaviour there is untested by construction. Asserting the text *after*
// the glyph is what makes this a rendering test rather than a restatement of the
// toolSegmentText unit test.
Deno.test("S36: row-2 tool error keeps its text after the error mark", async () => {
  await setupServer();
  try {
    await createClaudePane({
      status: "idle",
      prompt: "tool-err-xxx",
      lastTool: "Bash",
      lastToolError: "Exit code 1",
    });
    const agentower = await spawnAgentower();
    const out = await waitFor(agentower, (o) => o.includes("tool-err-xxx"));

    assertStringIncludes(out, "Bash \u{F0156} Exit code 1");

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// Runs git with the user's global and system config shut out, so a hooksPath
// or signing setting on the developer machine cannot leak into the fixture.
async function git(cwd: string, ...args: string[]): Promise<void> {
  const { code, stderr } = await new Deno.Command("git", {
    args: ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
    cwd,
    env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    stdout: "null",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${new TextDecoder().decode(stderr)}`,
    );
  }
}

// S38: the repo column names the repository, not the cwd's basename. A pane in
// a subdirectory of the main checkout shows the repo name, and a pane in a
// linked worktree shows `repo(worktree)`.
Deno.test("S38: repo column shows repo(worktree) from git", async () => {
  await setupServer();
  const root = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "agentower-git-",
  });
  try {
    await Deno.mkdir(`${root}/proj/sub`, { recursive: true });
    await git(`${root}/proj`, "init", "-q", "-b", "main");
    await git(`${root}/proj`, "commit", "-q", "--allow-empty", "-m", "init");
    await git(
      `${root}/proj`,
      "worktree",
      "add",
      "-q",
      "-b",
      "feature",
      `${root}/proj-wt`,
    );

    await createClaudePane({
      status: "idle",
      prompt: "main-row",
      cwd: `${root}/proj/sub`,
    });
    await createClaudePane({
      status: "idle",
      prompt: "wt-row",
      cwd: `${root}/proj-wt`,
    });
    const agentower = await spawnAgentower();
    const out = await waitFor(agentower, (o) => o.includes("proj(proj-wt)"));
    // Only the list column: the preview card beside it shows the full path,
    // which does contain the subdirectory name.
    const lines = out.split("\n").map((l) => l.split(/[│╭╰]/)[0]);
    const mainRow = lines.find((l) => l.includes("main-row")) ?? "";
    const wtRow = lines.find((l) => l.includes("wt-row")) ?? "";

    assertStringIncludes(mainRow, "proj");
    assertFalse(mainRow.includes("sub"), `subdir leaked: ${mainRow}`);
    assertStringIncludes(mainRow, "main");
    assertStringIncludes(wtRow, "proj(proj-wt)");
    assertStringIncludes(wtRow, "feature");

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

// S39: `n` moves the selection to the next waiting pane, skipping others, and
// wraps past the end of the list.
Deno.test("S39: n jumps to the next waiting pane and wraps", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "row-run" });
    await createClaudePane({ status: "waiting", prompt: "row-wait-1" });
    await createClaudePane({ status: "idle", prompt: "row-idle" });
    await createClaudePane({ status: "waiting", prompt: "row-wait-2" });
    const agentower = await spawnAgentower();
    assertStringIncludes(
      selectedLine(await captureOutput(agentower)),
      "row-run",
    );

    for (const want of ["row-wait-1", "row-wait-2", "row-wait-1"]) {
      await sendKey(agentower, "n");
      await waitFor(agentower, selectedIncludes(want));
    }

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S40: with no waiting pane, `n` leaves the selection where it is.
Deno.test("S40: n without a waiting pane keeps the selection", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "row-first" });
    await createClaudePane({ status: "idle", prompt: "row-second" });
    const agentower = await spawnAgentower();
    await sendKey(agentower, "n");
    // Two ticks for a stray move to land before sampling.
    await new Promise((r) => setTimeout(r, 2200));
    const out = await captureOutput(agentower);
    assertStringIncludes(selectedLine(out), "row-first");

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S41: a list taller than the body scrolls instead of letting Yoga shrink it.
// At 20 panes and the default 50 rows the list gets 47 rows, room for 11
// four-row cards between the two indicator lines; wrapping to the last pane
// scrolls the first nine out of view.
Deno.test("S41: 20 panes scroll with the selection and keep rows intact", async () => {
  await setupServer();
  try {
    for (let i = 1; i <= 20; i++) {
      await createClaudePane({
        status: "idle",
        prompt: `row-${String(i).padStart(2, "0")}`,
      });
    }
    const agentower = await spawnAgentower();
    const initial = await captureOutput(agentower);
    assertStringIncludes(initial, "↓ 9 more");
    assertStringIncludes(initial, "row-01");
    assertFalse(initial.includes("row-12"), `row-12 visible:\n${initial}`);

    await sendKey(agentower, "k"); // wraps to the last pane
    const out = await waitFor(
      agentower,
      (o) => selectedLine(o).includes("row-20"),
    );
    assertStringIncludes(out, "↑ 9 more");
    assertFalse(out.includes("row-09"), `row-09 still visible:\n${out}`);
    // Every visible pane keeps its own row 1: 11 prompts, each once.
    const prompts = out.match(/row-\d\d/g) ?? [];
    assertEquals(prompts.length, 11);
    assertEquals(new Set(prompts).size, 11);

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S42: each pane is a four-row card — a padding row above and below its two
// content rows — and the selection marker runs down all four rows.
Deno.test("S42: the selected card carries the marker on all four rows", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "card-first" });
    await createClaudePane({ status: "idle", prompt: "card-second" });
    const agentower = await spawnAgentower();
    const lines = (await captureOutput(agentower)).split("\n");
    const marked = lines.flatMap((l, i) => (l.startsWith("▌") ? [i] : []));
    assertEquals(marked.length, 4, `marker rows: ${marked}`);
    assertEquals(
      marked[3] - marked[0],
      3,
      `marker rows not contiguous: ${marked}`,
    );
    // The card's padding row comes first, so the pane's own row 1 is second.
    assertStringIncludes(lines[marked[1]], "card-first");
    // The list starts one row below the popup border, level with the preview
    // card's top edge.
    assertEquals(marked[0], 1);

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S43: a popup under 30 rows switches to compact cards — no padding rows, so
// the marker covers only the two content rows — and starts the list on the top
// row.
Deno.test("S43: a short popup drops the card padding and starts at the top row", async () => {
  await setupServer({ cols: 150, rows: 24 });
  try {
    await createClaudePane({ status: "running", prompt: "compact-first" });
    await createClaudePane({ status: "idle", prompt: "compact-second" });
    const agentower = await spawnAgentower();
    const lines = (await captureOutput(agentower)).split("\n");
    const marked = lines.flatMap((l, i) => (l.startsWith("▌") ? [i] : []));
    assertEquals(marked, [0, 1], `marker rows: ${marked}`);
    assertStringIncludes(lines[0], "compact-first");
    // One blank row separates the two panes.
    assertStringIncludes(lines[3], "compact-second");

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// S44/S45: inside a popup tmux hands every key to Agentower, so the
// `prefix w` that opened it arrives as two keys. The harness server runs with
// `-f /dev/null`, so the prefix is read back instead of assuming C-b.
Deno.test("S44: prefix then w closes Agentower instead of toggling the filter", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running" });
    const agentower = await spawnAgentower();
    const prefix = (await tmux(["show-options", "-gv", "prefix"])).trim();

    await sendKey(agentower, prefix);
    await sendKey(agentower, "w");
    await waitForExit();
  } finally {
    await teardown();
  }
});

Deno.test("S45: prefix then another key keeps Agentower open and handles the key", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "row-a-xxx" });
    await createClaudePane({ status: "waiting", prompt: "row-b-yyy" });
    const agentower = await spawnAgentower();
    const prefix = (await tmux(["show-options", "-gv", "prefix"])).trim();

    await sendKey(agentower, prefix);
    await sendKey(agentower, "j");
    await waitFor(agentower, selectedIncludes("row-b-yyy"));

    await sendKey(agentower, "w");
    await waitFor(agentower, (o) => o.includes("wait/idle"));

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// One send-keys call writes both keys back to back, so they usually reach
// Agentower in a single read — the unsplit-chunk path S44 rarely takes.
Deno.test("S46: prefix and w sent together still close Agentower", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running" });
    const agentower = await spawnAgentower();
    const prefix = (await tmux(["show-options", "-gv", "prefix"])).trim();

    await tmux(["send-keys", "-t", agentower, prefix, "w"]);
    await waitForExit();
  } finally {
    await teardown();
  }
});

// Mouse reports are written straight to Agentower's pty, which is what tmux
// does for a popup once Agentower turns mouse mode on. Coordinates are the
// 0-based cells the unit tests for cardIndexAt use; press and release go out
// in one write, the way a terminal reports a click.
async function sendClick(
  target: string,
  button: number,
  cell: { x: number; y: number },
): Promise<void> {
  const at = `${cell.x + 1};${cell.y + 1}`;
  const seq = `\x1b[<${button};${at}M\x1b[<${button};${at}m`;
  const hex = [...new TextEncoder().encode(seq)].map((b) =>
    b.toString(16).padStart(2, "0")
  );
  await tmux(["send-keys", "-t", target, "-H", ...hex]);
}

// At 200×50 with no scrolling, card 0 spans rows 1-4 and card 1 rows 5-8.
const CARD_0 = { x: 2, y: 2 };
const CARD_1 = { x: 2, y: 6 };

Deno.test("S47: Agentower turns on SGR mouse reporting", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running" });
    const agentower = await spawnAgentower();
    const flags = await tmux([
      "display-message",
      "-t",
      agentower,
      "-p",
      "#{mouse_standard_flag}#{mouse_sgr_flag}",
    ]);
    assertEquals(flags.trim(), "11");

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

Deno.test("S48: clicking a card selects it and clicking it again jumps", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "row-a" });
    const paneB = await createClaudePane({
      status: "running",
      prompt: "row-b",
    });
    const agentower = await spawnAgentower();

    await sendClick(agentower, 0, CARD_1);
    await waitFor(agentower, selectedIncludes("row-b"));

    await sendClick(agentower, 0, CARD_1);
    await waitForExit();

    const active = await tmux([
      "display-message",
      "-t",
      paneB,
      "-p",
      "#{pane_active}#{window_active}",
    ]);
    assertEquals(active.trim(), "11");
  } finally {
    await teardown();
  }
});

// A wheel event past either end must leave the selection where it is, which a
// waitFor cannot observe, so those steps check the screen after a settle delay
// long enough for a wrap-around render to have landed.
Deno.test("S49: the wheel moves the selection and stops at both ends", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "row-a" });
    await createClaudePane({ status: "running", prompt: "row-b" });
    await createClaudePane({ status: "running", prompt: "row-c" });
    const agentower = await spawnAgentower();
    const settle = () => new Promise((r) => setTimeout(r, 500));

    await sendClick(agentower, 64, CARD_0);
    await settle();
    assertStringIncludes(selectedLine(await captureOutput(agentower)), "row-a");

    await sendClick(agentower, 65, CARD_0);
    await waitFor(agentower, selectedIncludes("row-b"));
    await sendClick(agentower, 65, CARD_0);
    await waitFor(agentower, selectedIncludes("row-c"));

    await sendClick(agentower, 65, CARD_0);
    await settle();
    assertStringIncludes(selectedLine(await captureOutput(agentower)), "row-c");

    await sendClick(agentower, 64, CARD_0);
    await waitFor(agentower, selectedIncludes("row-b"));

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

Deno.test("S50: right-clicking a card selects it and cycles its label", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "row-a" });
    const paneB = await createClaudePane({
      status: "running",
      prompt: "row-b",
    });
    const agentower = await spawnAgentower();

    await sendClick(agentower, 2, CARD_1);
    await waitFor(agentower, selectedIncludes("row-b"));
    await waitFor(agentower, (out) => out.includes("review"), 4000);
    // The screen shows the label optimistically, ahead of the tmux write.
    let label = "";
    for (let i = 0; i < 40 && label !== "review"; i++) {
      label = (await tmux([
        "show-options",
        "-p",
        "-t",
        paneB,
        "-v",
        "@pane_user_label",
      ])).trim();
      if (label !== "review") await new Promise((r) => setTimeout(r, 50));
    }
    assertEquals(label, "review");

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

Deno.test("S51: a key typed before the first frame still reaches the list", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "row-a" });
    await createClaudePane({ status: "running", prompt: "row-b" });
    // startDelayMs parks the key in the pane's tty while sh sleeps, so it is
    // already buffered when Agentower execs — the prefix+w symptom, without a
    // race. Before the entry module set raw mode ahead of the ink import, a
    // key delivered this early stayed invisible until the next keypress.
    const agentower = await spawnAgentower({
      waitForReady: false,
      startDelayMs: 600,
    });
    await sendKey(agentower, "j");

    await waitFor(agentower, selectedIncludes("row-b"), 8000);

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

Deno.test("S52: Ctrl+C during load still closes the popup", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "running", prompt: "row-a" });
    const agentower = await spawnAgentower({ waitForReady: false });

    await sendKey(agentower, "C-c");

    await waitForExit();
  } finally {
    await teardown();
  }
});

function wheelDown(cell: { x: number; y: number }): string {
  return `\x1b[<${MOUSE_WHEEL_DOWN};${cell.x + 1};${cell.y + 1}M`;
}

Deno.test("S53: a burst of j in one write moves one row per key", async () => {
  await setupServer();
  try {
    for (const prompt of ["row-a", "row-b", "row-c", "row-d"]) {
      await createClaudePane({ status: "running", prompt });
    }
    const agentower = await spawnAgentower();

    await sendBurst(agentower, "jjj");

    await waitFor(agentower, selectedIncludes("row-d"));

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

Deno.test("S54: a wheel burst moves per event and clamps at the end", async () => {
  await setupServer();
  try {
    for (const prompt of ["row-a", "row-b", "row-c", "row-d"]) {
      await createClaudePane({ status: "running", prompt });
    }
    const agentower = await spawnAgentower();

    await sendBurst(agentower, wheelDown(CARD_0).repeat(3));
    await waitFor(agentower, selectedIncludes("row-d"));

    // Already on the last row: a second fling must not wrap back to the top.
    await sendBurst(agentower, wheelDown(CARD_0).repeat(3));
    await new Promise((r) => setTimeout(r, 300));
    assertEquals(
      selectedIncludes("row-d")(await captureOutput(agentower)),
      true,
    );

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// The progress segment used to arrive with the first tick, a full second after
// the popup opened, shifting the row under the cursor. main() now reads it
// before render, so it is on the frame spawnAgentower waits for. A corrupt
// usage file rides along: the footer read sits behind the same tick body, and
// the list and the progress segment must survive it.
Deno.test("S55: task progress is on the first frame, past a corrupt usage file", async () => {
  const originalHome = Deno.env.get("HOME");
  const fixtureHome = new URL("./fixtures/task-progress-home", import.meta.url)
    .pathname;
  // /tmp explicitly: agentower-verify.ts narrows --allow-write to
  // $HOME/.claude/tasks and /tmp, so TMPDIR is out of scope there.
  const tempHome = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "agentower-e2e-home-",
  });
  await Deno.mkdir(`${tempHome}/.claude`, { recursive: true });
  await copyDirRecursive(
    `${fixtureHome}/.claude/tasks`,
    `${tempHome}/.claude/tasks`,
  );
  const usageDir = `${tempHome}/.local/state/agent-usage`;
  await Deno.mkdir(usageDir, { recursive: true });
  await Deno.writeTextFile(`${usageDir}/claude.json`, "{not json at all");

  const denoDir = Deno.env.get("DENO_DIR") ??
    (originalHome ? `${originalHome}/Library/Caches/deno` : undefined);
  const env: Record<string, string> = { HOME: tempHome };
  if (denoDir) env.DENO_DIR = denoDir;

  await setupServer();
  try {
    await createClaudePane({
      status: "idle",
      prompt: "row-progress",
      lastTool: "Read",
      sessionId: "sess-A",
    });
    const agentower = await spawnAgentower({ env });

    // No waitFor: spawnAgentower already returned on the first frame, so a
    // segment that only arrives with the tick would not be here yet.
    const first = await captureOutput(agentower);
    assertStringIncludes(first, "2/3");
    assertStringIncludes(first, "row-progress");

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
    await Deno.remove(tempHome, { recursive: true });
  }
});

async function copyDirRecursive(from: string, to: string): Promise<void> {
  await Deno.mkdir(to, { recursive: true });
  for await (const entry of Deno.readDir(from)) {
    const src = `${from}/${entry.name}`;
    const dst = `${to}/${entry.name}`;
    if (entry.isDirectory) await copyDirRecursive(src, dst);
    else if (entry.isFile) await Deno.copyFile(src, dst);
  }
}

// The branch column is read from HEAD on every tick rather than cached, so a
// checkout inside the pane has to move it. Nothing pinned that before: S38 only
// looks at the branch a repository was created with.
Deno.test("S56: a checkout while the popup is open moves the branch column", async () => {
  await setupServer();
  const root = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "agentower-git-",
  });
  try {
    await Deno.mkdir(`${root}/proj`, { recursive: true });
    await git(`${root}/proj`, "init", "-q", "-b", "main");
    await git(`${root}/proj`, "commit", "-q", "--allow-empty", "-m", "init");

    await createClaudePane({
      status: "idle",
      prompt: "main-row",
      cwd: `${root}/proj`,
    });
    const agentower = await spawnAgentower();
    await waitFor(agentower, (o) => o.includes("main"));

    await git(`${root}/proj`, "checkout", "-q", "-b", "other");

    await waitFor(agentower, (o) => o.includes("other"), 4000);

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

// branchMax used to be measured in UTF-16 units while repoMax a line above used
// display cells, so a CJK branch got half the room it needed and was cut short
// even with the column wide enough to hold it.
Deno.test("S57: a CJK branch name gets the width it actually occupies", async () => {
  await setupServer();
  const root = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "agentower-git-",
  });
  try {
    await Deno.mkdir(`${root}/proj`, { recursive: true });
    await git(`${root}/proj`, "init", "-q", "-b", "機能追加");
    await git(`${root}/proj`, "commit", "-q", "--allow-empty", "-m", "init");

    await createClaudePane({
      status: "idle",
      prompt: "cjk-row",
      cwd: `${root}/proj`,
    });
    const agentower = await spawnAgentower();
    const out = await waitFor(agentower, (o) => o.includes("cjk-row"));
    const row = out.split("\n").map((l) => l.split(/[│╭╰]/)[0])
      .find((l) => l.includes("cjk-row")) ?? "";

    assertStringIncludes(row, "機能追加");

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

// The list column of each captured line, cut at the preview card's left edge.
function listColumn(out: string): string[] {
  return out.split("\n").map((l) => l.split(/[│╭╰]/)[0]);
}

// Row-2 segment widths used to be code-point counts, so a CJK file or subagent
// name passed the budget at half its real width and Ink wrapped the row, which
// pushed every pane below it down one line.
Deno.test("S58: CJK row-2 segments stay on their row", async () => {
  await setupServer({ cols: 120, rows: 40 });
  try {
    await createClaudePane({
      status: "running",
      prompt: "cjk-seg-row",
      currentTool: "Edit",
      lastEditFile: "/x/設計ドキュメント草案メモ版.md",
      subagents: "探索エージェント:a",
    });
    await createClaudePane({ status: "idle", prompt: "below-row" });
    const agentower = await spawnAgentower();
    const out = await waitFor(agentower, (o) => o.includes("below-row"));
    const list = listColumn(out);
    const first = list.findIndex((l) => l.includes("cjk-seg-row"));
    // Four-row cards: the next pane's row 1 is four lines further down.
    assertStringIncludes(list[first + 4] ?? "", "below-row", out);
    // splitLayout gives the list 72 of the 120 columns.
    for (const l of list) {
      const used = stringCells(l.trimEnd());
      assertEquals(used <= 72, true, `list line overflows: ${l}`);
    }

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// cell_width counted an emoji as one cell while tmux draws two, so an emoji
// prompt overflowed row 1 and wrapped the card.
Deno.test("S59: an emoji prompt is truncated to the row instead of wrapping", async () => {
  await setupServer({ cols: 120, rows: 40 });
  try {
    await createClaudePane({ status: "idle", prompt: "🎉".repeat(40) });
    await createClaudePane({ status: "idle", prompt: "below-row" });
    const agentower = await spawnAgentower();
    const out = await waitFor(agentower, (o) => o.includes("below-row"));
    const list = listColumn(out);
    const first = list.findIndex((l) => l.includes("🎉"));
    assertStringIncludes(list[first], "…", out);
    assertStringIncludes(list[first + 4] ?? "", "below-row", out);

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// capture-pane ends its last row with a newline too; split as-is, that became
// an empty preview row under the pane's real bottom row.
Deno.test("S60: the preview's last row is the pane's last row", async () => {
  await setupServer({ cols: 120, rows: 40 });
  try {
    await printingClaudePane(
      "i=1; while [ $i -le 60 ]; do echo L$i; i=$((i+1)); done; printf BOTTOM",
    );
    const agentower = await spawnAgentower();
    const out = await waitFor(agentower, (o) => o.includes("BOTTOM"));
    const rows = out.split("\n");
    const bottomBorder = rows.findIndex((l) => l.includes("╰"));
    assertStringIncludes(rows[bottomBorder - 1], "BOTTOM", out);

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// tmux accepts ':' in a session name, but `name:win.pane` built from it cannot
// be resolved again, so preview and jump both addressed nothing.
Deno.test("S61: a pane in a session named with ':' previews and is jumped to", async () => {
  await setupServer({ cols: 120, rows: 40 });
  try {
    const stub = `/tmp/agentower-e2e-bin-${Deno.pid}/.claude-wrapped`;
    const paneId = (await tmux([
      "new-session",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-s",
      "proj:v2",
      "-x",
      "120",
      "-y",
      "40",
      `sh -c 'yes "" | head -60; printf COLON-MARK; exec ${stub} 99999'`,
    ])).trim();
    await waitForCommand(paneId, ".claude-wrapped");
    await tmux(["set-option", "-p", "-t", paneId, "@pane_agent", "claude"]);
    await tmux(["set-option", "-p", "-t", paneId, "@pane_status", "idle"]);
    // A second window made current, so the jump has a window to switch.
    const sessionId = (await tmux([
      "display-message",
      "-p",
      "-t",
      paneId,
      "#{session_id}",
    ])).trim();
    await tmux(["new-window", "-t", sessionId, "-n", "other"]);
    const agentower = await spawnAgentower();
    await waitFor(agentower, (o) => o.includes("COLON-MARK"));

    await sendKey(agentower, "Enter");
    await waitForExit();
    const windowActive = (await tmux([
      "display-message",
      "-p",
      "-t",
      paneId,
      "#{window_active}",
    ])).trim();
    assertEquals(windowActive, "1", "the pane's window was not selected");
  } finally {
    await teardown();
  }
});

// A live claude pane whose screen is whatever `script` prints before the stub
// takes over. Printed by the pane itself: the suite's write scope does not
// reach the pane's tty.
async function printingClaudePane(script: string): Promise<string> {
  const stub = `/tmp/agentower-e2e-bin-${Deno.pid}/.claude-wrapped`;
  if (script.includes("'")) throw new Error("script must not contain '");
  const paneId = (await tmux([
    "new-window",
    "-d",
    "-t",
    "test",
    "-P",
    "-F",
    "#{pane_id}",
    `sh -c '${script}; exec ${stub} 99999'`,
  ])).trim();
  await waitForCommand(paneId, ".claude-wrapped");
  await tmux(["set-option", "-p", "-t", paneId, "@pane_agent", "claude"]);
  await tmux(["set-option", "-p", "-t", paneId, "@pane_status", "idle"]);
  return paneId;
}

async function waitForCommand(paneId: string, cmd: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const cur = (await tmux([
      "display-message",
      "-p",
      "-t",
      paneId,
      "#{pane_current_command}",
    ])).trim();
    if (cur === cmd) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`pane ${paneId} never ran ${cmd}`);
}

// A selected pane hidden by the filter left selectedPaneId pointing at it, so
// the cursor sat on another row and then jumped back when the pane returned.
Deno.test("S62: a filtered-out selection stays on the row it moved to", async () => {
  await setupServer();
  try {
    await createClaudePane({ status: "idle", prompt: "row-a" });
    const paneB = await createClaudePane({
      status: "waiting",
      prompt: "row-b",
    });
    const agentower = await spawnAgentower();
    await sendKey(agentower, "j");
    await waitFor(agentower, selectedIncludes("row-b"));
    await sendKey(agentower, "w");
    await waitFor(agentower, (o) => o.includes("wait/idle"));

    await tmux(["set-option", "-p", "-t", paneB, "@pane_status", "running"]);
    await waitFor(agentower, (o) => !o.includes("row-b"), 4000);
    await waitFor(agentower, selectedIncludes("row-a"));

    await tmux(["set-option", "-p", "-t", paneB, "@pane_status", "waiting"]);
    const back = await waitFor(agentower, (o) => o.includes("row-b"), 4000);
    assertStringIncludes(selectedLine(back), "row-a", back);

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});

// capture-pane returns tabs as a literal \t. Counted as one cell and expanded
// by the terminal afterwards, a tab pushed the rest of its preview line, and
// the card's right border with it, several columns right.
Deno.test("S63: a tab in the pane keeps the preview's right border in place", async () => {
  await setupServer({ cols: 120, rows: 40 });
  try {
    await printingClaudePane(
      String.raw`yes "" | head -50; printf "a\tb\tTAB-MARK"`,
    );
    const agentower = await spawnAgentower();
    const out = await waitFor(agentower, (o) => o.includes("TAB-MARK"));
    const rows = out.split("\n");
    const tabRow = rows.find((l) => l.includes("TAB-MARK")) ?? "";
    const plainRow = rows[rows.indexOf(tabRow) - 1];
    assertStringIncludes(tabRow, "a       b       TAB-MARK", out);
    assertEquals(
      stringCells(tabRow.trimEnd()),
      stringCells(plainRow.trimEnd()),
      out,
    );

    await sendKey(agentower, "Escape");
    await waitForExit();
  } finally {
    await teardown();
  }
});
