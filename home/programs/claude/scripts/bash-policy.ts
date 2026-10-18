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
//
// It also inspects `plan-state.ts run … -- <argv>` and `plan-state.ts rerun`:
// the helper is in permissions.allow, so without this the argv after `--`
// would run with neither a permission prompt nor these rules. The helper
// applies the same checks again right before it spawns (plan-evidence.ts
// `assertArgvPermitted`), so this hook is the early, fail-closed half.

import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { text } from "node:stream/consumers";
import { parse } from "@std/yaml";
import {
  flattenCommand,
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

// --- plan-state.ts run / rerun ---

const HELPER = "plan-state.ts";
const EXECUTING = new Set(["run", "rerun"]);
/** Subcommands that execute nothing; any other word after the helper (an
 * expansion, a typo) is refused rather than guessed at. */
const PASSIVE = new Set([
  "init",
  "normalize",
  "start",
  "append-evidence",
  "complete",
  "require",
  "record",
  "snapshot",
  "reconcile",
  "coverage",
]);
/** The path the passive subcommands' `permissions.allow` entries match; their leading `*` auto-approves a command carrying it anywhere. */
const INSTALLED_HELPER = "/.agents/scripts/plan-state.ts";
const WHOLE_COMMAND =
  "plan-state.ts run / rerun must be the whole command: no prefix assignment, wrapper, shell string, pipeline, `&&` or `;` around it";
const SINGLE_LINE =
  "plan-state.ts run / rerun must be a single line (a later line is executed but not inspected)";
const PASSIVE_SHAPE =
  "no prefix assignment, $(…), backtick (inside an argument included) or redirect around a passive plan-state.ts subcommand (a heredoc, an fd-dup or /dev/null is fine); the allow entry approves the command as a whole";
const INSTALLED_ELSEWHERE =
  "plan-state.ts: its installed path may appear only as the head of a command; inside a heredoc body, a shell string, a wrapper's argument or a search pattern it would be auto-approved whole by permissions.allow (name the worktree path home/programs/agents/scripts/plan-state.ts when it is data)";

function basename(word: string): string {
  return word.slice(word.lastIndexOf("/") + 1);
}

export interface HelperContext {
  cwd: string;
  home: string;
}

function settingsPaths(ctx: HelperContext): string[] {
  return [
    `${ctx.home}/.claude/settings.json`,
    `${ctx.cwd}/.claude/settings.json`,
    `${ctx.cwd}/.claude/settings.local.json`,
  ];
}

/** Words the shell would still rewrite before the helper sees them. */
function shellRewrites(word: string): boolean {
  return word.includes("$") || word.includes("`") ||
    (word.includes("{") && /\{[^}]*(,|\.\.)[^}]*\}/.test(word));
}

type Approve = typeof import("./approve-piped-commands.ts");
type Evidence = typeof import("../../agents/scripts/plan-evidence.ts");

/**
 * Why an inner argv may not run, or null. Mirrors what a direct Bash call goes
 * through: these rules first, then permissions.deny / ask, then permissions.allow.
 */
async function denyInnerArgv(
  argv: string[],
  env: Record<string, string>,
  rules: Rule[],
  ctx: HelperContext,
  lib: { approve: Approve; evidence: Evidence },
): Promise<string | null> {
  for (const key of Object.keys(env)) {
    if (!lib.evidence.RUN_ENV_KEYS.has(key)) {
      return `--env ${key} is not allowed (keys: ${
        [...lib.evidence.RUN_ENV_KEYS].join(" ")
      })`;
    }
  }
  for (const word of argv) {
    if (shellRewrites(word)) {
      return `inner command word "${word}" contains $, a backtick or a brace expansion; the hook cannot see what it expands to`;
    }
    if (basename(word) === HELPER) {
      return "inner command may not invoke plan-state.ts";
    }
  }
  if (lib.evidence.ARGV_WRAPPERS.has(basename(argv[0] ?? ""))) {
    return `inner command may not start with the wrapper "${
      argv[0]
    }"; deny entries and the rules are anchored at the first word, so name the command itself`;
  }
  const inner = argv.join(" ");
  const rule = matchRule(rules, inner);
  if (rule) return `inner command matches "${rule.pattern}"\n${rule.message}`;
  const forms = [inner, stripGitGlobalFlags(inner)];
  const paths = settingsPaths(ctx);
  for (const key of ["deny", "ask"] as const) {
    const patterns = await lib.approve.loadAllowedPatterns(paths, key);
    if (
      forms.some((f) =>
        patterns.some((p) => lib.approve.matchesAllowedPattern(f, p))
      )
    ) {
      return `inner command "${inner}" matches permissions.${key}`;
    }
  }
  const allow = await lib.approve.loadAllowedPatterns(paths, "allow");
  if (
    !forms.some((f) =>
      allow.some((p) => lib.approve.matchesAllowedPattern(f, p))
    )
  ) {
    return `inner command "${inner}" is not in permissions.allow of ~/.claude/settings.json; add an allow rule, or in Claude Code run it directly once to get permission`;
  }
  return null;
}

function expandPath(path: string, ctx: HelperContext): string {
  const expanded = path === "~" || path.startsWith("~/")
    ? `${ctx.home}${path.slice(1)}`
    : path;
  return resolve(ctx.cwd, expanded);
}

async function denyRerun(
  pathArg: string | undefined,
  rules: Rule[],
  ctx: HelperContext,
  lib: { approve: Approve; evidence: Evidence },
): Promise<string | null> {
  if (!pathArg || shellRewrites(pathArg)) {
    return "plan-state.ts rerun needs a literal evidence path";
  }
  // Every stored argv is about to be executed, so each one is checked as if it
  // were typed now; a sidecar the hook cannot read or understand is refused.
  try {
    const data = JSON.parse(await readFile(expandPath(pathArg, ctx), "utf8"));
    if (!data || typeof data !== "object" || !Array.isArray(data.tasks)) {
      return `plan-state.ts rerun: ${pathArg} is not an evidence sidecar`;
    }
    for (const task of data.tasks as unknown[]) {
      const checks = (task as { checks?: unknown }).checks;
      const latest = new Map<string, { argv?: unknown; env?: unknown }>();
      for (const check of Array.isArray(checks) ? checks : []) {
        const c = check as { id?: unknown; argv?: unknown; env?: unknown };
        if (typeof c?.id === "string") latest.set(c.id, c);
      }
      for (const [id, check] of latest) {
        if (check.argv === undefined) continue;
        if (
          !Array.isArray(check.argv) ||
          check.argv.some((w) => typeof w !== "string")
        ) {
          return `plan-state.ts rerun: stored check ${id} has a malformed argv`;
        }
        const env = check.env ?? {};
        if (
          typeof env !== "object" || env === null || Array.isArray(env) ||
          Object.values(env).some((v) => typeof v !== "string")
        ) {
          return `plan-state.ts rerun: stored check ${id} has a malformed env`;
        }
        const reason = await denyInnerArgv(
          check.argv as string[],
          env as Record<string, string>,
          rules,
          ctx,
          lib,
        );
        if (reason) return `plan-state.ts rerun: stored check ${id}: ${reason}`;
      }
    }
    return null;
  } catch (err) {
    return `plan-state.ts rerun: cannot read ${pathArg}: ${
      (err as Error).message
    }`;
  }
}

/**
 * Returns the reason a `plan-state.ts` invocation must be blocked, or null
 * when the command does not touch the helper or passes every check. The
 * helper at the head of a command must be followed by a literal subcommand:
 * a passive one may sit in any pipeline or `&&` chain but carries no prefix
 * assignment, expansion or file redirect; `run` / `rerun` must be the whole
 * command and get the inner-argv checks. Anywhere but the head, the helper
 * followed by `run` / `rerun` is a wrapper and is refused, and every
 * occurrence of the installed path must be one of those heads.
 */
export async function checkHelperInvocation(
  command: string,
  rules: Rule[],
  ctx: HelperContext,
): Promise<string | null> {
  // Every refusal below needs the helper's basename somewhere in the text, so
  // the parse is skipped for the commands that cannot name it. Quote characters
  // are dropped first: the parser's words are unquoted, so `plan-state.t's'`
  // is the helper to it and must reach the checks below.
  const unquoted = command.replace(/['"\\]/g, "");
  if (!unquoted.includes(HELPER)) return null;
  const flat = await flattenCommand(command);
  if (!flat) return "plan-state.ts inside a command the hook cannot parse";
  let direct: { name: string; args: string[] } | null = null;
  let installedHeads = 0;
  for (const c of flat.commands) {
    const words = c.name === null ? c.args : [c.name, ...c.args];
    const at = words.findIndex((w) => basename(w) === HELPER);
    if (at < 0) continue;
    // Anywhere but the head, the helper's path followed by `run` / `rerun` is
    // a wrapper handing it its words (`command`, `exec`, `xargs`, `bun`, …);
    // the worktree path as a plain argument of `sed` or `rg` is data.
    if (at !== 0 || c.name === null) {
      if (EXECUTING.has(words[at + 1] ?? "")) return WHOLE_COMMAND;
      continue;
    }
    const mode = words[at + 1] ?? "";
    if (!PASSIVE.has(mode) && !EXECUTING.has(mode)) {
      return `plan-state.ts must be followed by a literal subcommand, got "${mode}"`;
    }
    if (PASSIVE.has(mode)) {
      // `stripHeredocs` removes the body before the parse, so a `$(…)` in an
      // unquoted-delimiter body is expanded by the shell and seen by nobody.
      // Backslash-newline is folded first: bash joins the lines before it
      // reads the delimiter, so `<<\` + newline + `EOF` is an unquoted `EOF`.
      if (
        c.redirects.some((r) => r.isHeredoc) &&
        /<<(?!<)-?\s*[^\s'"\\-]/.test(command.replace(/\\\n/g, ""))
      ) {
        return `plan-state.ts ${mode}: quote the heredoc delimiter (<<'EOF'); an unquoted body is expanded by the shell before the helper reads it`;
      }
      // The shell applies these before the helper runs and the allow entry
      // never sees them: `GIT_CONFIG_PARAMETERS=… snapshot`, `snapshot > ~/.zshrc`.
      // `>&file` parses as an fd-dup too; only a descriptor or `-` is one.
      const unsafeRedirect = c.redirects.some((r) =>
        !r.isHeredoc && r.target !== "/dev/null" &&
        !(r.isFdDup && /^(\d+|-)$/.test(r.target ?? ""))
      );
      if (
        c.hasAssignment || c.hasExpansion || unsafeRedirect ||
        words.some((w) => w.includes("`"))
      ) {
        return `plan-state.ts ${mode}: ${PASSIVE_SHAPE}`;
      }
      if (words[0].includes(INSTALLED_HELPER)) installedHeads += 1;
      continue;
    }
    if (direct) return WHOLE_COMMAND;
    if (words[0].includes(INSTALLED_HELPER)) installedHeads += 1;
    direct = { name: c.name, args: c.args };
  }
  // The allow entries match the installed path anywhere in the command, so an
  // occurrence that is not one of the heads counted above (a heredoc body, a
  // shell string, `find -exec`, an `rg` pattern) would be approved unread.
  // Counted on the raw text and on the text without quote characters, because
  // the heads above are the parser's unquoted words: a head spelled
  // `plan-state.t's'` would count once there and zero times in the raw text.
  const occurrences = command.split(INSTALLED_HELPER).length - 1;
  const occurrencesUnquoted = unquoted.split(INSTALLED_HELPER).length - 1;
  if (
    occurrences !== installedHeads || occurrencesUnquoted !== installedHeads ||
    (flat.exotic && occurrences > 0)
  ) {
    return INSTALLED_ELSEWHERE;
  }
  if (!direct) return null;
  // `stripHeredocs` can mistake a quoted `<<WORD` for a heredoc and hide the
  // lines after it from the parser; bash still runs them.
  if (command.includes("\n")) return SINGLE_LINE;
  if (flat.exotic || flat.commands.length !== 1) return WHOLE_COMMAND;
  const head = command.trim().split(/\s+/)[0] ?? "";
  if (head !== direct.name) return WHOLE_COMMAND;
  if (command.includes("`")) {
    return "plan-state.ts run / rerun may not contain a backtick";
  }
  const [cmd] = flat.commands;
  if (cmd.hasExpansion || cmd.redirects.length > 0) {
    return "plan-state.ts run / rerun may not use $(…) or redirects";
  }
  // Loaded here so a broken module fails this check closed instead of taking
  // every rule above down with an import error.
  let lib: { approve: Approve; evidence: Evidence };
  try {
    lib = {
      approve: await import("./approve-piped-commands.ts"),
      evidence: await import("../../agents/scripts/plan-evidence.ts"),
    };
  } catch (err) {
    return `cannot load the inner-command check: ${(err as Error).message}`;
  }
  const [mode, ...rest] = direct.args;
  if (mode === "run") {
    // Every token, not only the argv: an expansion in an option value or the
    // check id could move the `--` the helper sees.
    for (const word of rest) {
      if (shellRewrites(word)) {
        return `plan-state.ts run: "${word}" contains $, a backtick or a brace expansion`;
      }
    }
    let parsed;
    try {
      parsed = lib.evidence.splitRunArgs(rest);
    } catch (err) {
      return `plan-state.ts run: ${(err as Error).message}`;
    }
    return await denyInnerArgv(parsed.argv, parsed.env, rules, ctx, lib);
  }
  return await denyRerun(rest[0], rules, ctx, lib);
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

  let helperReason: string | null;
  try {
    helperReason = await checkHelperInvocation(command, rules, {
      cwd,
      home: process.env.HOME ?? homedir(),
    });
  } catch (err) {
    helperReason = `inner-command check failed: ${(err as Error).message}`;
  }
  if (helperReason) {
    console.error(
      [`[bash-policy] ${helperReason}`, `Blocked: ${command}`].join("\n"),
    );
    process.exit(2);
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
