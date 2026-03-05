// Shared shell command parsing utilities.
// Used by bash-policy.ts and approve-piped-commands.ts.

import { parse as parseBash } from "jsr:@ein/bash-parser@0.18";

/** Convert glob pattern to anchored regex. * matches any characters including spaces and newlines. */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escaped.replace(/\*/g, "[\\s\\S]*").replace(/\?/g, "[\\s\\S]") + "$");
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

/** Regex-based compound detection fallback (used when AST parser fails). */
function hasShellSyntaxFallback(command: string): boolean {
  return /[|;]|&&|\d*>&\d+|\d*>[^ ]*|\d*<[^ ]*|\$\(/.test(command);
}

/** Check if a Command node has any Redirect suffix. */
function hasRedirect(cmd: any): boolean {
  return (cmd.suffix ?? []).some((s: any) => s.type === "Redirect");
}

/** Check if a Command node has CommandExpansion in any word (name or suffix). */
function hasCommandExpansion(cmd: any): boolean {
  const words = [cmd.name, ...(cmd.suffix ?? [])].filter(
    (w: any) => w?.type === "Word",
  );
  return words.some((w: any) =>
    (w.expansion ?? []).some((e: any) => e.type === "CommandExpansion")
  );
}

/** Check if an AST node represents compound shell syntax (pipes, redirects, logical ops, etc.). */
function isCompound(node: any): boolean {
  switch (node.type) {
    case "Script":
    case "CompoundList":
      return node.commands.length > 1 || node.commands.some(isCompound);
    case "Pipeline":
    case "LogicalExpression":
    case "For":
    case "While":
    case "Until":
    case "If":
    case "Case":
    case "Function":
    case "Subshell":
      return true;
    case "Command":
      return hasRedirect(node) || hasCommandExpansion(node);
    default:
      return false;
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

/** Structured result of parsing a shell command: extracted segments and compound detection. */
export interface ParsedCommand {
  segments: string[];
  isCompound: boolean;
}

/**
 * Parse a shell command into segments and compound detection in a single AST parse.
 * Falls back to regex-based detection on parse errors or empty AST result.
 */
export async function parseCommand(command: string): Promise<ParsedCommand> {
  try {
    const preprocessed = stripHeredocs(command);
    const ast = await parseBash(preprocessed);
    const segments = extractCommands(ast);
    if (segments.length > 0) {
      return { segments, isCompound: isCompound(ast) };
    }
    // AST parsed but returned no commands (e.g. empty string): fall back
    return {
      segments: getSegmentsFallback(command),
      isCompound: hasShellSyntaxFallback(command),
    };
  } catch {
    // Parser failure (e.g. process substitution <()): fall back to regex
    // Note: fallback inherits the original regex's false-positive limitations
    // (quoted operators may be misdetected), but parser failure is rare.
    return {
      segments: getSegmentsFallback(command),
      isCompound: hasShellSyntaxFallback(command),
    };
  }
}

/**
 * Split a shell command into individual command segments using a bash AST parser.
 * Falls back to regex-based splitting on parse errors.
 */
export async function getSegments(command: string): Promise<string[]> {
  return (await parseCommand(command)).segments;
}
