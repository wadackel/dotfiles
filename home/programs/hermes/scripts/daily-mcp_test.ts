import { assertEquals, assertThrows } from "@std/assert";
import { test } from "bun:test";
import { validateBriefing } from "./daily-mcp.ts";

test("validateBriefing trims and accepts bullets", () => {
  assertEquals(
    validateBriefing("\n- **止まっている To-Do**: A\n"),
    "- **止まっている To-Do**: A",
  );
});

test("validateBriefing rejects headings, empty and oversized input", () => {
  assertThrows(() => validateBriefing("- a\n## 📝 To-Do"));
  assertThrows(() => validateBriefing("  # title"));
  assertThrows(() => validateBriefing("   "));
  assertThrows(() => validateBriefing("a".repeat(3001)));
});
