import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildChildMap,
  type Category,
  classifyPane,
  descendants,
  findClaudeDescendants,
  isClaudeCommand,
  parseArgs,
  parsePsOutput,
  type ProcInfo,
} from "./picker-doctor.ts";
import type { PaneRow } from "./pane_row.ts";

// --- isClaudeCommand ---

Deno.test("isClaudeCommand: bare 'claude' binary", () => {
  assertEquals(isClaudeCommand("/Users/u/.nix-profile/bin/claude"), true);
});

Deno.test("isClaudeCommand: node claude-code package", () => {
  assertEquals(
    isClaudeCommand(
      "node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js",
    ),
    true,
  );
});

Deno.test("isClaudeCommand: underscore form also detected", () => {
  assertEquals(
    isClaudeCommand("/opt/tools/claude_code/run.sh"),
    true,
  );
});

Deno.test("isClaudeCommand: unrelated binary names rejected", () => {
  assertEquals(isClaudeCommand("zsh"), false);
  assertEquals(isClaudeCommand("/bin/bash -l"), false);
  assertEquals(isClaudeCommand("node server.js"), false);
});

Deno.test("isClaudeCommand: false positive guard — 'claude' as substring of unrelated word", () => {
  // "claudeish" is not "claude" as a token / path segment
  assertEquals(isClaudeCommand("/usr/bin/claudeish"), false);
  assertEquals(isClaudeCommand("claudeish --run"), false);
});

Deno.test("isClaudeCommand: argument containing 'claude' path triggers", () => {
  assertEquals(
    isClaudeCommand("sh -c 'exec /opt/claude/bin/run'"),
    true,
  );
});

// --- parsePsOutput ---

Deno.test("parsePsOutput: drops header, parses 3-column format", () => {
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

Deno.test("parsePsOutput: preserves whitespace in command column", () => {
  const raw = "  PID  PPID COMMAND\n 100 50 echo  hello   world\n";
  const out = parsePsOutput(raw);
  assertEquals(out[0].command, "echo  hello   world");
});

Deno.test("parsePsOutput: skips blank and malformed lines", () => {
  const raw = "\n  PID  PPID COMMAND\n\ngarbage line\n 42 1 real-cmd\n";
  const out = parsePsOutput(raw);
  assertEquals(out.length, 1);
  assertEquals(out[0].pid, 42);
});

// --- buildChildMap / descendants ---

function p(pid: number, ppid: number, command = ""): ProcInfo {
  return { pid, ppid, command };
}

Deno.test("buildChildMap: groups children by parent", () => {
  const procs = [p(1, 0), p(10, 1), p(11, 1), p(100, 10)];
  const map = buildChildMap(procs);
  assertEquals(map.get(0), [1]);
  assertEquals(map.get(1), [10, 11]);
  assertEquals(map.get(10), [100]);
  assertEquals(map.get(100), undefined);
});

Deno.test("descendants: BFS collects full subtree, excludes root", () => {
  const procs = [p(1, 0), p(10, 1), p(11, 1), p(100, 10), p(101, 10)];
  const map = buildChildMap(procs);
  const d = descendants(1, map);
  assertEquals([...d].sort((a, b) => a - b), [10, 11, 100, 101]);
  // root itself is NOT included
  assertEquals(d.has(1), false);
});

Deno.test("descendants: cycle-safe via visited set", () => {
  // fabricate an impossible cycle 1→2→1
  const procs = [p(1, 2), p(2, 1)];
  const map = buildChildMap(procs);
  const d = descendants(1, map);
  // should terminate; content: {2} (2 is descendant of 1 via 1→2)
  assertEquals(d.has(2), true);
});

// --- findClaudeDescendants ---

Deno.test("findClaudeDescendants: surfaces matching pids in subtree", () => {
  const procs = [
    p(100, 1, "zsh"),
    p(200, 100, "node /opt/claude/cli.js"),
    p(201, 100, "git status"),
    p(300, 200, "rg --json 'foo'"),
  ];
  const map = buildChildMap(procs);
  const hits = findClaudeDescendants(100, procs, map);
  assertEquals(hits, [200]);
});

Deno.test("findClaudeDescendants: empty when subtree has no claude", () => {
  const procs = [p(100, 1, "zsh"), p(200, 100, "vim")];
  const map = buildChildMap(procs);
  assertEquals(findClaudeDescendants(100, procs, map), []);
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
  };
}

Deno.test("classifyPane: agent=claude + descendant=true → OK", () => {
  assertEquals(classifyPane(mkRow("claude"), true), "OK" as Category);
});

Deno.test("classifyPane: agent=unset + descendant=true → SUSPECT_MISSING_FLAG (the invisible case)", () => {
  assertEquals(
    classifyPane(mkRow(""), true),
    "SUSPECT_MISSING_FLAG" as Category,
  );
  assertEquals(
    classifyPane(mkRow("shell"), true),
    "SUSPECT_MISSING_FLAG" as Category,
  );
});

Deno.test("classifyPane: agent=claude + descendant=false → STALE_FLAG", () => {
  assertEquals(
    classifyPane(mkRow("claude"), false),
    "STALE_FLAG" as Category,
  );
});

Deno.test("classifyPane: neither → NORMAL", () => {
  assertEquals(classifyPane(mkRow(""), false), "NORMAL" as Category);
  assertEquals(classifyPane(mkRow("shell"), false), "NORMAL" as Category);
});

// --- parseArgs ---

Deno.test("parseArgs: defaults", () => {
  assertEquals(parseArgs([]), {
    json: false,
    withLogs: false,
    logLines: 50,
  });
});

Deno.test("parseArgs: --json / --with-logs / --log-lines=", () => {
  assertEquals(parseArgs(["--json"]).json, true);
  assertEquals(parseArgs(["--with-logs"]).withLogs, true);
  assertEquals(parseArgs(["--log-lines=120"]).logLines, 120);
});

Deno.test("parseArgs: invalid --log-lines ignored (keeps default)", () => {
  assertEquals(parseArgs(["--log-lines=abc"]).logLines, 50);
  assertEquals(parseArgs(["--log-lines=-5"]).logLines, 50);
});
