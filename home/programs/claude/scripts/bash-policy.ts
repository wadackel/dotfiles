#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

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

import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { text } from "node:stream/consumers";
import { parse } from "@std/yaml";
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
    const content = await readFile(path, "utf8");
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
      await stat(candidate);
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
  const input: HookInput = JSON.parse(await text(process.stdin));

  if (input.tool_name !== "Bash") process.exit(0);

  const command = input.tool_input.command;
  const cwd = input.cwd ?? process.cwd();

  // Load global config (co-located with this script)
  const globalRules = await loadRules(
    join(import.meta.dirname, "bash-policy.yaml"),
  );

  // Load project config (walk up from cwd)
  const projectConfigPath = await findProjectConfig(cwd);
  const projectRules = projectConfigPath
    ? await loadRules(projectConfigPath)
    : [];

  // Project rules checked first, then global
  const rules = [...projectRules, ...globalRules];
  if (rules.length === 0) process.exit(0);

  const segments = await getSegments(command);
  if (segments.length === 0) process.exit(0);

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
        process.exit(2);
      }
    }
  }
}
