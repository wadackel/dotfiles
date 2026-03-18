#!/usr/bin/env -S deno run --allow-read --allow-env=HOME

// PermissionRequest hook for Bash: auto-approve compound commands
// where all individual commands match the allowed glob patterns.
// Derives the allowed patterns dynamically from permissions.allow in settings.json files.

import { globToRegex, parseCommand } from "./shell-utils.ts";

/** Extract a normalized glob pattern from a single Bash(...) permission pattern. Returns null if not applicable. */
export function extractAllowedPattern(pattern: string): string | null {
  const m = pattern.match(/^Bash\((.+)\)$/);
  if (!m) return null;

  let content = m[1];

  // Handle colon separator format from settings.local.json (e.g. "rg:*" -> "rg *", "nix fmt:*" -> "nix fmt *")
  const colonIdx = content.indexOf(":");
  if (colonIdx !== -1) {
    content = content.slice(0, colonIdx) + " " + content.slice(colonIdx + 1);
  }

  // Strip leading env var assignments (FOO=bar, TMUX=, etc.)
  const tokens = content.split(/\s+/);
  let cmdStart = 0;
  while (
    cmdStart < tokens.length &&
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[cmdStart])
  ) {
    cmdStart++;
  }
  if (cmdStart >= tokens.length) return null;

  const cmdTokens = tokens.slice(cmdStart);
  const firstToken = cmdTokens[0];
  const cleaned = firstToken.replace(/^\*+/, "").replace(/\*+$/, "");

  // Skip if first meaningful token is empty (pure wildcards like "* --help *")
  // or a flag (generic patterns like "* -v")
  if (cleaned === "" || cleaned.startsWith("-")) return null;
  // Skip system paths (//...)
  if (cleaned.startsWith("//")) return null;
  // Skip redirect operators
  if (/^[><#!]/.test(cleaned)) return null;

  return cmdTokens.join(" ");
}

/** Check if a command segment matches an allowed glob pattern. */
export function matchesAllowedPattern(
  segment: string,
  pattern: string,
): boolean {
  if (globToRegex(pattern).test(segment)) return true;
  // "cmd *" should also match bare "cmd" (no args)
  if (pattern.endsWith(" *") && segment === pattern.slice(0, -2)) return true;
  return false;
}

interface Settings {
  permissions?: { allow?: string[] };
}

/** Load permissions.allow from multiple settings files, extract allowed glob patterns. */
export async function loadAllowedPatterns(
  paths: string[],
): Promise<string[]> {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    try {
      const text = await Deno.readTextFile(path);
      const json: Settings = JSON.parse(text);
      for (const pattern of json?.permissions?.allow ?? []) {
        const p = extractAllowedPattern(pattern);
        if (p && !seen.has(p)) {
          seen.add(p);
          result.push(p);
        }
      }
    } catch {
      // File not found or parse error -- skip
    }
  }
  return result;
}

/** Extract command names from each segment of a compound shell command. */
export async function extractCommands(command: string): Promise<string[]> {
  const { segments } = await parseCommand(command);
  return segments
    .map((seg) => seg.split(/\s+/)[0])
    .filter((cmd) => cmd.length > 0);
}

/** Determine if all commands in a compound command match the allowed patterns. */
export async function shouldApprove(
  command: string,
  patterns: string[],
): Promise<boolean> {
  const { segments } = await parseCommand(command);
  if (segments.length === 0) return false;
  return segments.every((seg) => {
    if (patterns.some((p) => matchesAllowedPattern(seg, p))) return true;
    // Basename fallback: if segment starts with a path, try with basename
    const firstWord = seg.split(/\s+/)[0];
    if (firstWord.includes("/")) {
      const base = firstWord.split("/").pop() ?? "";
      if (base) {
        const baseSeg = base + seg.slice(firstWord.length);
        return patterns.some((p) => matchesAllowedPattern(baseSeg, p));
      }
    }
    return false;
  });
}

// --- Entry point ---

if (import.meta.main) {
  interface HookInput {
    tool_name: string;
    tool_input: { command: string };
    cwd?: string;
  }

  const input: HookInput = JSON.parse(
    await new Response(Deno.stdin.readable).text(),
  );

  if (input.tool_name !== "Bash") Deno.exit(0);

  const cwd = input.cwd ?? Deno.cwd();
  const home = Deno.env.get("HOME") ?? "";
  const paths = [
    `${home}/.claude/settings.json`,
    `${cwd}/.claude/settings.json`,
    `${cwd}/.claude/settings.local.json`,
  ];
  const patterns = await loadAllowedPatterns(paths);

  if (!(await shouldApprove(input.tool_input.command, patterns))) Deno.exit(0);

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    }),
  );
}
