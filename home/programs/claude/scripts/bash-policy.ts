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
import { getSegments, globToRegex, parseSingleCommand } from "./shell-utils.ts";
import { PLAN_MARKER_SUBCOMMANDS } from "./plan-marker.ts";

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
 * see them. For the gate's own state directory, any reference to the plans
 * directory in the raw command — argument, redirect target, or deno
 * permission-flag value — is forbidden. This closes the Bash-side attack
 * surface (touch / cp / mv / tee / `>` redirect / ln -s, plus `deno run
 * --allow-write=$HOME/.claude/plans …` style invocations) on the gate's own
 * marker files.
 *
 * The match anchor `\.claude\/plans(\/|["',\s]|$)` covers:
 *   - `.claude/plans/<anything>` — direct path argument or redirect target
 *   - `.claude/plans"` / `.claude/plans'` — quoted permission-flag value
 *   - `.claude/plans,` — comma-separated permission-flag value list
 *   - `.claude/plans ` — whitespace-terminated (e.g. `--allow-write=$HOME/.claude/plans <script>`)
 *   - `.claude/plans` at end of command string
 * The deliberate consequence is that `echo '~/.claude/plans is …'` also
 * trips the guard; that informational form is rare and easily reformulated,
 * and accepting it would also accept the attacker's
 * `--allow-write=$HOME/.claude/plans /tmp/plan-marker.ts …` shape.
 */
export function rawCommandTouchesPlansDir(command: string): boolean {
  return /\.claude\/plans(\/|["',\s]|$)/.test(command);
}

/**
 * Exempt the canonical plan-marker.ts invocation from rawCommandTouchesPlansDir.
 *
 * `/plan` Phase 6 ACTIVATE PENDING and `/impl`'s approval gate both call
 * plan-marker.ts via Bash with a plan path argument that necessarily contains
 * `.claude/plans/` (e.g. `activate-pending /Users/foo/.claude/plans/bar.md`).
 * Without this exemption the gate's own helper would be blocked by its own
 * guard. plan-marker.ts internally validates that the plan path resolves under
 * the realpath of plansDir, is absolute, and is a regular .md file — so
 * allowing the helper through Bash does not weaken the "no arbitrary marker
 * write via Bash" guarantee.
 *
 * The decision is AST-structural, not substring-based, to close the
 * `bash -c '/foo/plan-marker.ts activate-pending /x.md; touch <marker>'`
 * bypass: an outer `bash -c '...'` parses as a single non-compound Command
 * whose name is `bash`, and a regex matching the joined-segment text would
 * see the helper name inside the quoted argument. Inspecting `Command.name`
 * + Word suffixes distinguishes "the executable is X" from "the substring
 * `X` appears in a quoted argument".
 *
 * Exempted shapes:
 *   - Direct: `[/path/]plan-marker.ts <subcommand> [args...]`
 *   - Via deno: `deno run [flags...] [/path/]plan-marker.ts <subcommand> [args...]`
 *
 * The deno shape is restricted to the `run` subcommand and requires the
 * helper-path to follow only flag-shaped tokens (`-x` / `--foo[=...]`). This
 * prevents `deno eval '<arbitrary JS that ends in /plan-marker.ts>' activate-pending`
 * from being treated as canonical — `deno eval` would execute the JS body
 * with full Deno permissions (subject to the runtime flags), and the JS body
 * could write marker files directly via `Deno.writeTextFile`, bypassing
 * plan-marker.ts's path validation entirely. The same constraint rejects
 * `deno test`, `deno task`, `deno repl`, etc.
 *
 * Subcommand enum is sourced from `plan-marker.ts`'s exported
 * `PLAN_MARKER_SUBCOMMANDS` tuple so a new subcommand there automatically
 * extends the exemption (no fork to keep in sync).
 */
const SUBCOMMAND_SET = new Set<string>(PLAN_MARKER_SUBCOMMANDS);

/**
 * The exemption is only safe when the executed file IS the real plan-marker.ts
 * shipped under `~/.claude/scripts/`. An attacker who can write outside the
 * gate's protected paths (e.g. `/tmp/plan-marker.ts`, `~/work/plan-marker.ts`)
 * could otherwise plant a same-basename script and have the exemption grant
 * it the same Bash-side permissive treatment as the real helper. Constrain
 * the token to the canonical install path suffix. Bare-basename invocations
 * (no path) are deliberately rejected — the canonical install always uses an
 * absolute path under `~/.claude/scripts/`.
 */
function tokenIsHelper(token: string): boolean {
  return token.endsWith("/.claude/scripts/plan-marker.ts");
}

function tokenIsDenoFlag(token: string): boolean {
  return token.startsWith("-");
}

export async function isCanonicalPlanMarkerCommand(
  command: string,
): Promise<boolean> {
  const cmd = await parseSingleCommand(command);
  if (!cmd) return false;

  // Shape 1: helper invoked directly.
  if (tokenIsHelper(cmd.name)) {
    return cmd.args.length > 0 && SUBCOMMAND_SET.has(cmd.args[0]);
  }

  // Shape 2: `deno run [flags...] <helper-path> <subcommand> [helper-args...]`.
  // Reject `deno eval`, `deno test`, `deno task`, etc. — only `deno run` is
  // the canonical helper invocation shape, and only flag-shaped tokens may
  // precede the helper path so the helper-path token cannot be smuggled in
  // as a script-data argument to a different deno subcommand.
  if (cmd.name !== "deno") return false;
  if (cmd.args[0] !== "run") return false;
  let i = 1;
  while (i < cmd.args.length && tokenIsDenoFlag(cmd.args[i])) i++;
  if (i >= cmd.args.length - 1) return false;
  if (!tokenIsHelper(cmd.args[i])) return false;
  return SUBCOMMAND_SET.has(cmd.args[i + 1]);
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

  if (
    rawCommandTouchesPlansDir(command) &&
    !(await isCanonicalPlanMarkerCommand(command))
  ) {
    console.error(
      [
        "[bash-policy] Raw command references ~/.claude/plans/ (gate state directory).",
        "Direct manipulation of plan-gate state markers via Bash is forbidden.",
        "Use /plan, /impl, or /plan-marker-grant skills instead.",
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
