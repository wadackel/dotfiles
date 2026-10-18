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
// hook loads the co-located global bash-policy.yaml and blocks (exit 2) any
// command whose segment matches a rule pattern; unrelated commands exit 0.

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
  test(`entry point: renovate rule blocks \`${command}\` (exit 2)`, async () => {
    const { code, stderr } = await invokeHook({
      tool_name: "Bash",
      tool_input: { command },
      cwd: "/tmp",
    });
    assertEquals(code, 2, `expected exit 2, got ${code}. stderr=${stderr}`);
    assertStringIncludes(stderr, "stop-updating");
  });
}

test("entry point: a project rule matches through git -C (exit 2)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bash-policy-project-"));
  try {
    await mkdir(join(dir, ".claude"));
    await writeFile(
      join(dir, ".claude", "bash-policy.yaml"),
      'rules:\n  - pattern: "git switch -c *"\n    message: "no branches"\n',
    );
    const { code, stderr } = await invokeHook({
      tool_name: "Bash",
      tool_input: { command: "git -C . switch -c foo" },
      cwd: dir,
    });
    assertEquals(code, 2, `expected exit 2, got ${code}. stderr=${stderr}`);
    assertStringIncludes(stderr, "no branches");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("entry point: reading a renovate branch is not a push (exit 0)", async () => {
  const { code, stderr } = await invokeHook({
    tool_name: "Bash",
    tool_input: { command: "git log --oneline renovate/foo" },
    cwd: "/tmp",
  });
  assertEquals(code, 0, `expected exit 0, got ${code}. stderr=${stderr}`);
});

// --- plan-state.ts run / rerun ---
//
// The helper is in permissions.allow, so the hook has to judge the argv after
// `--` itself. HOME and cwd both point at a temp dir so the test's settings are
// the only ones read.

const HELPER = "~/.agents/scripts/plan-state.ts";

async function helperFixture(
  body: (
    dir: string,
    hook: (command: string) => Promise<{ code: number; stderr: string }>,
  ) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bash-policy-helper-"));
  try {
    await mkdir(join(dir, ".claude"));
    await writeFile(
      join(dir, ".claude", "settings.json"),
      JSON.stringify({
        permissions: {
          allow: [
            "Bash(rg *)",
            "Bash(bun *)",
            "Bash(git push *)",
            "Bash(git fetch *)",
            "Bash(cp *)",
            "Bash(timeout *)",
            "Bash(*/.agents/scripts/plan-state.ts init *)",
            "Bash(*/.agents/scripts/plan-state.ts start *)",
            "Bash(*/.agents/scripts/plan-state.ts require *)",
            "Bash(*/.agents/scripts/plan-state.ts snapshot *)",
            "Bash(*/.agents/scripts/plan-state.ts record *)",
            "Bash(*/.agents/scripts/plan-state.ts append-evidence *)",
            "Bash(*/.agents/scripts/plan-state.ts coverage *)",
            "Bash(*/.agents/scripts/plan-state.ts complete *)",
            "Bash(*/.agents/scripts/plan-state.ts reconcile *)",
          ],
          deny: ["Bash(git push -f origin main)"],
        },
      }),
    );
    const hook = async (command: string) => {
      const { code, stderr } = await run(HOOK_SCRIPT, [], {
        stdin: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command },
          cwd: dir,
        }),
        env: { HOME: dir },
      });
      return { code, stderr };
    };
    await body(dir, hook);
  } finally {
    await rm(dir, { recursive: true });
  }
}

const RUN = `${HELPER} run /tmp/e.evidence.json task-1 cc-1`;

for (
  const [name, command, reason] of [
    ["a rule", `${RUN} -- git push origin renovate/x`, "stop-updating"],
    [
      "permissions.deny",
      `${RUN} -- git push -f origin main`,
      "permissions.deny",
    ],
    [
      "permissions.deny behind --env",
      `${RUN} --env CI=1 -- git push -f origin main`,
      "permissions.deny",
    ],
    [
      "a command outside permissions.allow",
      `${RUN} -- rm -rf /tmp/x`,
      "not in permissions.allow",
    ],
    [
      "an --env key outside the safe list",
      `${RUN} --env GIT_SSH_COMMAND=x -- git fetch origin`,
      "--env GIT_SSH_COMMAND",
    ],
    ["a prefix assignment", `X=1 ${RUN} -- rg -n foo .`, "whole command"],
    ["a wrapper", `timeout 60 ${RUN} -- rg -n foo .`, "whole command"],
    [
      "a shell string",
      `bash -c "${RUN} -- git push -f origin main"`,
      "installed path",
    ],
    [
      "a compound",
      `cp a b && ${HELPER} rerun /tmp/e.evidence.json`,
      "whole command",
    ],
    [
      "a nested helper",
      `${RUN} -- home/programs/agents/scripts/plan-state.ts run /tmp/f.evidence.json task-1 cc-1 -- rg -n foo .`,
      "may not invoke plan-state.ts",
    ],
    ["an unexpanded variable", `${RUN} -- rg $X .`, "contains $"],
    ["a missing --", `${RUN} rg -n foo .`, "-- <command>"],
    [
      "an expanded subcommand",
      `${HELPER} $CMD /tmp/e.evidence.json task-1 cc-1 -- rg -n foo .`,
      "literal subcommand",
    ],
    [
      "a brace expansion",
      `${RUN} -- git push -f origin {main,}`,
      "brace expansion",
    ],
    [
      "a wrapper handing the helper its words",
      `xargs ${HELPER} run /tmp/e.evidence.json task-1 cc-1 --`,
      "whole command",
    ],
    [
      "a wrapper that clears CLAUDECODE",
      `command env -u CLAUDECODE ${RUN} -- rg -n foo .`,
      "whole command",
    ],
    ["exec", `exec ${RUN} -- rg -n foo .`, "whole command"],
    [
      "find -exec with a shell string",
      `find . -maxdepth 0 -exec sh -c '${RUN} -- rg -n foo .' \;`,
      "installed path",
    ],
    ["the installed path as data", `rg -n foo ${HELPER}`, "installed path"],
    [
      "a heredoc fed to a shell",
      `bash <<'EOF'\n${RUN} -- rm -rf /\nEOF`,
      "installed path",
    ],
    [
      "a passive call inside a substitution",
      `T=$(${HELPER} snapshot /tmp/e.evidence.json)`,
      "installed path",
    ],
    [
      "a passive call beside a shell string",
      `${HELPER} snapshot /tmp/e.evidence.json; bash -c '${RUN} -- rm -rf /'`,
      "installed path",
    ],
    [
      "a prefix assignment on a passive subcommand",
      `GIT_CONFIG_PARAMETERS=x ${HELPER} snapshot /tmp/e.evidence.json`,
      "passive plan-state.ts subcommand",
    ],
    [
      "a file redirect on a passive subcommand",
      `${HELPER} snapshot /tmp/e.evidence.json > /tmp/out`,
      "passive plan-state.ts subcommand",
    ],
    [
      "a substitution in a passive subcommand",
      `${HELPER} snapshot "$(echo /tmp/e.evidence.json)"`,
      "passive plan-state.ts subcommand",
    ],
    [
      "a second line hidden behind a quoted heredoc operator",
      `${RUN} -- rg -n '<<EOF' .\nrm -rf /tmp/x\nEOF`,
      "single line",
    ],
    [
      "a passive head obfuscated with quotes beside a shell string",
      `~/.agents/scripts/plan-state.t's' coverage /tmp/e.evidence.json; bash -c 'id #${HELPER}'`,
      "installed path",
    ],
    [
      "a redirect of both streams to a file on a passive subcommand",
      `${HELPER} snapshot /tmp/e.evidence.json >&/tmp/out`,
      "passive plan-state.ts subcommand",
    ],
    [
      "a quote-split helper name with a prefix assignment",
      `GIT_CONFIG_PARAMETERS=x ~/.agents/scripts/plan-state.t's' snapshot /tmp/e.evidence.json`,
      "passive plan-state.ts subcommand",
    ],
    [
      "an unquoted heredoc delimiter on a passive subcommand",
      `${HELPER} append-evidence /tmp/e.evidence.json task-1 <<EOF\nx\nEOF`,
      "quote the heredoc delimiter",
    ],
    [
      "a heredoc delimiter unquoted behind a line continuation",
      `${HELPER} append-evidence /tmp/e.evidence.json task-1 <<\\\nEOF\nx\nEOF`,
      "quote the heredoc delimiter",
    ],
    [
      "a wrapper at the head of the inner argv",
      `${RUN} -- timeout 9 git push -f origin main`,
      "wrapper",
    ],
    [
      "an expansion in an option value",
      `${RUN} --grep "\${X}" -- rg -n foo .`,
      "contains $",
    ],
  ] as const
) {
  test(`run: blocks ${name} (exit 2)`, async () => {
    await helperFixture(async (_dir, hook) => {
      const { code, stderr } = await hook(command);
      assertEquals(code, 2, `expected exit 2, got ${code}. stderr=${stderr}`);
      assertStringIncludes(stderr, reason);
    });
  });
}

for (
  const [name, command] of [
    ["an allowed command", `${RUN} -- rg -n foo .`],
    [
      "an allowed command with a safe --env",
      `${RUN} --env CLAUDECODE= --grep 'pass|fail' -- bun test x`,
    ],
    [
      "a heredoc that quotes the worktree path",
      `cat > /dev/null <<'EOF'\nhome/programs/agents/scripts/plan-state.ts run e.json task-1 cc-1 -- rm -rf /\nEOF`,
    ],
    ["a search for the helper's name", `rg -n 'plan-state.ts run' home`],
    [
      "the helper's path as data",
      `sed -n '1,3p' home/programs/agents/scripts/plan-state.ts`,
    ],
    ["a passive subcommand", `${HELPER} snapshot /tmp/e.evidence.json`],
    [
      "a passive subcommand fed by a pipe",
      `echo '[{"id":"cc-1","kind":"file-state"}]' | ${HELPER} require /tmp/e.evidence.json task-1`,
    ],
    [
      "a passive subcommand after cd",
      `cd /tmp && ${HELPER} start /tmp/e.evidence.json task-1`,
    ],
    [
      "a passive subcommand with a heredoc",
      `${HELPER} record /tmp/e.evidence.json task-1 <<'EOF'\n{"id":"cc-1"}\nEOF`,
    ],
    [
      "a passive subcommand with stderr dropped",
      `${HELPER} snapshot /tmp/e.evidence.json 2>/dev/null`,
    ],
    [
      "a passive subcommand with stderr joined to stdout",
      `${HELPER} snapshot /tmp/e.evidence.json 2>&1`,
    ],
    [
      "a passive subcommand with a quoted dash-heredoc",
      `${HELPER} record /tmp/e.evidence.json task-1 <<-'EOF'\n\t{"id":"cc-1"}\n\tEOF`,
    ],
  ] as const
) {
  test(`run: lets ${name} through (exit 0)`, async () => {
    await helperFixture(async (_dir, hook) => {
      const { code, stderr } = await hook(command);
      assertEquals(code, 0, `expected exit 0, got ${code}. stderr=${stderr}`);
    });
  });
}

async function writeSidecar(dir: string, argv: string[]): Promise<string> {
  const path = join(dir, "p.evidence.json");
  await writeFile(
    path,
    JSON.stringify({
      plan: "p.md",
      tasks: [{
        id: "task-1",
        subject: "s",
        checks: [
          {
            id: "cc-1",
            status: "pass",
            target: "t",
            command: "c",
            output: "o",
            argv: ["rg", "-n", "foo", "."],
          },
          {
            id: "cc-2",
            status: "pass",
            target: "t",
            command: "c",
            output: "o",
            argv,
          },
        ],
      }, { id: "task-2", subject: "Final Audit + Review" }],
    }),
  );
  return path;
}

test("rerun: blocks a sidecar holding a denied argv (exit 2)", async () => {
  await helperFixture(async (dir, hook) => {
    const path = await writeSidecar(dir, [
      "git",
      "push",
      "-f",
      "origin",
      "main",
    ]);
    const { code, stderr } = await hook(`${HELPER} rerun ${path}`);
    assertEquals(code, 2, `expected exit 2, got ${code}. stderr=${stderr}`);
    assertStringIncludes(stderr, "stored check cc-2");
  });
});

test("rerun: blocks an unreadable or non-literal evidence path (exit 2)", async () => {
  await helperFixture(async (dir, hook) => {
    const missing = await hook(
      `${HELPER} rerun ${join(dir, "nope.evidence.json")}`,
    );
    assertEquals(missing.code, 2, missing.stderr);
    assertStringIncludes(missing.stderr, "cannot read");
    const expanded = await hook(`${HELPER} rerun $E`);
    assertEquals(expanded.code, 2, expanded.stderr);
    assertStringIncludes(expanded.stderr, "literal evidence path");
  });
});

test("rerun: lets a sidecar whose argv are all allowed through (exit 0)", async () => {
  await helperFixture(async (dir, hook) => {
    const path = await writeSidecar(dir, ["bun", "test", "x"]);
    const { code, stderr } = await hook(`${HELPER} rerun ${path}`);
    assertEquals(code, 0, `expected exit 0, got ${code}. stderr=${stderr}`);
  });
});

test("rerun: blocks a sidecar the hook cannot understand (exit 2)", async () => {
  await helperFixture(async (dir, hook) => {
    const path = join(dir, "p.evidence.json");
    await writeFile(path, "null");
    const nul = await hook(`${HELPER} rerun ${path}`);
    assertEquals(nul.code, 2, nul.stderr);
    await writeFile(
      path,
      JSON.stringify({ tasks: [{ checks: [{ id: "x", argv: [1] }] }] }),
    );
    const malformed = await hook(`${HELPER} rerun ${path}`);
    assertEquals(malformed.code, 2, malformed.stderr);
    assertStringIncludes(malformed.stderr, "malformed argv");
  });
});
