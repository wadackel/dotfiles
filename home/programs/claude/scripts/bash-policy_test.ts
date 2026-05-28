import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  isCanonicalPlanMarkerTokens,
  isPlansGuardExempt,
  rawCommandTouchesPlansDir,
  READ_ONLY_COMMANDS,
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

// `isCanonicalPlanMarkerTokens` is the pure per-node recognizer that
// `isPlansGuardExempt` applies to each leaf Command node. It answers "is this
// exactly a canonical plan-marker.ts call" from already-extracted `(name,
// args)`. String-level concerns (compound chaining, `bash -c` quoting,
// redirects, `$()`, subshells) are the caller's responsibility and are
// covered by the `isPlansGuardExempt` + entry-point tests below.

const HELPER_TOKEN = "/Users/foo/.claude/scripts/plan-marker.ts";

Deno.test("isCanonicalPlanMarkerTokens: accepts direct + deno-run canonical shapes", () => {
  // Direct shebang form, all four subcommands.
  for (const sub of ["activate-pending", "status", "require-active", "clear-active"]) {
    assertEquals(
      isCanonicalPlanMarkerTokens(HELPER_TOKEN, [sub, "/tmp"]),
      true,
      `direct ${sub}`,
    );
  }
  // `deno run [flags...] <helper> <subcommand>` form.
  assertEquals(
    isCanonicalPlanMarkerTokens("deno", [
      "run",
      "--allow-env=HOME",
      "--no-prompt",
      HELPER_TOKEN,
      "activate-pending",
      "/Users/foo/.claude/plans/bar.md",
    ]),
    true,
  );
});

Deno.test("isCanonicalPlanMarkerTokens: rejects unknown subcommand / missing subcommand", () => {
  assertEquals(isCanonicalPlanMarkerTokens(HELPER_TOKEN, ["foo-bar", "/tmp"]), false);
  assertEquals(isCanonicalPlanMarkerTokens(HELPER_TOKEN, []), false);
  assertEquals(
    isCanonicalPlanMarkerTokens("deno", ["run", HELPER_TOKEN]),
    false,
    "deno run helper with no subcommand",
  );
});

Deno.test("isCanonicalPlanMarkerTokens: rejects attacker-planted helper paths", () => {
  // Only the canonical `/.claude/scripts/plan-marker.ts` install suffix counts.
  for (const path of [
    "/tmp/plan-marker.ts",
    "/home/attacker/plan-marker.ts",
    "/tmp/.claude/plans/plan-marker.ts",
    "plan-marker.ts", // bare basename
  ]) {
    assertEquals(
      isCanonicalPlanMarkerTokens(path, ["activate-pending", "/tmp/foo.md"]),
      false,
      `attacker path: ${path}`,
    );
    assertEquals(
      isCanonicalPlanMarkerTokens("deno", ["run", path, "activate-pending"]),
      false,
      `deno run attacker path: ${path}`,
    );
  }
});

Deno.test("isCanonicalPlanMarkerTokens: rejects deno non-run + smuggled-positional shapes", () => {
  // Only `deno run` is canonical — eval/test/task/repl can execute helper-named
  // data as a script body.
  for (const sub of ["eval", "test", "task", "repl"]) {
    assertEquals(
      isCanonicalPlanMarkerTokens("deno", [sub, HELPER_TOKEN, "activate-pending"]),
      false,
      `deno ${sub}`,
    );
  }
  // bare `deno` with no subcommand.
  assertEquals(
    isCanonicalPlanMarkerTokens("deno", [HELPER_TOKEN, "activate-pending"]),
    false,
  );
  // A non-flag positional precedes the helper path → helper-token smuggled as data.
  assertEquals(
    isCanonicalPlanMarkerTokens("deno", ["run", "script.js", HELPER_TOKEN, "activate-pending"]),
    false,
  );
});

// `isPlansGuardExempt` generalizes the single-command recognizer to a flat
// command sequence: `cd <repo> && <helper>` and `;` / `|` chains become exempt
// while every plans-touching non-helper node, redirect, `$()`, and exotic
// structure stays blocked.

const HELPER_ABS = "/Users/foo/.claude/scripts/plan-marker.ts";
const PLAN_MD = "/Users/foo/.claude/plans/bar.md";
const DENO_HELPER =
  `deno run --allow-env=HOME --no-prompt ${HELPER_ABS} activate-pending ${PLAN_MD} /tmp`;

Deno.test("isPlansGuardExempt: allows flat compound canonical forms", async () => {
  const exempt = [
    // cd-prefix — the exact shape that was wrongly blocked before this fix.
    `cd /repo && ${HELPER_ABS} activate-pending ${PLAN_MD} /tmp`,
    `cd ~/dotfiles && ${DENO_HELPER}`,
    // semicolon chain with a clean trailing command.
    `${HELPER_ABS} status /tmp ; cd /repo`,
    // bare single command (the one-node case of a flat sequence).
    `${HELPER_ABS} activate-pending ${PLAN_MD} /tmp`,
  ];
  for (const cmd of exempt) {
    assertEquals(await isPlansGuardExempt(cmd), true, `should exempt: ${cmd}`);
  }
});

Deno.test("isPlansGuardExempt: blocks compound/redirect/expansion/exotic attacks", async () => {
  const blocked = [
    // && / ; / | chaining a marker-touching attack after a clean helper.
    `${HELPER_ABS} activate-pending ${PLAN_MD} /tmp && touch /Users/foo/.claude/plans/y`,
    `${HELPER_ABS} status /tmp ; touch /Users/foo/.claude/plans/y`,
    `${HELPER_ABS} status /tmp | tee /Users/foo/.claude/plans/.active-pwn`,
    // redirect into a marker file (suffix and &> prefix forms).
    `${HELPER_ABS} activate-pending ${PLAN_MD} /tmp > /Users/foo/.claude/plans/.active-pwn`,
    `cmd &> /Users/foo/.claude/plans/.active-pwn`,
    // assignment prefix carrying the plans-dir literal.
    "MARKER=/Users/foo/.claude/plans && touch $MARKER/.active-pwn",
    // Sibling-indirection forge: a benign canonical helper node supplies the
    // `.claude/plans` literal (firing the raw trigger) while a sibling `touch`
    // forges the marker via parameter expansion ($P), whose per-node text holds
    // no literal. Must block — `touch` is not on the {cd, helper} allow-list.
    `P=/Users/foo/.claude; ${HELPER_ABS} activate-pending ${PLAN_MD} /tmp; touch "$P/plans/.active-pwn"`,
    // Any non-{cd, helper} sibling command is rejected even when it carries no
    // plans literal of its own.
    `${HELPER_ABS} status /tmp && tee /Users/foo/.claude/plans/.active-pwn`,
    // command substitution running a marker write during arg evaluation.
    "echo $(touch /Users/foo/.claude/plans/.active-pwn)",
    // subshell (exotic) wrapping a canonical-looking call.
    `( ${HELPER_ABS} activate-pending ${PLAN_MD} )`,
    // bash -c with a plans-touching quoted body.
    "bash -c '/foo/plan-marker.ts activate-pending /x.md; touch /Users/foo/.claude/plans/.active-pwn'",
    // attacker-planted helper path that touches plans dir.
    "deno run --allow-write=/Users/foo/.claude/plans /tmp/plan-marker.ts activate-pending /tmp/foo.md",
    // deno non-run subcommand smuggling a plans write in the eval body.
    'deno eval \'Deno.writeTextFileSync("/Users/foo/.claude/plans/.active-pwn","x");//y/plan-marker.ts\' activate-pending',
  ];
  for (const cmd of blocked) {
    assertEquals(await isPlansGuardExempt(cmd), false, `should block: ${cmd}`);
  }
});

Deno.test("isPlansGuardExempt: allows read-only inspection of the plans dir", async () => {
  const exempt = [
    "ls /Users/foo/.claude/plans/",
    "cat /Users/foo/.claude/plans/bar.md",
    // The exact shape blocked in real session 8741f63b (L48).
    "date +%Y%m%dT%H%M && ls /Users/foo/.claude/plans/ 2>/dev/null | tail -3",
    // fd-dup redirect is a safe target.
    "ls /Users/foo/.claude/plans 2>&1",
    // grep/wc/head over plan files.
    "grep -l Context /Users/foo/.claude/plans/x.md",
    "wc -l /Users/foo/.claude/plans/x.md",
  ];
  for (const cmd of exempt) {
    assertEquals(await isPlansGuardExempt(cmd), true, `should exempt: ${cmd}`);
  }
});

Deno.test("isPlansGuardExempt: blocks write-capable commands targeting the plans dir", async () => {
  const blocked = [
    "touch /Users/foo/.claude/plans/.active-pwn",
    "tee /Users/foo/.claude/plans/x",
    "cp /tmp/a /Users/foo/.claude/plans/x",
    "mv /tmp/a /Users/foo/.claude/plans/x",
    "sort -o /Users/foo/.claude/plans/x /tmp/a",
    "find /Users/foo/.claude/plans -delete",
    // awk can write a file from its own program without a shell redirect.
    "awk 'BEGIN{print > \"/Users/foo/.claude/plans/.active-pwn\"}'",
    // ripgrep's --pre runs an arbitrary command per file (no shell redirect),
    // so `rg` is NOT on the allow-list and this forge must block.
    "rg --pre touch '' /Users/foo/.claude/plans/.active-pwn",
  ];
  for (const cmd of blocked) {
    assertEquals(await isPlansGuardExempt(cmd), false, `should block: ${cmd}`);
  }
});

Deno.test("isPlansGuardExempt: blocks unsafe redirects even on read-only commands", async () => {
  const blocked = [
    // `>` / `>>` / `>|` / `&>` into a plans path on an allow-listed command.
    "echo pwn > /Users/foo/.claude/plans/.active-pwn",
    "echo pwn >> /Users/foo/.claude/plans/.active-pwn",
    "ls x >| /Users/foo/.claude/plans/.active-pwn",
    "ls x &> /Users/foo/.claude/plans/.active-pwn",
    // $VAR-indirected redirect target — no literal, must still block.
    'P=/Users/foo/.claude; echo pwn > "$P/plans/.active-pwn"',
    // redirect to a non-null real path is unsafe regardless of target dir.
    "cat /Users/foo/.claude/plans/x > /tmp/leak",
  ];
  for (const cmd of blocked) {
    assertEquals(await isPlansGuardExempt(cmd), false, `should block: ${cmd}`);
  }
});

Deno.test("READ_ONLY_COMMANDS excludes write-capable / exec-capable tools", () => {
  for (const safe of ["ls", "cat", "head", "tail", "date", "grep"]) {
    assertEquals(READ_ONLY_COMMANDS.has(safe), true, `should allow: ${safe}`);
  }
  // `rg` is excluded: ripgrep's `--pre`/`-z` execute an arbitrary command per
  // file (no shell redirect needed), so it is NOT a pure read-only tool.
  for (const danger of ["awk", "sed", "sort", "find", "tee", "cp", "mv", "dd", "ln", "touch", "truncate", "rg"]) {
    assertEquals(READ_ONLY_COMMANDS.has(danger), false, `should exclude: ${danger}`);
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

Deno.test("entry point: `cd <repo> && <canonical helper>` passes (exit 0)", async () => {
  const { code, stderr } = await invokeHook({
    tool_name: "Bash",
    tool_input: {
      command:
        "cd /repo && /Users/foo/.claude/scripts/plan-marker.ts activate-pending /Users/foo/.claude/plans/bar.md /tmp",
    },
    cwd: "/tmp",
  });
  assertEquals(code, 0, `expected exit 0, got ${code}. stderr=${stderr}`);
  assertEquals(stderr, "");
});

Deno.test("entry point: clean cd chained to a marker-touching attack is blocked (exit 2)", async () => {
  const { code, stderr } = await invokeHook({
    tool_name: "Bash",
    tool_input: {
      command: "cd /repo && touch /Users/foo/.claude/plans/.active-pwn",
    },
    cwd: "/tmp",
  });
  assertEquals(code, 2, `expected exit 2, got ${code}. stderr=${stderr}`);
  assertStringIncludes(stderr, "Raw command references ~/.claude/plans/");
});

Deno.test("entry point: sibling-indirection forge behind a benign helper is blocked (exit 2)", async () => {
  // Regression for the security-auditor finding: a canonical helper node
  // supplies the `.claude/plans` literal that fires the raw trigger, while a
  // sibling `touch` forges the marker via `$P` parameter expansion.
  const { code, stderr } = await invokeHook({
    tool_name: "Bash",
    tool_input: {
      command:
        'P=/Users/foo/.claude; /Users/foo/.claude/scripts/plan-marker.ts activate-pending /Users/foo/.claude/plans/bar.md /tmp; touch "$P/plans/.active-pwn"',
    },
    cwd: "/tmp",
  });
  assertEquals(code, 2, `expected exit 2, got ${code}. stderr=${stderr}`);
  assertStringIncludes(stderr, "Raw command references ~/.claude/plans/");
});

Deno.test("entry point: read-only plans inspection passes (exit 0)", async () => {
  // The exact shape blocked in real session 8741f63b (L48).
  const { code, stderr } = await invokeHook({
    tool_name: "Bash",
    tool_input: {
      command:
        "date +%Y%m%dT%H%M && ls /Users/foo/.claude/plans/ 2>/dev/null | tail -3",
    },
    cwd: "/tmp",
  });
  assertEquals(code, 0, `expected exit 0, got ${code}. stderr=${stderr}`);
  assertEquals(stderr, "");
});

Deno.test("entry point: unsafe redirect on a read-only command is blocked (exit 2)", async () => {
  // The read arg supplies the `.claude/plans` literal (fires the trigger) and a
  // `>|` clobber redirect into a marker file is rejected by isRedirectSafe.
  const { code, stderr } = await invokeHook({
    tool_name: "Bash",
    tool_input: {
      command:
        "ls /Users/foo/.claude/plans/ >| /Users/foo/.claude/plans/.active-pwn",
    },
    cwd: "/tmp",
  });
  assertEquals(code, 2, `expected exit 2, got ${code}. stderr=${stderr}`);
  assertStringIncludes(stderr, "Raw command references ~/.claude/plans/");
});
