import { assertEquals } from "jsr:@std/assert";
import { rawCommandTouchesPlansDir } from "./bash-policy.ts";

Deno.test("rawCommandTouchesPlansDir: detects argument-form .claude/plans references", () => {
  const blocked = [
    "touch ~/.claude/plans/.active-abc",
    "echo x > ~/.claude/plans/marker.json",
    "cp /tmp/forged.json ~/.claude/plans/foo",
    "printf '%s' y >> ~/.claude/plans/foo",
    "tee ~/.claude/plans/foo < /dev/null",
    "ln -s /tmp/target ~/.claude/plans/foo",
    "mv /tmp/x ~/.claude/plans/y",
    "deno eval 'await Deno.writeTextFile(\"/Users/me/.claude/plans/x\", \"y\");'",
  ];
  for (const cmd of blocked) {
    assertEquals(
      rawCommandTouchesPlansDir(cmd),
      true,
      `should block: ${cmd}`,
    );
  }
});

Deno.test("rawCommandTouchesPlansDir: allows unrelated commands", () => {
  const allowed = [
    "echo hello",
    "ls /tmp",
    "rg foo home/programs/claude/scripts/",
    "git status",
    "deno test home/programs/claude/scripts/plan-gate_test.ts",
  ];
  for (const cmd of allowed) {
    assertEquals(
      rawCommandTouchesPlansDir(cmd),
      false,
      `should allow: ${cmd}`,
    );
  }
});

Deno.test("rawCommandTouchesPlansDir: requires trailing slash (substring discipline)", () => {
  // `~/.claude/plans` without trailing slash is informational reference
  // (e.g., docs), not a write target — must not block.
  assertEquals(
    rawCommandTouchesPlansDir("echo '~/.claude/plans is the gate dir'"),
    false,
  );
  // Add trailing slash → block, even when quoted.
  assertEquals(
    rawCommandTouchesPlansDir("echo '~/.claude/plans/x'"),
    true,
  );
});
