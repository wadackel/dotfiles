// Runs a Claude Code task asked for from the Slack DM or fixed by a cron job.
// Claude runs headless in restricted mode, which ignores the owner's settings
// files (allow rules, hooks, MCP servers), in a sandbox that reads only the
// worktree and the toolchain and reaches only the npm registry. It edits files
// and reports through a JSON schema; this script does every git and GitHub
// write (commit, push, label, PR or issue, merge).

import { home } from "./feed-store.ts";
import { postMessage } from "./slack.ts";

export type Request = { owner: string; repo: string; task: string };

const NAME = /^[A-Za-z0-9._-]+$/;

// Slack escapes these three in message text; the request should read as typed.
export function decodeSlack(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll(
    "&amp;",
    "&",
  );
}

export function parseRequest(
  text: string,
  owners: string[],
): Request | { error: string } {
  const body = text.replace(/^!claude\b/, "").trim();
  const target = body.split(/\s+/, 1)[0] ?? "";
  const task = body.slice(target.length).trim();
  if (!target || !task) {
    return { error: "使い方: `!claude <repo か owner/repo> <依頼>`" };
  }
  const [owner, repo] = target.includes("/")
    ? target.split("/", 2)
    : [owners[0], target];
  if (!NAME.test(owner) || !NAME.test(repo) || repo.startsWith(".")) {
    return { error: `リポジトリ名として読めません: ${target}` };
  }
  if (!owners.includes(owner)) {
    return { error: `${owner} は依頼を受け付ける owner にありません` };
  }
  return { owner, repo, task };
}

const MERGE_WORDS = new Set(["merge", "マージ", "マージして", "lgtm"]);

export function isMergeWord(text: string): boolean {
  return MERGE_WORDS.has(text.trim().toLowerCase());
}

type Check = { conclusion?: string; status?: string; state?: string };
export type PrState = { mergeable: string; statusCheckRollup: Check[] | null };

export function mergeReadiness(
  pr: PrState,
): "ready" | "failing" | "pending" | "unknown" | "conflicting" {
  const checks = pr.statusCheckRollup ?? [];
  // StatusContext entries carry `state`, CheckRun entries `status` + `conclusion`.
  const result = (c: Check) => (c.conclusion || c.state || "").toUpperCase();
  const bad = new Set([
    "FAILURE",
    "ERROR",
    "CANCELLED",
    "TIMED_OUT",
    "ACTION_REQUIRED",
  ]);
  if (checks.some((c) => bad.has(result(c)))) return "failing";
  if (
    checks.some((c) =>
      (c.status && c.status !== "COMPLETED") ||
      ["PENDING", "EXPECTED"].includes(result(c))
    )
  ) return "pending";
  if (pr.mergeable === "CONFLICTING") return "conflicting";
  if (pr.mergeable !== "MERGEABLE") return "unknown";
  return "ready";
}

// `git diff -z --name-only` output: NUL-separated and never quoted.
export function splitNul(out: string): string[] {
  return out.split("\0").filter(Boolean);
}

export function touchesWorkflows(files: string[]): boolean {
  return files.some((f) => f.startsWith(".github/"));
}

export type Outcome = {
  outcome: "pr" | "issue" | "answer" | "nothing";
  summary: string;
  title?: string;
  body?: string;
  commit_message?: string;
};

export type Action =
  | "open-pr"
  | "update-pr"
  | "refuse-workflow"
  | "issue"
  | "answer"
  | "close";

// Only a `pr` outcome commits; anything Claude changed otherwise is discarded.
// `pushed` means the branch already carries commits without a PR, which is
// left behind when opening the PR failed on an earlier run.
export function decideAction(o: {
  outcome: Outcome["outcome"];
  files: string[];
  hasPr: boolean;
  pushed: boolean;
}): Action {
  if (o.outcome === "pr" && o.files.length > 0) {
    if (touchesWorkflows(o.files)) return "refuse-workflow";
    return o.hasPr ? "update-pr" : "open-pr";
  }
  if (o.outcome === "issue") return "issue";
  if (o.outcome === "nothing") return "close";
  return o.pushed && !o.hasPr ? "open-pr" : "answer";
}

export type SandboxPaths = {
  home: string;
  worktree: string;
  clone: string;
  pnpm: string;
};

export function claudeSettings(p: SandboxPaths) {
  return {
    permissions: { deny: ["WebFetch", "WebSearch"] },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        denyRead: [`${p.home}/`],
        allowRead: [
          p.worktree,
          p.clone,
          p.pnpm,
          `${p.home}/.config/git`,
          `${p.home}/.config/mise`,
          `${p.home}/.local/share/mise`,
        ],
        allowWrite: [p.worktree, p.pnpm],
      },
      network: {
        allowedDomains: ["registry.npmjs.org"],
        strictAllowlist: true,
      },
    },
  };
}

export const OUTCOME_SCHEMA = {
  type: "object",
  properties: {
    outcome: {
      type: "string",
      enum: ["pr", "issue", "answer", "nothing"],
      description:
        "pr: files were changed for a PR. issue: a problem needs the owner's design decision. answer: a reply without changes. nothing: nothing worth reporting",
    },
    summary: {
      type: "string",
      description: "What you did and what you verified, in Japanese, for Slack",
    },
    title: { type: "string", description: "PR or issue title" },
    body: {
      type: "string",
      description:
        "PR or issue body in Markdown, including the verification commands and their results",
    },
    commit_message: { type: "string", description: "Commit message for pr" },
  },
  required: ["outcome", "summary"],
};

const SYSTEM_PROMPT = [
  "You are running unattended for the repository owner, who asked from Slack.",
  "The owner's personal workflow instructions (skills, /plan, /gate, subagents, the Obsidian vault, llm-wiki) are not available here; ignore them.",
  "Read the repository's AGENTS.md or CLAUDE.md first and follow its conventions.",
  "Only edit files. Do not commit, push, or use gh: the script commits and opens the PR or issue from your structured output.",
  "Network access is limited to the npm registry. Verify your change with the repository's own test and lint commands before reporting.",
  "Installing dependencies or running tests is fine even when you only answer a question: file changes are discarded unless your outcome is pr, and for pr only the changes the fix needs should remain.",
].join(" ");

export function claudeArgv(o: {
  settings: ReturnType<typeof claudeSettings>;
  prompt: string;
  resume?: string;
}): string[] {
  return [
    "-p",
    "--restricted",
    "--tools",
    "Bash,Read,Edit,Write,Glob,Grep",
    "--strict-mcp-config",
    "--settings",
    JSON.stringify(o.settings),
    "--permission-mode",
    "acceptEdits",
    "--permission-prompts",
    "none",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(OUTCOME_SCHEMA),
    "--append-system-prompt",
    SYSTEM_PROMPT,
    ...(o.resume ? ["--resume", o.resume] : []),
    o.prompt,
  ];
}

// ---------------------------------------------------------------------------
// Everything below runs git, gh, claude and Slack.

type Config = {
  channel: string;
  owners: string[];
  claude: string;
  gh: string;
  git: string;
  identity: { name: string; email: string };
};

type Task = {
  thread: string;
  owner: string;
  repo: string;
  status: "running" | "idle" | "closed";
  startedAt: number;
  sessionId?: string;
  base?: string;
  head?: string;
  defaultBranch?: string;
  pr?: string;
};

const CLAUDE_TIMEOUT_MS = 45 * 60_000;
// A run older than this crashed without saving its end state: the script
// always stops Claude by CLAUDE_TIMEOUT_MS plus the SIGKILL grace.
const STALE_RUN_MS = CLAUDE_TIMEOUT_MS + 5 * 60_000;
const TASK_TTL_MS = 14 * 24 * 3600_000;
const LOCK_STALE_MS = 10 * 60_000;

const dir = (p: string) => p.slice(0, p.lastIndexOf("/"));
const stateDir = () => `${home()}/.config/hermes-claude/tasks`;
const workDir = () => `${home()}/.local/share/hermes-claude`;
const clonePath = (t: Task) => `${workDir()}/repos/${t.owner}/${t.repo}`;
const worktreePath = (t: Task) => `${workDir()}/worktrees/${t.thread}`;
// Named after the worktree directory by `git worktree add`.
const gitDirOf = (t: Task) => `${clonePath(t)}/.git/worktrees/${t.thread}`;
const pnpmDir = () => `${workDir()}/pnpm`;
const taskFile = (thread: string) => `${stateDir()}/${thread}.json`;

async function loadTask(thread: string): Promise<Task | undefined> {
  try {
    return JSON.parse(await Deno.readTextFile(taskFile(thread)));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return undefined;
    throw e;
  }
}

async function saveTask(t: Task, opts: { createNew?: boolean } = {}) {
  await Deno.mkdir(stateDir(), { recursive: true, mode: 0o700 });
  const text = JSON.stringify(t, null, 2) + "\n";
  if (opts.createNew) {
    await Deno.writeTextFile(taskFile(t.thread), text, {
      createNew: true,
      mode: 0o600,
    });
    return;
  }
  const tmp = `${taskFile(t.thread)}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(tmp, text, { mode: 0o600 });
  await Deno.rename(tmp, taskFile(t.thread));
}

function gitConfigEnv(entries: [string, string][]): Record<string, string> {
  const env: Record<string, string> = {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: String(entries.length),
  };
  entries.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return env;
}

// Without the owner's global config, which carries git-lfs filters that a
// worktree's .gitattributes could turn into network calls outside the
// sandbox, and without hooks, which could run anything Claude planted.
// fsmonitor's socket is unreachable from the sandbox and only adds noise.
const SAFE_GIT: [string, string][] = [
  ["core.hooksPath", "/dev/null"],
  ["core.fsmonitor", "false"],
];

function toolEnv(cfg: Config): Record<string, string> {
  return {
    HOME: home(),
    USER: Deno.env.get("USER") ?? "",
    PATH: `${dir(cfg.gh)}:${dir(cfg.git)}:/usr/bin:/bin`,
    ...gitConfigEnv([
      ...SAFE_GIT,
      ["credential.https://github.com.helper", `${cfg.gh} auth git-credential`],
      ["user.name", cfg.identity.name],
      ["user.email", cfg.identity.email],
    ]),
  };
}

async function run(
  cfg: Config,
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<string> {
  const out = await new Deno.Command(cmd, {
    args,
    cwd,
    env: toolEnv(cfg),
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(out.stdout);
  if (!out.success) {
    const stderr = new TextDecoder().decode(out.stderr).trim();
    throw new Error(
      `${cmd.split("/").pop()} ${args.join(" ").slice(0, 80)}: ${
        stderr || stdout || `exit ${out.code}`
      }`,
    );
  }
  return stdout.trim();
}

// The worktree's `.git` file sits inside Claude's writable area, so git runs
// against the known gitdir instead of following it.
const gitWt = (cfg: Config, t: Task, args: string[]) =>
  run(cfg, cfg.git, [
    `--git-dir=${gitDirOf(t)}`,
    `--work-tree=${worktreePath(t)}`,
    ...args,
  ], worktreePath(t));

const ensureLabel = (cfg: Config, repo: string) =>
  run(cfg, cfg.gh, [
    "label",
    "create",
    "claude",
    "-R",
    repo,
    "--force",
    "--color",
    "D97757",
  ]);

async function withRepoLock<T>(t: Task, fn: () => Promise<T>): Promise<T> {
  const lock = `${clonePath(t)}.lock`;
  await Deno.mkdir(dir(lock), { recursive: true });
  for (let i = 0;; i++) {
    try {
      await Deno.writeTextFile(lock, String(Deno.pid), { createNew: true });
      break;
    } catch (e) {
      if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
      if (i > 900) throw new Error(`${lock} is held by another run`);
      const st = await Deno.stat(lock).catch((e) => {
        if (e instanceof Deno.errors.NotFound) return null;
        throw e;
      });
      // Only git commands run under the lock, so an old one was left by a
      // crashed script.
      if (st && Date.now() - (st.mtime?.getTime() ?? 0) > LOCK_STALE_MS) {
        await Deno.remove(lock);
      } else if (st) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  try {
    return await fn();
  } finally {
    await Deno.remove(lock).catch(() => {});
  }
}

// What git reads as configuration and code from the clone. The sandbox is
// meant to keep Claude out of these; a change means it did not, and nothing
// the script runs afterwards can be trusted.
async function gitMetadata(t: Task): Promise<string> {
  const read = (p: string) =>
    Deno.readTextFile(p).catch((e) => {
      if (e instanceof Deno.errors.NotFound) return "";
      throw e;
    });
  const git = `${clonePath(t)}/.git`;
  const hooks = await Array.fromAsync(Deno.readDir(`${git}/hooks`)).catch(
    () => [],
  );
  const parts = [
    await read(`${git}/config`),
    await read(`${git}/info/attributes`),
    await read(`${gitDirOf(t)}/config.worktree`),
    await read(`${gitDirOf(t)}/commondir`),
    await read(`${gitDirOf(t)}/gitdir`),
    ...await Promise.all(
      hooks.map((h) => h.name).sort().map(async (name) =>
        `${name}\n${await read(`${git}/hooks/${name}`)}`
      ),
    ),
  ];
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(parts.join("\0")),
  );
  return Array.from(new Uint8Array(digest)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

async function prepareWorktree(cfg: Config, t: Task) {
  await withRepoLock(t, async () => {
    const clone = clonePath(t);
    const exists = await Deno.stat(clone).then(() => true, () => false);
    // HTTPS, so git authenticates through the gh credential helper instead
    // of an SSH agent the launchd environment does not have.
    if (!exists) {
      await run(cfg, cfg.git, [
        "clone",
        "--quiet",
        `https://github.com/${t.owner}/${t.repo}.git`,
        clone,
      ]);
    } else {
      await run(cfg, cfg.git, ["fetch", "--quiet", "--prune", "origin"], clone);
    }
    const ref = await run(
      cfg,
      cfg.git,
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      clone,
    );
    t.defaultBranch = ref.replace(/^origin\//, "");
    await run(cfg, cfg.git, [
      "worktree",
      "add",
      "--quiet",
      "-b",
      `claude/${t.thread}`,
      worktreePath(t),
      ref,
    ], clone);
    t.base = t.head = await gitWt(cfg, t, ["rev-parse", "HEAD"]);
  });
}

async function removeWorktree(cfg: Config, t: Task) {
  await withRepoLock(t, async () => {
    await run(cfg, cfg.git, [
      "worktree",
      "remove",
      "--force",
      worktreePath(t),
    ], clonePath(t)).catch(() => {});
    await run(
      cfg,
      cfg.git,
      ["branch", "-D", `claude/${t.thread}`],
      clonePath(t),
    ).catch(() => {});
  });
  await Deno.remove(`${pnpmDir()}/virtual/${t.thread}`, { recursive: true })
    .catch(() => {});
}

async function runClaude(
  cfg: Config,
  t: Task,
  prompt: string,
): Promise<{ sessionId: string; out: Outcome }> {
  const settings = claudeSettings({
    home: home(),
    worktree: worktreePath(t),
    clone: clonePath(t),
    pnpm: pnpmDir(),
  });
  const child = new Deno.Command(cfg.claude, {
    args: claudeArgv({ settings, prompt, resume: t.sessionId }),
    cwd: worktreePath(t),
    clearEnv: true,
    env: {
      // No credential helper: Claude has nothing to authenticate to.
      HOME: home(),
      USER: Deno.env.get("USER") ?? "",
      ...gitConfigEnv(SAFE_GIT),
      PATH: `${home()}/.local/share/mise/shims:${dir(cfg.git)}:/usr/bin:/bin`,
      SHELL: "/bin/bash",
      TMPDIR: Deno.env.get("TMPDIR") ?? "/tmp",
      MISE_TRUSTED_CONFIG_PATHS: workDir(),
      npm_config_store_dir: `${pnpmDir()}/store`,
      npm_config_cache_dir: `${pnpmDir()}/cache`,
      // Outside the worktree: the sandbox refuses writes to `.idea` and
      // `.vscode` inside the working directory, and some packages ship them.
      npm_config_virtual_store_dir: `${pnpmDir()}/virtual/${t.thread}`,
    },
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  let timedOut = false;
  const kill = (signal: Deno.Signal) => {
    try {
      child.kill(signal);
    } catch {
      // Already exited.
    }
  };
  const term = setTimeout(() => {
    timedOut = true;
    kill("SIGTERM");
  }, CLAUDE_TIMEOUT_MS);
  const hard = setTimeout(() => kill("SIGKILL"), CLAUDE_TIMEOUT_MS + 30_000);
  const res = await child.output();
  clearTimeout(term);
  clearTimeout(hard);
  if (timedOut) throw new Error("45 分で打ち切りました");
  const text = new TextDecoder().decode(res.stdout);
  let json: {
    is_error?: boolean;
    session_id?: string;
    result?: string;
    structured_output?: Outcome;
  };
  try {
    json = JSON.parse(text);
  } catch {
    const err = new TextDecoder().decode(res.stderr).trim();
    throw new Error(`claude の出力を読めません: ${err || text}`.slice(0, 500));
  }
  const out = json.structured_output;
  if (
    json.is_error || !json.session_id || !out ||
    !["pr", "issue", "answer", "nothing"].includes(out.outcome)
  ) {
    throw new Error(
      `claude が失敗しました: ${json.result ?? text}`.slice(0, 500),
    );
  }
  return { sessionId: json.session_id, out };
}

async function publish(cfg: Config, t: Task, out: Outcome): Promise<string> {
  const repo = `${t.owner}/${t.repo}`;
  // Claude is told not to commit, but the sandbox lets it write the shared
  // .git of a worktree; fold anything it committed back into the index.
  await gitWt(cfg, t, ["reset", "--quiet", "--soft", t.head!]);
  await gitWt(cfg, t, ["add", "-A"]);
  const files = splitNul(
    await gitWt(cfg, t, [
      "diff",
      "--cached",
      "--name-only",
      "--no-renames",
      "-z",
      t.head!,
    ]),
  );
  const action = decideAction({
    outcome: out.outcome,
    files,
    hasPr: Boolean(t.pr),
    pushed: t.head !== t.base,
  });
  if (action !== "open-pr" && action !== "update-pr") {
    await gitWt(cfg, t, ["reset", "--quiet", "--hard", t.head!]);
  }
  switch (action) {
    case "refuse-workflow":
      return `${out.summary}\n\n⚠️ \`.github/\` への変更を含むので、変更を捨てて push しませんでした`;
    case "issue": {
      await ensureLabel(cfg, repo);
      const url = await run(cfg, cfg.gh, [
        "issue",
        "create",
        "-R",
        repo,
        "--label",
        "claude",
        "--title",
        out.title || "Claude の報告",
        "--body",
        out.body || out.summary,
      ]);
      t.status = "closed";
      return `${out.summary}\n\nIssue: ${url}`;
    }
    case "close":
      t.status = "closed";
      return out.summary;
    case "answer":
      return out.summary;
  }
  if (files.length > 0) {
    await withRepoLock(t, async () => {
      await gitWt(cfg, t, [
        "commit",
        "--quiet",
        "-m",
        out.commit_message || out.title || "Apply Claude's changes",
      ]);
      // An explicit URL: the clone's remote configuration is not trusted.
      await gitWt(cfg, t, [
        "push",
        "--quiet",
        `https://github.com/${repo}.git`,
        `HEAD:refs/heads/claude/${t.thread}`,
      ]);
    });
    t.head = await gitWt(cfg, t, ["rev-parse", "HEAD"]);
  }
  if (t.pr) return `${out.summary}\n\nPR を更新しました: ${t.pr}`;
  await ensureLabel(cfg, repo);
  t.pr = await run(cfg, cfg.gh, [
    "pr",
    "create",
    "-R",
    repo,
    "--head",
    `claude/${t.thread}`,
    "--base",
    t.defaultBranch!,
    "--label",
    "claude",
    "--title",
    out.title || out.commit_message || "Claude の変更",
    "--body",
    out.body || out.summary,
  ]);
  return `${out.summary}\n\nPR: ${t.pr}\nレビューして問題なければ「マージ」と返信してください`;
}

async function execute(cfg: Config, t: Task, prompt: string) {
  t.status = "running";
  t.startedAt = Date.now();
  await saveTask(t);
  try {
    const before = await gitMetadata(t);
    const { sessionId, out } = await runClaude(cfg, t, prompt);
    t.sessionId = sessionId;
    // Claude has stopped; what remains is git and gh, which the lock bounds.
    t.startedAt = Date.now();
    await saveTask(t);
    if (await gitMetadata(t) !== before) {
      t.status = "closed";
      // The clone itself is no longer trusted: the next task would fetch
      // through its config. It is cloned again from scratch.
      await withRepoLock(
        t,
        () => Deno.remove(clonePath(t), { recursive: true }),
      );
      await Deno.remove(worktreePath(t), { recursive: true }).catch(() => {});
      throw new Error(
        "Claude の実行中に clone の git 設定か hook が変わったので、何も push せずに打ち切り、clone を消しました",
      );
    }
    t.status = "idle";
    const message = await publish(cfg, t, out);
    await postMessage(cfg.channel, message, t.thread);
  } catch (e) {
    if (t.status === "running") t.status = t.sessionId ? "idle" : "closed";
    await postMessage(
      cfg.channel,
      `❌ 失敗しました: ${(e as Error).message}`,
      t.thread,
    );
    throw e;
  } finally {
    if (t.status === "closed") await removeWorktree(cfg, t);
    await saveTask(t);
  }
}

async function pruneOld(cfg: Config) {
  const entries = await Array.fromAsync(Deno.readDir(stateDir())).catch(
    () => [],
  );
  for (const e of entries) {
    if (!e.name.endsWith(".json")) continue;
    const t = await loadTask(e.name.slice(0, -5)).catch(() => undefined);
    if (!t || Date.now() - t.startedAt < TASK_TTL_MS) continue;
    await removeWorktree(cfg, t);
    await Deno.remove(taskFile(t.thread)).catch(() => {});
  }
}

async function begin(
  cfg: Config,
  thread: string,
  req: Request,
  opts: { announce: boolean },
) {
  const t: Task = {
    thread,
    owner: req.owner,
    repo: req.repo,
    status: "running",
    startedAt: Date.now(),
  };
  try {
    await saveTask(t, { createNew: true });
  } catch (e) {
    // Slack redelivered the same message.
    if (e instanceof Deno.errors.AlreadyExists) return;
    throw e;
  }
  if (opts.announce) {
    await postMessage(
      cfg.channel,
      `🛠 ${req.owner}/${req.repo} で作業を始めます`,
      thread,
    );
  }
  await pruneOld(cfg);
  try {
    await prepareWorktree(cfg, t);
  } catch (e) {
    t.status = "closed";
    await saveTask(t);
    await removeWorktree(cfg, t);
    await postMessage(
      cfg.channel,
      `❌ 準備に失敗しました: ${(e as Error).message}`,
      thread,
    );
    throw e;
  }
  await execute(cfg, t, req.task);
}

async function start(cfg: Config, thread: string, text: string) {
  const req = parseRequest(decodeSlack(text), cfg.owners);
  if ("error" in req) {
    await postMessage(cfg.channel, req.error, thread);
    return;
  }
  await begin(cfg, thread, req, { announce: true });
}

async function merge(cfg: Config, t: Task) {
  if (!t.pr) {
    await postMessage(cfg.channel, "マージする PR がありません", t.thread);
    return;
  }
  let state = "unknown";
  for (let i = 0; i < 5 && state === "unknown"; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 5000));
    const pr = JSON.parse(
      await run(cfg, cfg.gh, [
        "pr",
        "view",
        t.pr,
        "--json",
        "mergeable,statusCheckRollup",
      ]),
    );
    state = mergeReadiness(pr);
  }
  if (state !== "ready") {
    const why = {
      failing: "CI が失敗しています",
      pending: "CI がまだ終わっていません",
      conflicting: "コンフリクトしています",
      unknown: "GitHub がマージ可否を判定できていません",
    }[state];
    await postMessage(cfg.channel, `マージしませんでした: ${why}`, t.thread);
    return;
  }
  // From the state directory, outside the clone: gh would otherwise try to
  // check out the base branch that the clone already has checked out. The
  // head check refuses a branch that moved after the owner reviewed it.
  await run(cfg, cfg.gh, [
    "pr",
    "merge",
    t.pr,
    "--squash",
    "--delete-branch",
    "--match-head-commit",
    t.head!,
  ], stateDir());
  t.status = "closed";
  await postMessage(cfg.channel, `✅ マージしました: ${t.pr}`, t.thread);
}

async function reply(cfg: Config, thread: string, text: string) {
  const t = await loadTask(thread);
  if (!t) return;
  if (t.status === "closed") {
    await postMessage(cfg.channel, "この依頼は終了済みです", thread);
    return;
  }
  if (t.status === "running") {
    if (Date.now() - t.startedAt < STALE_RUN_MS) {
      await postMessage(
        cfg.channel,
        "まだ実行中です。終わってから返信してください",
        thread,
      );
      return;
    }
    await postMessage(
      cfg.channel,
      "前回の実行は途中で止まったようです。この返信から続けます",
      thread,
    );
  }
  const body = decodeSlack(text);
  if (!isMergeWord(body)) {
    await execute(cfg, t, body);
    return;
  }
  t.status = "running";
  t.startedAt = Date.now();
  await saveTask(t);
  try {
    await merge(cfg, t);
  } catch (e) {
    await postMessage(
      cfg.channel,
      `❌ マージに失敗しました: ${(e as Error).message}`,
      thread,
    );
    throw e;
  } finally {
    // merge() sets "closed" on success; anything else leaves the PR open.
    if ((t.status as Task["status"]) === "closed") {
      await removeWorktree(cfg, t);
    } else t.status = "idle";
    await saveTask(t);
  }
}

async function explore(cfg: Config, target: string, promptFile: string) {
  const [owner, repo] = target.split("/");
  if (!owner || !repo || !cfg.owners.includes(owner)) {
    throw new Error(`not an allowed repository: ${target}`);
  }
  const open = async (kind: "issue" | "pr") =>
    JSON.parse(
      await run(cfg, cfg.gh, [
        kind,
        "list",
        "-R",
        target,
        "--label",
        "claude",
        "--state",
        "open",
        "--json",
        "number",
      ]),
    ).length;
  if (await open("issue") + await open("pr") > 0) return;
  const task = await Deno.readTextFile(promptFile);
  const thread = await postMessage(
    cfg.channel,
    `🔎 ${target} の探索を始めます`,
  );
  await begin(cfg, thread, { owner, repo, task }, { announce: false });
}

// The commit identity is the only thing taken from the owner's global git
// config; every later git runs without it.
async function gitIdentity(git: string): Promise<Config["identity"]> {
  const get = async (key: string) => {
    const out = await new Deno.Command(git, {
      args: ["config", "--global", "--get", key],
      env: { HOME: home() },
      clearEnv: true,
      stdout: "piped",
    }).output();
    const value = new TextDecoder().decode(out.stdout).trim();
    if (!value) throw new Error(`git ${key} is not set`);
    return value;
  };
  return { name: await get("user.name"), email: await get("user.email") };
}

function parseArgs(
  args: string[],
): { cfg: Omit<Config, "identity">; rest: string[] } {
  const opts: Record<string, string> = {};
  let i = 0;
  while (args[i]?.startsWith("--")) {
    opts[args[i].slice(2)] = args[i + 1];
    i += 2;
  }
  for (const k of ["channel", "owners", "claude", "gh", "git"]) {
    if (!opts[k]) throw new Error(`--${k} is required`);
  }
  return {
    cfg: {
      channel: opts.channel,
      owners: opts.owners.split(","),
      claude: opts.claude,
      gh: opts.gh,
      git: opts.git,
    },
    rest: args.slice(i),
  };
}

const THREAD_TS = /^\d+\.\d+$/;

if (import.meta.main) {
  const parsed = parseArgs(Deno.args);
  const cfg = { ...parsed.cfg, identity: await gitIdentity(parsed.cfg.git) };
  const rest = parsed.rest;
  const [cmd, a, b] = rest;
  if ((cmd === "start" || cmd === "reply") && !THREAD_TS.test(a ?? "")) {
    throw new Error(`not a Slack thread ts: ${a}`);
  }
  if (cmd === "start") await start(cfg, a, b);
  else if (cmd === "reply") await reply(cfg, a, b);
  else if (cmd === "explore") await explore(cfg, a, b);
  else {
    throw new Error(
      "usage: claude-task.ts --channel <id> --owners <a,b> --claude <path> --gh <path> --git <path> start|reply <thread ts> <text> | explore <owner/repo> <prompt file>",
    );
  }
}
