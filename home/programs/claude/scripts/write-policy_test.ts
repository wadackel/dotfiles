// write-policy: allow — this file holds the real identifier as test data.
import { test } from "bun:test";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../agents/lib/proc.ts";
import { findIdentifiers, isFixturePath, newContent } from "./write-policy.ts";

const HOOK_SCRIPT = join(import.meta.dirname, "write-policy.ts");

async function invokeHook(
  hookInput: Record<string, unknown>,
): Promise<{ code: number; stderr: string }> {
  const { code, stderr } = await run(HOOK_SCRIPT, [], {
    stdin: JSON.stringify(hookInput),
  });
  return { code, stderr };
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
