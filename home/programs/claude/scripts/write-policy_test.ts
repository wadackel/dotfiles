// write-policy: allow — this file holds the real identifier as test data.
import { test } from "bun:test";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../agents/lib/proc.ts";
import {
  findIdentifiers,
  hintKey,
  isFixturePath,
  newContent,
  SKILL_HINT,
  takeSkillHint,
} from "./write-policy.ts";

const HOOK_SCRIPT = join(import.meta.dirname, "write-policy.ts");

async function invokeHook(
  hookInput: Record<string, unknown>,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { code, stdout, stderr } = await run(HOOK_SCRIPT, [], {
    stdin: JSON.stringify(hookInput),
    env,
  });
  return { code, stdout, stderr };
}

test("isFixturePath matches test directories and test file names", () => {
  assertEquals(isFixturePath("/r/tests/fixtures/a.json"), true);
  assertEquals(isFixturePath("/r/src/foo_test.ts"), true);
  assertEquals(isFixturePath("/r/src/foo.spec.ts"), true);
  assertEquals(isFixturePath("/r/src/foo.ts"), false);
});

test("findIdentifiers and newContent cover the three tools", () => {
  assertEquals(findIdentifiers("x wadackels-MacBook y"), [
    "wadackels-MacBook",
    "wadackel",
  ]);
  assertEquals(
    newContent({ tool_name: "Write", tool_input: { content: "a" } }),
    "a",
  );
  assertEquals(
    newContent({ tool_name: "Edit", tool_input: { new_string: "b" } }),
    "b",
  );
  assertEquals(
    newContent({
      tool_name: "MultiEdit",
      tool_input: { edits: [{ new_string: "c" }, { new_string: "d" }] },
    }),
    "c\nd",
  );
});

test("entry point: a fixture write with the user name is blocked (exit 2)", async () => {
  const { code, stderr } = await invokeHook({
    tool_name: "Write",
    tool_input: {
      file_path: "/tmp/nonexistent-repo/tests/fixtures/a.json",
      content: '{"home": "/Users/wadackel"}',
    },
  });
  assertEquals(code, 2, stderr);
  assertStringIncludes(stderr, '[write-policy] Personal identifier "wadackel"');
  assertStringIncludes(stderr, "write-policy: allow");
  assertStringIncludes(
    stderr,
    "Blocked: /tmp/nonexistent-repo/tests/fixtures/a.json",
  );
});

test("entry point: the same content outside a fixture path passes (exit 0)", async () => {
  const { code } = await invokeHook({
    tool_name: "Write",
    tool_input: {
      file_path: "/tmp/nonexistent-repo/src/config.ts",
      content: "const home = '/Users/wadackel';",
    },
  });
  assertEquals(code, 0);
});

test("entry point: a placeholder path in a fixture passes (exit 0)", async () => {
  const { code } = await invokeHook({
    tool_name: "Write",
    tool_input: {
      file_path: "/tmp/nonexistent-repo/fixtures/a.json",
      content: '{"home": "/Users/me"}',
    },
  });
  assertEquals(code, 0);
});

test("entry point: MultiEdit is blocked when a later edit carries the identifier", async () => {
  const { code, stderr } = await invokeHook({
    tool_name: "MultiEdit",
    tool_input: {
      file_path: "/tmp/nonexistent-repo/src/a_test.ts",
      edits: [{ old_string: "x", new_string: "y" }, {
        old_string: "z",
        new_string: "tsuyoshi.wada",
      }],
    },
  });
  assertEquals(code, 2, stderr);
  assertStringIncludes(stderr, '"tsuyoshi.wada"');
});

test("entry point: an existing fixture that already carries the identifier stays editable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "write-policy-"));
  try {
    const path = `${dir}/fixtures/existing_test.ts`;
    await mkdir(`${dir}/fixtures`);
    await writeFile(path, 'const p = "/Users/wadackel/dotfiles";\n');
    const same = await invokeHook({
      tool_name: "Edit",
      tool_input: {
        file_path: path,
        old_string: "dotfiles",
        new_string: "wadackel/other",
      },
    });
    assertEquals(same.code, 0, same.stderr);
    const longer = await invokeHook({
      tool_name: "Edit",
      tool_input: {
        file_path: path,
        old_string: "dotfiles",
        new_string: "wadackels-MacBook",
      },
    });
    assertEquals(longer.code, 2, longer.stderr);
    assertStringIncludes(longer.stderr, '"wadackels-MacBook"');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("entry point: the allow marker in the new content passes (exit 0)", async () => {
  const { code } = await invokeHook({
    tool_name: "Write",
    tool_input: {
      file_path: "/tmp/nonexistent-repo/tests/a.json",
      content: "// write-policy: allow\nwadackel",
    },
  });
  assertEquals(code, 0);
});

test("entry point: other tools and malformed input are ignored (exit 0)", async () => {
  const other = await invokeHook({
    tool_name: "Bash",
    tool_input: { command: "echo wadackel > tests/x" },
  });
  assertEquals(other.code, 0);
  const malformed = await run(HOOK_SCRIPT, [], { stdin: "not json" });
  assertEquals(malformed.code, 0);
});

test("takeSkillHint returns the hint once per session, only for a SKILL.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skill-hint-"));
  try {
    assertEquals(takeSkillHint("/r/src/a.ts", "s1", dir), null);
    assertEquals(takeSkillHint("/r/skills/x/SKILL.md.bak", "s1", dir), null);
    assertEquals(takeSkillHint("/r/skills/x/MYSKILL.md", "s1", dir), null);
    assertEquals(takeSkillHint("/r/skills/x/SKILL.md", "s1", dir), SKILL_HINT);
    assertEquals(takeSkillHint("/r/skills/y/SKILL.md", "s1", dir), null);
    assertEquals(takeSkillHint("/r/skills/y/SKILL.md", "s2", dir), SKILL_HINT);
    assertEquals(takeSkillHint("SKILL.md", undefined, dir), SKILL_HINT);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("entry point: the first SKILL.md edit of a session gets the hint as context", async () => {
  const session_id = `write-policy-test-${crypto.randomUUID()}`;
  const marker = join(tmpdir(), "claude-skill-hint", `${session_id}-main`);
  const input = {
    session_id,
    tool_name: "Edit",
    tool_input: {
      file_path: "/tmp/nonexistent-repo/skills/x/SKILL.md",
      old_string: "a",
      new_string: "b",
    },
  };
  try {
    const first = await invokeHook(input);
    assertEquals(first.code, 0, first.stderr);
    const out = JSON.parse(first.stdout);
    assertEquals(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assertEquals(out.hookSpecificOutput.additionalContext, SKILL_HINT);
    const second = await invokeHook(input);
    assertEquals(second.code, 0, second.stderr);
    assertEquals(second.stdout, "");
  } finally {
    await rm(marker, { force: true });
  }
});

test("entry point: a blocked SKILL.md fixture write gets no hint and keeps it for later", async () => {
  const session_id = `write-policy-test-${crypto.randomUUID()}`;
  const marker = join(tmpdir(), "claude-skill-hint", `${session_id}-main`);
  try {
    const blocked = await invokeHook({
      session_id,
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/nonexistent-repo/tests/fixtures/SKILL.md",
        content: "home: /Users/wadackel",
      },
    });
    assertEquals(blocked.code, 2, blocked.stderr);
    assertEquals(blocked.stdout, "");
    const later = await invokeHook({
      session_id,
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/nonexistent-repo/skills/x/SKILL.md",
        content: "body",
      },
    });
    assertEquals(later.code, 0, later.stderr);
    assertStringIncludes(later.stdout, "additionalContext");
  } finally {
    await rm(marker, { force: true });
  }
});

test("hintKey separates the main session from each subagent", () => {
  assertEquals(hintKey({ session_id: "s1" }), "s1-main");
  assertEquals(hintKey({ session_id: "s1", agent_id: "a9" }), "s1-a9");
  assertEquals(hintKey({}), undefined);
});

test("entry point: a subagent gets its own hint after the main session took one", async () => {
  const session_id = `write-policy-test-${crypto.randomUUID()}`;
  const markers = [`${session_id}-main`, `${session_id}-a1`].map((k) =>
    join(tmpdir(), "claude-skill-hint", k)
  );
  const edit = (agent: Record<string, string>) =>
    invokeHook({
      session_id,
      ...agent,
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/nonexistent-repo/skills/x/SKILL.md",
        content: "body",
      },
    });
  try {
    assertStringIncludes((await edit({})).stdout, "additionalContext");
    const sub = await edit({ agent_id: "a1", agent_type: "general-purpose" });
    assertEquals(sub.code, 0, sub.stderr);
    assertStringIncludes(sub.stdout, "additionalContext");
    assertEquals((await edit({ agent_id: "a1" })).stdout, "");
  } finally {
    for (const m of markers) await rm(m, { force: true });
  }
});

test("entry point: a SKILL.md fixture write that passes still gets the hint", async () => {
  const session_id = `write-policy-test-${crypto.randomUUID()}`;
  const marker = join(tmpdir(), "claude-skill-hint", `${session_id}-main`);
  try {
    const { code, stdout, stderr } = await invokeHook({
      session_id,
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/nonexistent-repo/tests/fixtures/SKILL.md",
        content: "home: /Users/me",
      },
    });
    assertEquals(code, 0, stderr);
    assertStringIncludes(stdout, "additionalContext");
  } finally {
    await rm(marker, { force: true });
  }
});

test("entry point: CLAUDE_SKILL_HINT_SKIP=1 suppresses the hint and keeps it for later", async () => {
  const session_id = `write-policy-test-${crypto.randomUUID()}`;
  const marker = join(tmpdir(), "claude-skill-hint", `${session_id}-main`);
  const input = {
    session_id,
    tool_name: "Write",
    tool_input: {
      file_path: "/tmp/nonexistent-repo/skills/x/SKILL.md",
      content: "body",
    },
  };
  try {
    const skipped = await invokeHook(input, { CLAUDE_SKILL_HINT_SKIP: "1" });
    assertEquals(skipped.code, 0, skipped.stderr);
    assertEquals(skipped.stdout, "");
    assertStringIncludes((await invokeHook(input)).stdout, "additionalContext");
  } finally {
    await rm(marker, { force: true });
  }
});
