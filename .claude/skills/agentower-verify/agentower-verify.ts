#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

// agentower-verify: run Agentower e2e suite against an isolated tmux server,
// emit a JSON summary on stdout. Exit code mirrors ok.

import { join } from "node:path";
import { run } from "../../../home/programs/agents/lib/proc.ts";

interface Result {
  check: "agentower-e2e";
  ok: boolean;
  scenarios: {
    passed: number;
    failed: number;
    names_failed: string[];
  };
  elapsed_ms: number;
  errors: string[];
}

const TEST_PATH = join(
  import.meta.dirname,
  "../../../home/programs/tmux/agentower/agentower_e2e_test.ts",
);

// Bun's default of 5 s per test is the harness's own wait timeout, so a stuck
// scenario would be cut off before waitFor could throw its "Last capture"
// diagnostic, and its teardown would then overlap the next scenario.
function testTimeoutMs(): number {
  const parsed = Number.parseInt(
    process.env.AGENTOWER_E2E_TIMEOUT_MS ?? "",
    10,
  );
  const harnessWait = Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
  return Math.max(60000, 6 * harnessWait);
}

// `bun test` reports on stderr. Lines of interest:
//   "(pass) S0: harness smoke (no panes) [811.02ms]"
//   "(fail) S3: navigation (...) [578.10ms]"   (a timeout is a (fail) too)
//   " 85 pass"
//   " 1 fail"
function parseReport(stderr: string): {
  scenarios: Result["scenarios"];
  summary: { pass: number | null; fail: number | null };
} {
  const TEST_RE = /^\((pass|fail)\) (.+?)(?: \[\d+(?:\.\d+)?m?s\])?$/;
  const SUMMARY_RE = /^ (\d+) (pass|fail)$/;
  let passed = 0;
  const names_failed: string[] = [];
  const summary: { pass: number | null; fail: number | null } = {
    pass: null,
    fail: null,
  };
  let recap = false;
  for (const raw of stderr.split("\n")) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
    // After the last test bun lists every failure again under this heading.
    if (/^\d+ tests? failed:$/.test(line)) recap = true;
    const test = recap ? null : line.match(TEST_RE);
    if (test) {
      if (test[1] === "pass") passed++;
      else names_failed.push(test[2]);
      continue;
    }
    const total = line.match(SUMMARY_RE);
    if (total) summary[total[2] as "pass" | "fail"] = Number(total[1]);
  }
  return {
    scenarios: { passed, failed: names_failed.length, names_failed },
    summary,
  };
}

async function main(): Promise<number> {
  const start = Date.now();
  const errors: string[] = [];

  const test = await run(
    process.execPath,
    [
      "--no-env-file",
      "--no-install",
      "--config=/dev/null",
      "test",
      "--timeout",
      String(testTimeoutMs()),
      TEST_PATH,
    ],
    // With CLAUDECODE=1, which every agent session sets, bun prints no line
    // per passing test.
    { env: { CLAUDECODE: "" } },
  );

  const { scenarios, summary } = parseReport(test.stderr);

  if (test.code !== 0 && scenarios.failed === 0) {
    errors.push(
      `bun test exited ${test.code} but no scenarios parsed as failed — see stderr`,
    );
  }
  if (scenarios.passed === 0) {
    errors.push("no scenarios ran — test file may be empty or filtered");
  }
  if (summary.pass !== scenarios.passed) {
    errors.push(
      `parsed ${scenarios.passed} (pass) lines but the summary says ${
        summary.pass ?? "nothing"
      } pass`,
    );
  }
  // Bun prints " 0 fail" on a clean run.
  if (summary.fail !== scenarios.failed) {
    errors.push(
      `parsed ${scenarios.failed} (fail) lines but the summary says ${
        summary.fail ?? "nothing"
      } fail`,
    );
  }

  const ok = test.code === 0 && scenarios.failed === 0 &&
    scenarios.passed > 0 && errors.length === 0;

  const result: Result = {
    check: "agentower-e2e",
    ok,
    scenarios,
    elapsed_ms: Date.now() - start,
    errors,
  };

  console.log(JSON.stringify(result));

  // Failed runs: surface stderr under the JSON so the caller can diagnose.
  if (!ok) {
    console.error("--- bun test stderr ---");
    console.error(test.stderr);
    console.error("--- bun test stdout ---");
    console.error(test.stdout);
  }

  return ok ? 0 : 1;
}

process.exit(await main());
