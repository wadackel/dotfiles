#!/usr/bin/env -S deno run --allow-read --allow-env=HOME

// PermissionRequest hook for Bash: auto-approve compound commands
// where all individual commands are in the allowed set.
// Derives the allowed set dynamically from permissions.allow in settings.json files.

import { getSegments } from "./shell-utils.ts";

/** Compound operator (|, &&, ||, ;) or redirect (2>&1, >/dev/null, etc.) check */
export function hasShellSyntax(command: string): boolean {
  return /[|;]|&&|\d*>&\d+|\d*>[^ ]*|\d*<[^ ]*/.test(command);
}

/** Extract the command name from a single Bash(...) permission pattern. Returns null if not applicable. */
export function extractCommandName(pattern: string): string | null {
  const m = pattern.match(/^Bash\((.+)\)$/);
  if (!m) return null;

  let content = m[1];

  // Handle colon separator format from settings.local.json (e.g. "rg:*" -> "rg", "nix fmt:*" -> "nix fmt")
  const colonIdx = content.indexOf(":");
  if (colonIdx !== -1) {
    content = content.slice(0, colonIdx);
  }

  const tokens = content.split(/\s+/);
  for (const token of tokens) {
    // Skip env var assignments (FOO=bar, TMUX=, etc.)
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    // Strip leading/trailing wildcards
    const cleaned = token.replace(/^\*+/, "").replace(/\*+$/, "");
    // Skip if empty after stripping (pure wildcards like "*" or "**")
    if (cleaned === "") continue;
    // Skip system paths (//...)
    if (cleaned.startsWith("//")) return null;
    // Skip flags
    if (cleaned.startsWith("-")) continue;
    // Skip redirect operators
    if (/^[><#!]/.test(cleaned)) continue;
    // If contains /, take basename
    const name = cleaned.includes("/") ? (cleaned.split("/").pop() ?? "") : cleaned;
    if (name === "") continue;
    return name;
  }
  return null;
}

interface Settings {
  permissions?: { allow?: string[] };
}

/** Load permissions.allow from multiple settings files, extract allowed command names. */
export async function loadAllowedCommands(
  paths: string[],
): Promise<Set<string>> {
  const result = new Set<string>();
  for (const path of paths) {
    try {
      const text = await Deno.readTextFile(path);
      const json: Settings = JSON.parse(text);
      for (const pattern of json?.permissions?.allow ?? []) {
        const cmd = extractCommandName(pattern);
        if (cmd) result.add(cmd);
      }
    } catch {
      // File not found or parse error -- skip
    }
  }
  return result;
}

/** Extract command names from each segment of a compound shell command. */
export async function extractCommands(command: string): Promise<string[]> {
  const segments = await getSegments(command);
  return segments
    .map((seg) => seg.split(/\s+/)[0])
    .filter((cmd) => cmd.length > 0);
}

/** Determine if all commands in a compound command are in the allowed set. */
export async function shouldApprove(
  command: string,
  allowed: Set<string>,
): Promise<boolean> {
  if (!hasShellSyntax(command)) return false;
  const cmds = await extractCommands(command);
  if (cmds.length === 0) return false;
  return cmds.every((cmd) => {
    if (allowed.has(cmd)) return true;
    const base = cmd.includes("/") ? (cmd.split("/").pop() ?? "") : cmd;
    return allowed.has(base);
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
  const allowed = await loadAllowedCommands(paths);

  if (!(await shouldApprove(input.tool_input.command, allowed))) Deno.exit(0);

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    }),
  );
}
