import { assertEquals } from "jsr:@std/assert@1";
import {
  basename,
  cwdBranchParts,
  formatElapsed,
  parseSubagents,
  renderSubagentTree,
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
  assertEquals(statusIcon("error"), "✖");
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

// --- cwdBranchParts ---

Deno.test("cwdBranchParts: cwd + branch → both fields populated", () => {
  assertEquals(
    cwdBranchParts("/Users/wadackel/dotfiles", "main"),
    { repo: "dotfiles", branch: "main" },
  );
});

Deno.test("cwdBranchParts: cwd only → branch empty", () => {
  assertEquals(
    cwdBranchParts("/Users/wadackel/dotfiles", ""),
    { repo: "dotfiles", branch: "" },
  );
});

Deno.test("cwdBranchParts: branch only → repo empty", () => {
  assertEquals(cwdBranchParts("", "main"), { repo: "", branch: "main" });
});

Deno.test("cwdBranchParts: both empty → middle dot in repo, branch empty", () => {
  assertEquals(cwdBranchParts("", ""), { repo: "·", branch: "" });
});

Deno.test("cwdBranchParts: root path basename is /", () => {
  assertEquals(cwdBranchParts("/", "main"), { repo: "/", branch: "main" });
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

Deno.test("toolSegmentText: lastTool with error (no subject) appends ` ✖ <error>`", () => {
  assertEquals(
    toolSegmentText(
      mkRow({ lastTool: "Bash", lastToolError: "Exit code 1" }),
    ),
    "Bash ✖ Exit code 1",
  );
});

Deno.test("toolSegmentText: lastTool with subject + error → `tool(subject) ✖ error`", () => {
  assertEquals(
    toolSegmentText(
      mkRow({
        lastTool: "Bash",
        lastToolSubject: "pnpm test",
        lastToolError: "Exit code 1",
      }),
    ),
    "Bash(pnpm test) ✖ Exit code 1",
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
