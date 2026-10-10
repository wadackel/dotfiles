import { test } from "bun:test";
import { assertArrayIncludes, assertEquals } from "@std/assert";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aggregatePatterns,
  diagnoseReason,
  extractNonBashExample,
  generalizeBashCommand,
  isActionableTool,
  isPatternCovered,
  purgeResolvedEntries,
} from "./permission-review.ts";

// --- generalizeBashCommand ---

test("generalizeBashCommand: simple command", () => {
  const patterns = generalizeBashCommand("ls -la");
  assertArrayIncludes(patterns, ["Bash(ls *)"]);
});

test("generalizeBashCommand: git subcommand preserved", () => {
  const patterns = generalizeBashCommand("git push origin feature-1");
  assertArrayIncludes(patterns, ["Bash(git push *)"]);
});

test("generalizeBashCommand: docker compose subcommand", () => {
  const patterns = generalizeBashCommand("docker compose up -d");
  assertArrayIncludes(patterns, ["Bash(docker compose *)"]);
});

test("generalizeBashCommand: path arguments replaced with *", () => {
  const patterns = generalizeBashCommand("cat ./src/main.ts");
  assertArrayIncludes(patterns, ["Bash(cat *)"]);
});

test("generalizeBashCommand: absolute path replaced", () => {
  const patterns = generalizeBashCommand("chmod +x /usr/local/bin/foo");
  assertArrayIncludes(patterns, ["Bash(chmod *)"]);
});

test("generalizeBashCommand: hex hash replaced", () => {
  const patterns = generalizeBashCommand("git show abc1234def");
  assertArrayIncludes(patterns, ["Bash(git show *)"]);
});

test("generalizeBashCommand: UUID replaced", () => {
  const patterns = generalizeBashCommand(
    "rm 550e8400-e29b-41d4-a716-446655440000",
  );
  assertArrayIncludes(patterns, ["Bash(rm *)"]);
});

test("generalizeBashCommand: env var prefix skipped", () => {
  const patterns = generalizeBashCommand("TMUX= tmux list-sessions");
  assertArrayIncludes(patterns, ["Bash(tmux *)"]);
});

test("generalizeBashCommand: nix subcommand", () => {
  const patterns = generalizeBashCommand("nix flake check --no-build");
  assertArrayIncludes(patterns, ["Bash(nix flake *)"]);
});

test("generalizeBashCommand: sudo darwin-rebuild", () => {
  const patterns = generalizeBashCommand(
    "sudo darwin-rebuild switch --flake .#private",
  );
  assertArrayIncludes(patterns, ["Bash(sudo *)"]);
});

test("generalizeBashCommand: home path replaced", () => {
  const patterns = generalizeBashCommand("cat ~/dotfiles/README.md");
  assertArrayIncludes(patterns, ["Bash(cat *)"]);
});

test("generalizeBashCommand: gh subcommand", () => {
  const patterns = generalizeBashCommand("gh pr create --title test");
  assertArrayIncludes(patterns, ["Bash(gh pr *)"]);
});

test("generalizeBashCommand: single command no args", () => {
  const patterns = generalizeBashCommand("whoami");
  assertArrayIncludes(patterns, ["Bash(whoami *)"]);
});

test("generalizeBashCommand: brew subcommand", () => {
  const patterns = generalizeBashCommand("brew install ripgrep");
  assertArrayIncludes(patterns, ["Bash(brew install *)"]);
});

test("generalizeBashCommand: pnpm subcommand", () => {
  const patterns = generalizeBashCommand("pnpm add -D typescript");
  assertArrayIncludes(patterns, ["Bash(pnpm add *)"]);
});

// --- extractNonBashExample ---

test("extractNonBashExample: Read with file_path", () => {
  const result = extractNonBashExample("Read", { file_path: "/src/main.ts" });
  assertEquals(result, "Read(/src/main.ts)");
});

test("extractNonBashExample: WebFetch with url", () => {
  const result = extractNonBashExample("WebFetch", {
    url: "https://example.com/api",
    prompt: "extract data",
  });
  assertEquals(result, "WebFetch(https://example.com/api)");
});

test("extractNonBashExample: empty input", () => {
  const result = extractNonBashExample("Glob", {});
  assertEquals(result, "Glob");
});

test("extractNonBashExample: string value truncated at 80 chars", () => {
  const longVal = "a".repeat(100);
  const result = extractNonBashExample("Grep", { pattern: longVal });
  assertEquals(result, `Grep(pattern=${"a".repeat(80)}...)`);
});

test("extractNonBashExample: non-string first value shows keys", () => {
  const result = extractNonBashExample("Edit", {
    changes: [{ line: 1 }],
    file_path: "/foo.ts",
  });
  // file_path is checked first, so it should match
  assertEquals(result, "Edit(/foo.ts)");
});

test("extractNonBashExample: object-only input shows key names", () => {
  const result = extractNonBashExample("SomeTool", {
    config: { nested: true },
  });
  assertEquals(result, "SomeTool(config)");
});

// --- isPatternCovered ---

test("isPatternCovered: exact match", () => {
  assertEquals(
    isPatternCovered("Bash(git status)", ["Bash(git status)"]),
    true,
  );
});

test("isPatternCovered: suffix glob", () => {
  assertEquals(
    isPatternCovered("Bash(git push origin main)", ["Bash(git push *)"]),
    true,
  );
});

test("isPatternCovered: wrapped glob Bash(*merge.ts*)", () => {
  assertEquals(
    isPatternCovered("Bash(merge.ts --check)", ["Bash(*merge.ts*)"]),
    true,
  );
});

test("isPatternCovered: wrapped glob with path", () => {
  assertEquals(
    isPatternCovered(
      "Bash(/Users/foo/.claude/scripts/merge.ts arg1)",
      ["Bash(*merge.ts*)"],
    ),
    true,
  );
});

test("isPatternCovered: wrapped glob no match", () => {
  assertEquals(
    isPatternCovered("Bash(git status)", ["Bash(*merge.ts*)"]),
    false,
  );
});

test("isPatternCovered: mcp prefix match", () => {
  assertEquals(
    isPatternCovered("mcp__codex__codex", ["mcp__codex"]),
    true,
  );
});

test("isPatternCovered: no match", () => {
  assertEquals(
    isPatternCovered("Bash(rm -rf /)", ["Bash(git *)"]),
    false,
  );
});

test("isPatternCovered: Tool(**) covers bare Tool name", () => {
  assertEquals(isPatternCovered("Read", ["Read(**)"]), true);
});

test("isPatternCovered: Tool(**) covers Tool(path)", () => {
  assertEquals(
    isPatternCovered("Read(/src/main.ts)", ["Read(**)"]),
    true,
  );
});

// Asymmetric: broad pattern covers specific, but not vice-versa
test("isPatternCovered: git * covers git commit *", () => {
  assertEquals(
    isPatternCovered("Bash(git commit *)", ["Bash(git *)"]),
    true,
  );
});

test("isPatternCovered: git commit * does NOT cover git *", () => {
  assertEquals(
    isPatternCovered("Bash(git *)", ["Bash(git commit *)"]),
    false,
  );
});

// --- diagnoseReason ---

test("diagnoseReason: compound command with pipe", () => {
  assertEquals(
    diagnoseReason("git status | head -5", ["Bash(git status *)"], [
      "Bash(git status *)",
    ]),
    "compound_command",
  );
});

test("diagnoseReason: compound command with &&", () => {
  assertEquals(
    diagnoseReason("git add . && git commit -m msg", ["Bash(git add *)"], [
      "Bash(git *)",
    ]),
    "compound_command",
  );
});

test("diagnoseReason: pattern gap — same tool registered but subcmd missing", () => {
  assertEquals(
    diagnoseReason("git merge feature", ["Bash(git merge *)"], [
      "Bash(git commit *)",
    ]),
    "pattern_gap",
  );
});

test("diagnoseReason: no pattern at all", () => {
  assertEquals(
    diagnoseReason("whoami", ["Bash(whoami *)"], []),
    "no_pattern",
  );
});

// --- aggregatePatterns ---

test("aggregatePatterns: JSON mode collects many examples", () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({
    ts: `2025-01-0${Math.min(i + 1, 9)}T00:00:00Z`,
    sid: "s1",
    tool: "Bash",
    input: { command: `git status --short-${i}` },
    cwd: "/tmp",
    project: "test",
  }));
  const settings = { permissions: { allow: [] } };
  const result = aggregatePatterns(entries, settings, {
    maxExamples: 50,
    maxExampleLen: 2000,
  });
  // All 10 unique examples should be collected
  const candidate = [...result.allowCandidates, ...result.reviewItems].find(
    (c) => c.pattern === "Bash(git *)",
  );
  assertEquals(candidate!.examples.length, 10);
});

test("aggregatePatterns: subPatterns accumulated as union", () => {
  const entries = [
    {
      ts: "2025-01-01T00:00:00Z",
      sid: "s1",
      tool: "Bash",
      input: { command: "git commit -m first" },
      cwd: "/tmp",
      project: "test",
    },
    {
      ts: "2025-01-02T00:00:00Z",
      sid: "s1",
      tool: "Bash",
      input: { command: "git push origin main" },
      cwd: "/tmp",
      project: "test",
    },
    {
      ts: "2025-01-03T00:00:00Z",
      sid: "s1",
      tool: "Bash",
      input: { command: "git status --short" },
      cwd: "/tmp",
      project: "test",
    },
  ];
  const settings = { permissions: { allow: [] } };
  const result = aggregatePatterns(entries, settings, {
    maxExamples: 50,
    maxExampleLen: 2000,
  });
  const candidate = [...result.allowCandidates, ...result.reviewItems].find(
    (c) => c.pattern === "Bash(git *)",
  );
  const subs = new Set(candidate!.subPatterns);
  // Should contain sub-patterns from all 3 commands
  assertEquals(subs.has("Bash(git commit *)"), true);
  assertEquals(subs.has("Bash(git push *)"), true);
  assertEquals(subs.has("Bash(git status *)"), true);
  assertEquals(subs.has("Bash(git *)"), true);
});

// --- purgeResolvedEntries ---

test("purgeResolvedEntries: allowListOverride purges matching entries only", () => {
  const tmpFile = join(tmpdir(), `${randomUUID()}.jsonl`);
  const lines = [
    JSON.stringify({
      ts: "2025-01-01T00:00:00Z",
      sid: "s1",
      tool: "Bash",
      input: { command: "git commit -m test" },
      cwd: "/tmp",
      project: "test",
    }),
    JSON.stringify({
      ts: "2025-01-02T00:00:00Z",
      sid: "s1",
      tool: "Bash",
      input: { command: "whoami" },
      cwd: "/tmp",
      project: "test",
    }),
    JSON.stringify({
      ts: "2025-01-03T00:00:00Z",
      sid: "s1",
      tool: "AskUserQuestion",
      input: {},
      cwd: "/tmp",
      project: "test",
    }),
  ];
  writeFileSync(tmpFile, lines.join("\n") + "\n");

  const settings = { permissions: { allow: [] } };
  const removed = purgeResolvedEntries(tmpFile, settings, [
    "Bash(git commit *)",
  ]);
  assertEquals(removed, 1);

  // Remaining entries
  const remaining = readFileSync(tmpFile, "utf8").trim().split("\n");
  assertEquals(remaining.length, 2);
  rmSync(tmpFile);
});

test("purgeResolvedEntries: empty allowListOverride purges nothing", () => {
  const tmpFile = join(tmpdir(), `${randomUUID()}.jsonl`);
  const lines = [
    JSON.stringify({
      ts: "2025-01-01T00:00:00Z",
      sid: "s1",
      tool: "Bash",
      input: { command: "git status" },
      cwd: "/tmp",
      project: "test",
    }),
  ];
  writeFileSync(tmpFile, lines.join("\n") + "\n");

  const settings = { permissions: { allow: [] } };
  const removed = purgeResolvedEntries(tmpFile, settings, []);
  assertEquals(removed, 0);
  rmSync(tmpFile);
});

// --- isActionableTool ---

test("isActionableTool: standard tools are actionable", () => {
  assertEquals(isActionableTool("Bash"), true);
  assertEquals(isActionableTool("Edit"), true);
  assertEquals(isActionableTool("Write"), true);
  assertEquals(isActionableTool("Read"), true);
  assertEquals(isActionableTool("Glob"), true);
  assertEquals(isActionableTool("Grep"), true);
  assertEquals(isActionableTool("WebFetch"), true);
  assertEquals(isActionableTool("WebSearch"), true);
});

test("isActionableTool: mcp__ prefix is actionable", () => {
  assertEquals(isActionableTool("mcp__codex__codex"), true);
  assertEquals(isActionableTool("mcp__playwright__navigate"), true);
});

test("isActionableTool: non-actionable tools", () => {
  assertEquals(isActionableTool("AskUserQuestion"), false);
  assertEquals(isActionableTool("ExitPlanMode"), false);
  assertEquals(isActionableTool("EnterPlanMode"), false);
  assertEquals(isActionableTool("Skill"), false);
});

// --- aggregatePatterns: event-based counting ---

test("aggregatePatterns: event-based counting separates requested and executed", () => {
  const entries = [
    {
      event: "request",
      ts: "2025-01-01T00:00:00Z",
      sid: "s1",
      tool: "Bash",
      input: { command: "man tmux" },
      cwd: "/tmp",
      project: "test",
    },
    {
      event: "executed",
      ts: "2025-01-01T00:01:00Z",
      sid: "s1",
      tool: "Bash",
      input: { command: "man tmux" },
      cwd: "/tmp",
      project: "test",
    },
    {
      event: "request",
      ts: "2025-01-02T00:00:00Z",
      sid: "s1",
      tool: "Bash",
      input: { command: "man git" },
      cwd: "/tmp",
      project: "test",
    },
  ];
  const settings = { permissions: { allow: [] } };
  const result = aggregatePatterns(entries, settings, {
    maxExamples: 50,
    maxExampleLen: 2000,
  });
  const all = [...result.allowCandidates, ...result.reviewItems];
  const manPattern = all.find((c) => c.pattern === "Bash(man *)");
  assertEquals(manPattern!.requested, 2);
  assertEquals(manPattern!.executed, 1);
});

test("aggregatePatterns: executed >= 3 becomes allowCandidate", () => {
  const entries = Array.from({ length: 3 }, (_, i) => ({
    event: "executed",
    ts: `2025-01-0${i + 1}T00:00:00Z`,
    sid: "s1",
    tool: "Bash",
    input: { command: "sudo darwin-rebuild switch" },
    cwd: "/tmp",
    project: "dotfiles",
  }));
  const settings = { permissions: { allow: [] } };
  const result = aggregatePatterns(entries, settings, {
    maxExamples: 50,
    maxExampleLen: 2000,
  });
  const candidate = result.allowCandidates.find(
    (c) => c.pattern === "Bash(sudo *)",
  );
  assertEquals(candidate !== undefined, true);
  assertEquals(candidate!.executed, 3);
});

test("aggregatePatterns: non-actionable tools excluded from candidates and stats", () => {
  const entries = [
    {
      event: "request",
      ts: "2025-01-01T00:00:00Z",
      sid: "s1",
      tool: "AskUserQuestion",
      input: { question: "Which option?" },
      cwd: "/tmp",
      project: "test",
    },
    {
      event: "request",
      ts: "2025-01-02T00:00:00Z",
      sid: "s1",
      tool: "Bash",
      input: { command: "whoami" },
      cwd: "/tmp",
      project: "test",
    },
  ];
  const settings = { permissions: { allow: [] } };
  const result = aggregatePatterns(entries, settings, {
    maxExamples: 50,
    maxExampleLen: 2000,
  });
  // AskUserQuestion must not appear in candidates
  const all = [...result.allowCandidates, ...result.reviewItems];
  assertEquals(all.every((c) => !c.pattern.includes("AskUserQuestion")), true);
  // AskUserQuestion must not appear in stats
  assertEquals(result.stats.byTool["AskUserQuestion"], undefined);
  // Bash still counted
  assertEquals(result.stats.byTool["Bash"], 1);
});

test("aggregatePatterns: backward compat — entry without event treated as request", () => {
  const entries = [
    {
      // No event field (legacy entry)
      ts: "2025-01-01T00:00:00Z",
      sid: "s1",
      tool: "Bash",
      input: { command: "git status" },
      cwd: "/tmp",
      project: "test",
    },
  ];
  const settings = { permissions: { allow: [] } };
  const result = aggregatePatterns(entries, settings, {
    maxExamples: 50,
    maxExampleLen: 2000,
  });
  const all = [...result.allowCandidates, ...result.reviewItems];
  const gitPattern = all.find((c) => c.pattern === "Bash(git *)");
  assertEquals(gitPattern!.requested, 1);
  assertEquals(gitPattern!.executed, 0);
});

// --- purgeResolvedEntries: bulk non-actionable filter ---

test("purgeResolvedEntries: bulk purge removes non-actionable entries", () => {
  const tmpFile = join(tmpdir(), `${randomUUID()}.jsonl`);
  const lines = [
    JSON.stringify({
      ts: "2025-01-01T00:00:00Z",
      sid: "s1",
      tool: "Bash",
      input: { command: "git status" },
      cwd: "/tmp",
      project: "test",
    }),
    JSON.stringify({
      ts: "2025-01-02T00:00:00Z",
      sid: "s1",
      tool: "AskUserQuestion",
      input: {},
      cwd: "/tmp",
      project: "test",
    }),
    JSON.stringify({
      ts: "2025-01-03T00:00:00Z",
      sid: "s1",
      tool: "ExitPlanMode",
      input: {},
      cwd: "/tmp",
      project: "test",
    }),
  ];
  writeFileSync(tmpFile, lines.join("\n") + "\n");

  const settings = { permissions: { allow: [] } };
  // Bulk purge (no allowListOverride) removes non-actionable entries
  const removed = purgeResolvedEntries(tmpFile, settings);
  assertEquals(removed, 2); // AskUserQuestion + ExitPlanMode

  const remaining = readFileSync(tmpFile, "utf8").trim().split("\n");
  assertEquals(remaining.length, 1);
  const kept = JSON.parse(remaining[0]);
  assertEquals(kept.tool, "Bash");
  rmSync(tmpFile);
});

test("purgeResolvedEntries: selective purge does NOT remove non-actionable entries", () => {
  const tmpFile = join(tmpdir(), `${randomUUID()}.jsonl`);
  const lines = [
    JSON.stringify({
      ts: "2025-01-01T00:00:00Z",
      sid: "s1",
      tool: "Bash",
      input: { command: "git commit -m test" },
      cwd: "/tmp",
      project: "test",
    }),
    JSON.stringify({
      ts: "2025-01-02T00:00:00Z",
      sid: "s1",
      tool: "AskUserQuestion",
      input: {},
      cwd: "/tmp",
      project: "test",
    }),
  ];
  writeFileSync(tmpFile, lines.join("\n") + "\n");

  const settings = { permissions: { allow: [] } };
  // Selective purge (with allowListOverride) only purges matched patterns
  const removed = purgeResolvedEntries(tmpFile, settings, [
    "Bash(git commit *)",
  ]);
  assertEquals(removed, 1); // only Bash entry

  const remaining = readFileSync(tmpFile, "utf8").trim().split("\n");
  assertEquals(remaining.length, 1);
  const kept = JSON.parse(remaining[0]);
  assertEquals(kept.tool, "AskUserQuestion"); // still present
  rmSync(tmpFile);
});
