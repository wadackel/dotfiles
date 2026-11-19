import { test } from "bun:test";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../agents/lib/proc.ts";
import { loadRules } from "./bash-policy.ts";

test("loadRules: parses rules from a YAML file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmp-"));
  const path = `${dir}/bash-policy.yaml`;
  await writeFile(
    path,
    'rules:\n  - pattern: "git -C *"\n    message: "no git -C"\n',
  );
  const rules = await loadRules(path);
  assertEquals(rules.length, 1);
  assertEquals(rules[0].pattern, "git -C *");
  assertEquals(rules[0].message, "no git -C");
  await rm(dir, { recursive: true });
});

test("loadRules: returns [] on missing file", async () => {
  const rules = await loadRules("/nonexistent/bash-policy.yaml");
  assertEquals(rules, []);
});

// --- Entry-point integration ---
//
// Spawn bash-policy.ts as a subprocess and feed PreToolUse JSON via stdin. The
// hook loads the global and the project bash-policy.yaml and blocks (exit 2)
// any command whose segment matches a rule pattern; unrelated commands exit 0.
// The global file ships empty, so a rule under test lives in a temp project.

const HOOK_SCRIPT = join(import.meta.dirname, "bash-policy.ts");

async function invokeHook(hookInput: {
  tool_name: string;
  tool_input: { command: string };
  cwd?: string;
}): Promise<{ code: number; stderr: string }> {
  const { code, stderr } = await run(HOOK_SCRIPT, [], {
    stdin: JSON.stringify(hookInput),
  });
  return { code, stderr };
}

async function withProjectRules(
  yaml: string,
  body: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bash-policy-project-"));
  try {
    await mkdir(join(dir, ".claude"));
    await writeFile(join(dir, ".claude", "bash-policy.yaml"), yaml);
    await body(dir);
  } finally {
    await rm(dir, { recursive: true });
  }
}

const RENOVATE_RULES =
  'rules:\n  - pattern: "git push *renovate/*"\n    message: "use stop-updating"\n';

test("entry point: `git -C` passes (exit 0)", async () => {
  const { code, stderr } = await invokeHook({
    tool_name: "Bash",
    tool_input: { command: "git -C /tmp status" },
    cwd: "/tmp",
  });
  assertEquals(code, 0, `expected exit 0, got ${code}. stderr=${stderr}`);
  assertEquals(stderr, "");
});

test("entry point: unrelated command passes (exit 0)", async () => {
  const { code, stderr } = await invokeHook({
    tool_name: "Bash",
    tool_input: { command: "ls /tmp" },
    cwd: "/tmp",
  });
  assertEquals(code, 0, `expected exit 0, got ${code}. stderr=${stderr}`);
  assertEquals(stderr, "");
});

test("entry point: non-Bash tool is ignored (exit 0)", async () => {
  const { code } = await invokeHook({
    tool_name: "Edit",
    tool_input: { command: "git push origin renovate/foo" },
    cwd: "/tmp",
  });
  assertEquals(code, 0);
});

for (
  const command of [
    "git push origin renovate/foo",
    "git push -f origin HEAD:renovate/foo",
    "git push renovate/foo",
    "git -C /tmp push origin renovate/foo",
    "git -c a=b push origin renovate/foo",
  ]
) {
  test(`entry point: a push rule blocks \`${command}\` (exit 2)`, async () => {
    await withProjectRules(RENOVATE_RULES, async (dir) => {
      const { code, stderr } = await invokeHook({
        tool_name: "Bash",
        tool_input: { command },
        cwd: dir,
      });
      assertEquals(code, 2, `expected exit 2, got ${code}. stderr=${stderr}`);
      assertStringIncludes(stderr, "stop-updating");
    });
  });
}

test("entry point: a project rule matches through git -C (exit 2)", async () => {
  await withProjectRules(
    'rules:\n  - pattern: "git switch -c *"\n    message: "no branches"\n',
    async (dir) => {
      const { code, stderr } = await invokeHook({
        tool_name: "Bash",
        tool_input: { command: "git -C . switch -c foo" },
        cwd: dir,
      });
      assertEquals(code, 2, `expected exit 2, got ${code}. stderr=${stderr}`);
      assertStringIncludes(stderr, "no branches");
    },
  );
});

test("entry point: reading a renovate branch is not a push (exit 0)", async () => {
  await withProjectRules(RENOVATE_RULES, async (dir) => {
    const { code, stderr } = await invokeHook({
      tool_name: "Bash",
      tool_input: { command: "git log --oneline renovate/foo" },
      cwd: dir,
    });
    assertEquals(code, 0, `expected exit 0, got ${code}. stderr=${stderr}`);
  });
});

// --- breaker-reviewer: a few commands that leave its worktree are refused for it alone ---

async function asAgent(
  command: string,
  agent: { agent_id?: string; agent_type?: string },
  setup?: (dir: string) => Promise<void>,
): Promise<{ code: number; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), "bash-policy-breaker-"));
  try {
    await setup?.(dir);
    const { code, stderr } = await run(HOOK_SCRIPT, [], {
      stdin: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command },
        cwd: dir,
        ...agent,
      }),
    });
    return { code, stderr };
  } finally {
    await rm(dir, { recursive: true });
  }
}

const BREAKER = { agent_id: "a1", agent_type: "breaker-reviewer" };

for (
  const command of [
    "tmux kill-server",
    "cd /tmp && tmux new-session -d",
    "launchctl list",
    "curl https://example.com",
    "wget https://example.com",
  ]
) {
  test(`breaker-reviewer: \`${command}\` is refused (exit 2)`, async () => {
    const { code, stderr } = await asAgent(command, BREAKER);
    assertEquals(code, 2, `expected exit 2, got ${code}. stderr=${stderr}`);
    assertStringIncludes(stderr, "breaker-reviewer");
  });
}

for (
  const command of [
    "tmux -L replay ls",
    "tmux -S /tmp/sock new-session -d",
    "rg -n tmux .",
  ]
) {
  test(`breaker-reviewer: \`${command}\` passes (exit 0)`, async () => {
    const { code, stderr } = await asAgent(command, BREAKER);
    assertEquals(code, 0, `expected exit 0, got ${code}. stderr=${stderr}`);
  });
}

test("the breaker-only refusal does not apply to the main session or another agent", async () => {
  for (
    const agent of [{}, { agent_id: "a2" }, {
      agent_id: "a3",
      agent_type: "code-reviewer",
    }]
  ) {
    const { code, stderr } = await asAgent("tmux kill-server", agent);
    assertEquals(code, 0, `${JSON.stringify(agent)}: ${stderr}`);
  }
});

for (
  const command of [
    "tmux capture-pane -p -S -",
    "tmux send-keys -t 0 -- -S Enter",
    "timeout 5 tmux kill-server",
    "env FOO=1 tmux kill-server",
    "command tmux kill-server",
    "nohup curl https://example.com",
    "sudo -n launchctl list",
    "xargs -0 curl",
    'bash -c "curl https://example.com"',
  ]
) {
  test(`breaker-reviewer: \`${command}\` is refused through its wrapper or subcommand option (exit 2)`, async () => {
    const { code, stderr } = await asAgent(command, BREAKER);
    assertEquals(code, 2, `expected exit 2, got ${code}. stderr=${stderr}`);
  });
}

test("breaker-reviewer: a private socket given before the tmux subcommand passes", async () => {
  for (
    const command of [
      "tmux -L replay capture-pane -p -S -",
      "timeout 5 tmux -S /tmp/sock kill-server",
    ]
  ) {
    const { code, stderr } = await asAgent(command, BREAKER);
    assertEquals(code, 0, `${command}: ${stderr}`);
  }
});

test("breaker-reviewer: tmux naming the user's own default socket is refused", async () => {
  for (
    const command of [
      "tmux -L default kill-server",
      "tmux -S /private/tmp/tmux-501/default kill-server",
    ]
  ) {
    const { code, stderr } = await asAgent(command, BREAKER);
    assertEquals(code, 2, `${command}: ${stderr}`);
  }
});

test("breaker-reviewer: more wrapper options and combined shell flags are refused", async () => {
  for (
    const command of [
      "env -u X tmux kill-server",
      "env -S 'curl https://example.com'",
      "xargs -a list.txt curl",
      "timeout --signal KILL 5 tmux kill-server",
      "bash -lc 'curl https://example.com'",
    ]
  ) {
    const { code, stderr } = await asAgent(command, BREAKER);
    assertEquals(code, 2, `${command}: ${stderr}`);
  }
});

// --- exploratory-session: what reaches the user's side is refused for it alone ---

const EXPLORER = { agent_id: "e1", agent_type: "exploratory-session" };

for (
  const command of [
    "tmux new-window",
    "tmux -S /private/tmp/tmux-501/default kill-server",
    "launchctl list",
    "gh issue create -R o/r --title t --body b",
    "gh pr merge 3",
    "gh api repos/o/r/issues -f title=t",
    "gh api -X DELETE repos/o/r",
    "gh auth token",
    "git push origin main",
    "git -C /repo push",
    "git worktree add ../wt",
    'bash -c "gh issue comment 1 --body x"',
  ]
) {
  test(`exploratory-session: \`${command}\` is refused (exit 2)`, async () => {
    const { code, stderr } = await asAgent(command, EXPLORER);
    assertEquals(code, 2, `expected exit 2, got ${code}. stderr=${stderr}`);
    assertStringIncludes(stderr, "exploratory-session");
  });
}

for (
  const command of [
    "tmux -S /private/tmp/xs-AbC123/tmux-501/default capture-pane -p -t app",
    "tmux -S /tmp/xs-AbC123/tmux-501/default send-keys -t app q",
    "gh issue list --state all --search crash",
    "gh pr view 3",
    "gh api repos/o/r/issues",
    "gh api -X GET search/issues -f q=crash",
    "git status",
    "git worktree list",
    "curl -s http://127.0.0.1:3000/api/notes",
    "explore-sandbox.ts exec /sb -- git push origin main",
  ]
) {
  test(`exploratory-session: \`${command}\` passes (exit 0)`, async () => {
    const { code, stderr } = await asAgent(command, EXPLORER);
    assertEquals(code, 0, `expected exit 0, got ${code}. stderr=${stderr}`);
  });
}

test("the exploratory-session refusal does not apply to the main session or the breaker's network rule", async () => {
  assertEquals((await asAgent("gh issue create -R o/r --title t --body b", {})).code, 0);
  assertEquals((await asAgent("curl -s http://127.0.0.1:3000", EXPLORER)).code, 0);
  assertEquals((await asAgent("tmux -S /private/tmp/xs-AbC123/tmux-501/default kill-server", BREAKER)).code, 2);
});

test("exploratory-session: a shell script it runs is read and its commands refused", async () => {
  const bareTmux = async (dir: string) => {
    await writeFile(join(dir, "drive.sh"), "#!/bin/sh\nset -e\ntmux new -d -s app 'sleep 5'\n");
    await chmod(join(dir, "drive.sh"), 0o755);
    await writeFile(join(dir, "outer.sh"), "#!/bin/bash\nsh ./drive.sh\n");
  };
  for (const command of ["bash drive.sh", "sh -e drive.sh", "./drive.sh", "source drive.sh", ". ./drive.sh", "bash outer.sh"]) {
    const { code, stderr } = await asAgent(command, EXPLORER, bareTmux);
    assertEquals(code, 2, `${command}: ${stderr}`);
    assertStringIncludes(stderr, "in the script");
  }
  const sandboxed = async (dir: string) => {
    await writeFile(join(dir, "ok.sh"), "#!/bin/sh\ntmux -S /private/tmp/xs-AbC123/tmux-501/default capture-pane -p -t app\n");
  };
  assertEquals((await asAgent("bash ok.sh", EXPLORER, sandboxed)).code, 0);
  assertEquals((await asAgent("bash drive.sh", {}, bareTmux)).code, 0);
});

for (
  const command of [
    "/usr/bin/git -C /repo push",
    "git -P push",
    "git --no-optional-locks push origin main",
    "gh api repos/o/r/issues -ftitle=x",
    "gh api --input=body.json repos/o/r/issues",
    "gh auth status --show-token",
    "gh ssh-key add key.pub",
    "gh extension install x/y",
    "explore-sandbox.ts exec /sb -- tmux -S /private/tmp/tmux-501/default kill-server",
    "explore-sandbox.ts exec /sb -- git -C /repo worktree add -b x /tmp/wt",
  ]
) {
  test(`exploratory-session: \`${command}\` is refused past its spelling (exit 2)`, async () => {
    const { code, stderr } = await asAgent(command, EXPLORER);
    assertEquals(code, 2, `expected exit 2, got ${code}. stderr=${stderr}`);
  });
}

for (
  const command of [
    "gh search issues crash",
    "gh auth status",
    "explore-sandbox.ts exec /sb -- tmux kill-server",
    "explore-sandbox.ts exec /sb -- git -C /sb/state/repo status",
  ]
) {
  test(`exploratory-session: \`${command}\` still passes (exit 0)`, async () => {
    const { code, stderr } = await asAgent(command, EXPLORER);
    assertEquals(code, 0, `expected exit 0, got ${code}. stderr=${stderr}`);
  });
}

test("exploratory-session: a git alias that expands to push is refused", async () => {
  const { code, stderr } = await asAgent("git pf origin main", EXPLORER, async (dir) => {
    await run("git", ["init", "-q"], { cwd: dir });
    await run("git", ["config", "alias.pf", "push --force-with-lease"], { cwd: dir });
  });
  assertEquals(code, 2, stderr);
});

// --- Deliverable hint ---

test("publishesText: creating a PR or an Issue, or editing its text, publishes", async () => {
  const { publishesText } = await import("./bash-policy.ts");
  const { getSegments } = await import("./shell-utils.ts");
  const cases: [string, boolean][] = [
    ["gh pr create --title x --body-file /tmp/b.md", true],
    ["gh issue create -t bug -b body", true],
    ["gh -R owner/repo pr create --fill", true],
    ["gh pr edit 12 --body-file /tmp/b.md", true],
    ["gh issue edit 3 --title=new", true],
    ["env GH_PROMPT_DISABLED=1 gh pr create -F /tmp/b.md", true],
    ['bash -c "gh issue create -t x -b y"', true],
    ["gh issue edit 3 --add-label bug", false],
    ["gh pr view 12", false],
    ["gh pr list --state open", false],
    ["git commit -m 'gh pr create'", false],
    ["URL=$(gh pr create --title x --body-file /tmp/b.md)", true],
    ["url=$(gh issue create -t a -b b) && echo $url", true],
    ["gh pr new --title x --body-file /tmp/b.md", true],
    ["gh issue new -t x -b y", true],
    ["gh pr edit 12 -tNewTitle", true],
    ["gh issue edit 3 -F/tmp/b.md", true],
    ['gh pr create --title "Add --dry-run option" --body-file /tmp/b.md', true],
    ["gh pr create --help", false],
    ["gh issue create -h", false],
    ["gh pr create --title x --body y --dry-run", false],
    ["gh help pr create", false],
    ['gh search issues "pr create fails"', false],
    ['gh release create v1 --notes "issue create"', false],
  ];
  for (const [command, expected] of cases) {
    assertEquals(await publishesText(await getSegments(command), command), expected, command);
  }
});

test("takeDeliverableHint: once per session and subagent, never without a session", async () => {
  const { takeDeliverableHint } = await import("./bash-policy.ts");
  const dir = await mkdtemp(join(tmpdir(), "deliverable-hint-"));
  try {
    assertEquals(takeDeliverableHint({ session_id: "s1" }, dir), true);
    assertEquals(takeDeliverableHint({ session_id: "s1" }, dir), false);
    assertEquals(takeDeliverableHint({ session_id: "s1", agent_id: "a1" }, dir), true);
    assertEquals(takeDeliverableHint({ session_id: "s2" }, dir), true);
    assertEquals(takeDeliverableHint({}, dir), false);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("entry point: the first PR creation of a session is held back with the hint, the retry passes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "deliverable-hint-entry-"));
  try {
    const call = () =>
      run(HOOK_SCRIPT, [], {
        stdin: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "gh pr create --title x --body-file /tmp/b.md" },
          session_id: "entry-session",
        }),
        env: { TMPDIR: dir },
      });
    const first = await call();
    assertEquals(first.code, 2, first.stderr);
    assertStringIncludes(first.stderr, "writing-clarity");
    const second = await call();
    assertEquals(second.code, 0, second.stderr);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("alreadyRevised: a transcript that loaded writing-clarity counts as revised", async () => {
  const { alreadyRevised } = await import("./bash-policy.ts");
  const dir = await mkdtemp(join(tmpdir(), "deliverable-transcript-"));
  try {
    const loaded = join(dir, "loaded.jsonl");
    await writeFile(loaded, '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"writing-clarity"}}]}}\n');
    const other = join(dir, "other.jsonl");
    await writeFile(other, '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"create-pr"}}]}}\n{"type":"user","message":{"content":[{"type":"tool_result","content":"return t.includes(\'\\"input\\":{\\"skill\\":\\"writing-clarity\\"\'); <command-name>/writing-clarity</command-name>"}]}}\n');
    assertEquals(await alreadyRevised(loaded), true);
    assertEquals(await alreadyRevised(other), false);
    assertEquals(await alreadyRevised(join(dir, "missing.jsonl")), false);
    assertEquals(await alreadyRevised(undefined), false);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("entry point: a project rule that refuses the command shows its own reason before the hint", async () => {
  await withProjectRules(
    'rules:\n  - pattern: "gh pr create*"\n    message: "PROJECT RULE"\n',
    async (dir) => {
      const tmp = await mkdtemp(join(tmpdir(), "deliverable-rule-"));
      try {
        const { code, stderr } = await run(HOOK_SCRIPT, [], {
          stdin: JSON.stringify({
            tool_name: "Bash",
            tool_input: { command: "gh pr create -t x -b y" },
            session_id: "rule-session",
            cwd: dir,
          }),
          env: { TMPDIR: tmp },
        });
        assertEquals(code, 2, stderr);
        assertStringIncludes(stderr, "PROJECT RULE");
      } finally {
        await rm(tmp, { recursive: true });
      }
    },
  );
});

test("entry point: CLAUDE_DELIVERABLE_HINT_SKIP=1 lets the first PR creation through", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "deliverable-skip-"));
  try {
    const { code, stderr } = await run(HOOK_SCRIPT, [], {
      stdin: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "gh pr create -t x -b y" },
        session_id: "skip-session",
      }),
      env: { TMPDIR: tmp, CLAUDE_DELIVERABLE_HINT_SKIP: "1" },
    });
    assertEquals(code, 0, stderr);
  } finally {
    await rm(tmp, { recursive: true });
  }
});

test("ownTranscript: a subagent reads its own transcript beside the session's", async () => {
  const { ownTranscript } = await import("./bash-policy.ts");
  assertEquals(ownTranscript({ transcript_path: "/p/s1.jsonl" }), "/p/s1.jsonl");
  assertEquals(
    ownTranscript({ transcript_path: "/p/s1.jsonl", agent_id: "a7" }),
    "/p/s1/subagents/agent-a7.jsonl",
  );
  assertEquals(ownTranscript({ agent_id: "a7" }), undefined);
});
