import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { spliceContent } from "./apply-managed.ts";

const MANAGED_BODY = [
  'model = "gpt-5.4"',
  'model_reasoning_effort = "high"',
  "",
  "[features]",
  "streamable_shell = true",
  "",
].join("\n");

const EXPECTED_BLOCK =
  "# nix-managed:start\n" + MANAGED_BODY + "# nix-managed:end\n";

const UNMANAGED_TAIL = [
  "",
  '[projects."/Users/me/foo"]',
  'trust_level = "trusted"',
  "",
  "[notice]",
  '"hide_xyz_migration_prompt" = true',
  "",
].join("\n");

Deno.test("scenario 1: target absent -> creates managed block with both markers", () => {
  const { next, result } = spliceContent(null, MANAGED_BODY);
  assertEquals(result.action, "created");
  assertEquals(next, EXPECTED_BLOCK);
  assertStringIncludes(next, "# nix-managed:start\n");
  assertStringIncludes(next, "# nix-managed:end\n");
});

Deno.test("scenario 2: target with markers and different content -> replaces inside, preserves outside", () => {
  const oldBody = 'model = "old-model"\n';
  const current = "# nix-managed:start\n" + oldBody + "# nix-managed:end\n" +
    UNMANAGED_TAIL;

  const { next, result } = spliceContent(current, MANAGED_BODY);

  assertEquals(result.action, "replaced");
  assertStringIncludes(next, EXPECTED_BLOCK);
  // Unmanaged tail must survive verbatim.
  assertStringIncludes(next, UNMANAGED_TAIL);
  assertStringIncludes(next, '[projects."/Users/me/foo"]');
  assertStringIncludes(next, "[notice]");
  // Old managed content must be gone.
  assertEquals(next.includes('model = "old-model"'), false);
});

Deno.test("scenario 3: target without markers -> prepends managed block, keeps existing content, returns warning", () => {
  const existing =
    'model = "user-set"\n[projects."/foo"]\ntrust_level = "trusted"\n';

  const { next, result } = spliceContent(existing, MANAGED_BODY);

  assertEquals(result.action, "prepended");
  assertEquals(next.startsWith("# nix-managed:start\n"), true);
  assertStringIncludes(next, EXPECTED_BLOCK);
  assertStringIncludes(next, existing);
  // Warning must mention duplicate keys / manual cleanup.
  assertEquals(typeof result.warning, "string");
  assertStringIncludes(result.warning ?? "", "duplicate");
});

Deno.test("scenario 4: target with markers and identical managed content -> noop, file content unchanged", () => {
  const current = EXPECTED_BLOCK + UNMANAGED_TAIL;

  const { next, result } = spliceContent(current, MANAGED_BODY);

  assertEquals(result.action, "noop");
  assertEquals(next, current);
});
