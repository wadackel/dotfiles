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
import { getSegments, globToRegex } from "./shell-utils.ts";

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

/**
 * Pre-segmentation guard: AST-based segmentation drops shell redirect
 * targets (`> file`, `>> file`), so per-rule glob matching on segments cannot
 * see them. For the gate's own state directory, any reference to
 * `.claude/plans/` in the raw command — argument or redirect target — is
 * forbidden. This closes the Bash-side attack surface (touch / cp / mv / tee
 * / `>` redirect / ln -s) on the gate's own marker files.
 */
export function rawCommandTouchesPlansDir(command: string): boolean {
  return /\.claude\/plans\//.test(command);
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

  if (rawCommandTouchesPlansDir(command)) {
    console.error(
      [
        "[bash-policy] Raw command references ~/.claude/plans/ (gate state directory).",
        "Direct manipulation of plan-gate state markers via Bash is forbidden.",
        "Use /plan, /impl, or /bypass-plan-gate skills instead.",
        `Blocked: ${command}`,
      ].join("\n"),
    );
    Deno.exit(2);
  }

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
