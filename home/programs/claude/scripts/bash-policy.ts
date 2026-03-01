#!/usr/bin/env -S deno run --allow-read

// PreToolUse hook: declarative bash command guard.
// Reads rules from YAML config files (global + project-level) and blocks
// commands where any segment matches a defined glob pattern.
//
// Config files: bash-policy.yaml
//   - Global: same directory as this script (~/.claude/scripts/bash-policy.yaml)
//   - Project: .claude/bash-policy.yaml (searched upward from cwd)
//
// YAML format:
//   rules:
//     - pattern: "git -C *"
//       message: "Use cd && git instead"

import { parse } from "jsr:@std/yaml";
import { dirname, join } from "jsr:@std/path";
import { parse as parseBash } from "jsr:@ein/bash-parser@0.18";

export interface Rule {
  pattern: string;
  message: string;
  exclude?: string[];
}

interface Config {
  rules?: Rule[];
}

interface HookInput {
  tool_name: string;
  tool_input: { command: string };
  cwd?: string;
}

/** Convert glob pattern to anchored regex. * matches any characters including spaces. */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
}

/**
 * Strip heredoc bodies from a command string before parsing.
 * The AST parser does not handle heredocs correctly (treats body lines as commands).
 * Preserves commands on the same line as the heredoc operator (e.g. `cat <<EOF && cmd`).
 * Handles single-quoted, double-quoted, and unquoted delimiters.
 * Supports multiple heredocs by iterating until no more matches.
 */
export function stripHeredocs(command: string): string {
  const re = /(<<-?\s*["']?)(\w+)(["']?[^\n]*)\n[\s\S]*?\n\s*\2\b/g;
  let result = command;
  let prev: string;
  do {
    prev = result;
    result = result.replace(re, "$1HEREDOC$3");
  } while (result !== prev);
  return result;
}

/** Extract commands from CommandExpansion nodes inside Word expansions. */
function extractFromExpansions(words: any[]): string[] {
  const results: string[] = [];
  for (const w of words) {
    for (const exp of w.expansion ?? []) {
      if (exp.type === "CommandExpansion" && exp.commandAST) {
        results.push(...extractCommands(exp.commandAST));
      }
    }
  }
  return results;
}

/** Convert a Command AST node back to a string (name + word suffixes). */
function commandToString(cmd: any): string {
  if (!cmd.name) return "";
  const parts = [cmd.name.text];
  for (const s of cmd.suffix ?? []) {
    if (s.type === "Word") parts.push(s.text);
  }
  return parts.join(" ");
}

/** Recursively extract command strings from a bash AST node. */
function extractCommands(node: any): string[] {
  switch (node.type) {
    case "Script":
    case "CompoundList":
      return node.commands.flatMap(extractCommands);
    case "Command": {
      const words = [node.name, ...(node.suffix ?? [])].filter(
        (w: any) => w?.type === "Word",
      );
      const expanded = extractFromExpansions(words);
      const str = commandToString(node);
      return [...(str ? [str] : []), ...expanded];
    }
    case "LogicalExpression":
      return [...extractCommands(node.left), ...extractCommands(node.right)];
    case "Pipeline":
      return node.commands.flatMap(extractCommands);
    case "For":
      return extractCommands(node.do);
    case "While":
    case "Until":
      return [...extractCommands(node.clause), ...extractCommands(node.do)];
    case "If":
      return [
        ...extractCommands(node.clause),
        ...extractCommands(node.then),
        ...(node.else ? extractCommands(node.else) : []),
      ];
    case "Case":
      return node.cases.flatMap((c: any) =>
        c.body ? extractCommands(c.body) : [],
      );
    case "Function":
      return extractCommands(node.body);
    case "Subshell":
      return extractCommands(node.list);
    default:
      return [];
  }
}

/**
 * Split a shell command into individual command segments by operators (&&, ||, |, ;).
 * Strips redirections and env var prefixes from each segment.
 * Regex-based fallback for when the AST parser fails.
 */
export function getSegmentsFallback(command: string): string[] {
  const normalized = command
    .replace(/\d*>&\d+/g, "") // 2>&1 etc.
    .replace(/\d*>\s*[^\s]+/g, "") // >/dev/null, > /dev/null, 2>/dev/null etc.
    .replace(/\d*<\s*[^\s]+/g, ""); // <input.txt, < input.txt etc.

  const SHELL_KEYWORDS = new Set([
    "do", "done", "then", "fi", "else", "elif", "esac", "in",
    "for", "while", "until", "select", "case", "if",
  ]);

  return normalized
    .replace(/[()]/g, "")
    .split(/\s*(?:\|\|?|&&|;)\s*/)
    .map((seg) => {
      // Strip leading env var assignments (KEY=value ...) and shell keywords
      const words = seg.trim().split(/\s+/);
      const idx = words.findIndex(
        (w) => !/^[A-Z_][A-Z0-9_]*=/.test(w) && !SHELL_KEYWORDS.has(w),
      );
      return idx >= 0 ? words.slice(idx).join(" ") : "";
    })
    .filter((s) => s.length > 0);
}

/**
 * Split a shell command into individual command segments using a bash AST parser.
 * Falls back to regex-based splitting on parse errors.
 */
export async function getSegments(command: string): Promise<string[]> {
  try {
    const preprocessed = stripHeredocs(command);
    const ast = await parseBash(preprocessed);
    const commands = extractCommands(ast);
    return commands.length > 0 ? commands : getSegmentsFallback(command);
  } catch {
    return getSegmentsFallback(command);
  }
}

/** Load and parse YAML config. Returns empty array on missing file or parse error. */
export async function loadRules(path: string): Promise<Rule[]> {
  try {
    const content = await Deno.readTextFile(path);
    const config = parse(content) as Config;
    return config?.rules ?? [];
  } catch {
    return [];
  }
}

/** Walk up from cwd to find .claude/bash-policy.yaml */
export async function findProjectConfig(cwd: string): Promise<string | null> {
  let dir = cwd;
  while (true) {
    const candidate = join(dir, ".claude", "bash-policy.yaml");
    try {
      await Deno.stat(candidate);
      return candidate;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

// --- Entry point ---

if (import.meta.main) {
  const input: HookInput = JSON.parse(
    await new Response(Deno.stdin.readable).text(),
  );

  if (input.tool_name !== "Bash") Deno.exit(0);

  const command = input.tool_input.command;
  const cwd = input.cwd ?? Deno.cwd();

  // Load global config (co-located with this script)
  const scriptDir = new URL(".", import.meta.url).pathname;
  const globalRules = await loadRules(join(scriptDir, "bash-policy.yaml"));

  // Load project config (walk up from cwd)
  const projectConfigPath = await findProjectConfig(cwd);
  const projectRules = projectConfigPath
    ? await loadRules(projectConfigPath)
    : [];

  // Project rules checked first, then global
  const rules = [...projectRules, ...globalRules];
  if (rules.length === 0) Deno.exit(0);

  const segments = await getSegments(command);
  if (segments.length === 0) Deno.exit(0);

  for (const rule of rules) {
    const regex = globToRegex(rule.pattern);
    const excludeRegexes = (rule.exclude ?? []).map(globToRegex);
    for (const segment of segments) {
      if (regex.test(segment)) {
        if (excludeRegexes.some((er) => er.test(segment))) continue;
        console.error(
          [
            `[bash-policy] Pattern matched: "${rule.pattern}"`,
            rule.message,
            `Blocked: ${command}`,
          ].join("\n"),
        );
        Deno.exit(2);
      }
    }
  }
}
