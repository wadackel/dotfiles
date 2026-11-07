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
//     - pattern: "git push *renovate/*"
//       message: "This push closes the Renovate PR; add the stop-updating label and push from a terminal"

import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { text } from "node:stream/consumers";
import { parse } from "@std/yaml";
import {
  getSegments,
  globToRegex,
  stripGitGlobalFlags,
} from "./shell-utils.ts";

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
  /** Set on a tool call made inside a subagent; absent for the main session. */
  agent_type?: string;
}

// Commands that run their arguments as another command; their own options (and
// timeout's duration, sudo's -u user) are skipped to reach the command they start.
const WRAPPERS = new Set([
  "env",
  "command",
  "exec",
  "nohup",
  "timeout",
  "sudo",
  "doas",
  "xargs",
  "nice",
  "time",
  "stdbuf",
]);
const WRAPPER_ARG_OPTIONS: Record<string, ReadonlySet<string>> = {
  env: new Set(["-u", "-C", "-P"]),
  exec: new Set(["-a"]),
  sudo: new Set(["-u", "-g", "-p"]),
  doas: new Set(["-u"]),
  nice: new Set(["-n"]),
  timeout: new Set(["-s", "-k", "--signal", "--kill-after"]),
  xargs: new Set(["-I", "-L", "-P", "-n", "-s", "-a", "-d", "-E"]),
  stdbuf: new Set(["-i", "-o", "-e"]),
};
// A shell option word that carries -c (`-c`, `-lc`, `-ec`): the next word is a script.
const SHELL_C = /^-[a-zA-Z]*c[a-zA-Z]*$/;
const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);
// tmux options that take a value; -L and -S are the socket ones.
const TMUX_ARG_OPTIONS = new Set(["-c", "-f", "-L", "-S", "-T"]);

function basenameOf(word: string): string {
  return word.split("/").at(-1) ?? word;
}

function unquote(text: string): string {
  return text.replace(/^(['"])(.*)\1$/, "$2");
}

function unwrap(words: string[]): string[] {
  let i = 0;
  while (i < words.length && /^\w+=/.test(words[i])) i++;
  while (i < words.length && WRAPPERS.has(basenameOf(words[i]))) {
    const wrapper = basenameOf(words[i]);
    i++;
    while (i < words.length) {
      const w = words[i];
      if (/^\w+=/.test(w)) i++;
      else if (w.startsWith("-")) {
        i += WRAPPER_ARG_OPTIONS[wrapper]?.has(w) ? 2 : 1;
      } else if (wrapper === "timeout" && /^\d/.test(w)) i++;
      else break;
    }
  }
  return words.slice(i);
}

/** True when tmux reaches its subcommand before a global -L or -S picks a socket. */
function tmuxReachesDefault(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (!w.startsWith("-") || w === "--") return true;
    // A socket given by name is private unless it names the user's own server.
    if (w === "-L" || w === "-S") {
      const socket = args[i + 1] ?? "";
      return w === "-L"
        ? socket === "default"
        : /\/tmux-\d+\/default$/.test(socket);
    }
    if (/^-L/.test(w)) return w === "-Ldefault";
    if (/^-S/.test(w)) return /\/tmux-\d+\/default$/.test(w);
    if (TMUX_ARG_OPTIONS.has(w)) i++;
  }
  return true;
}

/**
 * The /gate breaker runs commands in a throwaway worktree. These are the ones
 * that reach past it: the user's tmux server (a tmux whose subcommand comes
 * before a global -L / -S talks to the default socket), launchd and the
 * network. They are refused for that agent alone, through
 * the common wrappers and a shell's -c string; the main session and the other
 * reviewers are unaffected.
 */
export async function breakerRefusal(
  segments: string[],
): Promise<string | null> {
  for (const segment of segments) {
    const all = segment.trim().split(/\s+/).filter(Boolean);
    // `env -S <string>` runs the split string as a command, like a shell's -c.
    const envSplit = basenameOf(all[0] ?? "") === "env"
      ? all.indexOf("-S")
      : -1;
    if (envSplit >= 0) {
      const inner = await breakerRefusal(
        await getSegments(unquote(all.slice(envSplit + 1).join(" "))),
      );
      if (inner) return inner;
    }
    const words = unwrap(all);
    const head = basenameOf(words[0] ?? "");
    const flag = words.findIndex((w, i) => i > 0 && SHELL_C.test(w));
    if (SHELLS.has(head) && flag > 0) {
      const inner = await breakerRefusal(
        await getSegments(unquote(words.slice(flag + 1).join(" "))),
      );
      if (inner) return inner;
    }
    if (head === "tmux" && tmuxReachesDefault(words.slice(1))) {
      return "tmux without a global -L or -S would reach the user's tmux server; use a private socket (tmux -L <name> <command>)";
    }
    if (head === "launchctl") return "launchctl reaches the user's launchd";
    if (head === "curl" || head === "wget") {
      return `${head} reaches the network`;
    }
  }
  return null;
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

/** The first rule whose pattern matches the segment as written or with git's global flags stripped. */
export function matchRule(rules: Rule[], segment: string): Rule | null {
  const forms = [segment, stripGitGlobalFlags(segment)];
  for (const rule of rules) {
    const regex = globToRegex(rule.pattern);
    const excludeRegexes = (rule.exclude ?? []).map(globToRegex);
    if (!forms.some((f) => regex.test(f))) continue;
    if (forms.some((f) => excludeRegexes.some((er) => er.test(f)))) continue;
    return rule;
  }
  return null;
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

  if (input.agent_type === "breaker-reviewer") {
    const refusal = await breakerRefusal(await getSegments(command));
    if (refusal) {
      console.error(
        [
          `[bash-policy] breaker-reviewer: ${refusal}`,
          `Blocked: ${command}`,
        ].join("\n"),
      );
      process.exit(2);
    }
  }

  if (rules.length === 0) process.exit(0);

  const segments = await getSegments(command);
  if (segments.length === 0) process.exit(0);

  for (const segment of segments) {
    const rule = matchRule(rules, segment);
    if (!rule) continue;
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
