#!/usr/bin/env -S deno run --allow-run=tmux,deno --allow-env --allow-read --allow-write

// picker-verify: warm Deno module cache, run picker e2e suite against an
// isolated tmux server, emit a JSON summary on stdout. Exit code mirrors ok.

interface Result {
  check: "picker-e2e";
  ok: boolean;
  scenarios: {
    passed: number;
    failed: number;
    names_failed: string[];
  };
  elapsed_ms: number;
  errors: string[];
}

// URL.pathname is percent-encoded; decode so paths containing spaces or
// non-ASCII characters reach deno as a real filesystem path.
const REPO_ROOT = decodeURIComponent(
  new URL("../../../", import.meta.url).pathname,
);
const PICKER_PATH = `${REPO_ROOT}home/programs/tmux/picker.tsx`;
const TEST_PATH = `${REPO_ROOT}home/programs/tmux/picker_e2e_test.ts`;

async function runDeno(args: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return {
    code,
    stdout: dec.decode(stdout),
    stderr: dec.decode(stderr),
  };
}

// Extract scenario-level pass/fail from `deno test` stdout. Lines of interest:
//   "S0: harness smoke (no panes) ... ok (811ms)"
//   "S3: navigation (...) ... FAILED (578ms)"
function parseScenarios(stdout: string): {
  passed: number;
  failed: number;
  names_failed: string[];
} {
  const OK_RE = /^(.+?) \.\.\. ok \(/;
  const FAIL_RE = /^(.+?) \.\.\. FAILED /;
  let passed = 0;
  let failed = 0;
  const names_failed: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (OK_RE.test(trimmed)) passed++;
    const m = trimmed.match(FAIL_RE);
    if (m) {
      failed++;
      names_failed.push(m[1]);
    }
  }
  return { passed, failed, names_failed };
}

async function main(): Promise<number> {
  const start = Date.now();
  const errors: string[] = [];

  const cache = await runDeno(["cache", PICKER_PATH]);
  if (cache.code !== 0) {
    errors.push(`deno cache failed (code ${cache.code}): ${cache.stderr.trim()}`);
  }

  const home = Deno.env.get("HOME");
  // --allow-write is scoped to $HOME/.claude/tasks because S8 needs to seed
  // a disposable tasks dir there; other scenarios only read filesystem.
  const writeScope = home ? `--allow-write=${home}/.claude/tasks` : "--allow-write";
  const test = await runDeno([
    "test",
    "--allow-run=tmux",
    "--allow-env",
    "--allow-read",
    writeScope,
    TEST_PATH,
  ]);

  const scenarios = parseScenarios(test.stdout);
  const ok = test.code === 0 && scenarios.failed === 0 &&
    scenarios.passed > 0 && errors.length === 0;

  if (test.code !== 0 && scenarios.failed === 0) {
    errors.push(
      `deno test exited ${test.code} but no scenarios parsed as failed — see stderr`,
    );
  }
  if (scenarios.passed === 0) {
    errors.push("no scenarios ran — test file may be empty or filtered");
  }

  const result: Result = {
    check: "picker-e2e",
    ok,
    scenarios,
    elapsed_ms: Date.now() - start,
    errors,
  };

  console.log(JSON.stringify(result));

  // Failed runs: surface stderr under the JSON so the caller can diagnose.
  if (!ok) {
    console.error("--- deno test stderr ---");
    console.error(test.stderr);
    console.error("--- deno test stdout ---");
    console.error(test.stdout);
  }

  return ok ? 0 : 1;
}

Deno.exit(await main());
