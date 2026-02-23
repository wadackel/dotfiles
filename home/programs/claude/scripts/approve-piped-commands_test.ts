import { assertEquals } from "jsr:@std/assert";
import {
  ALLOWED_COMMANDS,
  extractCommands,
  hasShellSyntax,
  shouldApprove,
} from "./approve-piped-commands.ts";

// --- hasShellSyntax ---

Deno.test("hasShellSyntax: pipe", () => {
  assertEquals(hasShellSyntax("echo test | grep foo"), true);
});

Deno.test("hasShellSyntax: &&", () => {
  assertEquals(hasShellSyntax("git add . && git commit -m msg"), true);
});

Deno.test("hasShellSyntax: ||", () => {
  assertEquals(hasShellSyntax("test -f a || echo missing"), true);
});

Deno.test("hasShellSyntax: semicolon", () => {
  assertEquals(hasShellSyntax("echo a; echo b"), true);
});

Deno.test("hasShellSyntax: simple command", () => {
  assertEquals(hasShellSyntax("echo hello"), false);
});

Deno.test("hasShellSyntax: stderr redirect 2>&1", () => {
  assertEquals(hasShellSyntax("gemini -p 'test' 2>&1"), true);
});

Deno.test("hasShellSyntax: output redirect >/dev/null", () => {
  assertEquals(hasShellSyntax("echo hello >/dev/null"), true);
});

Deno.test("hasShellSyntax: numbered output redirect 2>/dev/null", () => {
  assertEquals(hasShellSyntax("npm test 2>/dev/null"), true);
});

Deno.test("hasShellSyntax: input redirect", () => {
  assertEquals(hasShellSyntax("sort <input.txt"), true);
});

// --- extractCommands ---

Deno.test("extractCommands: simple pipe", () => {
  assertEquals(extractCommands("echo test | grep foo"), ["echo", "grep"]);
});

Deno.test("extractCommands: pipe with redirect", () => {
  assertEquals(
    extractCommands("echo test | gemini -p 'hello' 2>&1"),
    ["echo", "gemini"],
  );
});

Deno.test("extractCommands: subshell with pipe and redirect", () => {
  assertEquals(
    extractCommands('time (echo "test" | gemini -p "Reply" 2>&1)'),
    ["time", "echo", "gemini"],
  );
});

Deno.test("extractCommands: &&", () => {
  assertEquals(
    extractCommands("git add . && git commit -m msg"),
    ["git", "git"],
  );
});

Deno.test("extractCommands: mixed operators", () => {
  assertEquals(
    extractCommands("echo a | grep b && echo c; wc -l"),
    ["echo", "grep", "echo", "wc"],
  );
});

Deno.test("extractCommands: strips input redirect", () => {
  assertEquals(extractCommands("sort <input.txt | head"), ["sort", "head"]);
});

Deno.test("extractCommands: strips numbered redirect", () => {
  assertEquals(
    extractCommands("npm test 2>/dev/null | tail -5"),
    ["npm", "tail"],
  );
});

Deno.test("extractCommands: empty segments ignored", () => {
  assertEquals(extractCommands("| echo test"), ["echo"]);
});

Deno.test("extractCommands: env var prefix before command", () => {
  assertEquals(
    extractCommands('TMUX="" tmux capture-pane -p 2>/dev/null | grep -v \'^$\' | tail -3'),
    ["tmux", "grep", "tail"],
  );
});

Deno.test("extractCommands: multiple env vars before command", () => {
  assertEquals(
    extractCommands("FOO=bar BAZ=qux git diff | grep foo"),
    ["git", "grep"],
  );
});

// --- shouldApprove ---

Deno.test("shouldApprove: real-world gemini pipe command", () => {
  assertEquals(
    shouldApprove('time (echo "test" | gemini -p "Reply with one word" 2>&1)'),
    true,
  );
});

Deno.test("shouldApprove: simple pipe with allowed commands", () => {
  assertEquals(shouldApprove("echo test | grep foo"), true);
});

Deno.test("shouldApprove: && with allowed commands", () => {
  assertEquals(shouldApprove("git add . && git commit -m msg"), true);
});

Deno.test("shouldApprove: pipe with unknown command rejects", () => {
  assertEquals(shouldApprove("echo test | evil-cmd"), false);
});

Deno.test("shouldApprove: && with unknown command rejects", () => {
  assertEquals(shouldApprove("echo test && evil-cmd --flag"), false);
});

Deno.test("shouldApprove: simple command (no shell syntax) rejects", () => {
  assertEquals(shouldApprove("echo hello"), false);
});

Deno.test("shouldApprove: allowed command with 2>&1", () => {
  assertEquals(shouldApprove("gemini -p 'test' 2>&1"), true);
});

Deno.test("shouldApprove: allowed command with >/dev/null", () => {
  assertEquals(shouldApprove("npm test >/dev/null"), true);
});

Deno.test("shouldApprove: unknown command with 2>&1 rejects", () => {
  assertEquals(shouldApprove("evil-cmd 2>&1"), false);
});

Deno.test("shouldApprove: pipe + redirect combined", () => {
  assertEquals(shouldApprove("echo test | gemini -p 'hello' 2>&1"), true);
});

Deno.test("shouldApprove: custom allowed set", () => {
  const custom = new Set(["foo", "bar"]);
  assertEquals(shouldApprove("foo | bar", custom), true);
  assertEquals(shouldApprove("foo | baz", custom), false);
});

Deno.test("shouldApprove: triple pipe chain", () => {
  assertEquals(shouldApprove("cat file | grep pattern | wc -l"), true);
});

Deno.test("shouldApprove: env var prefix with allowed command", () => {
  assertEquals(
    shouldApprove('TMUX="" tmux capture-pane -t "%53" -p 2>/dev/null | grep -v \'^$\' | tail -3'),
    true,
  );
});

Deno.test("shouldApprove: env var prefix with unknown command rejects", () => {
  assertEquals(shouldApprove("TMUX=\"\" evil-cmd | grep foo"), false);
});

Deno.test("shouldApprove: all ALLOWED_COMMANDS entries are lowercase strings", () => {
  for (const cmd of ALLOWED_COMMANDS) {
    assertEquals(cmd, cmd.toLowerCase(), `${cmd} should be lowercase`);
    assertEquals(cmd.trim(), cmd, `${cmd} should have no whitespace`);
  }
});
