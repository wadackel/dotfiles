import { test } from "bun:test";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
): Promise<{ code: number; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), "bash-policy-breaker-"));
  try {
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
