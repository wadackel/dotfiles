import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  isCanonicalPlanMarkerCommand,
  rawCommandTouchesPlansDir,
} from "./bash-policy.ts";

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

Deno.test("rawCommandTouchesPlansDir: matches plans dir as path AND as deno-flag value boundary", () => {
  // Trailing slash → child path argument (touch / cp / redirect target etc.).
  assertEquals(
    rawCommandTouchesPlansDir("echo '~/.claude/plans/x'"),
    true,
  );
  // Whitespace boundary → e.g. `--allow-write=$HOME/.claude/plans <script>`,
  // which grants writes to plans dir children even without a trailing slash.
  // The same anchor catches informational `echo '... .claude/plans is ...'`
  // forms; that false-positive is accepted because admitting whitespace-
  // boundary references would also admit the deno permission-flag attack.
  assertEquals(
    rawCommandTouchesPlansDir("echo '~/.claude/plans is the gate dir'"),
    true,
  );
  assertEquals(
    rawCommandTouchesPlansDir(
      "deno run --allow-write=/Users/foo/.claude/plans /tmp/script.ts",
    ),
    true,
  );
  // Quote / comma / end-of-string boundaries — all forms a deno permission
  // flag could plausibly take.
  assertEquals(
    rawCommandTouchesPlansDir('deno run --allow-write="$HOME/.claude/plans"'),
    true,
  );
  assertEquals(
    rawCommandTouchesPlansDir("deno run --allow-read=$HOME/.claude/plans,$PWD"),
    true,
  );
  assertEquals(
    rawCommandTouchesPlansDir("--allow-write=$HOME/.claude/plans"),
    true,
  );
  // Unrelated `.claude/` subdirectory must NOT match.
  assertEquals(
    rawCommandTouchesPlansDir("ls /Users/foo/.claude/scripts/"),
    false,
  );
  assertEquals(
    rawCommandTouchesPlansDir("echo foo .claude/plansomething"),
    false,
  );
});

// `isCanonicalPlanMarkerCommand` exempts plan-marker.ts's own invocations from
// the substring guard so that `/plan` Phase 6 and `/impl`'s approval gate can
// call the helper via Bash (the helper itself validates plan paths internally).
//
// Exempt: AST yields a single segment, command is not compound, segment
// contains `plan-marker.ts <known-subcommand>`. Otherwise: not exempt.

const CANONICAL_FORMS = [
  // The form `/plan` Phase 6 actually emits.
  'deno run --allow-env=HOME --allow-read="$HOME/.claude/plans,$PWD" --allow-write="$HOME/.claude/plans" --no-prompt /Users/foo/.claude/scripts/plan-marker.ts activate-pending /Users/foo/.claude/plans/bar.md /tmp',
  // status / require-active / clear-active from `/impl` approval gate and helpers.
  "deno run --allow-env=HOME --no-prompt /Users/foo/.claude/scripts/plan-marker.ts status /tmp",
  "deno run --allow-env=HOME --no-prompt /Users/foo/.claude/scripts/plan-marker.ts require-active /tmp",
  "deno run --allow-env=HOME --no-prompt /Users/foo/.claude/scripts/plan-marker.ts clear-active /tmp",
  // Shebang-direct form — the canonical emit shape after SKILL.md refactor.
  "/Users/foo/.claude/scripts/plan-marker.ts activate-pending /Users/foo/.claude/plans/bar.md /tmp",
  "/Users/foo/.claude/scripts/plan-marker.ts status /tmp",
  "/Users/foo/.claude/scripts/plan-marker.ts require-active /tmp",
  "/Users/foo/.claude/scripts/plan-marker.ts clear-active /tmp",
];

Deno.test("isCanonicalPlanMarkerCommand: allows the four canonical subcommands", async () => {
  for (const cmd of CANONICAL_FORMS) {
    assertEquals(
      await isCanonicalPlanMarkerCommand(cmd),
      true,
      `should exempt: ${cmd}`,
    );
  }
});

Deno.test("isCanonicalPlanMarkerCommand: rejects non-canonical and compound forms", async () => {
  const rejected = [
    // Unknown subcommand.
    "deno run --allow-env=HOME plan-marker.ts foo-bar /tmp",
    // Compound — semicolon chains a marker-touching attack.
    "deno run plan-marker.ts activate-pending /x.md ; touch /Users/foo/.claude/plans/y",
    // CommandExpansion — `$()` invokes a side-effect during arg evaluation.
    'deno run plan-marker.ts activate-pending "$(touch /Users/foo/.claude/plans/y)"',
    // LogicalExpression — `&&` chains a marker write after the helper.
    "deno run plan-marker.ts activate-pending /x.md && touch /Users/foo/.claude/plans/y",
    // Redirect — `>` writes into the gate's marker file regardless of helper.
    "deno run plan-marker.ts activate-pending /x.md > /Users/foo/.claude/plans/.active-pwn",
    // Pipeline — `|` is also compound.
    "deno run plan-marker.ts status /tmp | tee /Users/foo/.claude/plans/.active-pwn",
    // Helper name appears only as an `echo` argument — the actual command isn't plan-marker.ts.
    "echo plan-marker.ts activate-pending /x.md",
    // Subshell.
    "(deno run plan-marker.ts activate-pending /x.md)",
  ];
  for (const cmd of rejected) {
    assertEquals(
      await isCanonicalPlanMarkerCommand(cmd),
      false,
      `should not exempt: ${cmd}`,
    );
  }
});

Deno.test("isCanonicalPlanMarkerCommand: rejects `<shell> -c '<helper-invocation>; <attack>'` bypass", async () => {
  // Regression guard for the AST-structural review:
  // A single `bash -c '<inner>'` parses as a single non-compound Command whose
  // name is `bash`. A regex on the joined-segment text would see the helper
  // name inside the quoted argument and exempt the call, which would let
  // `<inner>` execute arbitrary marker writes. Inspecting Command.name +
  // Word suffixes closes this. All of these must return false.
  const rejected = [
    "bash -c '/foo/plan-marker.ts activate-pending /x.md; touch /Users/foo/.claude/plans/.active-pwn'",
    "bash -c \"/foo/plan-marker.ts status /tmp\"",
    "sh -c '/foo/plan-marker.ts activate-pending /x.md'",
    "zsh -c '/foo/plan-marker.ts activate-pending /x.md'",
    // Quoted form without leading slash before plan-marker.ts.
    "bash -c 'plan-marker.ts activate-pending /x.md'",
    // Helper appears as part of a multi-arg shell exec.
    "xargs plan-marker.ts activate-pending /x.md",
    "env FOO=bar bash -c '/foo/plan-marker.ts activate-pending /x.md'",
  ];
  for (const cmd of rejected) {
    assertEquals(
      await isCanonicalPlanMarkerCommand(cmd),
      false,
      `should not exempt: ${cmd}`,
    );
  }
});

Deno.test("isCanonicalPlanMarkerCommand: rejects attacker-planted plan-marker.ts at non-canonical paths", async () => {
  // The exemption MUST require the canonical install location
  // (`~/.claude/scripts/plan-marker.ts`). An attacker who can write
  // `/tmp/plan-marker.ts` (or similar) and then run it via deno would
  // otherwise inherit the exemption and execute arbitrary marker writes.
  // The fix tightens tokenIsHelper to the `/.claude/scripts/plan-marker.ts`
  // suffix; combined with the broadened rawCommandTouchesPlansDir (which
  // catches `--allow-write=$HOME/.claude/plans` even without a trailing
  // slash), both attack variants now block.
  const rejected = [
    // Attacker-controlled path outside the canonical scripts dir.
    "deno run --allow-write=/Users/foo/.claude/plans /tmp/plan-marker.ts activate-pending /tmp/foo.md",
    "deno run --allow-write=/Users/foo/.claude/plans/ /tmp/plan-marker.ts activate-pending /tmp/foo.md",
    "deno run /home/attacker/plan-marker.ts activate-pending /tmp/foo.md",
    // Bare basename in cwd — no canonical-form invocation uses this shape.
    "deno run plan-marker.ts activate-pending /tmp/foo.md",
    "plan-marker.ts activate-pending /tmp/foo.md",
    // Helper path with attacker prefix that ends in `/plan-marker.ts` but
    // not under `/.claude/scripts/`.
    "deno run /tmp/.claude/plans/plan-marker.ts activate-pending /tmp/foo.md",
  ];
  for (const cmd of rejected) {
    assertEquals(
      await isCanonicalPlanMarkerCommand(cmd),
      false,
      `should not exempt: ${cmd}`,
    );
  }
});

Deno.test("isCanonicalPlanMarkerCommand: rejects deno non-`run` subcommands that smuggle helper-token", async () => {
  // `deno eval '<arbitrary JS that ends in /plan-marker.ts>' activate-pending`
  // would execute the JS body — which can call Deno.writeTextFile directly to
  // mint marker files, bypassing plan-marker.ts's path validation. Shape 2
  // must constrain to `deno run` and require only flag-shaped tokens between
  // `run` and the helper-path.
  const rejected = [
    // deno eval — the JS string literal ends with `/plan-marker.ts`; the
    // suffix-match in tokenIsHelper would otherwise treat it as the helper.
    'deno eval \'Deno.writeTextFileSync("/Users/foo/.claude/plans/.active-pwn","x");//y/plan-marker.ts\' activate-pending',
    // deno test — same shape, different subcommand.
    "deno test /foo/plan-marker.ts activate-pending /x.md",
    // deno task — same shape, different subcommand.
    "deno task /foo/plan-marker.ts activate-pending",
    // deno repl with -e (still not `run`).
    "deno repl -e '//x/plan-marker.ts' activate-pending",
    // bare `deno` with no subcommand.
    "deno /foo/plan-marker.ts activate-pending /x.md",
    // `deno run` but a non-flag positional precedes the helper path — the
    // helper-token is being smuggled as data.
    "deno run script.js /foo/plan-marker.ts activate-pending",
  ];
  for (const cmd of rejected) {
    assertEquals(
      await isCanonicalPlanMarkerCommand(cmd),
      false,
      `should not exempt: ${cmd}`,
    );
  }
});

// --- Entry-point integration ---
//
// Spawn bash-policy.ts as a subprocess and feed PreToolUse JSON via stdin.
// The hook exits 2 with the standard `Raw command references ~/.claude/plans/`
// stderr on block; exits 0 with empty stderr when the canonical helper is
// exempt and no yaml rule fires.

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

Deno.test("entry point: canonical plan-marker invocation passes (exit 0)", async () => {
  const { code, stderr } = await invokeHook({
    tool_name: "Bash",
    tool_input: {
      command:
        "deno run --allow-env=HOME --no-prompt /Users/foo/.claude/scripts/plan-marker.ts activate-pending /Users/foo/.claude/plans/bar.md /tmp",
    },
    cwd: "/tmp",
  });
  assertEquals(code, 0, `expected exit 0, got ${code}. stderr=${stderr}`);
  assertEquals(stderr, "");
});

Deno.test("entry point: bare touch on plans dir is blocked (exit 2)", async () => {
  const { code, stderr } = await invokeHook({
    tool_name: "Bash",
    tool_input: { command: "touch /Users/foo/.claude/plans/.active-pwn" },
    cwd: "/tmp",
  });
  assertEquals(code, 2);
  assertStringIncludes(stderr, "Raw command references ~/.claude/plans/");
});

Deno.test("entry point: compound chain bypass attempt is blocked (exit 2)", async () => {
  const { code, stderr } = await invokeHook({
    tool_name: "Bash",
    tool_input: {
      command:
        "deno run plan-marker.ts activate-pending /x.md ; touch /Users/foo/.claude/plans/y",
    },
    cwd: "/tmp",
  });
  assertEquals(code, 2);
  assertStringIncludes(stderr, "Raw command references ~/.claude/plans/");
});

Deno.test("entry point: redirect bypass attempt is blocked (exit 2)", async () => {
  const { code, stderr } = await invokeHook({
    tool_name: "Bash",
    tool_input: {
      command:
        "deno run plan-marker.ts activate-pending /x.md > /Users/foo/.claude/plans/.active-pwn",
    },
    cwd: "/tmp",
  });
  assertEquals(code, 2);
  assertStringIncludes(stderr, "Raw command references ~/.claude/plans/");
});

Deno.test("entry point: `bash -c` quoted-argument bypass is blocked (exit 2)", async () => {
  const { code, stderr } = await invokeHook({
    tool_name: "Bash",
    tool_input: {
      command:
        "bash -c '/foo/plan-marker.ts activate-pending /x.md; touch /Users/foo/.claude/plans/.active-pwn'",
    },
    cwd: "/tmp",
  });
  assertEquals(code, 2, `expected exit 2, got ${code}. stderr=${stderr}`);
  assertStringIncludes(stderr, "Raw command references ~/.claude/plans/");
});
