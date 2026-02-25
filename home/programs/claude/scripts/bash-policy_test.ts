import { assertEquals, assertMatch, assertNotMatch } from "jsr:@std/assert";
import { getSegments, globToRegex } from "./bash-policy.ts";

// ===== globToRegex =====

Deno.test("globToRegex: wildcard suffix matches", () => {
  assertMatch("git -C /tmp status", globToRegex("git -C *"));
});

Deno.test("globToRegex: wildcard suffix does not match unrelated command", () => {
  assertNotMatch("git status", globToRegex("git -C *"));
});

Deno.test("globToRegex: exact match without wildcards", () => {
  assertMatch("git", globToRegex("git"));
  assertNotMatch("git status", globToRegex("git"));
});

Deno.test("globToRegex: prefix wildcard", () => {
  assertMatch("npm run build", globToRegex("* run *"));
  assertMatch("pnpm run test", globToRegex("* run *"));
  assertNotMatch("npm install", globToRegex("* run *"));
});

Deno.test("globToRegex: dot in pattern is literal, not regex wildcard", () => {
  assertMatch("a.b", globToRegex("a.b"));
  assertNotMatch("a-b", globToRegex("a.b"));
});

Deno.test("globToRegex: npx pattern", () => {
  assertMatch("npx tsc --watch", globToRegex("npx *"));
  assertMatch("npx create-react-app my-app", globToRegex("npx *"));
  assertNotMatch("pnpm exec tsc", globToRegex("npx *"));
});

// ===== getSegments =====

Deno.test("getSegments: simple command", () => {
  assertEquals(getSegments("git status"), ["git status"]);
});

Deno.test("getSegments: git -C stays as one segment", () => {
  assertEquals(getSegments("git -C /tmp status"), ["git -C /tmp status"]);
});

Deno.test("getSegments: && splits into two segments", () => {
  assertEquals(getSegments("cd /app && git status"), ["cd /app", "git status"]);
});

Deno.test("getSegments: || splits into two segments", () => {
  assertEquals(getSegments("git status || echo failed"), [
    "git status",
    "echo failed",
  ]);
});

Deno.test("getSegments: pipe splits into segments", () => {
  assertEquals(getSegments("git log | head -10"), ["git log", "head -10"]);
});

Deno.test("getSegments: semicolon splits", () => {
  assertEquals(getSegments("git fetch; git pull"), ["git fetch", "git pull"]);
});

Deno.test("getSegments: redirections are stripped", () => {
  assertEquals(getSegments("git log 2>/dev/null"), ["git log"]);
  assertEquals(getSegments("git status 2>&1"), ["git status"]);
  assertEquals(getSegments("cmd < input.txt"), ["cmd"]);
});

Deno.test("getSegments: env var prefixes are stripped", () => {
  assertEquals(getSegments('TMUX="" tmux send-keys'), ["tmux send-keys"]);
  assertEquals(getSegments("FOO=bar BAZ=qux cmd arg"), ["cmd arg"]);
});

Deno.test("getSegments: subshell parens are removed", () => {
  assertEquals(getSegments("(cd /app && git status)"), [
    "cd /app",
    "git status",
  ]);
});

Deno.test("getSegments: complex pipeline with env var and redirections", () => {
  assertEquals(
    getSegments(
      'TMUX="" tmux capture-pane -p 2>/dev/null | grep -v \'^$\' | tail -3',
    ),
    ["tmux capture-pane -p", "grep -v '^$'", "tail -3"],
  );
});

Deno.test("getSegments: multiple operators in sequence", () => {
  assertEquals(getSegments("a && b | c ; d || e"), ["a", "b", "c", "d", "e"]);
});

Deno.test("getSegments: empty string returns empty array", () => {
  assertEquals(getSegments(""), []);
});

Deno.test("getSegments: whitespace-only returns empty array", () => {
  assertEquals(getSegments("   "), []);
});

// Known limitation: quoted operators cause incorrect splits,
// but do NOT produce false positives for our target patterns.
Deno.test(
  "getSegments: quoted operator - no false positive for git -C pattern",
  () => {
    const segments = getSegments('git commit -m "fix && update"');
    assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), false);
  },
);

// ===== Integration: pattern matching =====

Deno.test("integration: git -C is caught", () => {
  const segments = getSegments("git -C /tmp status");
  assertMatch(segments[0], globToRegex("git -C *"));
});

Deno.test("integration: normal git is not caught", () => {
  const segments = getSegments("git status");
  assertNotMatch(segments[0], globToRegex("git -C *"));
});

Deno.test("integration: npx after cd is caught", () => {
  const segments = getSegments("cd /app && npx tsc");
  assertEquals(segments.some((s) => globToRegex("npx *").test(s)), true);
});

Deno.test("integration: pnpm -F is not caught by npx rule", () => {
  const segments = getSegments("pnpm -F my-app build");
  assertEquals(segments.some((s) => globToRegex("npx *").test(s)), false);
});

// ===== Rule.exclude =====

Deno.test("exclude: npx scaffdog is not blocked when excluded", () => {
  const pattern = globToRegex("npx *");
  const exclude = globToRegex("npx scaffdog *");
  const segment = "npx scaffdog generate component";
  assertEquals(pattern.test(segment) && !exclude.test(segment), false);
});

Deno.test("exclude: npx tsc is still blocked when not in exclude list", () => {
  const pattern = globToRegex("npx *");
  const exclude = globToRegex("npx scaffdog *");
  const segment = "npx tsc --noEmit";
  assertEquals(pattern.test(segment) && !exclude.test(segment), true);
});
