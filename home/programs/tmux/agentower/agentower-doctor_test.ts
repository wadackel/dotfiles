import { test } from "bun:test";
import { assertEquals } from "@std/assert";
import {
  buildChildMap,
  type Category,
  classifyPane,
  descendants,
  detectAgentCommand,
  findAgentDescendants,
  parseArgs,
  parsePsOutput,
  type ProcInfo,
} from "./agentower-doctor.ts";
import type { PaneRow } from "./pane_row.ts";

// --- detectAgentCommand ---

test("detectAgentCommand: bare 'claude' binary", () => {
  assertEquals(
    detectAgentCommand("/Users/u/.nix-profile/bin/claude"),
    "claude",
  );
});

test("detectAgentCommand: node claude-code package", () => {
  assertEquals(
    detectAgentCommand(
      "node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js",
    ),
    "claude",
  );
});

test("detectAgentCommand: underscore form also detected", () => {
  assertEquals(
    detectAgentCommand("/opt/tools/claude_code/run.sh"),
    "claude",
  );
});

test("detectAgentCommand: codex binary and path detected", () => {
  assertEquals(detectAgentCommand("codex"), "codex");
  assertEquals(detectAgentCommand("/Users/u/.nix-profile/bin/codex"), "codex");
});

test("detectAgentCommand: unrelated binary names rejected", () => {
  assertEquals(detectAgentCommand("zsh"), null);
  assertEquals(detectAgentCommand("/bin/bash -l"), null);
  assertEquals(detectAgentCommand("node server.js"), null);
});

test("detectAgentCommand: false positive guard — substrings rejected", () => {
  // "claudeish" is not "claude" as a token / path segment
  assertEquals(detectAgentCommand("/usr/bin/claudeish"), null);
  assertEquals(detectAgentCommand("claudeish --run"), null);
  assertEquals(detectAgentCommand("/usr/bin/codexish"), null);
  assertEquals(detectAgentCommand("codexish --run"), null);
});

test("detectAgentCommand: argument containing 'claude' path triggers", () => {
  assertEquals(
    detectAgentCommand("sh -c 'exec /opt/claude/bin/run'"),
    "claude",
  );
});

// --- parsePsOutput ---

test("parsePsOutput: drops header, parses 3-column format", () => {
  const raw = "  PID  PPID COMMAND\n" +
    "    1     0 /sbin/launchd\n" +
    "  353     1 /usr/libexec/logd\n" +
    " 9182  8000 node /path/claude-code/cli.js --pick\n";
  const out = parsePsOutput(raw);
  assertEquals(out.length, 3);
  assertEquals(out[0], { pid: 1, ppid: 0, command: "/sbin/launchd" });
  assertEquals(out[2], {
    pid: 9182,
    ppid: 8000,
    command: "node /path/claude-code/cli.js --pick",
  });
});

test("parsePsOutput: preserves whitespace in command column", () => {
  const raw = "  PID  PPID COMMAND\n 100 50 echo  hello   world\n";
  const out = parsePsOutput(raw);
  assertEquals(out[0].command, "echo  hello   world");
});

test("parsePsOutput: skips blank and malformed lines", () => {
  const raw = "\n  PID  PPID COMMAND\n\ngarbage line\n 42 1 real-cmd\n";
  const out = parsePsOutput(raw);
  assertEquals(out.length, 1);
  assertEquals(out[0].pid, 42);
});

// --- buildChildMap / descendants ---

function p(pid: number, ppid: number, command = ""): ProcInfo {
  return { pid, ppid, command };
}

test("buildChildMap: groups children by parent", () => {
  const procs = [p(1, 0), p(10, 1), p(11, 1), p(100, 10)];
  const map = buildChildMap(procs);
  assertEquals(map.get(0), [1]);
  assertEquals(map.get(1), [10, 11]);
  assertEquals(map.get(10), [100]);
  assertEquals(map.get(100), undefined);
});

test("descendants: BFS collects full subtree, excludes root", () => {
  const procs = [p(1, 0), p(10, 1), p(11, 1), p(100, 10), p(101, 10)];
  const map = buildChildMap(procs);
  const d = descendants(1, map);
  assertEquals([...d].sort((a, b) => a - b), [10, 11, 100, 101]);
  // root itself is NOT included
  assertEquals(d.has(1), false);
});

test("descendants: cycle-safe via visited set", () => {
  // fabricate an impossible cycle 1→2→1
  const procs = [p(1, 2), p(2, 1)];
  const map = buildChildMap(procs);
  const d = descendants(1, map);
  // should terminate; content: {2} (2 is descendant of 1 via 1→2)
  assertEquals(d.has(2), true);
});

// --- findAgentDescendants ---

test("findAgentDescendants: surfaces matching pids in subtree", () => {
  const procs = [
    p(100, 1, "zsh"),
    p(200, 100, "node /opt/claude/cli.js"),
    p(201, 100, "git status"),
    p(202, 100, "/nix/store/bin/codex"),
    p(300, 200, "rg --json 'foo'"),
  ];
  const map = buildChildMap(procs);
  const hits = findAgentDescendants(100, procs, map);
  assertEquals(hits, [
    { pid: 200, agent: "claude" },
    { pid: 202, agent: "codex" },
  ]);
});

test("findAgentDescendants: empty when subtree has no agent", () => {
  const procs = [p(100, 1, "zsh"), p(200, 100, "vim")];
  const map = buildChildMap(procs);
  assertEquals(findAgentDescendants(100, procs, map), []);
});

// --- classifyPane ---

function mkRow(agent: string): PaneRow {
  return {
    paneId: "%1",
    target: "s:1.0",
    currentCommand: "zsh",
    currentPath: "/",
    agent,
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
  };
}

test("classifyPane: agent=claude + descendant=claude → OK", () => {
  assertEquals(classifyPane(mkRow("claude"), "claude"), "OK" as Category);
});

test("classifyPane: agent=codex + descendant=codex → OK", () => {
  assertEquals(classifyPane(mkRow("codex"), "codex"), "OK" as Category);
});

test("classifyPane: agent mismatch → SUSPECT_MISSING_FLAG", () => {
  assertEquals(
    classifyPane(mkRow("claude"), "codex"),
    "SUSPECT_MISSING_FLAG" as Category,
  );
});

test("classifyPane: agent=unset + descendant detected → SUSPECT_MISSING_FLAG", () => {
  assertEquals(
    classifyPane(mkRow(""), "claude"),
    "SUSPECT_MISSING_FLAG" as Category,
  );
  assertEquals(
    classifyPane(mkRow("shell"), "codex"),
    "SUSPECT_MISSING_FLAG" as Category,
  );
});

test("classifyPane: flagged agent + no descendant → STALE_FLAG", () => {
  assertEquals(
    classifyPane(mkRow("claude"), null),
    "STALE_FLAG" as Category,
  );
  assertEquals(
    classifyPane(mkRow("codex"), null),
    "STALE_FLAG" as Category,
  );
});

test("classifyPane: neither → NORMAL", () => {
  assertEquals(classifyPane(mkRow(""), null), "NORMAL" as Category);
  assertEquals(classifyPane(mkRow("shell"), null), "NORMAL" as Category);
});

// --- parseArgs ---

test("parseArgs: defaults", () => {
  assertEquals(parseArgs([]), {
    json: false,
    withLogs: false,
    logLines: 50,
  });
});

test("parseArgs: --json / --with-logs / --log-lines=", () => {
  assertEquals(parseArgs(["--json"]).json, true);
  assertEquals(parseArgs(["--with-logs"]).withLogs, true);
  assertEquals(parseArgs(["--log-lines=120"]).logLines, 120);
});

test("parseArgs: invalid --log-lines ignored (keeps default)", () => {
  assertEquals(parseArgs(["--log-lines=abc"]).logLines, 50);
  assertEquals(parseArgs(["--log-lines=-5"]).logLines, 50);
});
