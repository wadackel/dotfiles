import { test } from "bun:test";
import { assertEquals, assertMatch, assertNotMatch } from "@std/assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractAllowedPattern,
  flattenCommand,
  getSegments,
  getSegmentsFallback,
  globToRegex,
  loadAllowedPatterns,
  matchesAllowedPattern,
  parseCommand,
  stripHeredocs,
} from "./shell-utils.ts";

// ===== globToRegex =====

test("globToRegex: wildcard suffix matches", () => {
  assertMatch("git -C /tmp status", globToRegex("git -C *"));
});

test("globToRegex: wildcard suffix does not match unrelated command", () => {
  assertNotMatch("git status", globToRegex("git -C *"));
});

test("globToRegex: exact match without wildcards", () => {
  assertMatch("git", globToRegex("git"));
  assertNotMatch("git status", globToRegex("git"));
});

test("globToRegex: prefix wildcard", () => {
  assertMatch("npm run build", globToRegex("* run *"));
  assertMatch("pnpm run test", globToRegex("* run *"));
  assertNotMatch("npm install", globToRegex("* run *"));
});

test("globToRegex: dot in pattern is literal, not regex wildcard", () => {
  assertMatch("a.b", globToRegex("a.b"));
  assertNotMatch("a-b", globToRegex("a.b"));
});

test("globToRegex: npx pattern", () => {
  assertMatch("npx tsc --watch", globToRegex("npx *"));
  assertMatch("npx create-react-app my-app", globToRegex("npx *"));
  assertNotMatch("pnpm exec tsc", globToRegex("npx *"));
});

test("globToRegex: wildcard matches newlines (multiline segment)", () => {
  // Heredoc-stripped segments may contain embedded newlines
  const segment = "gh pr create --title Test --body \"$(cat <<'HEREDOC'\n)\"";
  assertMatch(segment, globToRegex("gh pr create * <<*"));
  assertNotMatch(
    "gh pr create --title Test --body-file /tmp/body.md",
    globToRegex("gh pr create * <<*"),
  );
});

// ===== getSegments =====

test("getSegments: simple command", async () => {
  assertEquals(await getSegments("git status"), ["git status"]);
});

test("getSegments: git -C stays as one segment", async () => {
  assertEquals(await getSegments("git -C /tmp status"), ["git -C /tmp status"]);
});

test("getSegments: && splits into two segments", async () => {
  assertEquals(await getSegments("cd /app && git status"), [
    "cd /app",
    "git status",
  ]);
});

test("getSegments: || splits into two segments", async () => {
  assertEquals(await getSegments("git status || echo failed"), [
    "git status",
    "echo failed",
  ]);
});

test("getSegments: pipe splits into segments", async () => {
  assertEquals(await getSegments("git log | head -10"), [
    "git log",
    "head -10",
  ]);
});

test("getSegments: semicolon splits", async () => {
  assertEquals(await getSegments("git fetch; git pull"), [
    "git fetch",
    "git pull",
  ]);
});

test("getSegments: redirections are stripped", async () => {
  assertEquals(await getSegments("git log 2>/dev/null"), ["git log"]);
  assertEquals(await getSegments("git status 2>&1"), ["git status"]);
  assertEquals(await getSegments("cmd < input.txt"), ["cmd"]);
});

test("getSegments: env var prefixes are stripped", async () => {
  assertEquals(await getSegments('TMUX="" tmux send-keys'), ["tmux send-keys"]);
  assertEquals(await getSegments("FOO=bar BAZ=qux cmd arg"), ["cmd arg"]);
});

test("getSegments: subshell parens are removed", async () => {
  assertEquals(await getSegments("(cd /app && git status)"), [
    "cd /app",
    "git status",
  ]);
});

test("getSegments: complex pipeline with env var and redirections", async () => {
  assertEquals(
    await getSegments(
      "TMUX=\"\" tmux capture-pane -p 2>/dev/null | grep -v '^$' | tail -3",
    ),
    ["tmux capture-pane -p", "grep -v ^$", "tail -3"],
  );
});

test("getSegments: multiple operators in sequence", async () => {
  assertEquals(await getSegments("a && b | c ; d || e"), [
    "a",
    "b",
    "c",
    "d",
    "e",
  ]);
});

test("getSegments: empty string returns empty array", async () => {
  assertEquals(await getSegments(""), []);
});

test("getSegments: whitespace-only returns empty array", async () => {
  assertEquals(await getSegments("   "), []);
});

// Quoted operators are now handled correctly by the AST parser
test("getSegments: quoted && is not split", async () => {
  assertEquals(await getSegments('git commit -m "fix && update"'), [
    "git commit -m fix && update",
  ]);
});

// ===== Loop constructs =====

test("getSegments: for loop extracts body commands", async () => {
  assertEquals(await getSegments("for f in *.txt; do echo hello; done"), [
    "echo hello",
  ]);
});

test("getSegments: while loop extracts condition and body commands", async () => {
  assertEquals(await getSegments("while true; do sleep 1; done"), [
    "true",
    "sleep 1",
  ]);
});

test("getSegments: until loop extracts condition and body commands", async () => {
  assertEquals(await getSegments("until false; do echo waiting; done"), [
    "false",
    "echo waiting",
  ]);
});

test("getSegments: nested for loops", async () => {
  const segments = await getSegments(
    'for f in a b; do for g in 1 2; do echo "$f"; done; done',
  );
  assertEquals(segments, ['echo "$f"']);
});

// ===== If/Case =====

test("getSegments: if extracts commands from all branches", async () => {
  const segments = await getSegments(
    "if [ -f a ]; then echo yes; else echo no; fi",
  );
  assertEquals(segments, ["[ -f a ]", "echo yes", "echo no"]);
});

// ===== Integration: pattern matching =====

test("integration: git -C is caught", async () => {
  const segments = await getSegments("git -C /tmp status");
  assertMatch(segments[0], globToRegex("git -C *"));
});

test("integration: normal git is not caught", async () => {
  const segments = await getSegments("git status");
  assertNotMatch(segments[0], globToRegex("git -C *"));
});

test("integration: npx after cd is caught", async () => {
  const segments = await getSegments("cd /app && npx tsc");
  assertEquals(segments.some((s) => globToRegex("npx *").test(s)), true);
});

test("integration: pnpm -F is not caught by npx rule", async () => {
  const segments = await getSegments("pnpm -F my-app build");
  assertEquals(segments.some((s) => globToRegex("npx *").test(s)), false);
});

test("integration: git -C inside for loop is caught", async () => {
  const segments = await getSegments(
    'for d in */; do git -C "$d" status; done',
  );
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), true);
});

// ===== Rule.exclude =====

test("exclude: npx scaffdog is not blocked when excluded", () => {
  const pattern = globToRegex("npx *");
  const exclude = globToRegex("npx scaffdog *");
  const segment = "npx scaffdog generate component";
  assertEquals(pattern.test(segment) && !exclude.test(segment), false);
});

test("exclude: npx tsc is still blocked when not in exclude list", () => {
  const pattern = globToRegex("npx *");
  const exclude = globToRegex("npx scaffdog *");
  const segment = "npx tsc --noEmit";
  assertEquals(pattern.test(segment) && !exclude.test(segment), true);
});

// ===== Heredoc handling =====

test("stripHeredocs: removes heredoc body", () => {
  assertEquals(
    stripHeredocs("cat <<EOF\nhello world\nEOF"),
    "cat <<HEREDOC",
  );
});

test("stripHeredocs: preserves commands after heredoc on same line", () => {
  assertEquals(
    stripHeredocs("cat <<EOF && git -C /tmp status\nhello\nEOF"),
    "cat <<HEREDOC && git -C /tmp status",
  );
});

test("stripHeredocs: handles indented heredoc (<<-)", () => {
  assertEquals(
    stripHeredocs("cat <<-EOF\n\thello\n\tEOF"),
    "cat <<-HEREDOC",
  );
});

test("stripHeredocs: handles single-quoted delimiter", () => {
  assertEquals(
    stripHeredocs("cat <<'EOF'\nhello\nEOF"),
    "cat <<'HEREDOC'",
  );
});

test("stripHeredocs: handles double-quoted delimiter", () => {
  assertEquals(
    stripHeredocs('cat <<"EOF"\nhello\nEOF'),
    'cat <<"HEREDOC"',
  );
});

test("stripHeredocs: handles multiple heredocs", () => {
  assertEquals(
    stripHeredocs("cat <<A\na\nA\ncat <<B\nb\nB"),
    "cat <<HEREDOC\ncat <<HEREDOC",
  );
});

test("stripHeredocs: no-op on commands without heredocs", () => {
  assertEquals(stripHeredocs("git status"), "git status");
  assertEquals(
    stripHeredocs("for f in *.txt; do echo hello; done"),
    "for f in *.txt; do echo hello; done",
  );
});

test("getSegments: heredoc body is not treated as commands", async () => {
  const segments = await getSegments("cat <<EOF\ngit -C /tmp status\nEOF");
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), false);
});

test("getSegments: real command after heredoc is still checked", async () => {
  const segments = await getSegments(
    "cat <<EOF && git -C /tmp status\nhello\nEOF",
  );
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), true);
});

test("getSegments: safe heredoc with safe command passes", async () => {
  const segments = await getSegments("cat <<EOF && echo done\nhello\nEOF");
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), false);
});

// ===== Command substitution =====

test("getSegments: command substitution $() extracts inner commands", async () => {
  const segments = await getSegments("echo $(git -C /tmp status)");
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), true);
});

test("getSegments: backtick command substitution extracts inner commands", async () => {
  const segments = await getSegments("echo `git -C /tmp status`");
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), true);
});

test("getSegments: safe command substitution is not blocked", async () => {
  const segments = await getSegments("echo $(git status)");
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), false);
});

// ===== Process substitution (known limitation) =====

test("getSegments: process substitution falls back gracefully", async () => {
  // Parser doesn't support <(), falls back to regex.
  // Known limitation: inner commands of <(...) are not individually extracted.
  const segments = await getSegments("cat <(echo hello)");
  assertEquals(Array.isArray(segments), true);
});

// ===== Null safety =====

test("getSegments: redirect-only command does not crash", async () => {
  const segments = await getSegments("> /tmp/out");
  // Should not throw, segments may be empty or contain empty string
  assertEquals(Array.isArray(segments), true);
});

test("getSegments: [[ ]] conditional falls back gracefully", async () => {
  const segments = await getSegments("[[ -f a ]] && echo yes");
  assertEquals(segments.some((s) => s === "echo yes"), true);
});

test("getSegments: double-quoted heredoc body is not treated as commands", async () => {
  const segments = await getSegments('cat <<"EOF"\ngit -C /tmp status\nEOF');
  assertEquals(segments.some((s) => globToRegex("git -C *").test(s)), false);
});

// ===== Fallback keyword stripping =====

test("getSegmentsFallback: strips leading shell keywords from segments", () => {
  assertEquals(
    getSegmentsFallback("select x in a b; do git -C /tmp status; done"),
    [
      "x in a b",
      "git -C /tmp status",
    ],
  );
});

test("getSegmentsFallback: strips do/done/then/fi keywords", () => {
  assertEquals(
    getSegmentsFallback("if true; then echo yes; fi"),
    ["true", "echo yes"],
  );
});

// ===== Empty heredoc (stripHeredocs regex fix) =====

test("stripHeredocs: handles empty heredoc", () => {
  assertEquals(
    stripHeredocs("cat <<EOF\nEOF"),
    "cat <<HEREDOC",
  );
});

test("stripHeredocs: handles empty single-quoted heredoc", () => {
  assertEquals(
    stripHeredocs("cat <<'EOF'\nEOF"),
    "cat <<'HEREDOC'",
  );
});

test("stripHeredocs: handles empty indented heredoc", () => {
  assertEquals(
    stripHeredocs("cat <<-EOF\nEOF"),
    "cat <<-HEREDOC",
  );
});

// ===== Heredoc isCompound detection (Dless/Dlessdash) =====

test("parseCommand: heredoc command is compound", async () => {
  const result = await parseCommand("cat <<EOF\nhello\nEOF");
  assertEquals(result.isCompound, true);
});

test("parseCommand: indented heredoc command is compound", async () => {
  const result = await parseCommand("cat <<-EOF\n\thello\n\tEOF");
  assertEquals(result.isCompound, true);
});

test("parseCommand: heredoc segments exclude redirect", async () => {
  const result = await parseCommand(
    "agent-browser eval <<'EOF'\nconsole.log(1);\nEOF",
  );
  assertEquals(result.segments, ["agent-browser eval"]);
  assertEquals(result.isCompound, true);
});

// ===== getSegmentsFallback =====

test("getSegmentsFallback: works same as before for simple cases", () => {
  assertEquals(getSegmentsFallback("cd /app && git status"), [
    "cd /app",
    "git status",
  ]);
});

test("getSegmentsFallback: semicolon splits", () => {
  assertEquals(getSegmentsFallback("git fetch; git pull"), [
    "git fetch",
    "git pull",
  ]);
});

// ===== parseCommand: isCompound + segments =====

test("parseCommand: simple command is not compound", async () => {
  const result = await parseCommand("git stash");
  assertEquals(result.isCompound, false);
  assertEquals(result.segments, ["git stash"]);
});

test("parseCommand: pipeline is compound", async () => {
  const result = await parseCommand("echo test | grep foo");
  assertEquals(result.isCompound, true);
  assertEquals(result.segments, ["echo test", "grep foo"]);
});

test("parseCommand: redirect 2>&1 is compound", async () => {
  const result = await parseCommand("gemini -p 'test' 2>&1");
  assertEquals(result.isCompound, true);
  assertEquals(result.segments, ["gemini -p test"]);
});

test("parseCommand: redirect >/dev/null is compound", async () => {
  const result = await parseCommand("echo hello >/dev/null");
  assertEquals(result.isCompound, true);
  assertEquals(result.segments, ["echo hello"]);
});

test("parseCommand: redirect 2>/dev/null is compound", async () => {
  const result = await parseCommand("npm test 2>/dev/null");
  assertEquals(result.isCompound, true);
  assertEquals(result.segments, ["npm test"]);
});

test("parseCommand: input redirect is compound", async () => {
  const result = await parseCommand("sort <input.txt");
  assertEquals(result.isCompound, true);
  assertEquals(result.segments, ["sort"]);
});

test("parseCommand: quoted pipe is not compound", async () => {
  const result = await parseCommand('git commit -m "fix | update"');
  assertEquals(result.isCompound, false);
});

test("parseCommand: quoted && is not compound", async () => {
  const result = await parseCommand('git commit -m "fix && update"');
  assertEquals(result.isCompound, false);
});

test("parseCommand: env var prefix only is not compound", async () => {
  const result = await parseCommand('TMUX="" tmux send-keys');
  assertEquals(result.isCompound, false);
  assertEquals(result.segments, ["tmux send-keys"]);
});

test("parseCommand: command substitution $() is compound", async () => {
  const result = await parseCommand("echo $(git merge-base HEAD master)");
  assertEquals(result.isCompound, true);
});

test("parseCommand: for loop is compound", async () => {
  const result = await parseCommand("for f in *.txt; do echo hello; done");
  assertEquals(result.isCompound, true);
});

test("parseCommand: if statement is compound", async () => {
  const result = await parseCommand("if [ -f a ]; then echo yes; fi");
  assertEquals(result.isCompound, true);
});

test("parseCommand: subshell is compound", async () => {
  const result = await parseCommand("(cd /app && git status)");
  assertEquals(result.isCompound, true);
});

test("parseCommand: empty string returns empty segments and not compound", async () => {
  const result = await parseCommand("");
  assertEquals(result.isCompound, false);
  assertEquals(result.segments, []);
});

test("parseCommand: process substitution falls back gracefully", async () => {
  // Parser doesn't support <(), falls back to regex which detects <
  const result = await parseCommand("cat <(echo hello)");
  assertEquals(result.isCompound, true);
  assertEquals(Array.isArray(result.segments), true);
});

// ===== flattenCommand =====

const HELPER = "/h/.claude/scripts/example-helper.ts";
const PLAN = "/h/.claude/plans/b.md";

test("flattenCommand: cd && helper yields two flat commands, no exotic", async () => {
  const flat = await flattenCommand(
    `cd /r && ${HELPER} activate-pending ${PLAN} s`,
  );
  assertEquals(flat?.exotic, false);
  assertEquals(flat?.commands.length, 2);
  assertEquals(flat?.commands[0].name, "cd");
  assertEquals(flat?.commands[0].redirects, []);
  assertEquals(flat?.commands[1].name, HELPER);
  assertEquals(flat?.commands[1].args, ["activate-pending", PLAN, "s"]);
  assertEquals(flat?.commands[1].redirects, []);
});

test("flattenCommand: semicolon and pipe are flat (not exotic)", async () => {
  const semi = await flattenCommand("a ; b ; c");
  assertEquals(semi?.exotic, false);
  assertEquals(semi?.commands.length, 3);
  const pipe = await flattenCommand("a | b");
  assertEquals(pipe?.exotic, false);
  assertEquals(pipe?.commands.length, 2);
});

test("flattenCommand: &> redirect (prefix position) is captured", async () => {
  const flat = await flattenCommand(`echo x &> /h/.claude/plans/x`);
  assertEquals(flat?.exotic, false);
  // `&>` splits into an async `echo x` plus a nameless command bearing the
  // redirect in prefix position. Some leaf must carry the plans-dir target.
  const redirects = flat?.commands.flatMap((c) => c.redirects) ?? [];
  assertEquals(
    redirects.some((r) => r.target === "/h/.claude/plans/x" && !r.isFdDup),
    true,
  );
});

test("flattenCommand: suffix redirect target + fd-dup are captured", async () => {
  const out = await flattenCommand(`echo x > /h/.claude/plans/.active-pwn`);
  assertEquals(out?.commands[0].redirects, [
    {
      target: "/h/.claude/plans/.active-pwn",
      isFdDup: false,
      isHeredoc: false,
    },
  ]);

  const devnull = await flattenCommand(`ls /h/.claude/plans/ 2>/dev/null`);
  assertEquals(devnull?.commands[0].redirects, [
    { target: "/dev/null", isFdDup: false, isHeredoc: false },
  ]);

  const fddup = await flattenCommand(`ls /h/.claude/plans 2>&1`);
  assertEquals(fddup?.commands[0].redirects, [{
    target: "1",
    isFdDup: true,
    isHeredoc: false,
  }]);

  const clobber = await flattenCommand(`ls x >| /h/.claude/plans/y`);
  assertEquals(clobber?.commands[0].redirects, [
    { target: "/h/.claude/plans/y", isFdDup: false, isHeredoc: false },
  ]);

  const none = await flattenCommand(`ls /h/.claude/plans/`);
  assertEquals(none?.commands[0].redirects, []);
});

test("flattenCommand: command expansion sets hasExpansion", async () => {
  const flat = await flattenCommand(`echo $(touch /h/.claude/plans/x)`);
  assertEquals(flat?.exotic, false);
  assertEquals(flat?.commands.some((c) => c.hasExpansion), true);
});

test("flattenCommand: subshell is exotic", async () => {
  const flat = await flattenCommand(`(cmd)`);
  assertEquals(flat?.exotic, true);
});

test("flattenCommand: if/for/while/case are exotic", async () => {
  for (
    const cmd of [
      "if true; then cmd; fi",
      "for x in a b; do cmd; done",
      "while true; do cmd; done",
      "case x in a) cmd;; esac",
    ]
  ) {
    const flat = await flattenCommand(cmd);
    assertEquals(flat?.exotic, true, `should be exotic: ${cmd}`);
  }
});

test("flattenCommand: parse error (here-string) returns null", async () => {
  const flat = await flattenCommand(`cat <<< /h/.claude/plans/x`);
  assertEquals(flat, null);
});

test("flattenCommand: a prefix assignment sets hasAssignment and a heredoc is a marked redirect", async () => {
  const flat = await flattenCommand("X=1 ./tool record e <<'EOF'\n{}\nEOF");
  assertEquals(flat?.commands[0].name, "./tool");
  assertEquals(flat?.commands[0].hasAssignment, true);
  assertEquals(flat?.commands[0].redirects.map((r) => r.isHeredoc), [true]);
  const plain = await flattenCommand("./tool snapshot e > out 2>/dev/null");
  assertEquals(plain?.commands[0].hasAssignment, false);
  assertEquals(
    plain?.commands[0].redirects.map((r) => [r.target, r.isHeredoc]),
    [["out", false], ["/dev/null", false]],
  );
});

// --- extractAllowedPattern ---

test("extractAllowedPattern: simple command pattern", () => {
  assertEquals(extractAllowedPattern("Bash(echo *)"), "echo *");
});

test("extractAllowedPattern: subcommand pattern preserves subcommand", () => {
  assertEquals(extractAllowedPattern("Bash(git add *)"), "git add *");
});

test("extractAllowedPattern: wrapped wildcard pattern", () => {
  assertEquals(
    extractAllowedPattern("Bash(*extract-session-history.ts*)"),
    "*extract-session-history.ts*",
  );
});

test("extractAllowedPattern: generic wildcard with flags returns null", () => {
  assertEquals(extractAllowedPattern("Bash(* --help *)"), null);
});

test("extractAllowedPattern: version flag only returns null", () => {
  assertEquals(extractAllowedPattern("Bash(* --version)"), null);
});

test("extractAllowedPattern: short help flag returns null", () => {
  assertEquals(extractAllowedPattern("Bash(* -h *)"), null);
});

test("extractAllowedPattern: short version flag returns null", () => {
  assertEquals(extractAllowedPattern("Bash(* -v)"), null);
});

test("extractAllowedPattern: system path returns null", () => {
  assertEquals(extractAllowedPattern("Bash(//dev/null)"), null);
});

test("extractAllowedPattern: bare command no wildcard", () => {
  assertEquals(extractAllowedPattern("Bash(env)"), "env");
});

test("extractAllowedPattern: whoami bare command", () => {
  assertEquals(extractAllowedPattern("Bash(whoami)"), "whoami");
});

test("extractAllowedPattern: pwd bare command", () => {
  assertEquals(extractAllowedPattern("Bash(pwd)"), "pwd");
});

test("extractAllowedPattern: env var prefix is stripped", () => {
  assertEquals(extractAllowedPattern("Bash(TMUX= tmux:*)"), "tmux *");
});

test("extractAllowedPattern: colon separator format", () => {
  assertEquals(extractAllowedPattern("Bash(rg:*)"), "rg *");
});

test("extractAllowedPattern: colon separator with subcommand", () => {
  assertEquals(extractAllowedPattern("Bash(nix fmt:*)"), "nix fmt *");
});

test("extractAllowedPattern: non-Bash pattern returns null", () => {
  assertEquals(extractAllowedPattern("Read(**)"), null);
});

test("extractAllowedPattern: Edit pattern returns null", () => {
  assertEquals(extractAllowedPattern("Edit(~/.claude/**)"), null);
});

test("extractAllowedPattern: path-based command preserves glob", () => {
  assertEquals(
    extractAllowedPattern("Bash(~/.claude/scripts/foo.ts:*)"),
    "~/.claude/scripts/foo.ts *",
  );
});

test("extractAllowedPattern: sudo -k preserves flag", () => {
  assertEquals(extractAllowedPattern("Bash(sudo -k *)"), "sudo -k *");
});

test("extractAllowedPattern: bracket test command", () => {
  assertEquals(extractAllowedPattern("Bash([ *)"), "[ *");
});

test("extractAllowedPattern: double bracket test command", () => {
  assertEquals(extractAllowedPattern("Bash([[ *)"), "[[ *");
});

test("extractAllowedPattern: multiple env vars then command", () => {
  assertEquals(
    extractAllowedPattern("Bash(FOO=bar BAZ=qux git diff *)"),
    "git diff *",
  );
});

test("extractAllowedPattern: deep subcommand preserved", () => {
  assertEquals(
    extractAllowedPattern("Bash(nix-store --query --references *)"),
    "nix-store --query --references *",
  );
});

test("extractAllowedPattern: defaults with flags preserved", () => {
  assertEquals(
    extractAllowedPattern("Bash(defaults -currentHost read -g *)"),
    "defaults -currentHost read -g *",
  );
});

// --- matchesAllowedPattern ---

test("matchesAllowedPattern: exact glob match", () => {
  assertEquals(matchesAllowedPattern("git diff HEAD", "git diff *"), true);
});

test("matchesAllowedPattern: bare command matches 'cmd *' pattern", () => {
  assertEquals(matchesAllowedPattern("echo", "echo *"), true);
});

test("matchesAllowedPattern: wrong subcommand does not match", () => {
  assertEquals(matchesAllowedPattern("git push --force", "git diff *"), false);
});

test("matchesAllowedPattern: wrapped wildcard matches path", () => {
  assertEquals(
    matchesAllowedPattern(
      "~/.claude/scripts/extract-session-history.ts",
      "*extract-session-history.ts*",
    ),
    true,
  );
});

test("matchesAllowedPattern: exact bare command", () => {
  assertEquals(matchesAllowedPattern("whoami", "whoami"), true);
});

test("matchesAllowedPattern: bare command with args does not match exact pattern", () => {
  assertEquals(matchesAllowedPattern("whoami extra", "whoami"), false);
});

test("matchesAllowedPattern: sudo -k matches", () => {
  assertEquals(matchesAllowedPattern("sudo -k", "sudo -k *"), true);
});

test("matchesAllowedPattern: sudo rm does not match sudo -k", () => {
  assertEquals(matchesAllowedPattern("sudo rm -rf /", "sudo -k *"), false);
});

// --- loadAllowedPatterns ---

test("loadAllowedPatterns: extracts patterns from Bash patterns", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "tmp-"));
  const path = `${tmpDir}/settings.json`;
  await writeFile(
    path,
    JSON.stringify({
      permissions: {
        allow: [
          "Bash(echo *)",
          "Bash(git add *)",
          "Bash(*extract-session-history.ts*)",
          "Read(**)",
        ],
      },
    }),
  );

  const patterns = await loadAllowedPatterns([path]);
  assertEquals(patterns.includes("echo *"), true);
  assertEquals(patterns.includes("git add *"), true);
  assertEquals(patterns.includes("*extract-session-history.ts*"), true);
  // Non-Bash patterns are skipped
  assertEquals(patterns.length, 3);

  await rm(tmpDir, { recursive: true });
});

test("loadAllowedPatterns: merges multiple files", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "tmp-"));
  const file1 = `${tmpDir}/a.json`;
  const file2 = `${tmpDir}/b.json`;
  await writeFile(
    file1,
    JSON.stringify({ permissions: { allow: ["Bash(echo *)"] } }),
  );
  await writeFile(
    file2,
    JSON.stringify({ permissions: { allow: ["Bash(rg:*)"] } }),
  );

  const patterns = await loadAllowedPatterns([file1, file2]);
  assertEquals(patterns.includes("echo *"), true);
  assertEquals(patterns.includes("rg *"), true);

  await rm(tmpDir, { recursive: true });
});

test("loadAllowedPatterns: missing file is silently skipped", async () => {
  const patterns = await loadAllowedPatterns(["/nonexistent/path.json"]);
  assertEquals(patterns.length, 0);
});

test("loadAllowedPatterns: wildcard-only and system path patterns excluded", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "tmp-"));
  const path = `${tmpDir}/settings.json`;
  await writeFile(
    path,
    JSON.stringify({
      permissions: {
        allow: [
          "Bash(* --help *)",
          "Bash(* --version)",
          "Bash(//dev/null)",
          "Bash(echo *)",
        ],
      },
    }),
  );

  const patterns = await loadAllowedPatterns([path]);
  assertEquals(patterns.length, 1);
  assertEquals(patterns[0], "echo *");

  await rm(tmpDir, { recursive: true });
});

test("loadAllowedPatterns: no permissions key returns empty array", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "tmp-"));
  const path = `${tmpDir}/settings.json`;
  await writeFile(path, JSON.stringify({ model: "sonnet" }));

  const patterns = await loadAllowedPatterns([path]);
  assertEquals(patterns.length, 0);

  await rm(tmpDir, { recursive: true });
});

test("loadAllowedPatterns: deduplicates across files", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "tmp-"));
  const file1 = `${tmpDir}/a.json`;
  const file2 = `${tmpDir}/b.json`;
  await writeFile(
    file1,
    JSON.stringify({ permissions: { allow: ["Bash(echo *)"] } }),
  );
  await writeFile(
    file2,
    JSON.stringify({ permissions: { allow: ["Bash(echo *)"] } }),
  );

  const patterns = await loadAllowedPatterns([file1, file2]);
  assertEquals(patterns.length, 1);

  await rm(tmpDir, { recursive: true });
});
