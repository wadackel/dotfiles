#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=HOME --allow-net

// CLI analysis tool: aggregates permission request logs and suggests
// permissions.allow / bash-policy patterns.

import { parse as parseArgs } from "https://deno.land/std@0.224.0/flags/mod.ts";
import { parse as shellParse } from "npm:shell-quote@1";

// --- Constants ---

const HOME = Deno.env.get("HOME") ?? "";
const LOG_FILE = `${HOME}/.claude/logs/permission-requests.jsonl`;
const SETTINGS_PATH = `${HOME}/.claude/settings.json`;

const SUBCOMMAND_TOOLS = new Set([
  "git",
  "docker",
  "kubectl",
  "nix",
  "gh",
  "npm",
  "pnpm",
  "cargo",
  "brew",
]);

// --- Types ---

interface LogEntry {
  ts: string;
  sid: string;
  tool: string;
  input: Record<string, unknown>;
  cwd: string;
  project: string;
  permission_suggestions?: PermissionSuggestion[];
}

interface PermissionSuggestion {
  type: string;
  tool?: string;
  prefix?: string;
}

interface PatternInfo {
  pattern: string;
  count: number;
  lastSeen: string;
  projects: Set<string>;
  examples: string[];
  hasSuggestion: boolean;
  subPatterns: Set<string>;
  reason: string;
}

interface Settings {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
}

interface ReviewResult {
  period: { from: string; to: string; days: number };
  total: number;
  allowCandidates: PatternOutput[];
  allowedCommandsCandidates: AllowedCommandCandidate[];
  reviewItems: PatternOutput[];
  stats: {
    byTool: Record<string, number>;
    byProject: Record<string, number>;
  };
}

interface PatternOutput {
  pattern: string;
  count: number;
  lastSeen: string;
  projects: string[];
  examples: string[];
  subPatterns: string[];
  reason?: string;
}

interface AllowedCommandCandidate {
  command: string;
  count: number;
  example: string;
}

// --- Log Parsing ---

function readLogEntries(logFile: string, daysBack: number): LogEntry[] {
  let content: string;
  try {
    content = Deno.readTextFileSync(logFile);
  } catch {
    return [];
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString();

  return content
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((line) => {
      try {
        const entry = JSON.parse(line) as LogEntry;
        if (entry.ts >= cutoffStr) return [entry];
        return [];
      } catch {
        return [];
      }
    });
}

// --- Pattern Generalization (Bash) ---

type ShellToken = string | { op: string } | { comment: string };

const PATH_PATTERN = /^[~./]/;
const HEX_HASH_PATTERN = /^[0-9a-f]{7,}$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function generalizeBashCommand(command: string): string[] {
  let tokens: ShellToken[];
  try {
    tokens = shellParse(command) as ShellToken[];
  } catch {
    return [`Bash(${command.split(/\s+/)[0]} *)`];
  }

  // Extract first segment's string tokens (before any operator)
  const args: string[] = [];
  for (const token of tokens) {
    if (typeof token === "object") break;
    if (typeof token === "string") args.push(token);
  }
  if (args.length === 0) return [];

  // Skip env var assignments at the start
  let cmdIdx = 0;
  while (cmdIdx < args.length && /^[A-Z_][A-Z0-9_]*=/.test(args[cmdIdx])) {
    cmdIdx++;
  }
  if (cmdIdx >= args.length) return [];

  const cmdName = args[cmdIdx];
  const cmdArgs = args.slice(cmdIdx + 1);

  // Normalize arguments: replace paths, hashes, UUIDs with *
  const normalized = cmdArgs.map((arg) => {
    if (PATH_PATTERN.test(arg)) return "*";
    if (HEX_HASH_PATTERN.test(arg)) return "*";
    if (UUID_PATTERN.test(arg)) return "*";
    return arg;
  });

  const patterns: string[] = [];

  if (SUBCOMMAND_TOOLS.has(cmdName) && normalized.length > 0) {
    // Keep subcommand, wildcard the rest
    const sub = normalized[0] === "*" ? cmdArgs[0] : normalized[0];
    patterns.push(`Bash(${cmdName} ${sub} *)`);
  }

  // Progressive generalization: from most specific to least
  for (let i = normalized.length; i >= 1; i--) {
    const kept = normalized.slice(0, i);
    // If remaining args are all *, skip (redundant with shorter pattern)
    if (kept.every((a) => a === "*") && i > 1) continue;
    if (i < normalized.length) {
      patterns.push(`Bash(${cmdName} ${kept.join(" ")} *)`);
    } else {
      patterns.push(`Bash(${cmdName} ${kept.join(" ")})`);
    }
  }

  // Most general: command + *
  patterns.push(`Bash(${cmdName} *)`);

  // Deduplicate
  return [...new Set(patterns)];
}

// --- Pattern Generalization (Non-Bash) ---

function generalizeNonBashTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  if (toolName === "WebFetch") {
    const url = toolInput.url as string | undefined;
    if (url) {
      try {
        const domain = new URL(url).hostname;
        return `WebFetch(domain:${domain})`;
      } catch {
        return `WebFetch(*)`;
      }
    }
    return `WebFetch(*)`;
  }

  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    if (parts.length >= 2) {
      return `mcp__${parts[1]}`;
    }
  }

  if (toolName === "Edit" || toolName === "Write") {
    const filePath = toolInput.file_path as string | undefined;
    if (filePath) return `${toolName}(${filePath})`;
    return `${toolName}(**)`;
  }

  return toolName;
}

// --- Settings Loading ---

function loadSettings(): Settings {
  try {
    return JSON.parse(Deno.readTextFileSync(SETTINGS_PATH));
  } catch {
    return {};
  }
}

export function extractNonBashExample(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const filePath = input.file_path as string | undefined;
  if (filePath) return `${toolName}(${filePath})`;

  const url = input.url as string | undefined;
  if (url) return `${toolName}(${url})`;

  const keys = Object.keys(input);
  if (keys.length === 0) return toolName;

  const first = input[keys[0]];
  if (typeof first === "string") {
    const val = first.length > 80 ? first.slice(0, 80) + "..." : first;
    return `${toolName}(${keys[0]}=${val})`;
  }
  return `${toolName}(${keys.join(", ")})`;
}

export function isPatternCovered(pattern: string, allowList: string[]): boolean {
  for (const allowed of allowList) {
    if (allowed === pattern) return true;
    // Tool(**) covers bare Tool (e.g. "Read(**)" covers "Read")
    if (allowed.endsWith("(**)")) {
      const toolName = allowed.slice(0, -4);
      if (pattern === toolName || pattern.startsWith(toolName + "(")) return true;
    }
    // Suffix glob: "Bash(git *)" covers "Bash(git push *)"
    if (allowed.endsWith("*)")) {
      const prefix = allowed.slice(0, -2);
      if (pattern.startsWith(prefix)) return true;
    }
    // Wrapped glob: "Bash(*merge.ts*)" covers entries containing "merge.ts"
    if (allowed.startsWith("Bash(*") && allowed.endsWith("*)")) {
      const inner = allowed.slice(6, -2); // extract "merge.ts"
      if (pattern.startsWith("Bash(") && pattern.includes(inner)) return true;
    }
    // mcp__server covers mcp__server__*
    if (
      !allowed.includes("(") &&
      !allowed.includes("*") &&
      pattern.startsWith(allowed)
    ) {
      return true;
    }
  }
  return false;
}

function isPatternDenied(pattern: string, denyList: string[]): boolean {
  for (const denied of denyList) {
    if (denied === pattern) return true;
    if (denied.endsWith("*)")) {
      const prefix = denied.slice(0, -2);
      if (pattern.startsWith(prefix)) return true;
    }
  }
  return false;
}

export function diagnoseReason(
  command: string,
  patterns: string[],
  allowList: string[],
): string {
  // 1. Compound command check
  if (/[|;]|&&|\d*>&/.test(command)) return "compound_command";
  // 2. Same tool name pattern exists in allowList but doesn't cover this
  const cmdName = patterns[0]?.match(/^Bash\((\S+)/)?.[1];
  if (cmdName && allowList.some((a) => a.startsWith(`Bash(${cmdName} `))) {
    return "pattern_gap";
  }
  // 3. No matching pattern at all
  return "no_pattern";
}

// --- Aggregation ---

export function aggregatePatterns(
  entries: LogEntry[],
  settings: Settings,
  options: { maxExamples: number; maxExampleLen: number },
): {
  allowCandidates: PatternInfo[];
  reviewItems: PatternInfo[];
  allowedCommandsCandidates: AllowedCommandCandidate[];
  stats: { byTool: Record<string, number>; byProject: Record<string, number> };
} {
  const allowList = settings.permissions?.allow ?? [];
  const denyList = settings.permissions?.deny ?? [];
  const patternMap = new Map<string, PatternInfo>();
  const byTool: Record<string, number> = {};
  const byProject: Record<string, number> = {};

  // Track piped Bash commands for ALLOWED_COMMANDS analysis
  const pipedCommands = new Map<
    string,
    { count: number; example: string }
  >();

  for (const entry of entries) {
    byTool[entry.tool] = (byTool[entry.tool] ?? 0) + 1;
    byProject[entry.project] = (byProject[entry.project] ?? 0) + 1;

    let patterns: string[];
    let rawExample = "";

    if (entry.tool === "Bash") {
      const cmd = entry.input.command as string | undefined;
      if (!cmd) continue;
      rawExample = cmd.length > options.maxExampleLen
        ? cmd.slice(0, options.maxExampleLen) + "..."
        : cmd;
      patterns = generalizeBashCommand(cmd);

      // Check if this is a piped/compound command
      if (/[|;]|&&|\d*>&/.test(cmd)) {
        // Extract first command for ALLOWED_COMMANDS check
        try {
          const tokens = shellParse(cmd) as ShellToken[];
          for (const t of tokens) {
            if (typeof t === "string" && !/^[A-Z_][A-Z0-9_]*=/.test(t)) {
              const base = t.includes("/") ? t.split("/").pop()! : t;
              const existing = pipedCommands.get(base);
              pipedCommands.set(base, {
                count: (existing?.count ?? 0) + 1,
                example: rawExample,
              });
              break;
            }
          }
        } catch {
          // parse failure
        }
      }
    } else {
      const pattern = generalizeNonBashTool(entry.tool, entry.input);
      patterns = [pattern];
      rawExample = extractNonBashExample(entry.tool, entry.input);
    }

    const hasSuggestion =
      Array.isArray(entry.permission_suggestions) &&
      entry.permission_suggestions.length > 0;

    // Use the most general pattern for grouping
    const groupPattern = patterns[patterns.length - 1] ?? entry.tool;

    const info = patternMap.get(groupPattern) ?? {
      pattern: groupPattern,
      count: 0,
      lastSeen: "",
      projects: new Set<string>(),
      examples: [],
      hasSuggestion: false,
      subPatterns: new Set<string>(),
      reason: "no_pattern",
    };

    info.count++;
    if (entry.ts > info.lastSeen) info.lastSeen = entry.ts;
    info.projects.add(entry.project);
    if (hasSuggestion) info.hasSuggestion = true;
    if (
      rawExample &&
      info.examples.length < options.maxExamples &&
      !info.examples.includes(rawExample)
    ) {
      info.examples.push(rawExample);
    }
    // Accumulate all sub-patterns from this entry
    for (const p of patterns) info.subPatterns.add(p);
    // Diagnose reason for Bash entries
    if (entry.tool === "Bash") {
      const cmd = entry.input.command as string;
      const reason = diagnoseReason(cmd, patterns, allowList);
      // Prioritize: compound_command > pattern_gap > no_pattern
      if (
        reason === "compound_command" ||
        (reason === "pattern_gap" && info.reason === "no_pattern")
      ) {
        info.reason = reason;
      }
    }
    patternMap.set(groupPattern, info);
  }

  // Load ALLOWED_COMMANDS from approve-piped-commands.ts to detect missing entries
  const existingAllowed = loadAllowedCommands();
  const allowedCommandsCandidates: AllowedCommandCandidate[] = [];
  for (const [cmd, data] of pipedCommands) {
    if (!existingAllowed.has(cmd)) {
      allowedCommandsCandidates.push({
        command: cmd,
        count: data.count,
        example: data.example,
      });
    }
  }

  // Classify patterns
  const allowCandidates: PatternInfo[] = [];
  const reviewItems: PatternInfo[] = [];

  for (const info of patternMap.values()) {
    if (isPatternCovered(info.pattern, allowList)) continue;
    if (isPatternDenied(info.pattern, denyList)) continue;

    if (info.hasSuggestion || info.count >= 3) {
      allowCandidates.push(info);
    } else {
      reviewItems.push(info);
    }
  }

  allowCandidates.sort((a, b) => b.count - a.count);
  reviewItems.sort((a, b) => b.count - a.count);
  allowedCommandsCandidates.sort((a, b) => b.count - a.count);

  return { allowCandidates, reviewItems, allowedCommandsCandidates, stats: { byTool, byProject } };
}

// --- ALLOWED_COMMANDS Detection ---

function loadAllowedCommands(): Set<string> {
  const scriptDir = new URL(".", import.meta.url).pathname;
  const path = `${scriptDir}approve-piped-commands.ts`;
  try {
    const content = Deno.readTextFileSync(path);
    const match = content.match(
      /ALLOWED_COMMANDS\s*=\s*new\s+Set\(\[([^\]]+)\]/s,
    );
    if (!match) return new Set();
    const items = match[1].match(/"([^"]+)"/g);
    if (!items) return new Set();
    return new Set(items.map((s) => s.replace(/"/g, "")));
  } catch {
    return new Set();
  }
}

// --- Output Formatting ---

function toPatternOutput(info: PatternInfo): PatternOutput {
  return {
    pattern: info.pattern,
    count: info.count,
    lastSeen: info.lastSeen.slice(0, 10),
    projects: [...info.projects],
    examples: info.examples,
    subPatterns: [...info.subPatterns],
    ...(info.reason !== "no_pattern" ? { reason: info.reason } : {}),
  };
}

function formatText(result: ReviewResult, top: number): string {
  const lines: string[] = [];

  lines.push("# Permission Review Report");
  lines.push(
    `# Period: ${result.period.from} ~ ${result.period.to} (${result.period.days} days)`,
  );
  lines.push(`# Total: ${result.total} requests`);
  lines.push("");

  if (result.allowCandidates.length > 0) {
    lines.push(`## permissions.allow candidates (${result.allowCandidates.length} patterns)`);
    lines.push("");
    lines.push(
      "  Count  Pattern                                         Last Seen    Projects",
    );
    for (const item of result.allowCandidates.slice(0, top)) {
      const count = String(item.count).padStart(5);
      const pattern = item.pattern.padEnd(48);
      const projects = item.projects.join(", ");
      lines.push(`  ${count}  ${pattern}${item.lastSeen}   ${projects}`);
    }

    // Show examples for top patterns
    for (const item of result.allowCandidates.slice(0, 3)) {
      if (item.examples.length > 0) {
        lines.push("");
        lines.push(`  Examples for "${item.pattern}":`);
        for (const ex of item.examples) {
          lines.push(`    ${ex}`);
        }
      }
    }
    lines.push("");
  }

  if (result.allowedCommandsCandidates.length > 0) {
    lines.push("## approve-piped-commands.ts ALLOWED_COMMANDS candidates");
    lines.push("");
    for (const item of result.allowedCommandsCandidates) {
      lines.push(
        `  Missing: "${item.command}" (count: ${item.count}, e.g. "${item.example}")`,
      );
    }
    lines.push("");
  }

  if (result.reviewItems.length > 0) {
    lines.push(`## Needs review (${result.reviewItems.length} patterns)`);
    lines.push("");
    lines.push(
      "  Count  Pattern                                         Last Seen    Projects",
    );
    for (const item of result.reviewItems.slice(0, top)) {
      const count = String(item.count).padStart(5);
      const pattern = item.pattern.padEnd(48);
      const projects = item.projects.join(", ");
      lines.push(`  ${count}  ${pattern}${item.lastSeen}   ${projects}`);
    }
    lines.push("");
  }

  // Stats
  lines.push("## Stats");
  lines.push("");
  const toolEntries = Object.entries(result.stats.byTool)
    .sort((a, b) => b[1] - a[1]);
  const toolTotal = toolEntries.reduce((s, [, n]) => s + n, 0);
  const toolStr = toolEntries
    .map(([t, n]) => `${t} ${n} (${Math.round((n / toolTotal) * 100)}%)`)
    .join(", ");
  lines.push(`  Tool: ${toolStr}`);

  const projEntries = Object.entries(result.stats.byProject)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const projStr = projEntries.map(([p, n]) => `${p} ${n}`).join(", ");
  lines.push(`  Top projects: ${projStr}`);

  return lines.join("\n");
}

// --- Purge ---

export function purgeResolvedEntries(
  logFile: string,
  settings: Settings,
  allowListOverride?: string[],
): number {
  let content: string;
  try {
    content = Deno.readTextFileSync(logFile);
  } catch {
    return 0;
  }

  const allowList = allowListOverride ?? settings.permissions?.allow ?? [];
  const lines = content.split("\n").filter((l) => l.trim());
  const kept: string[] = [];
  let removed = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LogEntry;
      let patterns: string[];
      if (entry.tool === "Bash") {
        const cmd = entry.input.command as string | undefined;
        patterns = cmd ? generalizeBashCommand(cmd) : [];
      } else {
        patterns = [generalizeNonBashTool(entry.tool, entry.input)];
      }
      // Also check against the raw command for Bash(*script*) patterns
      const rawCmd = entry.tool === "Bash"
        ? (entry.input.command as string | undefined) ?? ""
        : "";
      const allPatterns = [...patterns];
      if (rawCmd) allPatterns.push(`Bash(${rawCmd})`);

      if (allPatterns.some((p) => isPatternCovered(p, allowList))) {
        removed++;
      } else {
        kept.push(line);
      }
    } catch {
      kept.push(line);
    }
  }

  if (removed > 0) {
    Deno.writeTextFileSync(logFile, kept.length > 0 ? kept.join("\n") + "\n" : "");
  }
  return removed;
}

// --- Main ---

if (import.meta.main) {
  const flags = parseArgs(Deno.args, {
    string: ["project", "tool", "format"],
    boolean: ["purge"],
    collect: ["purge-pattern"],
    default: { days: 30, top: 20, format: "text", purge: false },
  });

  const days = Number(flags.days) || 30;
  const top = Number(flags.top) || 20;
  const format = flags.format as string;
  const projectFilter = flags.project as string | undefined;
  const toolFilter = flags.tool as string | undefined;

  // Selective purge by specific patterns
  const purgePatterns = (flags["purge-pattern"] ?? []) as string[];
  if (purgePatterns.length > 0) {
    const settings = loadSettings();
    const removed = purgeResolvedEntries(LOG_FILE, settings, purgePatterns);
    console.log(
      `Purged ${removed} entries matching ${purgePatterns.length} patterns.`,
    );
    Deno.exit(0);
  }

  if (flags.purge) {
    const settings = loadSettings();
    const removed = purgeResolvedEntries(LOG_FILE, settings);
    console.log(`Purged ${removed} resolved entries from log.`);
    Deno.exit(0);
  }

  let entries = readLogEntries(LOG_FILE, days);

  if (entries.length === 0) {
    console.log("No permission requests logged yet.");
    Deno.exit(0);
  }

  if (projectFilter) {
    entries = entries.filter((e) => e.project === projectFilter);
  }
  if (toolFilter) {
    entries = entries.filter((e) => e.tool === toolFilter);
  }

  if (entries.length === 0) {
    console.log("No matching permission requests found.");
    Deno.exit(0);
  }

  const settings = loadSettings();
  const opts =
    format === "json"
      ? { maxExamples: 50, maxExampleLen: 2000 }
      : { maxExamples: 5, maxExampleLen: 200 };
  const { allowCandidates, reviewItems, allowedCommandsCandidates, stats } =
    aggregatePatterns(entries, settings, opts);

  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - days);

  const result: ReviewResult = {
    period: {
      from: from.toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
      days,
    },
    total: entries.length,
    allowCandidates: allowCandidates.map(toPatternOutput),
    allowedCommandsCandidates,
    reviewItems: reviewItems.map(toPatternOutput),
    stats,
  };

  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatText(result, top));
  }
}
