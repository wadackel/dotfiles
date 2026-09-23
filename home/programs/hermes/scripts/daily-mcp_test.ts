import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { validateBriefing } from "./daily-mcp.ts";

Deno.test("validateBriefing trims and accepts bullets", () => {
  assertEquals(
    validateBriefing("\n- **止まっている To-Do**: A\n"),
    "- **止まっている To-Do**: A",
  );
});

Deno.test("validateBriefing rejects headings, empty and oversized input", () => {
  assertThrows(() => validateBriefing("- a\n## 📝 To-Do"));
  assertThrows(() => validateBriefing("  # title"));
  assertThrows(() => validateBriefing("   "));
  assertThrows(() => validateBriefing("a".repeat(3001)));
});
