import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { loadRules } from "./bash-policy.ts";

Deno.test("loadRules: parses rules from a YAML file", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/bash-policy.yaml`;
  await Deno.writeTextFile(
    path,
    'rules:\n  - pattern: "git -C *"\n    message: "no git -C"\n',
  );
  const rules = await loadRules(path);
  assertEquals(rules.length, 1);
  assertEquals(rules[0].pattern, "git -C *");
  assertEquals(rules[0].message, "no git -C");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("loadRules: returns [] on missing file", async () => {
  const rules = await loadRules("/nonexistent/bash-policy.yaml");
  assertEquals(rules, []);
});

// --- Entry-point integration ---
//
// Spawn bash-policy.ts as a subprocess and feed PreToolUse JSON via stdin. The
// hook loads the co-located global bash-policy.yaml and blocks (exit 2) any
// command whose segment matches a rule pattern; unrelated commands exit 0.

const HOOK_SCRIPT = new URL("./bash-policy.ts", import.meta.url).pathname;

async function invokeHook(hookInput: {
  tool_name: string;
  tool_input: { command: string };
  cwd?: string;
}): Promise<{ code: number; stderr: string }> {
  const proc = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", HOOK_SCRIPT],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = proc.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(hookInput)));
  await writer.close();
  const { code, stderr } = await proc.output();
  return { code, stderr: new TextDecoder().decode(stderr) };
}

Deno.test("entry point: `git -C` rule blocks the command (exit 2)", async () => {
  const { code, stderr } = await invokeHook({
    tool_name: "Bash",
    tool_input: { command: "git -C /tmp status" },
    cwd: "/tmp",
  });
  assertEquals(code, 2, `expected exit 2, got ${code}. stderr=${stderr}`);
  assertStringIncludes(stderr, "git -C");
});

Deno.test("entry point: unrelated command passes (exit 0)", async () => {
  const { code, stderr } = await invokeHook({
    tool_name: "Bash",
    tool_input: { command: "ls /tmp" },
    cwd: "/tmp",
  });
  assertEquals(code, 0, `expected exit 0, got ${code}. stderr=${stderr}`);
  assertEquals(stderr, "");
});

Deno.test("entry point: non-Bash tool is ignored (exit 0)", async () => {
  const { code } = await invokeHook({
    tool_name: "Edit",
    tool_input: { command: "git -C /tmp status" },
    cwd: "/tmp",
  });
  assertEquals(code, 0);
});
