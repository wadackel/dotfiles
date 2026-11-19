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

import { closeSync, mkdirSync, openSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { text } from "node:stream/consumers";
import { parse } from "@std/yaml";
import { run } from "../../agents/lib/proc.ts";
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
  session_id?: string;
  transcript_path?: string;
  /** Set on a tool call made inside a subagent; absent for the main session. */
  agent_id?: string;
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

/**
 * True when tmux reaches its subcommand before a global -L or -S picks a socket.
 * `allowSocket` exempts a socket path that ends in `tmux-<uid>/default` but is not the user's.
 */
function tmuxReachesDefault(
  args: string[],
  allowSocket: (path: string) => boolean = () => false,
): boolean {
  const userDefault = (path: string) =>
    !allowSocket(path) && /\/tmux-\d+\/default$/.test(path);
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (!w.startsWith("-") || w === "--") return true;
    // A socket given by name is private unless it names the user's own server.
    if (w === "-L" || w === "-S") {
      const socket = args[i + 1] ?? "";
      return w === "-L" ? socket === "default" : userDefault(socket);
    }
    if (/^-L/.test(w)) return w === "-Ldefault";
    if (/^-S/.test(w)) return userDefault(w.slice(2));
    if (TMUX_ARG_OPTIONS.has(w)) i++;
  }
  return true;
}

type Decide = (
  head: string,
  words: string[],
) => string | null | Promise<string | null>;

/** Where an explorer's command runs, so a script it starts can be found and read. */
type Follow = { cwd: string; depth: number };

/**
 * The /do review's breaker runs commands in a throwaway worktree. These are the ones
 * that reach past it: the user's tmux server (a tmux whose subcommand comes
 * before a global -L / -S talks to the default socket), launchd and the
 * network. They are refused for that agent alone, through
 * the common wrappers and a shell's -c string; the main session and the other
 * reviewers are unaffected.
 */
export function breakerRefusal(segments: string[]): Promise<string | null> {
  return refusalIn(segments, (head, words) => {
    if (head === "tmux" && tmuxReachesDefault(words.slice(1))) {
      return "tmux without a global -L or -S would reach the user's tmux server; use a private socket (tmux -L <name> <command>)";
    }
    if (head === "launchctl") return "launchctl reaches the user's launchd";
    if (head === "curl" || head === "wget") {
      return `${head} reaches the network`;
    }
    return null;
  });
}

const SANDBOX_SOCKET = /^(\/private)?\/tmp\/xs-[^/]+\/tmux-\d+\/default$/;
// gh reads the session may run; every other gh command (writes, credentials, extensions,
// aliases) is refused, because a list of what to refuse kept missing groups.
const GH_READ: Record<string, ReadonlySet<string>> = {
  issue: new Set(["list", "view", "status"]),
  pr: new Set(["list", "view", "status", "diff", "checks"]),
  run: new Set(["list", "view"]),
  release: new Set(["list", "view"]),
  repo: new Set(["view"]),
  label: new Set(["list"]),
  workflow: new Set(["list", "view"]),
  gist: new Set(["list", "view"]),
  cache: new Set(["list"]),
  auth: new Set(["status"]),
};
const GH_FREE = new Set([
  "",
  "search",
  "status",
  "help",
  "version",
  "--version",
  "-h",
  "--help",
]);
// Options of git itself that take the next word as their value.
const GIT_VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--config-env",
  "--super-prefix",
]);
const SCRIPT_LIMIT = 256 * 1024;

function ghRefusal(args: string[]): string | null {
  const [group = "", verb = ""] = args;
  if (group === "api") {
    const m = args.findIndex((a) => a === "-X" || a === "--method");
    const inline = args.find((a) => /^(-X|--method=)./.test(a));
    const method =
      (m >= 0 ? args[m + 1] : inline?.replace(/^(-X|--method=)/, ""))
        ?.toUpperCase();
    const hasFields = args.some((a) =>
      ["-f", "-F", "--field", "--raw-field", "--input"].includes(a) ||
      /^-[fF]./.test(a) || /^--(raw-field|field|input)=/.test(a)
    );
    if ((method && method !== "GET") || (!method && hasFields)) {
      return "gh api with a method other than GET writes to GitHub";
    }
    return null;
  }
  if (GH_FREE.has(group)) return null;
  if (GH_READ[group]?.has(verb)) {
    if (
      group === "auth" && args.some((a) => a === "--show-token" || a === "-t")
    ) {
      return "gh auth status --show-token prints the user's token";
    }
    return null;
  }
  return `gh ${group} ${verb} is not a read the session needs; the main session files and edits`;
}

/** git's subcommand after its own options, from any spelling of git (`/usr/bin/git`, `git -P`). */
function gitArgs(words: string[]): string[] {
  const args = words.slice(1);
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!;
    if (!w.startsWith("-")) return args.slice(i);
    if (GIT_VALUE_OPTIONS.has(w)) i++;
  }
  return [];
}

async function gitRefusal(
  words: string[],
  cwd: string,
): Promise<string | null> {
  const [sub = "", next = ""] = gitArgs(words);
  if (sub === "push") {
    return "git push is the main session's; record the finding instead";
  }
  if (sub === "worktree" && next === "add") {
    return "git worktree add creates a branch in the real repository; clone into the sandbox instead";
  }
  if (!/^[\w-]+$/.test(sub)) return null;
  // The user's own aliases (`pushf = push --force-with-lease`) reach push under another name.
  const alias = await run("git", ["config", "--get", `alias.${sub}`], { cwd })
    .catch(() => null);
  const value = alias?.code === 0 ? alias.stdout.trim() : "";
  if (!value) return null;
  if (value.startsWith("!")) {
    return explorerRefusal(await getSegments(value.slice(1)), cwd);
  }
  return gitRefusal(["git", ...value.split(/\s+/)], cwd);
}

/** The inside of `explore-sandbox.ts exec <root> ... -- <cmd>`: only what the sandbox cannot redirect. */
function sandboxedRefusal(words: string[]): string | null {
  const dash = words.indexOf("--");
  const root = words[2] ?? "";
  if (words[1] !== "exec" || dash < 0) return null;
  const inner = words.slice(dash + 1);
  const head = basenameOf(inner[0] ?? "");
  const valueOf = (names: string[]) => {
    const i = inner.findIndex((w) => names.includes(w));
    return i >= 0
      ? inner[i + 1]
      : inner.find((w) => names.some((n) => w.startsWith(`${n}=`)))?.split(
        "=",
      )[1];
  };
  if (head === "tmux") {
    const socket = valueOf(["-S"]);
    if (socket && !SANDBOX_SOCKET.test(socket)) {
      return "tmux -S outside the sandbox reaches a server the sandbox does not own";
    }
  }
  if (head === "git") {
    const target = valueOf(["-C", "--git-dir", "--work-tree"]);
    if (target && root && !resolve(target).startsWith(`${resolve(root)}/`)) {
      return "git pointed outside the sandbox with -C / --git-dir / --work-tree reaches the real repository";
    }
  }
  return null;
}

/** The script a command runs: `sh file`, `source file`, `. file`, or a path to a shell script. */
async function scriptOf(
  head: string,
  words: string[],
  cwd: string,
): Promise<string | null> {
  let path: string | undefined;
  if (SHELLS.has(head)) path = words.slice(1).find((w) => !w.startsWith("-"));
  else if (head === "source" || head === ".") path = words[1];
  else if (words[0]?.includes("/")) path = words[0];
  if (!path) return null;
  const full = resolve(cwd, path);
  const st = await stat(full).catch(() => null);
  if (!st?.isFile() || st.size > SCRIPT_LIMIT) return null;
  const text = await readFile(full, "utf8");
  if (text.includes("\u0000")) return null;
  const shebang = /^#!.*\b(ba|z|da)?sh\b/.test(text.split("\n", 1)[0] ?? "");
  if (!SHELLS.has(head) && head !== "source" && head !== "." && !shebang) {
    return null;
  }
  return text;
}

/**
 * An /exploratory-testing session explores a product from a sandbox while the main
 * session reproduces, files and pushes. A written ban did not stop a past run from
 * opening a window in the user's tmux and adding branches to the real repository,
 * so these are refused for that agent: the user's tmux server (a sandbox socket under
 * /tmp/xs-* is allowed), launchd, gh beyond a few reads, git push and git worktree add.
 * Shell scripts it runs are read too, because its definition has it write multi-line
 * commands to files.
 */
export function explorerRefusal(
  segments: string[],
  cwd: string,
): Promise<string | null> {
  return refusalIn(segments, async (head, words) => {
    if (
      head === "tmux" &&
      tmuxReachesDefault(words.slice(1), (p) => SANDBOX_SOCKET.test(p))
    ) {
      return "tmux without a global -L or -S would reach the user's tmux server; name the sandbox socket (tmux -S <socket> <command>)";
    }
    if (head === "launchctl") return "launchctl reaches the user's launchd";
    if (head === "gh") return ghRefusal(words.slice(1));
    if (head === "git") return gitRefusal(words, cwd);
    if (head === "explore-sandbox.ts") return sandboxedRefusal(words);
    return null;
  }, { cwd, depth: 0 });
}

async function refusalIn(
  segments: string[],
  decide: Decide,
  follow?: Follow,
): Promise<string | null> {
  for (const segment of segments) {
    const all = segment.trim().split(/\s+/).filter(Boolean);
    // `env -S <string>` runs the split string as a command, like a shell's -c.
    const envSplit = basenameOf(all[0] ?? "") === "env"
      ? all.indexOf("-S")
      : -1;
    if (envSplit >= 0) {
      const inner = await refusalIn(
        await getSegments(unquote(all.slice(envSplit + 1).join(" "))),
        decide,
        follow,
      );
      if (inner) return inner;
    }
    const words = unwrap(all);
    const head = basenameOf(words[0] ?? "");
    const flag = words.findIndex((w, i) => i > 0 && SHELL_C.test(w));
    if (SHELLS.has(head) && flag > 0) {
      const inner = await refusalIn(
        await getSegments(unquote(words.slice(flag + 1).join(" "))),
        decide,
        follow,
      );
      if (inner) return inner;
    } else if (follow && follow.depth < 3) {
      const script = await scriptOf(head, words, follow.cwd);
      if (script !== null) {
        const inner = await refusalIn(await getSegments(script), decide, {
          ...follow,
          depth: follow.depth + 1,
        });
        if (inner) {
          return `${inner} (in the script ${
            words[SHELLS.has(head) || head === "source" || head === "." ? 1 : 0]
          })`;
        }
      }
    }
    const refusal = await decide(head, words);
    if (refusal) return refusal;
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

// --- Deliverable hint ---

// The writing skill's description fired on 4 of 24 requests to draft a PR or an
// Issue, because the model runs git or reads files before it looks at the skill
// listing, and half of the PRs and Issues created here came from sessions that never
// loaded create-pr. Publishing is the moment every route shares, so the first such
// command of a session (or of a subagent) is held back once with a pointer to the skill.
export const DELIVERABLE_HINT = [
  "[bash-policy] This command publishes the title or body of a PR or an Issue.",
  "Load the writing skill and revise that text with it (the --body-file in place, or the --title and --body values), then run the command again.",
  "If the user gave this exact text to publish, run the command again unchanged. This check stops only the first such command of a session; the next one runs.",
].join("\n");

// pflag accepts a short flag's value attached (`-tTitle`, `-F/tmp/b.md`).
const TEXT_FLAGS =
  /^(--title|--body|--body-file|--fill|--fill-first|--fill-verbose)(=|$)|^-[tbF]/;
// gh's own options that take a value come before the command group.
const GH_VALUE_OPTIONS = new Set(["-R", "--repo", "--hostname"]);

/** gh's command group and verb, skipping gh's own options (`gh -R o/r pr create`). */
function ghCommand(args: string[]): [string, string, string[]] {
  const positional: number[] = [];
  for (let i = 0; i < args.length && positional.length < 2; i++) {
    if (GH_VALUE_OPTIONS.has(args[i])) i++;
    else if (!args[i].startsWith("-")) positional.push(i);
  }
  const [g, v] = positional;
  return [
    args[g] ?? "",
    args[v] ?? "",
    v === undefined ? [] : args.slice(v + 1),
  ];
}

// The segments lose their quotes (`--title "Add --dry-run"` becomes three words), so
// the flags that publish nothing are looked for in the command with quoted text removed.
const NO_PUBLISH = /(^|\s)(--help|-h|--dry-run)(?=\s|=|$)/;
function withoutQuoted(command: string): string {
  return command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
}

export function publishesText(
  segments: string[],
  command = "",
): Promise<boolean> {
  // Looking up the flags first is common, and it must not use up the one hint.
  if (NO_PUBLISH.test(withoutQuoted(command))) return Promise.resolve(false);
  return refusalIn(segments, (head, words) => {
    if (head !== "gh") return null;
    const [group, verb, rest] = ghCommand(words.slice(1));
    if (group !== "pr" && group !== "issue") return null;
    if (verb === "create" || verb === "new") return "publishes";
    if (verb === "edit" && rest.some((w) => TEXT_FLAGS.test(w))) {
      return "publishes";
    }
    return null;
  }).then((hit) => hit !== null);
}

// create-pr and spec revise with the writing skill before they publish; holding their
// command back as well would only cost a turn, so a transcript that already shows the
// skill being called counts as revised. Only the tool call's own JSON is matched: in a
// tool result the same text has its quotes escaped, so reading this file does not count.
export async function alreadyRevised(
  transcriptPath: string | undefined,
): Promise<boolean> {
  if (!transcriptPath) return false;
  try {
    const info = await stat(transcriptPath);
    if (!info.isFile() || info.size > 64_000_000) return false;
    const t = await readFile(transcriptPath, "utf8");
    return t.includes('"input":{"skill":"writing"');
  } catch {
    return false;
  }
}

// A subagent's hook input names the session's transcript; its own calls are kept
// beside it under subagents/, so that is the file that shows whether it ran the skill.
export function ownTranscript(
  input: Pick<HookInput, "transcript_path" | "agent_id">,
): string | undefined {
  const t = input.transcript_path;
  if (!t || !input.agent_id) return t;
  return join(
    t.replace(/\.jsonl$/, ""),
    "subagents",
    `agent-${input.agent_id}.jsonl`,
  );
}

// A subagent's hook input carries its parent's session_id, so the key adds agent_id;
// "wx" creates the marker exclusively, so two commands at once are held back only once.
export function takeDeliverableHint(
  input: Pick<HookInput, "session_id" | "agent_id">,
  markerDir = join(tmpdir(), "claude-deliverable-hint"),
): boolean {
  if (!input.session_id) return false;
  const key = `${input.session_id}-${input.agent_id ?? "main"}`.replace(
    /[^\w-]/g,
    "_",
  );
  try {
    mkdirSync(markerDir, { recursive: true });
    closeSync(openSync(join(markerDir, key), "wx"));
    return true;
  } catch {
    return false;
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

  const agentRefusal = input.agent_type === "breaker-reviewer"
    ? breakerRefusal
    : input.agent_type === "exploratory-session"
    ? (segments: string[]) => explorerRefusal(segments, cwd)
    : null;
  if (agentRefusal) {
    const refusal = await agentRefusal(await getSegments(command));
    if (refusal) {
      console.error(
        [
          `[bash-policy] ${input.agent_type}: ${refusal}`,
          `Blocked: ${command}`,
        ].join("\n"),
      );
      process.exit(2);
    }
  }

  // Parsing costs more than the rest of this hook, and with no rules most commands
  // used to skip it; only a command that names gh can publish.
  const namesGh = /\bgh\b/.test(command);
  if (rules.length === 0 && !namesGh) process.exit(0);

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

  // After the rules, so a command a rule refuses shows the rule's reason first.
  if (
    namesGh && process.env.CLAUDE_DELIVERABLE_HINT_SKIP !== "1" &&
    await publishesText(segments, command) &&
    // The marker first, so the transcript is read at most once a session.
    takeDeliverableHint(input) && !(await alreadyRevised(ownTranscript(input)))
  ) {
    console.error([DELIVERABLE_HINT, `Blocked once: ${command}`].join("\n"));
    process.exit(2);
  }
}
