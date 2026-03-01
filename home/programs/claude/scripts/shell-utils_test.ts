import { assertEquals, assertMatch, assertNotMatch } from "jsr:@std/assert";
import {
  getSegments,
  getSegmentsFallback,
  globToRegex,
  stripHeredocs,
} from "./shell-utils.ts";

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

Deno.test("getSegments: simple command", async () => {
  assertEquals(await getSegments("git status"), ["git status"]);
});

Deno.test("getSegments: git -C stays as one segment", async () => {
  assertEquals(await getSegments("git -C /tmp status"), ["git -C /tmp status"]);
});

Deno.test("getSegments: && splits into two segments", async () => {
  assertEquals(await getSegments("cd /app && git status"), ["cd /app", "git status"]);
});

Deno.test("getSegments: || splits into two segments", async () => {
  assertEquals(await getSegments("git status || echo failed"), [
    "git status",
    "echo failed",
  ]);
});

Deno.test("getSegments: pipe splits into segments", async () => {
  assertEquals(await getSegments("git log | head -10"), ["git log", "head -10"]);
});

Deno.test("getSegments: semicolon splits", async () => {
  assertEquals(await getSegments("git fetch; git pull"), ["git fetch", "git pull"]);
});

Deno.test("getSegments: redirections are stripped", async () => {
  assertEquals(await getSegments("git log 2>/dev/null"), ["git log"]);
  assertEquals(await getSegments("git status 2>&1"), ["git status"]);
  assertEquals(await getSegments("cmd < input.txt"), ["cmd"]);
});

Deno.test("getSegments: env var prefixes are stripped", async () => {
  assertEquals(await getSegments('TMUX="" tmux send-keys'), ["tmux send-keys"]);
  assertEquals(await getSegments("FOO=bar BAZ=qux cmd arg"), ["cmd arg"]);
});

Deno.test("getSegments: subshell parens are removed", async () => {
  assertEquals(await getSegments("(cd /app && git status)"), [
    "cd /app",
    "git status",
  ]);
});

Deno.test("getSegments: complex pipeline with env var and redirections", async () => {
  assertEquals(
    await getSegments(
      'TMUX="" tmux capture-pane -p 2>/dev/null | grep -v \'^$\' | tail -3',
    ),
    ["tmux capture-pane -p", "grep -v ^$", "tail -3"],
  );
});

Deno.test("getSegments: multiple operators in sequence", async () => {
  assertEquals(await getSegments("a && b | c ; d || e"), ["a", "b", "c", "d", "e"]);
});

Deno.test("getSegments: empty string returns empty array", async () => {
  assertEquals(await getSegments(""), []);
});

Deno.test("getSegments: whitespace-only returns empty array", async () => {
  assertEquals(await getSegments("   "), []);
});

// Quoted operators are now handled correctly by the AST parser
Deno.test("getSegments: quoted && is not split", async () => {
  assertEquals(await getSegments('git commit -m "fix && update"'), [
    "git commit -m fix && update",
  ]);
});

// ===== Loop constructs =====

Deno.test("getSegments: for loop extracts body commands", async () => {
  assertEquals(await getSegments("for f in *.txt; do echo hello; done"), [
    "echo hello",
  ]);
});

Deno.test("getSegments: while loop extracts condition and body commands", async () => {
  assertEquals(await getSegments("while true; do sleep 1; done"), [
    "true",
    "sleep 1",
  ]);
});

Deno.test("getSegments: until loop extracts condition and body commands", async () => {
  assertEquals(await getSegments("until false; do echo waiting; done"), [
    "false",
    "echo waiting",
  ]);
});

Deno.test("getSegments: nested for loops", async () => {
  const segments = await getSegments(
    'for f in a b; do for g in 1 2; do echo "$f"; done; done',
  );
  assertEquals(segments, ['echo "$f"']);
});

// ===== If/Case =====

Deno.test("getSegments: if extracts commands from all branches", async () => {
  const segments = await getSegments(
    "if [ -f a ]; then echo yes; else echo no; fi",
  );
  assertEquals(segments, ["[ -f a ]", "echo yes", "echo no"]);
});

// ===== Integration: pattern matching =====

Deno.test("integration: git -C is caught", async () => {
  const segments = await getSegments("git -C /tmp status");
  assertMatch(segments[0], globToRegex("git -C *"));
});

Deno.test("integration: normal git is not caught", async () => {
  const segments = await getSegments("git status");
  assertNotMatch(segments[0], globToRegex("git -C *"));
});

Deno.test("integration: npx after cd is caught", async () => {
  const segments = await getSegments("cd /app && npx tsc");
  assertEquals(segments.some((s) => globToRegex("npx *").test(s)), true);
});

Deno.test("integration: pnpm -F is not caught by npx rule", async () => {
  const segments = await getSegments("pnpm -F my-app build");
  assertEquals(segments.some((s) => globToRegex("npx *").test(s)), false);
});

Deno.test("integration: git -C inside for loop is caught", async () => {
  const segments = await getSegments(
    'for d in */; do git -C "$d" status; done',
  );
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), true);
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

// ===== Heredoc handling =====

Deno.test("stripHeredocs: removes heredoc body", () => {
  assertEquals(
    stripHeredocs("cat <<EOF\nhello world\nEOF"),
    "cat <<HEREDOC",
  );
});

Deno.test("stripHeredocs: preserves commands after heredoc on same line", () => {
  assertEquals(
    stripHeredocs("cat <<EOF && git -C /tmp status\nhello\nEOF"),
    "cat <<HEREDOC && git -C /tmp status",
  );
});

Deno.test("stripHeredocs: handles indented heredoc (<<-)", () => {
  assertEquals(
    stripHeredocs("cat <<-EOF\n\thello\n\tEOF"),
    "cat <<-HEREDOC",
  );
});

Deno.test("stripHeredocs: handles single-quoted delimiter", () => {
  assertEquals(
    stripHeredocs("cat <<'EOF'\nhello\nEOF"),
    "cat <<'HEREDOC'",
  );
});

Deno.test("stripHeredocs: handles double-quoted delimiter", () => {
  assertEquals(
    stripHeredocs('cat <<"EOF"\nhello\nEOF'),
    'cat <<"HEREDOC"',
  );
});

Deno.test("stripHeredocs: handles multiple heredocs", () => {
  assertEquals(
    stripHeredocs("cat <<A\na\nA\ncat <<B\nb\nB"),
    "cat <<HEREDOC\ncat <<HEREDOC",
  );
});

Deno.test("stripHeredocs: no-op on commands without heredocs", () => {
  assertEquals(stripHeredocs("git status"), "git status");
  assertEquals(
    stripHeredocs("for f in *.txt; do echo hello; done"),
    "for f in *.txt; do echo hello; done",
  );
});

Deno.test("getSegments: heredoc body is not treated as commands", async () => {
  const segments = await getSegments("cat <<EOF\ngit -C /tmp status\nEOF");
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), false);
});

Deno.test("getSegments: real command after heredoc is still checked", async () => {
  const segments = await getSegments(
    "cat <<EOF && git -C /tmp status\nhello\nEOF",
  );
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), true);
});

Deno.test("getSegments: safe heredoc with safe command passes", async () => {
  const segments = await getSegments("cat <<EOF && echo done\nhello\nEOF");
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), false);
});

// ===== Command substitution =====

Deno.test("getSegments: command substitution $() extracts inner commands", async () => {
  const segments = await getSegments("echo $(git -C /tmp status)");
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), true);
});

Deno.test("getSegments: backtick command substitution extracts inner commands", async () => {
  const segments = await getSegments("echo `git -C /tmp status`");
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), true);
});

Deno.test("getSegments: safe command substitution is not blocked", async () => {
  const segments = await getSegments("echo $(git status)");
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), false);
});

// ===== Process substitution (known limitation) =====

Deno.test("getSegments: process substitution falls back gracefully", async () => {
  // Parser doesn't support <(), falls back to regex.
  // Known limitation: inner commands of <(...) are not individually extracted.
  const segments = await getSegments("cat <(echo hello)");
  assertEquals(Array.isArray(segments), true);
});

// ===== Null safety =====

Deno.test("getSegments: redirect-only command does not crash", async () => {
  const segments = await getSegments("> /tmp/out");
  // Should not throw, segments may be empty or contain empty string
  assertEquals(Array.isArray(segments), true);
});

Deno.test("getSegments: [[ ]] conditional falls back gracefully", async () => {
  const segments = await getSegments("[[ -f a ]] && echo yes");
  assertEquals(segments.some((s) => s === "echo yes"), true);
});

Deno.test("getSegments: double-quoted heredoc body is not treated as commands", async () => {
  const segments = await getSegments('cat <<"EOF"\ngit -C /tmp status\nEOF');
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), false);
});

// ===== Fallback keyword stripping =====

Deno.test("getSegmentsFallback: strips leading shell keywords from segments", () => {
  assertEquals(getSegmentsFallback("select x in a b; do git -C /tmp status; done"), [
    "x in a b",
    "git -C /tmp status",
  ]);
});

Deno.test("getSegmentsFallback: strips do/done/then/fi keywords", () => {
  assertEquals(
    getSegmentsFallback("if true; then echo yes; fi"),
    ["true", "echo yes"],
  );
});

// ===== getSegmentsFallback =====

Deno.test("getSegmentsFallback: works same as before for simple cases", () => {
  assertEquals(getSegmentsFallback("cd /app && git status"), [
    "cd /app",
    "git status",
  ]);
});

Deno.test("getSegmentsFallback: semicolon splits", () => {
  assertEquals(getSegmentsFallback("git fetch; git pull"), [
    "git fetch",
    "git pull",
  ]);
});
