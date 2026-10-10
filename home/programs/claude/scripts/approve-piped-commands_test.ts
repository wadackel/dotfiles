import { test } from "bun:test";
import { assertEquals } from "@std/assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractAllowedPattern,
  extractCommands,
  loadAllowedPatterns,
  matchesAllowedPattern,
  shouldApprove,
} from "./approve-piped-commands.ts";

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

// --- extractCommands ---

test("extractCommands: simple pipe", async () => {
  assertEquals(await extractCommands("echo test | grep foo"), ["echo", "grep"]);
});

test("extractCommands: pipe with redirect", async () => {
  assertEquals(
    await extractCommands("echo test | gemini -p 'hello' 2>&1"),
    ["echo", "gemini"],
  );
});

test("extractCommands: &&", async () => {
  assertEquals(
    await extractCommands("git add . && git commit -m msg"),
    ["git", "git"],
  );
});

test("extractCommands: mixed operators", async () => {
  assertEquals(
    await extractCommands("echo a | grep b && echo c; wc -l"),
    ["echo", "grep", "echo", "wc"],
  );
});

test("extractCommands: strips input redirect", async () => {
  assertEquals(await extractCommands("sort <input.txt | head"), [
    "sort",
    "head",
  ]);
});

test("extractCommands: strips numbered redirect", async () => {
  assertEquals(
    await extractCommands("npm test 2>/dev/null | tail -5"),
    ["npm", "tail"],
  );
});

test("extractCommands: env var prefix before command", async () => {
  assertEquals(
    await extractCommands(
      "TMUX=\"\" tmux capture-pane -p 2>/dev/null | grep -v '^$' | tail -3",
    ),
    ["tmux", "grep", "tail"],
  );
});

test("extractCommands: multiple env vars before command", async () => {
  assertEquals(
    await extractCommands("FOO=bar BAZ=qux git diff | grep foo"),
    ["git", "grep"],
  );
});

// --- shouldApprove ---

// AST-based detection: quoted operators are not treated as compound
test("shouldApprove: quoted pipe — single command matches pattern", async () => {
  const patterns = ["git *"];
  assertEquals(
    await shouldApprove('git commit -m "fix | update"', patterns),
    true,
  );
});

test("shouldApprove: quoted && — single command matches pattern", async () => {
  const patterns = ["git *"];
  assertEquals(
    await shouldApprove('git commit -m "fix && update"', patterns),
    true,
  );
});

test("shouldApprove: pipe with allowed commands", async () => {
  const patterns = ["echo *", "grep *"];
  assertEquals(await shouldApprove("echo test | grep foo", patterns), true);
});

test("shouldApprove: && with allowed commands", async () => {
  const patterns = ["git add *", "git commit *"];
  assertEquals(
    await shouldApprove("git add . && git commit -m msg", patterns),
    true,
  );
});

test("shouldApprove: pipe with unknown command rejects", async () => {
  const patterns = ["echo *"];
  assertEquals(await shouldApprove("echo test | evil-cmd", patterns), false);
});

test("shouldApprove: && with unknown command rejects", async () => {
  const patterns = ["echo *"];
  assertEquals(
    await shouldApprove("echo test && evil-cmd --flag", patterns),
    false,
  );
});

test("shouldApprove: simple command matches pattern (non-compound approved)", async () => {
  const patterns = ["echo *"];
  assertEquals(await shouldApprove("echo hello", patterns), true);
});

test("shouldApprove: allowed command with 2>&1", async () => {
  const patterns = ["gemini *"];
  assertEquals(await shouldApprove("gemini -p 'test' 2>&1", patterns), true);
});

test("shouldApprove: allowed command with >/dev/null", async () => {
  const patterns = ["npm *"];
  assertEquals(await shouldApprove("npm test >/dev/null", patterns), true);
});

test("shouldApprove: unknown command with 2>&1 rejects", async () => {
  assertEquals(await shouldApprove("evil-cmd 2>&1", []), false);
});

test("shouldApprove: pipe + redirect combined", async () => {
  const patterns = ["echo *", "gemini *"];
  assertEquals(
    await shouldApprove("echo test | gemini -p 'hello' 2>&1", patterns),
    true,
  );
});

test("shouldApprove: triple pipe chain", async () => {
  const patterns = ["cat *", "grep *", "wc *"];
  assertEquals(
    await shouldApprove("cat file | grep pattern | wc -l", patterns),
    true,
  );
});

test("shouldApprove: env var prefix with allowed command", async () => {
  const patterns = ["tmux *", "grep *", "tail *"];
  assertEquals(
    await shouldApprove(
      'TMUX="" tmux capture-pane -t "%53" -p 2>/dev/null | grep -v \'^$\' | tail -3',
      patterns,
    ),
    true,
  );
});

test("shouldApprove: env var prefix with unknown command rejects", async () => {
  const patterns = ["grep *"];
  assertEquals(
    await shouldApprove('TMUX="" evil-cmd | grep foo', patterns),
    false,
  );
});

// --- basename fallback ---

test("extractCommands: path-based command with redirect", async () => {
  assertEquals(
    await extractCommands(
      "~/.claude/scripts/extract-session-history.ts 2>/dev/null",
    ),
    ["~/.claude/scripts/extract-session-history.ts"],
  );
});

test("shouldApprove: full path script with redirect (basename fallback)", async () => {
  const patterns = ["*extract-session-history.ts*"];
  assertEquals(
    await shouldApprove(
      "~/.claude/scripts/extract-session-history.ts 2>/dev/null",
      patterns,
    ),
    true,
  );
});

test("shouldApprove: unknown path-based command with redirect rejects", async () => {
  assertEquals(
    await shouldApprove("/usr/local/bin/evil-cmd 2>/dev/null", []),
    false,
  );
});

test("shouldApprove: basename fallback with custom patterns", async () => {
  const patterns = ["my-script.ts *"];
  assertEquals(
    await shouldApprove("/some/path/my-script.ts arg 2>&1", patterns),
    true,
  );
  assertEquals(
    await shouldApprove("/some/path/other.ts arg 2>&1", patterns),
    false,
  );
});

// --- subcommand granularity (regression tests for security fix) ---

test("shouldApprove: git push rejected when only git diff allowed", async () => {
  const patterns = ["git diff *"];
  assertEquals(
    await shouldApprove("git push --force 2>&1", patterns),
    false,
  );
});

test("shouldApprove: git diff approved when git diff allowed", async () => {
  const patterns = ["git diff *"];
  assertEquals(
    await shouldApprove("git diff HEAD 2>&1", patterns),
    true,
  );
});

test("shouldApprove: sudo rm rejected when only sudo -k allowed", async () => {
  const patterns = ["sudo -k *"];
  assertEquals(
    await shouldApprove("sudo rm -rf / 2>&1", patterns),
    false,
  );
});

test("shouldApprove: sudo -k approved when sudo -k allowed", async () => {
  const patterns = ["sudo -k *"];
  assertEquals(
    await shouldApprove("sudo -k 2>&1", patterns),
    true,
  );
});

test("shouldApprove: nix profile rejected when only nix fmt allowed", async () => {
  const patterns = ["nix fmt *"];
  assertEquals(
    await shouldApprove("nix profile wipe-history 2>&1", patterns),
    false,
  );
});

test("shouldApprove: nix fmt approved when nix fmt allowed", async () => {
  const patterns = ["nix fmt *"];
  assertEquals(
    await shouldApprove("nix fmt 2>&1", patterns),
    true,
  );
});

test("shouldApprove: gh auth rejected when only gh api and gh pr allowed", async () => {
  const patterns = ["gh api *", "gh pr *"];
  assertEquals(
    await shouldApprove("gh auth logout 2>&1", patterns),
    false,
  );
});

test("shouldApprove: compound with mixed subcommands, one not allowed", async () => {
  const patterns = ["git diff *", "git add *"];
  assertEquals(
    await shouldApprove("git add . && git push origin main", patterns),
    false,
  );
});

test("shouldApprove: compound with all subcommands allowed", async () => {
  const patterns = ["git diff *", "git add *"];
  assertEquals(
    await shouldApprove("git add . && git diff HEAD", patterns),
    true,
  );
});

// --- heredoc approval ---

test("shouldApprove: standalone heredoc with allowed command", async () => {
  const patterns = ["agent-browser *"];
  assertEquals(
    await shouldApprove(
      "agent-browser eval <<'EOF'\nconsole.log(1);\nEOF",
      patterns,
    ),
    true,
  );
});

test("shouldApprove: empty heredoc with allowed command", async () => {
  const patterns = ["agent-browser *"];
  assertEquals(
    await shouldApprove("agent-browser eval <<'EOF'\nEOF", patterns),
    true,
  );
});

test("shouldApprove: heredoc with unquoted delimiter", async () => {
  const patterns = ["cat *"];
  assertEquals(
    await shouldApprove("cat <<EOF\nhello\nEOF", patterns),
    true,
  );
});

test("shouldApprove: heredoc with double-quoted delimiter", async () => {
  const patterns = ["cat *"];
  assertEquals(
    await shouldApprove('cat <<"EOF"\nhello\nEOF', patterns),
    true,
  );
});

test("shouldApprove: heredoc with indented delimiter (<<-)", async () => {
  const patterns = ["cat *"];
  assertEquals(
    await shouldApprove("cat <<-EOF\n\thello\n\tEOF", patterns),
    true,
  );
});

test("shouldApprove: heredoc combined with pipe", async () => {
  const patterns = ["cat *", "grep *"];
  assertEquals(
    await shouldApprove("cat <<EOF | grep foo\nhello world\nEOF", patterns),
    true,
  );
});

test("shouldApprove: heredoc combined with &&", async () => {
  const patterns = ["agent-browser *", "echo *"];
  assertEquals(
    await shouldApprove(
      "agent-browser eval <<'EOF' && echo done\nconsole.log(1);\nEOF",
      patterns,
    ),
    true,
  );
});

test("shouldApprove: heredoc with disallowed command rejects", async () => {
  const patterns = ["echo *"];
  assertEquals(
    await shouldApprove("evil-cmd <<'EOF'\nhello\nEOF", patterns),
    false,
  );
});

test("shouldApprove: heredoc pipe where one command is disallowed rejects", async () => {
  const patterns = ["cat *"];
  assertEquals(
    await shouldApprove("cat <<EOF | evil-cmd\nhello\nEOF", patterns),
    false,
  );
});

test("shouldApprove: multiple heredocs with allowed commands", async () => {
  const patterns = ["cat *"];
  assertEquals(
    await shouldApprove("cat <<A\na\nA\ncat <<B\nb\nB", patterns),
    true,
  );
});

// --- Reproduction tests for codex CLI permission prompt issue ---

test("shouldApprove: H1 — multiline prompt with 2>&1 (Pattern A)", async () => {
  const patterns = ["codex *"];
  const cmd =
    'codex exec --full-auto "\nReview uncommitted changes.\n\n## Review criteria\n1. Correctness\n2. Security\n3. Code quality\n\nMark each issue with severity: Critical/High/Medium/Low\n" 2>&1';
  assertEquals(await shouldApprove(cmd, patterns), true);
});

test("shouldApprove: H2 — special chars without shell syntax (Pattern C)", async () => {
  const patterns = ["codex *"];
  const cmd = 'codex exec -s read-only "text with ${row.pr_number} syntax"';
  assertEquals(await shouldApprove(cmd, patterns), true);
});

test("shouldApprove: non-compound unknown command still rejects", async () => {
  const patterns = ["codex *"];
  assertEquals(await shouldApprove("evil-cmd hello", patterns), false);
});

test("shouldApprove: H3 — multiline with pipe char in prompt + 2>&1", async () => {
  const patterns = ["codex *"];
  const cmd =
    'codex exec --full-auto "\n| Header | Value |\n|--------|-------|\n| a      | b     |\n" 2>&1';
  assertEquals(await shouldApprove(cmd, patterns), true);
});

// --- Git global flag stripping ---

test("shouldApprove: strips git -c key=value before subcommand", async () => {
  const patterns = ["git status *", "head *"];
  assertEquals(
    await shouldApprove(
      "git -c core.excludesfile=/dev/null status --porcelain 2>&1 | head -5",
      patterns,
    ),
    true,
  );
});

test("shouldApprove: strips git --no-pager before subcommand", async () => {
  const patterns = ["git log *"];
  assertEquals(
    await shouldApprove("git --no-pager log --oneline -5", patterns),
    true,
  );
});

test("shouldApprove: strips git -C dir before subcommand", async () => {
  const patterns = ["git status *"];
  assertEquals(
    await shouldApprove("git -C /tmp/repo status", patterns),
    true,
  );
});

test("shouldApprove: strips multiple git global flags", async () => {
  const patterns = ["git diff *"];
  assertEquals(
    await shouldApprove(
      "git --no-pager -c diff.color=never -C /tmp/repo diff HEAD",
      patterns,
    ),
    true,
  );
});

test("shouldApprove: strips git --git-dir=value", async () => {
  const patterns = ["git log *"];
  assertEquals(
    await shouldApprove("git --git-dir=/tmp/.git log --oneline", patterns),
    true,
  );
});

test("shouldApprove: git flag stripping does not affect non-git commands", async () => {
  // gh -c is not a real flag, so it stays as-is and won't match "gh status *"
  const patterns = ["gh status *"];
  assertEquals(
    await shouldApprove("gh -c something status", patterns),
    false,
  );
});

test("shouldApprove: git without flags still works", async () => {
  const patterns = ["git commit *"];
  assertEquals(await shouldApprove("git commit -m 'test'", patterns), true);
});
