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
import {
  type CommandRedirect,
  flattenCommand,
  getSegments,
  globToRegex,
} from "./shell-utils.ts";
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
 * bypass: an outer `bash -c '...'` parses as a single Command whose name is
 * `bash`, and a regex matching the joined-segment text would see the helper
 * name inside the quoted argument. Inspecting `Command.name` + Word suffixes
 * distinguishes "the executable is X" from "the substring `X` appears in a
 * quoted argument".
 *
 * `isPlansGuardExempt` (below) applies this token recognizer per leaf Command
 * node across a FLAT command sequence, so `cd <repo> && <helper>` and `;` / `|`
 * chains are exempt while exotic structures (subshell / loop / if / case /
 * function), redirects, and `$(…)` stay blocked. This recognizer itself
 * answers only the single-command question.
 *
 * Exempted shapes (per node):
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
 * Read-only commands allowed to reference the plans dir alongside the canonical
 * helper / `cd`. Membership is load-bearing for the gate: every entry MUST be
 * incapable of writing to an arbitrary file *on its own* — no write flag, no
 * embedded language, and no arbitrary-subprocess capability. Combined with the
 * redirect allow-list (`isRedirectSafe`), a node running one of these cannot
 * forge a marker. Deliberately EXCLUDED because they can write / exec without a
 * shell redirect: `awk` (`print > "f"`), `sed -i`, `sort -o`,
 * `find -delete/-exec/-fprint`, `tee`, `cp`, `mv`, `dd`, `ln`, `install`,
 * `truncate`, and `rg` (ripgrep's `--pre`/`-z` run an arbitrary command per
 * file — `rg --pre touch '' <marker>` forges a marker with no redirect). `grep`
 * has no such preprocessor and stays. Add here only after confirming the tool
 * has neither a write-to-file flag nor a subprocess-exec flag.
 */
export const READ_ONLY_COMMANDS = new Set<string>([
  "ls",
  "cat",
  "head",
  "tail",
  "stat",
  "wc",
  "file",
  "date",
  "echo",
  "grep",
]);

/**
 * A redirect is safe iff it cannot write into a guarded path: an fd-dup
 * (`>&N` / `<&N`) targets a file descriptor, and `/dev/null` discards. Any
 * other target — a real path, a relative name, or a `$VAR`-containing form like
 * `"$P/plans/.active"` — is rejected (fail-closed), which also blocks `>|`
 * (Clobber), `&>`, and `>>` to a non-null target since those carry a non-null,
 * non-fd-dup `target`.
 */
function isRedirectSafe(r: CommandRedirect): boolean {
  return r.isFdDup || r.target === "/dev/null";
}

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

/**
 * Token-level canonical-helper recognizer used per leaf node by
 * `isPlansGuardExempt`. Pure: takes the already-extracted Command `name` +
 * positional `args` and answers "is this exactly a canonical plan-marker.ts
 * invocation". The structural guarantees a caller must establish before
 * trusting this result (no redirect, no command expansion, the token really is
 * the executable rather than a quoted substring) live in the caller — see
 * `flattenCommand`.
 */
export function isCanonicalPlanMarkerTokens(
  name: string,
  args: string[],
): boolean {
  // Shape 1: helper invoked directly.
  if (tokenIsHelper(name)) {
    return args.length > 0 && SUBCOMMAND_SET.has(args[0]);
  }

  // Shape 2: `deno run [flags...] <helper-path> <subcommand> [helper-args...]`.
  // Reject `deno eval`, `deno test`, `deno task`, etc. — only `deno run` is
  // the canonical helper invocation shape, and only flag-shaped tokens may
  // precede the helper path so the helper-path token cannot be smuggled in
  // as a script-data argument to a different deno subcommand.
  if (name !== "deno") return false;
  if (args[0] !== "run") return false;
  let i = 1;
  while (i < args.length && tokenIsDenoFlag(args[i])) i++;
  if (i >= args.length - 1) return false;
  if (!tokenIsHelper(args[i])) return false;
  return SUBCOMMAND_SET.has(args[i + 1]);
}

/**
 * Decide whether a command is exempt from the gate's block. Walks a flat
 * command sequence so `/plan` ACTIVATE and `/impl`'s approval gate can prefix
 * the helper with `cd <repo> &&` (or chain with `;` / `|`), and so read-only
 * inspection of the plans dir (`ls`, `cat`, `date && ls … 2>/dev/null | tail`)
 * is allowed; a lone single command is just the one-node case.
 *
 * The accepted grammar is deliberately tiny and fail-closed — exempt ONLY when
 * every leaf node clears all of:
 *
 *   - parse failure                    → not exempt (block)
 *   - any exotic node (subshell, loop, → not exempt
 *     if/case/function, unknown type)
 *   - any command substitution `$(…)`  → not exempt (could hide a write)
 *   - any redirect to an unsafe target → not exempt (only `/dev/null` + fd-dups
 *     (`isRedirectSafe`)                 are safe; blocks `>`/`>>`/`>|`/`&>` into
 *                                        a path or `$VAR`-indirected target)
 *   - any command that is not the       → not exempt
 *     canonical helper, `cd`, or a
 *     member of READ_ONLY_COMMANDS
 *
 * Allow-listing commands is the load-bearing rule. The canonical helper is the
 * ONLY write-capable command permitted; `cd` and the READ_ONLY_COMMANDS cannot
 * write a marker (verified write-incapable, and any write-redirect they could
 * carry is rejected by `isRedirectSafe`). Permitting arbitrary "harmless-looking"
 * siblings would reopen a forge path: e.g. `P=…/.claude; <helper> …/plans/x.md;
 * touch "$P/plans/.active-pwn"` keeps the literal `.claude/plans` (so the raw
 * trigger still fires) inside the benign helper arg while a sibling forges the
 * marker via runtime parameter expansion — invisible to any per-node substring
 * check; `touch` is simply not on the allow-list. Substring-evasion that removes
 * the literal from the raw command entirely is a separate, pre-existing
 * limitation of the `rawCommandTouchesPlansDir` trigger, out of scope here.
 */
export async function isPlansGuardExempt(command: string): Promise<boolean> {
  const flat = await flattenCommand(command);
  if (!flat || flat.exotic) return false;

  for (const node of flat.commands) {
    if (node.hasExpansion) return false;
    if (!node.redirects.every(isRedirectSafe)) return false;
    if (node.name !== null && isCanonicalPlanMarkerTokens(node.name, node.args)) {
      continue;
    }
    if (node.name === "cd") continue;
    if (node.name !== null && READ_ONLY_COMMANDS.has(node.name)) continue;
    return false;
  }

  return true;
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
    !(await isPlansGuardExempt(command))
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
