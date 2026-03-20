import {
  findSimilar,
  readInstincts,
  writeInstincts,
} from "./instincts.ts";
import { assertEquals, assertNotEquals } from "jsr:@std/assert";

const TEST_DIR = Deno.makeTempDirSync();
const TEST_PATH = `${TEST_DIR}/instincts.jsonl`;

function cleanup(): void {
  try {
    Deno.removeSync(TEST_PATH);
  } catch {
    // ignore
  }
}

Deno.test("readInstincts - empty file returns empty array", () => {
  cleanup();
  const result = readInstincts(TEST_PATH);
  assertEquals(result, []);
});

Deno.test("writeInstincts and readInstincts roundtrip", () => {
  cleanup();
  const instincts = [
    {
      id: "inst-00001",
      rule: "test rule",
      status: "active" as const,
      confidence: 0.5,
      domain: "verification",
      source_sessions: ["session-1"],
      created: "2026-03-19",
      last_reinforced: "2026-03-19",
      promoted_at: null,
      claude_md_section: null,
    },
  ];
  writeInstincts(TEST_PATH, instincts);
  const result = readInstincts(TEST_PATH);
  assertEquals(result.length, 1);
  assertEquals(result[0].id, "inst-00001");
  assertEquals(result[0].rule, "test rule");
  assertEquals(result[0].confidence, 0.5);
});

Deno.test("findSimilar - detects similar rules", () => {
  const instincts = [
    {
      id: "inst-00001",
      rule: "verify output value correctness not just error absence",
      status: "active" as const,
      confidence: 0.5,
      domain: "verification",
      source_sessions: ["s1"],
      created: "2026-03-19",
      last_reinforced: "2026-03-19",
      promoted_at: null,
      claude_md_section: null,
    },
  ];
  const result = findSimilar(
    instincts,
    "verify output value correctness before claiming success",
  );
  assertNotEquals(result, undefined);
  assertEquals(result?.id, "inst-00001");
});

Deno.test("findSimilar - does not match dissimilar rules", () => {
  const instincts = [
    {
      id: "inst-00001",
      rule: "verify output value correctness",
      status: "active" as const,
      confidence: 0.5,
      domain: "verification",
      source_sessions: ["s1"],
      created: "2026-03-19",
      last_reinforced: "2026-03-19",
      promoted_at: null,
      claude_md_section: null,
    },
  ];
  const result = findSimilar(instincts, "always use conventional commits for git");
  assertEquals(result, undefined);
});

Deno.test("findSimilar - skips pruned instincts", () => {
  const instincts = [
    {
      id: "inst-00001",
      rule: "verify output value correctness not just error absence",
      status: "pruned" as const,
      confidence: 0.2,
      domain: "verification",
      source_sessions: ["s1"],
      created: "2026-03-19",
      last_reinforced: "2026-03-19",
      promoted_at: null,
      claude_md_section: null,
    },
  ];
  const result = findSimilar(
    instincts,
    "verify output value correctness before claiming success",
  );
  assertEquals(result, undefined);
});

Deno.test("writeInstincts preserves multiple entries", () => {
  cleanup();
  const instincts = [
    {
      id: "inst-00001",
      rule: "rule one",
      status: "active" as const,
      confidence: 0.5,
      domain: "verification",
      source_sessions: ["s1"],
      created: "2026-03-19",
      last_reinforced: "2026-03-19",
      promoted_at: null,
      claude_md_section: null,
    },
    {
      id: "inst-00002",
      rule: "rule two",
      status: "promoted" as const,
      confidence: 0.8,
      domain: "workflow",
      source_sessions: ["s1", "s2"],
      created: "2026-03-18",
      last_reinforced: "2026-03-19",
      promoted_at: "2026-03-19",
      claude_md_section: "General",
    },
  ];
  writeInstincts(TEST_PATH, instincts);
  const result = readInstincts(TEST_PATH);
  assertEquals(result.length, 2);
  assertEquals(result[0].status, "active");
  assertEquals(result[1].status, "promoted");
  assertEquals(result[1].promoted_at, "2026-03-19");
});
