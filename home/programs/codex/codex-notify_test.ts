import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import {
  buildActivateCommand,
  buildTerminalNotifierArgs,
  debugOutput,
  notificationMessage,
  parsePayload,
  shellQuote,
  type TmuxContext,
} from "./codex-notify.ts";

Deno.test("parsePayload: accepts Codex notify payload and falls back on malformed JSON", () => {
  assertEquals(parsePayload('{"last-assistant-message":"done"}'), {
    "last-assistant-message": "done",
  });
  assertEquals(parsePayload("not-json"), {});
});

Deno.test("notificationMessage: prefers assistant message and sanitizes controls", () => {
  assertEquals(
    notificationMessage({ "last-assistant-message": "hello\n\tworld" }),
    "hello world",
  );
  assertEquals(notificationMessage({}), "Codex task completed");
});

Deno.test("shellQuote: quotes single quotes safely", () => {
  assertEquals(shellQuote("a'b"), "'a'\\''b'");
});

Deno.test("buildActivateCommand: uses argument quoting for callback command", () => {
  const ctx: TmuxContext = {
    session: "dev one",
    window: "1",
    pane: "2",
    paneTitle: "codex",
  };
  const cmd = buildActivateCommand(
    "/bin/deno",
    "/Users/me/.codex/codex-notify.ts",
    ctx,
    "/opt/bin/tmux",
  );
  assertStringIncludes(cmd, "'dev one'");
  assertStringIncludes(cmd, "'/opt/bin/tmux'");
});

Deno.test("buildTerminalNotifierArgs: includes tmux execute callback only when present", () => {
  const ctx: TmuxContext = {
    session: "s",
    window: "1",
    pane: "2",
    paneTitle: "codex-pane",
  };
  const args = buildTerminalNotifierArgs("done", "Hero", ctx, "activate-cmd");
  assertEquals(args.includes("-execute"), true);
  assertEquals(args.includes("activate-cmd"), true);
  assertEquals(args.includes("Codex · codex-pane"), true);

  const fallback = buildTerminalNotifierArgs("done", "Hero", null, null);
  assertEquals(fallback.includes("-execute"), false);
  assertEquals(fallback.includes("Codex"), true);
});

Deno.test("debugOutput: renders tail log or missing-log message", () => {
  const content = Array.from({ length: 55 }, (_, i) => `line-${i}`).join("\n");
  const output = debugOutput("/tmp/codex-notify.log", content);
  assertStringIncludes(output, "=== codex-notify.ts debug log ===");
  assertStringIncludes(output, "Log file: /tmp/codex-notify.log");
  assertEquals(output.includes("line-0"), false);
  assertStringIncludes(output, "line-54");

  assertEquals(
    debugOutput("/tmp/missing.log", null),
    "No log file found at /tmp/missing.log\n",
  );
});
