import {
  applyOutcome,
  executeTranscriptGrep,
  findSimilar,
  type LedgerEntry,
  readLedger,
  writeLedger,
} from "./retrospective-ledger.ts";
import { assertEquals, assertNotEquals } from "jsr:@std/assert";

const TEST_DIR = Deno.makeTempDirSync();
const TEST_PATH = `${TEST_DIR}/retrospective-ledger.jsonl`;
const TEST_TRANSCRIPT = `${TEST_DIR}/transcript.jsonl`;

function cleanup(): void {
  try {
    Deno.removeSync(TEST_PATH);
  } catch {
    // ignore
  }
  try {
    Deno.removeSync(TEST_TRANSCRIPT);
  } catch {
    // ignore
  }
}

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "inst-00001",
    rule: "test rule",
    status: "active",
    confidence: 0.5,
    domain: "verification",
    source_sessions: ["session-1"],
    created: "2026-03-19",
    last_reinforced: "2026-03-19",
    promoted_at: null,
    claude_md_section: null,
    proposals: [],
    outcomes: [],
    ...overrides,
  };
}

Deno.test("readLedger - empty file returns empty array", () => {
  cleanup();
  const result = readLedger(TEST_PATH);
  assertEquals(result, []);
});

Deno.test("writeLedger and readLedger roundtrip preserves extended schema", () => {
  cleanup();
  const entry = makeEntry({
    proposals: [
      {
        proposed_at: "2026-04-19",
        session_id: "s-abc",
        enforcement_layer: "claude_md",
        target_file: "~/.claude/CLAUDE.md",
        verification_plan: {
          type: "transcript_grep",
          pattern: "git -C",
          expected: "absent",
        },
        expiry_condition: null,
      },
    ],
    outcomes: [
      {
        session_id: "s-def",
        checked_at: "2026-04-20",
        result: "prevented",
        evidence: "transcript_grep pattern=git -C expected=absent",
      },
    ],
  });
  writeLedger(TEST_PATH, [entry]);
  const result = readLedger(TEST_PATH);
  assertEquals(result.length, 1);
  assertEquals(result[0].proposals.length, 1);
  assertEquals(result[0].proposals[0].enforcement_layer, "claude_md");
  assertEquals(result[0].outcomes[0].result, "prevented");
});

Deno.test("findSimilar - detects similar rules (regression)", () => {
  const entries = [
    makeEntry({
      rule: "verify output value correctness not just error absence",
    }),
  ];
  const result = findSimilar(
    entries,
    "verify output value correctness before claiming success",
  );
  assertNotEquals(result, undefined);
  assertEquals(result?.id, "inst-00001");
});

Deno.test("applyOutcome - prevented increments confidence by 0.05", () => {
  const entry = makeEntry({ confidence: 0.5 });
  applyOutcome(entry, {
    session_id: "s-1",
    checked_at: "2026-04-20",
    result: "prevented",
    evidence: "grep passed",
  });
  assertEquals(entry.confidence, 0.55);
  assertEquals(entry.outcomes.length, 1);
});

Deno.test("applyOutcome - recurred decrements confidence by 0.2", () => {
  const entry = makeEntry({ confidence: 0.7 });
  applyOutcome(entry, {
    session_id: "s-1",
    checked_at: "2026-04-20",
    result: "recurred",
    evidence: "grep found pattern",
  });
  assertEquals(entry.confidence, 0.5);
});

Deno.test("applyOutcome - confidence clamps at 0.9 upper bound", () => {
  const entry = makeEntry({ confidence: 0.89 });
  applyOutcome(entry, {
    session_id: "s-1",
    checked_at: "2026-04-20",
    result: "prevented",
    evidence: "ok",
  });
  assertEquals(entry.confidence, 0.9);
});

Deno.test("applyOutcome - confidence clamps at 0 lower bound", () => {
  const entry = makeEntry({ confidence: 0.1 });
  applyOutcome(entry, {
    session_id: "s-1",
    checked_at: "2026-04-20",
    result: "recurred",
    evidence: "failed",
  });
  assertEquals(entry.confidence, 0);
});

Deno.test("applyOutcome - 5 consecutive not-applicable triggers -0.1 delta", () => {
  const entry = makeEntry({ confidence: 0.5 });
  for (let i = 0; i < 4; i++) {
    applyOutcome(entry, {
      session_id: `s-${i}`,
      checked_at: "2026-04-20",
      result: "not-applicable",
      evidence: "no signal",
    });
  }
  // First 4 → no delta yet
  assertEquals(entry.confidence, 0.5);
  applyOutcome(entry, {
    session_id: "s-4",
    checked_at: "2026-04-20",
    result: "not-applicable",
    evidence: "no signal",
  });
  // 5th → -0.1 applied
  assertEquals(entry.confidence, 0.4);
});

Deno.test("executeTranscriptGrep - expected absent, pattern found => recurred", () => {
  cleanup();
  Deno.writeTextFileSync(TEST_TRANSCRIPT, "some transcript with git -C invoked\n");
  const plan = {
    type: "transcript_grep" as const,
    pattern: "git -C",
    expected: "absent" as const,
  };
  const result = executeTranscriptGrep(plan, TEST_TRANSCRIPT);
  assertEquals(result, "recurred");
});

Deno.test("executeTranscriptGrep - expected absent, pattern not found => prevented", () => {
  cleanup();
  Deno.writeTextFileSync(TEST_TRANSCRIPT, "clean transcript with cd && git usage\n");
  const plan = {
    type: "transcript_grep" as const,
    pattern: "git -C",
    expected: "absent" as const,
  };
  const result = executeTranscriptGrep(plan, TEST_TRANSCRIPT);
  assertEquals(result, "prevented");
});

Deno.test("executeTranscriptGrep - expected present, pattern found => prevented", () => {
  cleanup();
  Deno.writeTextFileSync(TEST_TRANSCRIPT, "ran /verification-loop successfully\n");
  const plan = {
    type: "transcript_grep" as const,
    pattern: "/verification-loop",
    expected: "present" as const,
  };
  const result = executeTranscriptGrep(plan, TEST_TRANSCRIPT);
  assertEquals(result, "prevented");
});

Deno.test("executeTranscriptGrep - missing transcript returns not-applicable", () => {
  cleanup();
  const plan = {
    type: "transcript_grep" as const,
    pattern: "anything",
    expected: "absent" as const,
  };
  const result = executeTranscriptGrep(plan, `${TEST_DIR}/nonexistent.jsonl`);
  assertEquals(result, "not-applicable");
});
