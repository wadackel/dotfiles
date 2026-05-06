import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import {
  buildActivateCommand,
  buildTerminalNotifierArgs,
  debugOutput,
  isMissingRequestedUserOption,
  normalizeMissingUserOption,
  notificationMessage,
  parsePayload,
  pendingSubagentNotificationDecision,
  runCommand,
  shellQuote,
  subagentLockName,
  type TmuxContext,
  tmuxPaneId,
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
    "/Users/me/.codex/scripts/codex-notify.ts",
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

Deno.test("runCommand: timeout kills long-running process", async () => {
  const started = Date.now();
  const result = await runCommand("/bin/sleep", ["2"], { timeoutMs: 100 });
  assertEquals(result.code, 124);
  assertStringIncludes(result.stderr, "timeout after 100ms");
  if (Date.now() - started > 1000) {
    throw new Error("timeout command was not killed promptly");
  }
});

Deno.test("tmuxPaneId: accepts raw tmux pane ids only", () => {
  assertEquals(tmuxPaneId("%123"), "%123");
  assertEquals(tmuxPaneId("1"), null);
  assertEquals(tmuxPaneId("-L"), null);
  assertEquals(tmuxPaneId(undefined), null);
});

Deno.test("subagentLockName: uses raw pane id sanitization", () => {
  assertEquals(subagentLockName("%123"), "codex-pane-status-subagents--123");
});

Deno.test("isMissingRequestedUserOption: matches only exact missing user option stderr", () => {
  assertEquals(
    isMissingRequestedUserOption(
      "invalid option: @pane_pending_subagent_notifications",
      "@pane_pending_subagent_notifications",
    ),
    true,
  );
  assertEquals(
    isMissingRequestedUserOption(
      "invalid option: @pane_subagents",
      "@pane_pending_subagent_notifications",
    ),
    false,
  );
  assertEquals(
    isMissingRequestedUserOption(
      "no such pane: %999",
      "@pane_pending_subagent_notifications",
    ),
    false,
  );
  assertEquals(
    isMissingRequestedUserOption("invalid option: status", "status"),
    false,
  );
});

Deno.test("normalizeMissingUserOption: missing pending counter becomes send decision", () => {
  const normalized = normalizeMissingUserOption(
    {
      ok: false,
      stderr: "invalid option: @pane_pending_subagent_notifications",
    },
    "@pane_pending_subagent_notifications",
  );
  assertEquals(normalized, { ok: true, value: "" });
  assertEquals(
    pendingSubagentNotificationDecision(normalized.ok ? normalized.value : "1"),
    { kind: "send", count: 0 },
  );
});

Deno.test("normalizeMissingUserOption: unrelated tmux failures remain failures", () => {
  assertEquals(
    normalizeMissingUserOption(
      { ok: false, stderr: "no such pane: %999" },
      "@pane_pending_subagent_notifications",
    ),
    { ok: false, stderr: "no such pane: %999" },
  );
  assertEquals(
    normalizeMissingUserOption(
      { ok: true, value: "1" },
      "@pane_pending_subagent_notifications",
    ),
    { ok: true, value: "1" },
  );
});

Deno.test("pendingSubagentNotificationDecision: malformed and zero values send", () => {
  assertEquals(pendingSubagentNotificationDecision(""), {
    kind: "send",
    count: 0,
  });
  assertEquals(pendingSubagentNotificationDecision("0"), {
    kind: "send",
    count: 0,
  });
  assertEquals(pendingSubagentNotificationDecision("-1"), {
    kind: "send",
    count: 0,
  });
  assertEquals(pendingSubagentNotificationDecision("not-a-number"), {
    kind: "send",
    count: 0,
  });
});

Deno.test("pendingSubagentNotificationDecision: consumes one pending notification", () => {
  assertEquals(pendingSubagentNotificationDecision("1"), {
    kind: "skip",
    count: 1,
    remaining: 0,
    op: { kind: "unset", key: "@pane_pending_subagent_notifications" },
  });
  assertEquals(pendingSubagentNotificationDecision("3"), {
    kind: "skip",
    count: 3,
    remaining: 2,
    op: {
      kind: "set",
      key: "@pane_pending_subagent_notifications",
      value: "2",
    },
  });
});
