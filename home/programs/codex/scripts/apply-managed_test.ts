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

const EXPECTED_BLOCK = "# nix-managed:start\n" + MANAGED_BODY +
  "# nix-managed:end\n";

const MANAGED_BODY_WITH_TUI = [
  'model = "gpt-5.4"',
  'model_reasoning_effort = "high"',
  "",
  "[features]",
  "streamable_shell = true",
  "",
  "[tui]",
  'status_line = ["model", "project-name", "git-branch", "context-used", "five-hour-limit"]',
  "",
].join("\n");

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

Deno.test("scenario 5: managed body shrinks (section removed) -> section gone, unmanaged tail preserved", () => {
  const oldBodyWithSection = [
    'model = "gpt-5.4"',
    'sandbox_mode = "workspace-write"',
    "",
    "[sandbox_workspace_write]",
    "network_access = true",
    "",
  ].join("\n");
  const newBodyWithoutSection = [
    'model = "gpt-5.5"',
    'sandbox_mode = "danger-full-access"',
    "",
  ].join("\n");
  const current = "# nix-managed:start\n" + oldBodyWithSection +
    "# nix-managed:end\n" + UNMANAGED_TAIL;

  const { next, result } = spliceContent(current, newBodyWithoutSection);

  assertEquals(result.action, "replaced");
  // Removed section must be completely gone.
  assertEquals(next.includes("[sandbox_workspace_write]"), false);
  assertEquals(next.includes("network_access = true"), false);
  assertEquals(next.includes('sandbox_mode = "workspace-write"'), false);
  // New managed body must be present.
  assertStringIncludes(next, 'model = "gpt-5.5"');
  assertStringIncludes(next, 'sandbox_mode = "danger-full-access"');
  // Unmanaged tail must survive verbatim.
  assertStringIncludes(next, UNMANAGED_TAIL);
  assertStringIncludes(next, '[projects."/Users/me/foo"]');
});

Deno.test("scenario 6: managed tui status_line prunes legacy unmanaged tui while preserving nested tui state", () => {
  const current = "# nix-managed:start\n" + MANAGED_BODY +
    "# nix-managed:end\n" +
    UNMANAGED_TAIL +
    [
      "[tui]",
      'status_line = ["model", "project-name", "git-branch", "context-used", "five-hour-limit"]',
      "",
      "[tui.model_availability_nux]",
      '"gpt-5.5" = 4',
      "",
    ].join("\n");

  const { next, result } = spliceContent(current, MANAGED_BODY_WITH_TUI);

  assertEquals(result.action, "replaced");
  assertStringIncludes(next, "[tui]\n");
  assertStringIncludes(next, "[tui.model_availability_nux]");
  assertStringIncludes(next, '"gpt-5.5" = 4');
  assertEquals((next.match(/\[tui\]\n/g) ?? []).length, 1);
  assertEquals((next.match(/status_line =/g) ?? []).length, 1);
});

Deno.test("scenario 7: unexpected unmanaged tui keys are preserved for fail-loud cleanup", () => {
  const current = "# nix-managed:start\n" + MANAGED_BODY +
    "# nix-managed:end\n" +
    UNMANAGED_TAIL +
    [
      "[tui]",
      'status_line = ["old"]',
      "other_key = true",
      "",
      "[notice.more]",
      "value = true",
      "",
    ].join("\n");

  const { next, result } = spliceContent(current, MANAGED_BODY_WITH_TUI);

  assertEquals(result.action, "replaced");
  assertStringIncludes(next, 'status_line = ["old"]');
  assertStringIncludes(next, "other_key = true");
  assertStringIncludes(next, "[notice.more]");
});
