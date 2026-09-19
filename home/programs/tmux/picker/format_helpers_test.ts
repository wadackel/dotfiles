import { assertEquals } from "jsr:@std/assert@1";
import {
  basename,
  elapsedSource,
  formatElapsed,
  formatRemaining,
  locationParts,
  parseGitLocation,
  parseSubagents,
  renderSubagentTree,
  repoLabel,
  statusColor,
  statusIcon,
  statusShort,
  summaryOf,
  toolSegmentText,
} from "./format_helpers.ts";
import { type PaneRow } from "./pane_row.ts";

function mkRow(overrides: Partial<PaneRow> = {}): PaneRow {
  return {
    paneId: "%1",
    target: "0:0.0",
    currentCommand: "",
    currentPath: "",
    agent: "",
    status: "",
    startedAtSec: null,
    cwd: "",
    worktreeBranch: "",
    subagents: "",
    prompt: "",
    waitReason: "",
    currentTool: "",
    sessionId: "",
    lastTool: "",
    lastEditFile: "",
    lastActivityAtSec: null,
    currentToolSubject: "",
    lastToolSubject: "",
    lastToolError: "",
    contextUsedPct: null,
    userLabel: "",
    ...overrides,
  };
}

// --- formatElapsed ---

Deno.test("formatElapsed: null → middle dot", () => {
  assertEquals(formatElapsed(null, 1700000000), "·");
});

Deno.test("formatElapsed: clock skew (negative diff) → middle dot", () => {
  assertEquals(formatElapsed(1700000100, 1700000000), "·");
});

Deno.test("formatElapsed: seconds bucket", () => {
  assertEquals(formatElapsed(1700000000, 1700000000), "0s");
  assertEquals(formatElapsed(1700000000, 1700000059), "59s");
});

Deno.test("formatElapsed: minutes bucket (floor)", () => {
  assertEquals(formatElapsed(1700000000, 1700000060), "1m");
  assertEquals(formatElapsed(1700000000, 1700000119), "1m");
  assertEquals(formatElapsed(1700000000, 1700003599), "59m");
});

Deno.test("formatElapsed: hours bucket (floor)", () => {
  assertEquals(formatElapsed(1700000000, 1700003600), "1h");
  assertEquals(formatElapsed(1700000000, 1700010800), "3h");
});

// --- statusColor / statusShort / statusIcon ---

Deno.test("statusColor: known statuses", () => {
  assertEquals(statusColor("running"), "#73c1a9");
  assertEquals(statusColor("waiting"), "#ac8b83");
  assertEquals(statusColor("idle"), "#545c8c");
  assertEquals(statusColor("error"), "#ff9494");
});

Deno.test("statusColor: unknown → Normal fg", () => {
  assertEquals(statusColor(""), "#9ea3c0");
});

Deno.test("statusShort: known statuses", () => {
  assertEquals(statusShort("running"), "run");
  assertEquals(statusShort("waiting"), "wait");
  assertEquals(statusShort("idle"), "idle");
  assertEquals(statusShort("error"), "err");
  assertEquals(statusShort(""), "");
});

Deno.test("statusIcon: known statuses", () => {
  assertEquals(statusIcon("running"), "●");
  assertEquals(statusIcon("waiting"), "◐");
  assertEquals(statusIcon("idle"), "○");
  assertEquals(statusIcon("error"), "\u{F0156}");
  assertEquals(statusIcon(""), " ");
});

// --- summaryOf ---

Deno.test("summaryOf: waiting uses wait_reason", () => {
  assertEquals(
    summaryOf(mkRow({ status: "waiting", waitReason: "perm", prompt: "p" })),
    "perm",
  );
});

Deno.test("summaryOf: error uses wait_reason", () => {
  assertEquals(
    summaryOf(mkRow({ status: "error", waitReason: "err", prompt: "p" })),
    "err",
  );
});

Deno.test("summaryOf: waiting falls back to prompt if wait_reason empty", () => {
  assertEquals(
    summaryOf(mkRow({ status: "waiting", waitReason: "", prompt: "hi" })),
    "hi",
  );
});

Deno.test("summaryOf: running uses prompt", () => {
  assertEquals(
    summaryOf(mkRow({ status: "running", prompt: "go" })),
    "go",
  );
});

Deno.test("summaryOf: empty fallback → middle dot", () => {
  assertEquals(summaryOf(mkRow({ status: "idle" })), "·");
});

Deno.test("summaryOf: returns full prompt without length cap", () => {
  const long = "a".repeat(200);
  assertEquals(summaryOf(mkRow({ prompt: long })), long);
});

Deno.test("summaryOf: preserves full CJK prompt (caller truncates by width)", () => {
  const jp =
    "提出したPRが他のPRをマージしたらコンフリクトしたので適切に修正したい";
  assertEquals(summaryOf(mkRow({ prompt: jp })), jp);
});

// --- parseGitLocation ---

Deno.test("parseGitLocation: main checkout has no worktree", () => {
  assertEquals(
    parseGitLocation("/src/dotfiles\n/src/dotfiles/.git\n/src/dotfiles/.git\n"),
    { repo: "dotfiles", worktree: "" },
  );
});

Deno.test("parseGitLocation: linked worktree names the repo after the common dir", () => {
  assertEquals(
    parseGitLocation(
      "/src/dotfiles-worktrees/obsidian\n" +
        "/src/dotfiles/.git/worktrees/obsidian\n/src/dotfiles/.git\n",
    ),
    { repo: "dotfiles", worktree: "obsidian" },
  );
});

Deno.test("parseGitLocation: bare repo.git with a linked worktree drops .git", () => {
  assertEquals(
    parseGitLocation(
      "/src/wt\n/src/repo.git/worktrees/wt\n/src/repo.git\n",
    ),
    { repo: "repo", worktree: "wt" },
  );
});

Deno.test("parseGitLocation: .bare layout names the repo after its parent", () => {
  assertEquals(
    parseGitLocation(
      "/src/repo/main\n/src/repo/.bare/worktrees/main\n/src/repo/.bare\n",
    ),
    { repo: "repo", worktree: "main" },
  );
});

Deno.test("parseGitLocation: submodule is named after its module dir", () => {
  assertEquals(
    parseGitLocation(
      "/src/qmk/lib/chibios\n/src/qmk/.git/modules/lib/chibios\n" +
        "/src/qmk/.git/modules/lib/chibios\n",
    ),
    { repo: "chibios", worktree: "" },
  );
});

Deno.test("parseGitLocation: fewer than three lines → null", () => {
  assertEquals(parseGitLocation(""), null);
  assertEquals(parseGitLocation("/src/a\n/src/a/.git\n"), null);
});

// --- locationParts ---

Deno.test("locationParts: git lookup result wins over the cwd basename", () => {
  assertEquals(
    locationParts(mkRow({
      cwd: "/src/dotfiles/home/programs",
      repoName: "dotfiles",
      worktreeName: "",
      worktreeBranch: "main",
    })),
    { repo: "dotfiles", worktree: "", branch: "main" },
  );
});

Deno.test("locationParts: without a lookup the cwd basename stands in", () => {
  assertEquals(
    locationParts(mkRow({ cwd: "/src/dotfiles", worktreeBranch: "main" })),
    { repo: "dotfiles", worktree: "", branch: "main" },
  );
});

Deno.test("locationParts: pane_current_path covers an unset @pane_cwd", () => {
  assertEquals(
    locationParts(mkRow({ currentPath: "/src/notes" })).repo,
    "notes",
  );
});

Deno.test("locationParts: nothing known → middle dot in repo", () => {
  assertEquals(locationParts(mkRow()), { repo: "·", worktree: "", branch: "" });
});

// --- repoLabel ---

Deno.test("repoLabel: fits → unchanged", () => {
  assertEquals(repoLabel("storycap-testrun", "t3", 24), {
    head: "storycap-testrun",
    suffix: "(t3)",
  });
});

Deno.test("repoLabel: over budget keeps the worktree and cuts the repo", () => {
  const label = repoLabel("storycap-testrun", "t3", 12);
  assertEquals(label, { head: "storyca…", suffix: "(t3)" });
  assertEquals(label.head.length + label.suffix.length, 12);
});

Deno.test("repoLabel: a suffix that alone fills the budget is cut with the name", () => {
  assertEquals(repoLabel("repo", "a-very-long-worktree", 10), {
    head: "repo(a-ve…",
    suffix: "",
  });
});

Deno.test("repoLabel: no worktree → plain truncation", () => {
  assertEquals(repoLabel("storycap-testrun", "", 8), {
    head: "storyca…",
    suffix: "",
  });
});

// --- parseSubagents ---

Deno.test("parseSubagents: empty → empty array", () => {
  assertEquals(parseSubagents(""), []);
});

Deno.test("parseSubagents: single entry", () => {
  assertEquals(parseSubagents("Explore:a1"), [{ type: "Explore", id: "a1" }]);
});

Deno.test("parseSubagents: multiple entries", () => {
  assertEquals(parseSubagents("Explore:a1|Plan:b2|Explore:c3"), [
    { type: "Explore", id: "a1" },
    { type: "Plan", id: "b2" },
    { type: "Explore", id: "c3" },
  ]);
});

Deno.test("parseSubagents: malformed segment without colon → type only", () => {
  assertEquals(parseSubagents("bogus"), [{ type: "bogus", id: "" }]);
});

Deno.test("parseSubagents: trailing pipe filtered", () => {
  assertEquals(parseSubagents("A:1|"), [{ type: "A", id: "1" }]);
});

// --- renderSubagentTree ---

Deno.test("renderSubagentTree: empty → middle dot", () => {
  assertEquals(renderSubagentTree([]), "·");
});

Deno.test("renderSubagentTree: single entry → type name only", () => {
  assertEquals(
    renderSubagentTree([{ type: "Explore", id: "a1" }]),
    "Explore",
  );
});

Deno.test("renderSubagentTree: multiple types → comma-separated", () => {
  const result = renderSubagentTree([
    { type: "Explore", id: "a1" },
    { type: "Plan", id: "b2" },
    { type: "Researcher", id: "c3" },
  ]);
  assertEquals(result, "Explore, Plan, Researcher");
});

Deno.test("renderSubagentTree: same type aggregates with ×N", () => {
  const result = renderSubagentTree([
    { type: "Explore", id: "a1" },
    { type: "Explore", id: "b2" },
    { type: "Plan", id: "c3" },
  ]);
  assertEquals(result, "Explore ×2, Plan");
});

// --- basename ---

Deno.test("basename: typical path returns final segment", () => {
  assertEquals(basename("/a/b/file.ts"), "file.ts");
});

Deno.test("basename: trailing slash stripped", () => {
  assertEquals(basename("/a/b/c/"), "c");
});

Deno.test("basename: empty string returns empty", () => {
  assertEquals(basename(""), "");
});

Deno.test("basename: root slash returns root", () => {
  assertEquals(basename("/"), "/");
});

Deno.test("basename: no slash returns entire string", () => {
  assertEquals(basename("bare.txt"), "bare.txt");
});

// --- toolSegmentText ---

Deno.test("toolSegmentText: no tool → empty string", () => {
  assertEquals(toolSegmentText(mkRow()), "");
});

Deno.test("toolSegmentText: currentTool without subject → tool name only", () => {
  assertEquals(
    toolSegmentText(mkRow({ currentTool: "Bash" })),
    "Bash",
  );
});

Deno.test("toolSegmentText: currentTool with subject → `tool(subject)`", () => {
  assertEquals(
    toolSegmentText(
      mkRow({ currentTool: "Bash", currentToolSubject: "pnpm test" }),
    ),
    "Bash(pnpm test)",
  );
});

Deno.test("toolSegmentText: lastTool without subject → bare tool name", () => {
  assertEquals(
    toolSegmentText(mkRow({ lastTool: "Edit" })),
    "Edit",
  );
});

Deno.test("toolSegmentText: lastTool with subject → `tool(subject)`", () => {
  assertEquals(
    toolSegmentText(
      mkRow({ lastTool: "Grep", lastToolSubject: "foo.*bar" }),
    ),
    "Grep(foo.*bar)",
  );
});

Deno.test("toolSegmentText: lastTool with error (no subject) appends ` <mark> <error>`", () => {
  assertEquals(
    toolSegmentText(
      mkRow({ lastTool: "Bash", lastToolError: "Exit code 1" }),
    ),
    "Bash \u{F0156} Exit code 1",
  );
});

Deno.test("toolSegmentText: lastTool with subject + error → `tool(subject) <mark> error`", () => {
  assertEquals(
    toolSegmentText(
      mkRow({
        lastTool: "Bash",
        lastToolSubject: "pnpm test",
        lastToolError: "Exit code 1",
      }),
    ),
    "Bash(pnpm test) \u{F0156} Exit code 1",
  );
});

Deno.test("toolSegmentText: currentTool takes precedence over lastTool", () => {
  assertEquals(
    toolSegmentText(
      mkRow({
        currentTool: "Grep",
        currentToolSubject: "TODO",
        lastTool: "Bash",
        lastToolSubject: "pnpm test",
        lastToolError: "Exit code 1",
      }),
    ),
    "Grep(TODO)",
  );
});

Deno.test("toolSegmentText: Edit-family with empty lastToolSubject (delegates to file segment)", () => {
  // SUBJECT_EXTRACTORS returns "" for Edit/Write/MultiEdit, so lastToolSubject
  // is empty and the tool segment renders without the basename. The independent
  // `file` segment (populated from @pane_last_edit_file) shows the target path.
  assertEquals(
    toolSegmentText(
      mkRow({
        lastTool: "Edit",
        lastToolSubject: "",
        lastEditFile: "/x/y/picker.tsx",
      }),
    ),
    "Edit",
  );
});

Deno.test("formatRemaining: sub-minute renders <1m", () => {
  assertEquals(formatRemaining(1059, 1000), "<1m");
  assertEquals(formatRemaining(1001, 1000), "<1m");
});

Deno.test("formatRemaining: minutes below an hour", () => {
  assertEquals(formatRemaining(1000 + 12 * 60, 1000), "12m");
  assertEquals(formatRemaining(1000 + 60, 1000), "1m");
  assertEquals(formatRemaining(1000 + 3599, 1000), "59m");
});

Deno.test("formatRemaining: hours carry minutes", () => {
  assertEquals(formatRemaining(1000 + 3 * 3600 + 47 * 60, 1000), "3h47m");
  assertEquals(formatRemaining(1000 + 3600, 1000), "1h");
  assertEquals(formatRemaining(1000 + 86399, 1000), "23h59m");
});

Deno.test("formatRemaining: a past timestamp falls through to <1m", () => {
  // UsageFooter screens expired windows out before calling this, so the value
  // is never rendered — the case is pinned only so a future caller that skips
  // that screening fails loudly in review rather than silently here.
  assertEquals(formatRemaining(900, 1000), "<1m");
  assertEquals(formatRemaining(1000, 1000), "<1m");
});

Deno.test("formatRemaining: a day or more renders whole days", () => {
  assertEquals(formatRemaining(1000 + 86400, 1000), "1d");
  assertEquals(formatRemaining(1000 + 2 * 86400 + 5 * 3600, 1000), "2d");
});

// --- formatElapsed (days) / elapsedSource ---

Deno.test("formatElapsed: a day or more renders whole days", () => {
  assertEquals(formatElapsed(0, 86399), "23h");
  assertEquals(formatElapsed(0, 86400), "1d");
  assertEquals(formatElapsed(0, 86400 * 12 + 5), "12d");
});

Deno.test("formatElapsed: days cap at 99d so the 3-cell column never widens", () => {
  assertEquals(formatElapsed(0, 86400 * 99), "99d");
  assertEquals(formatElapsed(0, 86400 * 400), "99d");
});

Deno.test("elapsedSource: running counts from the prompt", () => {
  assertEquals(
    elapsedSource(
      mkRow({ status: "running", startedAtSec: 100, lastActivityAtSec: 200 }),
    ),
    100,
  );
});

Deno.test("elapsedSource: waiting / idle / error / unknown count from last activity", () => {
  for (const status of ["waiting", "idle", "error", ""] as const) {
    assertEquals(
      elapsedSource(
        mkRow({ status, startedAtSec: 100, lastActivityAtSec: 200 }),
      ),
      200,
      status,
    );
  }
});

Deno.test("elapsedSource: missing timestamp → null", () => {
  assertEquals(elapsedSource(mkRow({ status: "running" })), null);
  assertEquals(elapsedSource(mkRow({ status: "idle" })), null);
});
