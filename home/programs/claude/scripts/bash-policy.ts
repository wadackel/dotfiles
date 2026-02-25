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
 * Split a shell command into individual command segments by operators (&&, ||, |, ;).
 * Strips redirections and env var prefixes from each segment.
 *
 * Known limitation: operators inside quoted strings (e.g. `git commit -m "fix && update"`)
 * may cause incorrect splits. This does not produce false positives for our target patterns
 * (git -C *, npx *, etc.) since they always appear at the start of a command.
 */
export function getSegments(command: string): string[] {
  const normalized = command
    .replace(/\d*>&\d+/g, "") // 2>&1 etc.
    .replace(/\d*>\s*[^\s]+/g, "") // >/dev/null, > /dev/null, 2>/dev/null etc.
    .replace(/\d*<\s*[^\s]+/g, ""); // <input.txt, < input.txt etc.

  return normalized
    .replace(/[()]/g, "")
    .split(/\s*(?:\|\|?|&&|;)\s*/)
    .map((seg) => {
      // Strip leading env var assignments (KEY=value ...)
      const words = seg.trim().split(/\s+/);
      const idx = words.findIndex((w) => !/^[A-Z_][A-Z0-9_]*=/.test(w));
      return idx >= 0 ? words.slice(idx).join(" ") : "";
    })
    .filter((s) => s.length > 0);
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

  const segments = getSegments(command);
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
