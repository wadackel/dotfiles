import { assertEquals } from "jsr:@std/assert@1";
import {
  ALL_PANE_OPTIONS_FOR_CLAUDE,
  ALL_PANE_OPTIONS_FOR_CODEX,
  ALL_PANE_OPTIONS_FOR_OPENCODE,
  CLAUDE_ONLY_KEYS,
  formatToolError,
  maskPrompt,
  type Op,
  promptOps,
  PROMPT_MAX_CHARS,
  sessionStartOps,
  TOOL_ERROR_MAX_CHARS,
  TOOL_SUBJECT_MAX_CHARS,
  toolFinishOps,
  toolStartOps,
  truncate,
  unsetOps,
} from "./pane-shared.ts";
import { TMUX_FORMAT } from "./pane_row.ts";

// --- Contract: TMUX_FORMAT keys ⊆ ⋃ writer keys ---
//
// Writers may set keys that the picker does not display (writer-internal
// state machine fields like @pane_pending_teardown, @pane_main_stopped,
// @pane_worktree_path, @pane_current_tool_use_id). The opposite direction —
// picker reads a key no writer ever sets — IS a contract violation: the
// picker would surface a permanently-empty cell.

function tmuxFormatKeys(): Set<string> {
  // TMUX_FORMAT contains placeholders like #{@pane_agent}; extract the @pane_*
  // names. Non-@pane fields (#{pane_id}, #{session_name}:..., etc.) are
  // intentionally excluded.
  const re = /@pane_[a-z_]+/g;
  return new Set(TMUX_FORMAT.match(re) ?? []);
}

Deno.test("TMUX_FORMAT keys ⊆ union of all writer ALL_PANE_OPTIONS", () => {
  const allWriter = new Set<string>([
    ...ALL_PANE_OPTIONS_FOR_CLAUDE,
    ...ALL_PANE_OPTIONS_FOR_CODEX,
    ...ALL_PANE_OPTIONS_FOR_OPENCODE,
  ]);
  for (const key of tmuxFormatKeys()) {
    if (!allWriter.has(key)) {
      throw new Error(
        `picker reads ${key} via TMUX_FORMAT but no writer lists it in ALL_PANE_OPTIONS_FOR_<AGENT> — picker would render an empty cell forever`,
      );
    }
  }
});

Deno.test("ALL_PANE_OPTIONS_FOR_OPENCODE ⊆ ALL_PANE_OPTIONS_FOR_CLAUDE", () => {
  // opencode's key set is a subset of claude's (it sets fewer keys).
  const claudeKeys = new Set<string>(ALL_PANE_OPTIONS_FOR_CLAUDE);
  for (const key of ALL_PANE_OPTIONS_FOR_OPENCODE) {
    if (!claudeKeys.has(key)) {
      throw new Error(
        `opencode key ${key} unexpectedly absent from claude's key set — divergence may be intentional but should be reviewed`,
      );
    }
  }
});

Deno.test("CLAUDE_ONLY_KEYS ⊆ ALL_PANE_OPTIONS_FOR_CLAUDE", () => {
  const claudeKeys = new Set<string>(ALL_PANE_OPTIONS_FOR_CLAUDE);
  for (const key of CLAUDE_ONLY_KEYS) {
    if (!claudeKeys.has(key)) {
      throw new Error(
        `CLAUDE_ONLY_KEYS member ${key} is missing from ALL_PANE_OPTIONS_FOR_CLAUDE — codex resume path would unset a key claude never sets`,
      );
    }
  }
});

// --- Constants ---

Deno.test("constants match pre-refactor writer values", () => {
  assertEquals(PROMPT_MAX_CHARS, 40);
  assertEquals(TOOL_SUBJECT_MAX_CHARS, 24);
  assertEquals(TOOL_ERROR_MAX_CHARS, 40);
});

// --- truncate ---

Deno.test("truncate: short input passes through unchanged", () => {
  assertEquals(truncate("hello", 10), "hello");
});

Deno.test("truncate: exact-max input passes through unchanged (no ellipsis)", () => {
  assertEquals(truncate("0123456789", 10), "0123456789");
});

Deno.test("truncate: over-max input is sliced + ellipsis appended (default …)", () => {
  assertEquals(truncate("0123456789abc", 10), "0123456789…");
});

Deno.test("truncate: codex-style 3-dot ellipsis honored", () => {
  assertEquals(truncate("0123456789abc", 10, "..."), "0123456789...");
});

Deno.test("truncate: control chars collapse to single space", () => {
  // \x00\x00\x00 (3 NUL run) → 1 space
  assertEquals(truncate("a\x00\x00\x00b", 10), "a b");
});

Deno.test("truncate: ESC byte neutralized to space (CSI body chars stay printable)", () => {
  // \x1b is 0x1b (control range); '[2J' are 0x5b/0x32/0x4a (printable
  // ASCII). Only the ESC is replaced — but that alone is sufficient to
  // disarm CSI interpretation (terminals require ESC to enter CSI state).
  assertEquals(truncate("a\x1b[2Jb", 10), "a [2Jb");
});

Deno.test("truncate: multi-byte input counted in code units (string length)", () => {
  // "あいう" = 3 chars (UTF-16 code units). max=2 ⇒ slice to 2 + ellipsis.
  assertEquals(truncate("あいう", 2), "あい…");
});

// --- maskPrompt ---

Deno.test("maskPrompt: non-string input returns empty", () => {
  assertEquals(maskPrompt(undefined), "");
  assertEquals(maskPrompt(null), "");
  assertEquals(maskPrompt(123), "");
  assertEquals(maskPrompt(""), "");
});

Deno.test("maskPrompt: clean short input passes through", () => {
  assertEquals(maskPrompt("hello world"), "hello world");
});

Deno.test("maskPrompt: collapses multi-space runs to single space", () => {
  assertEquals(maskPrompt("hello    world"), "hello world");
});

Deno.test("maskPrompt: trims surrounding whitespace", () => {
  assertEquals(maskPrompt("   hello   "), "hello");
});

Deno.test("maskPrompt: control bytes neutralized then collapsed", () => {
  // \x00\x1b \t = 3 controls → 1 space (control run replaced by single
  // space, then multi-space collapse leaves single space).
  assertEquals(maskPrompt("a\x00\x1b\tb"), "a b");
});

Deno.test("maskPrompt: over-max input sliced + default … ellipsis", () => {
  const long = "a".repeat(50);
  const out = maskPrompt(long);
  assertEquals(out, "a".repeat(40) + "…");
  assertEquals(out.length, 41);
});

Deno.test("maskPrompt: custom ellipsis honored (codex compat)", () => {
  const long = "a".repeat(50);
  assertEquals(maskPrompt(long, { ellipsis: "..." }), "a".repeat(40) + "...");
});

Deno.test("maskPrompt: custom max honored", () => {
  assertEquals(maskPrompt("0123456789abc", { max: 5 }), "01234…");
});

// --- formatToolError ---

Deno.test("formatToolError: strips leading 'Error: ' prefix", () => {
  assertEquals(formatToolError("Error: file not found"), "file not found");
});

Deno.test("formatToolError: bare error message passes through", () => {
  assertEquals(formatToolError("file not found"), "file not found");
});

Deno.test("formatToolError: long message truncated with default max", () => {
  const long = "Error: " + "x".repeat(50);
  // After strip: 50 'x'. max=40 → 40 'x' + …
  assertEquals(formatToolError(long), "x".repeat(40) + "…");
});

Deno.test("formatToolError: control chars in message neutralized", () => {
  assertEquals(
    formatToolError("Error: file\x00not\x00found"),
    "file not found",
  );
});

// --- unsetOps ---

Deno.test("unsetOps: empty keys returns empty array", () => {
  assertEquals(unsetOps([]), []);
});

Deno.test("unsetOps: produces { kind: 'unset', key } per input key", () => {
  assertEquals(unsetOps(["@pane_a", "@pane_b"]), [
    { kind: "unset", key: "@pane_a" },
    { kind: "unset", key: "@pane_b" },
  ]);
});

// --- sessionStartOps ---

Deno.test("sessionStartOps: minimal args (no cwd, default nowSec=startedAt)", () => {
  const ops = sessionStartOps({
    agent: "claude",
    sessionId: "sid-1",
    startedAt: "1700000000",
  });
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "claude" },
    { kind: "set", key: "@pane_session_id", value: "sid-1" },
    { kind: "set", key: "@pane_status", value: "idle" },
    { kind: "set", key: "@pane_started_at", value: "1700000000" },
    { kind: "set", key: "@pane_last_activity_at", value: "1700000000" },
  ] satisfies Op[]);
});

Deno.test("sessionStartOps: with cwd appended", () => {
  const ops = sessionStartOps({
    agent: "codex",
    sessionId: "sid-2",
    startedAt: "1700000000",
    cwd: "/repo",
  });
  assertEquals(ops, [
    { kind: "set", key: "@pane_agent", value: "codex" },
    { kind: "set", key: "@pane_session_id", value: "sid-2" },
    { kind: "set", key: "@pane_status", value: "idle" },
    { kind: "set", key: "@pane_started_at", value: "1700000000" },
    { kind: "set", key: "@pane_last_activity_at", value: "1700000000" },
    { kind: "set", key: "@pane_cwd", value: "/repo" },
  ] satisfies Op[]);
});

// --- promptOps ---

Deno.test("promptOps: with prompt sets @pane_prompt", () => {
  const ops = promptOps({ prompt: "hi", nowSec: "1700000000" });
  assertEquals(ops, [
    { kind: "set", key: "@pane_status", value: "running" },
    { kind: "set", key: "@pane_started_at", value: "1700000000" },
    { kind: "set", key: "@pane_last_activity_at", value: "1700000000" },
    { kind: "set", key: "@pane_prompt", value: "hi" },
  ] satisfies Op[]);
});

Deno.test("promptOps: empty prompt unsets @pane_prompt", () => {
  const ops = promptOps({ prompt: "", nowSec: "1700000000" });
  assertEquals(ops[3], { kind: "unset", key: "@pane_prompt" });
});

// --- toolStartOps ---

Deno.test("toolStartOps: with subject", () => {
  assertEquals(toolStartOps({ tool: "Bash", subject: "ls -la" }), [
    { kind: "set", key: "@pane_current_tool", value: "Bash" },
    { kind: "set", key: "@pane_current_tool_subject", value: "ls -la" },
  ] satisfies Op[]);
});

Deno.test("toolStartOps: without subject unsets @pane_current_tool_subject", () => {
  assertEquals(toolStartOps({ tool: "Read" }), [
    { kind: "set", key: "@pane_current_tool", value: "Read" },
    { kind: "unset", key: "@pane_current_tool_subject" },
  ] satisfies Op[]);
});

// --- toolFinishOps ---

Deno.test("toolFinishOps: success path (subject, no error)", () => {
  assertEquals(
    toolFinishOps({ tool: "Bash", subject: "ls", nowSec: "1700000123" }),
    [
      { kind: "set", key: "@pane_last_activity_at", value: "1700000123" },
      { kind: "unset", key: "@pane_current_tool" },
      { kind: "set", key: "@pane_last_tool", value: "Bash" },
      { kind: "set", key: "@pane_last_tool_subject", value: "ls" },
      { kind: "unset", key: "@pane_last_tool_error" },
    ] satisfies Op[],
  );
});

Deno.test("toolFinishOps: error path (sets @pane_last_tool_error)", () => {
  const ops = toolFinishOps({
    tool: "Bash",
    error: "command not found",
    nowSec: "1700000123",
  });
  // subject unset (caller passed undefined) + error set
  assertEquals(ops[3], { kind: "unset", key: "@pane_last_tool_subject" });
  assertEquals(ops[4], {
    kind: "set",
    key: "@pane_last_tool_error",
    value: "command not found",
  });
});

Deno.test("toolFinishOps: no subject + no error → both unset", () => {
  const ops = toolFinishOps({ tool: "Bash", nowSec: "1700000123" });
  assertEquals(ops, [
    { kind: "set", key: "@pane_last_activity_at", value: "1700000123" },
    { kind: "unset", key: "@pane_current_tool" },
    { kind: "set", key: "@pane_last_tool", value: "Bash" },
    { kind: "unset", key: "@pane_last_tool_subject" },
    { kind: "unset", key: "@pane_last_tool_error" },
  ] satisfies Op[]);
});

// --- Web-standard API guard (smoke check) ---

Deno.test("module source has no Deno.* / Bun.* / node: references", async () => {
  const url = new URL("./pane-shared.ts", import.meta.url);
  const src = await Deno.readTextFile(url);
  // Comments referencing these names ARE allowed (e.g. "Deno.* / Bun.* / node:*"
  // documentation); strip line comments + block comments before scanning.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const violations: string[] = [];
  for (const re of [/\bDeno\./, /\bBun\./, /\bnode:/, /\bprocess\./]) {
    if (re.test(stripped)) violations.push(re.source);
  }
  assertEquals(violations, []);
});
