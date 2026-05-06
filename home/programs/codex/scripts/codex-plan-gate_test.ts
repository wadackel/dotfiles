import {
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cwdHash,
  extractPatchFiles,
  gateDecision,
  type GateInput,
  isInfraPath,
} from "./codex-plan-gate.ts";

const CODEX_INFRA =
  "/Users/wadackel/dotfiles/home/programs/codex/scripts/codex-plan-gate.ts";
const CODEX_SKILL_PATH =
  "/Users/wadackel/dotfiles/home/programs/codex/skills/plan/SKILL.md";
const CLAUDE_PATH =
  "/Users/wadackel/dotfiles/home/programs/claude/skills/plan/SKILL.md";
const LEGACY_PLAN_RE = new RegExp("\\$plan-" + "codex");
const LEGACY_IMPL_RE = new RegExp("\\$impl-" + "codex");

async function tmpHomeWith(
  setup: (home: string, hash: string, cwd: string) => Promise<void>,
): Promise<{ home: string; hash: string; cwd: string }> {
  const home = await Deno.makeTempDir({ prefix: "codex-gate-test-" });
  const cwd = await Deno.makeTempDir({ prefix: "codex-gate-cwd-" });
  const hash = await cwdHash(cwd);
  await Deno.mkdir(`${home}/.codex/plans`, { recursive: true });
  await setup(home, hash, cwd);
  return { home, hash, cwd };
}

function input(toolName: string, command: string, cwd: string): GateInput {
  return {
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: { command },
    cwd,
  };
}

const ADD_FILE_PATCH = (...paths: string[]) =>
  "*** Begin Patch\n" +
  paths.map((p) => `*** Add File: ${p}\n+contents\n`).join("") +
  "*** End Patch";

Deno.test("extractPatchFiles parses Add/Update/Delete File markers", () => {
  const cmd = "*** Begin Patch\n" +
    "*** Add File: home/x.ts\n+1\n" +
    "*** Update File: home/y.ts\n@@\n-old\n+new\n" +
    "*** Delete File: home/z.ts\n" +
    "*** End Patch";
  assertEquals(extractPatchFiles(cmd), ["home/x.ts", "home/y.ts", "home/z.ts"]);
});

Deno.test("isInfraPath: only codex bootstrap files are infra", () => {
  assertEquals(isInfraPath(CODEX_INFRA), true);
  assertEquals(isInfraPath(CODEX_SKILL_PATH), false);
  assertEquals(isInfraPath(CLAUDE_PATH), false);
  assertEquals(isInfraPath("/tmp/random.ts"), false);
});

Deno.test("scenario 1: active marker valid → allow", async () => {
  const { home, hash, cwd } = await tmpHomeWith(async (h, hh) => {
    await Deno.writeTextFile(
      `${h}/.codex/plans/.active-${hh}`,
      "/some/plan.md",
    );
  });
  Deno.env.set("HOME", home);
  const dec = await gateDecision(
    input("apply_patch", ADD_FILE_PATCH(`${cwd}/foo.ts`), cwd),
  );
  assertEquals(dec.kind, "allow");
  assertEquals(dec.reason, "marker-valid");
});

Deno.test("scenario 2: active marker expired → block", async () => {
  const { home, hash, cwd } = await tmpHomeWith(async (h, hh) => {
    const path = `${h}/.codex/plans/.active-${hh}`;
    await Deno.writeTextFile(path, "/some/plan.md");
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await Deno.utime(path, stale, stale);
  });
  Deno.env.set("HOME", home);
  const dec = await gateDecision(
    input("apply_patch", ADD_FILE_PATCH(`${cwd}/foo.ts`), cwd),
  );
  assertEquals(dec.kind, "block");
  assertMatch(dec.reason, /期限切れ|expired/);
});

Deno.test("scenario 3: marker absent (no pending) → block with $plan hint", async () => {
  const { home, cwd } = await tmpHomeWith(async () => {/* no markers */});
  Deno.env.set("HOME", home);
  const dec = await gateDecision(
    input("apply_patch", ADD_FILE_PATCH(`${cwd}/foo.ts`), cwd),
  );
  assertEquals(dec.kind, "block");
  assertMatch(dec.reason, /\$plan/);
  assertNotMatch(dec.reason, LEGACY_PLAN_RE);
});

Deno.test("scenario 4: pending only (no active) → block with $impl hint", async () => {
  const { home, hash, cwd } = await tmpHomeWith(async (h, hh) => {
    await Deno.writeTextFile(
      `${h}/.codex/plans/.pending-${hh}`,
      "/some/plan.md",
    );
  });
  Deno.env.set("HOME", home);
  const dec = await gateDecision(
    input("apply_patch", ADD_FILE_PATCH(`${cwd}/foo.ts`), cwd),
  );
  assertEquals(dec.kind, "block");
  assertMatch(dec.reason, /\$impl/);
  assertNotMatch(dec.reason, LEGACY_IMPL_RE);
});

Deno.test("scenario 5: codex bootstrap file edit → allow as infra", async () => {
  const { home } = await tmpHomeWith(async () => {/* no markers */});
  Deno.env.set("HOME", home);
  const codexCwd = "/Users/wadackel/dotfiles/home/programs/codex";
  const dec = await gateDecision(
    input(
      "apply_patch",
      ADD_FILE_PATCH(CODEX_INFRA),
      codexCwd,
    ),
  );
  assertEquals(dec.kind, "allow");
  assertEquals(dec.reason, "infra");
});

Deno.test("scenario 5b: codex skill edit from codex cwd is gated", async () => {
  const { home } = await tmpHomeWith(async () => {/* no markers */});
  Deno.env.set("HOME", home);
  const codexCwd = "/Users/wadackel/dotfiles/home/programs/codex";
  const dec = await gateDecision(
    input("apply_patch", ADD_FILE_PATCH(CODEX_SKILL_PATH), codexCwd),
  );
  assertEquals(dec.kind, "block");
  assertMatch(dec.reason, /\$plan/);
});

Deno.test("scenario 5c: codex skill path from repo root cwd is gated", async () => {
  const { home } = await tmpHomeWith(async () => {/* no markers */});
  Deno.env.set("HOME", home);
  const repoRoot = "/Users/wadackel/dotfiles";
  const dec = await gateDecision(
    input("apply_patch", ADD_FILE_PATCH(CODEX_SKILL_PATH), repoRoot),
  );
  assertEquals(dec.kind, "block");
  assertMatch(dec.reason, /\$plan/);
});

Deno.test("scenario 6: non-edit tool (Bash) → allow regardless of marker", async () => {
  const { home, cwd } = await tmpHomeWith(async () => {/* no markers */});
  Deno.env.set("HOME", home);
  const dec = await gateDecision({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "ls -la" },
    cwd,
  });
  assertEquals(dec.kind, "allow");
  assertEquals(dec.reason, "non-gated-tool");
});

Deno.test("scenario 7: patch only touches files outside cwd → allow", async () => {
  const { home, cwd } = await tmpHomeWith(async () => {/* no markers */});
  Deno.env.set("HOME", home);
  const otherDir = await Deno.makeTempDir({ prefix: "other-" });
  const dec = await gateDecision(
    input("apply_patch", ADD_FILE_PATCH(`${otherDir}/elsewhere.ts`), cwd),
  );
  assertEquals(dec.kind, "allow");
  assertEquals(dec.reason, "outside-cwd");
});

Deno.test("scenario 8: mixed cwd + outside files, no marker → block (any cwd hit gates)", async () => {
  const { home, cwd } = await tmpHomeWith(async () => {/* no markers */});
  Deno.env.set("HOME", home);
  const otherDir = await Deno.makeTempDir({ prefix: "other-" });
  const dec = await gateDecision(
    input(
      "apply_patch",
      ADD_FILE_PATCH(`${otherDir}/elsewhere.ts`, `${cwd}/inside.ts`),
      cwd,
    ),
  );
  assertEquals(dec.kind, "block");
});

Deno.test("scenario 9: malformed patch (no file markers) → block fail-closed", async () => {
  const { home, cwd } = await tmpHomeWith(async () => {/* no markers */});
  Deno.env.set("HOME", home);
  const dec = await gateDecision(
    input("apply_patch", "no markers here at all", cwd),
  );
  assertEquals(dec.kind, "block");
});
