import { assertEquals } from "jsr:@std/assert";
import {
  extractAllowedPattern,
  extractCommands,
  loadAllowedPatterns,
  matchesAllowedPattern,
  shouldApprove,
} from "./approve-piped-commands.ts";

// --- extractAllowedPattern ---

Deno.test("extractAllowedPattern: simple command pattern", () => {
  assertEquals(extractAllowedPattern("Bash(echo *)"), "echo *");
});

Deno.test("extractAllowedPattern: subcommand pattern preserves subcommand", () => {
  assertEquals(extractAllowedPattern("Bash(git add *)"), "git add *");
});

Deno.test("extractAllowedPattern: wrapped wildcard pattern", () => {
  assertEquals(
    extractAllowedPattern("Bash(*extract-session-history.ts*)"),
    "*extract-session-history.ts*",
  );
});

Deno.test("extractAllowedPattern: generic wildcard with flags returns null", () => {
  assertEquals(extractAllowedPattern("Bash(* --help *)"), null);
});

Deno.test("extractAllowedPattern: version flag only returns null", () => {
  assertEquals(extractAllowedPattern("Bash(* --version)"), null);
});

Deno.test("extractAllowedPattern: short help flag returns null", () => {
  assertEquals(extractAllowedPattern("Bash(* -h *)"), null);
});

Deno.test("extractAllowedPattern: short version flag returns null", () => {
  assertEquals(extractAllowedPattern("Bash(* -v)"), null);
});

Deno.test("extractAllowedPattern: system path returns null", () => {
  assertEquals(extractAllowedPattern("Bash(//dev/null)"), null);
});

Deno.test("extractAllowedPattern: bare command no wildcard", () => {
  assertEquals(extractAllowedPattern("Bash(env)"), "env");
});

Deno.test("extractAllowedPattern: whoami bare command", () => {
  assertEquals(extractAllowedPattern("Bash(whoami)"), "whoami");
});

Deno.test("extractAllowedPattern: pwd bare command", () => {
  assertEquals(extractAllowedPattern("Bash(pwd)"), "pwd");
});

Deno.test("extractAllowedPattern: env var prefix is stripped", () => {
  assertEquals(extractAllowedPattern("Bash(TMUX= tmux:*)"), "tmux *");
});

Deno.test("extractAllowedPattern: colon separator format", () => {
  assertEquals(extractAllowedPattern("Bash(rg:*)"), "rg *");
});

Deno.test("extractAllowedPattern: colon separator with subcommand", () => {
  assertEquals(extractAllowedPattern("Bash(nix fmt:*)"), "nix fmt *");
});

Deno.test("extractAllowedPattern: non-Bash pattern returns null", () => {
  assertEquals(extractAllowedPattern("Read(**)"), null);
});

Deno.test("extractAllowedPattern: Edit pattern returns null", () => {
  assertEquals(extractAllowedPattern("Edit(~/.claude/**)"), null);
});

Deno.test("extractAllowedPattern: path-based command preserves glob", () => {
  assertEquals(
    extractAllowedPattern("Bash(~/.claude/scripts/foo.ts:*)"),
    "~/.claude/scripts/foo.ts *",
  );
});

Deno.test("extractAllowedPattern: sudo -k preserves flag", () => {
  assertEquals(extractAllowedPattern("Bash(sudo -k *)"), "sudo -k *");
});

Deno.test("extractAllowedPattern: bracket test command", () => {
  assertEquals(extractAllowedPattern("Bash([ *)"), "[ *");
});

Deno.test("extractAllowedPattern: double bracket test command", () => {
  assertEquals(extractAllowedPattern("Bash([[ *)"), "[[ *");
});

Deno.test("extractAllowedPattern: multiple env vars then command", () => {
  assertEquals(
    extractAllowedPattern("Bash(FOO=bar BAZ=qux git diff *)"),
    "git diff *",
  );
});

Deno.test("extractAllowedPattern: deep subcommand preserved", () => {
  assertEquals(
    extractAllowedPattern("Bash(nix-store --query --references *)"),
    "nix-store --query --references *",
  );
});

Deno.test("extractAllowedPattern: defaults with flags preserved", () => {
  assertEquals(
    extractAllowedPattern("Bash(defaults -currentHost read -g *)"),
    "defaults -currentHost read -g *",
  );
});

// --- matchesAllowedPattern ---

Deno.test("matchesAllowedPattern: exact glob match", () => {
  assertEquals(matchesAllowedPattern("git diff HEAD", "git diff *"), true);
});

Deno.test("matchesAllowedPattern: bare command matches 'cmd *' pattern", () => {
  assertEquals(matchesAllowedPattern("echo", "echo *"), true);
});

Deno.test("matchesAllowedPattern: wrong subcommand does not match", () => {
  assertEquals(matchesAllowedPattern("git push --force", "git diff *"), false);
});

Deno.test("matchesAllowedPattern: wrapped wildcard matches path", () => {
  assertEquals(
    matchesAllowedPattern(
      "~/.claude/scripts/extract-session-history.ts",
      "*extract-session-history.ts*",
    ),
    true,
  );
});

Deno.test("matchesAllowedPattern: exact bare command", () => {
  assertEquals(matchesAllowedPattern("whoami", "whoami"), true);
});

Deno.test("matchesAllowedPattern: bare command with args does not match exact pattern", () => {
  assertEquals(matchesAllowedPattern("whoami extra", "whoami"), false);
});

Deno.test("matchesAllowedPattern: sudo -k matches", () => {
  assertEquals(matchesAllowedPattern("sudo -k", "sudo -k *"), true);
});

Deno.test("matchesAllowedPattern: sudo rm does not match sudo -k", () => {
  assertEquals(matchesAllowedPattern("sudo rm -rf /", "sudo -k *"), false);
});

// --- loadAllowedPatterns ---

Deno.test({
  name: "loadAllowedPatterns: extracts patterns from Bash patterns",
  permissions: { read: true, write: true },
  async fn() {
    const tmpDir = await Deno.makeTempDir();
    const path = `${tmpDir}/settings.json`;
    await Deno.writeTextFile(
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

    await Deno.remove(tmpDir, { recursive: true });
  },
});

Deno.test({
  name: "loadAllowedPatterns: merges multiple files",
  permissions: { read: true, write: true },
  async fn() {
    const tmpDir = await Deno.makeTempDir();
    const file1 = `${tmpDir}/a.json`;
    const file2 = `${tmpDir}/b.json`;
    await Deno.writeTextFile(
      file1,
      JSON.stringify({ permissions: { allow: ["Bash(echo *)"] } }),
    );
    await Deno.writeTextFile(
      file2,
      JSON.stringify({ permissions: { allow: ["Bash(rg:*)"] } }),
    );

    const patterns = await loadAllowedPatterns([file1, file2]);
    assertEquals(patterns.includes("echo *"), true);
    assertEquals(patterns.includes("rg *"), true);

    await Deno.remove(tmpDir, { recursive: true });
  },
});

Deno.test("loadAllowedPatterns: missing file is silently skipped", async () => {
  const patterns = await loadAllowedPatterns(["/nonexistent/path.json"]);
  assertEquals(patterns.length, 0);
});

Deno.test({
  name: "loadAllowedPatterns: wildcard-only and system path patterns excluded",
  permissions: { read: true, write: true },
  async fn() {
    const tmpDir = await Deno.makeTempDir();
    const path = `${tmpDir}/settings.json`;
    await Deno.writeTextFile(
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

    await Deno.remove(tmpDir, { recursive: true });
  },
});

Deno.test({
  name: "loadAllowedPatterns: no permissions key returns empty array",
  permissions: { read: true, write: true },
  async fn() {
    const tmpDir = await Deno.makeTempDir();
    const path = `${tmpDir}/settings.json`;
    await Deno.writeTextFile(path, JSON.stringify({ model: "sonnet" }));

    const patterns = await loadAllowedPatterns([path]);
    assertEquals(patterns.length, 0);

    await Deno.remove(tmpDir, { recursive: true });
  },
});

Deno.test({
  name: "loadAllowedPatterns: deduplicates across files",
  permissions: { read: true, write: true },
  async fn() {
    const tmpDir = await Deno.makeTempDir();
    const file1 = `${tmpDir}/a.json`;
    const file2 = `${tmpDir}/b.json`;
    await Deno.writeTextFile(
      file1,
      JSON.stringify({ permissions: { allow: ["Bash(echo *)"] } }),
    );
    await Deno.writeTextFile(
      file2,
      JSON.stringify({ permissions: { allow: ["Bash(echo *)"] } }),
    );

    const patterns = await loadAllowedPatterns([file1, file2]);
    assertEquals(patterns.length, 1);

    await Deno.remove(tmpDir, { recursive: true });
  },
});

// --- extractCommands ---

Deno.test("extractCommands: simple pipe", async () => {
  assertEquals(await extractCommands("echo test | grep foo"), ["echo", "grep"]);
});

Deno.test("extractCommands: pipe with redirect", async () => {
  assertEquals(
    await extractCommands("echo test | gemini -p 'hello' 2>&1"),
    ["echo", "gemini"],
  );
});

Deno.test("extractCommands: &&", async () => {
  assertEquals(
    await extractCommands("git add . && git commit -m msg"),
    ["git", "git"],
  );
});

Deno.test("extractCommands: mixed operators", async () => {
  assertEquals(
    await extractCommands("echo a | grep b && echo c; wc -l"),
    ["echo", "grep", "echo", "wc"],
  );
});

Deno.test("extractCommands: strips input redirect", async () => {
  assertEquals(await extractCommands("sort <input.txt | head"), ["sort", "head"]);
});

Deno.test("extractCommands: strips numbered redirect", async () => {
  assertEquals(
    await extractCommands("npm test 2>/dev/null | tail -5"),
    ["npm", "tail"],
  );
});

Deno.test("extractCommands: env var prefix before command", async () => {
  assertEquals(
    await extractCommands(
      'TMUX="" tmux capture-pane -p 2>/dev/null | grep -v \'^$\' | tail -3',
    ),
    ["tmux", "grep", "tail"],
  );
});

Deno.test("extractCommands: multiple env vars before command", async () => {
  assertEquals(
    await extractCommands("FOO=bar BAZ=qux git diff | grep foo"),
    ["git", "grep"],
  );
});

// --- shouldApprove ---

// AST-based detection: quoted operators are not treated as compound
Deno.test("shouldApprove: quoted pipe in argument is not compound", async () => {
  const patterns = ["git *"];
  assertEquals(
    await shouldApprove('git commit -m "fix | update"', patterns),
    false,
  );
});

Deno.test("shouldApprove: quoted && in argument is not compound", async () => {
  const patterns = ["git *"];
  assertEquals(
    await shouldApprove('git commit -m "fix && update"', patterns),
    false,
  );
});

Deno.test("shouldApprove: pipe with allowed commands", async () => {
  const patterns = ["echo *", "grep *"];
  assertEquals(await shouldApprove("echo test | grep foo", patterns), true);
});

Deno.test("shouldApprove: && with allowed commands", async () => {
  const patterns = ["git add *", "git commit *"];
  assertEquals(
    await shouldApprove("git add . && git commit -m msg", patterns),
    true,
  );
});

Deno.test("shouldApprove: pipe with unknown command rejects", async () => {
  const patterns = ["echo *"];
  assertEquals(await shouldApprove("echo test | evil-cmd", patterns), false);
});

Deno.test("shouldApprove: && with unknown command rejects", async () => {
  const patterns = ["echo *"];
  assertEquals(
    await shouldApprove("echo test && evil-cmd --flag", patterns),
    false,
  );
});

Deno.test("shouldApprove: simple command (no shell syntax) rejects", async () => {
  const patterns = ["echo *"];
  assertEquals(await shouldApprove("echo hello", patterns), false);
});

Deno.test("shouldApprove: allowed command with 2>&1", async () => {
  const patterns = ["gemini *"];
  assertEquals(await shouldApprove("gemini -p 'test' 2>&1", patterns), true);
});

Deno.test("shouldApprove: allowed command with >/dev/null", async () => {
  const patterns = ["npm *"];
  assertEquals(await shouldApprove("npm test >/dev/null", patterns), true);
});

Deno.test("shouldApprove: unknown command with 2>&1 rejects", async () => {
  assertEquals(await shouldApprove("evil-cmd 2>&1", []), false);
});

Deno.test("shouldApprove: pipe + redirect combined", async () => {
  const patterns = ["echo *", "gemini *"];
  assertEquals(
    await shouldApprove("echo test | gemini -p 'hello' 2>&1", patterns),
    true,
  );
});

Deno.test("shouldApprove: triple pipe chain", async () => {
  const patterns = ["cat *", "grep *", "wc *"];
  assertEquals(
    await shouldApprove("cat file | grep pattern | wc -l", patterns),
    true,
  );
});

Deno.test("shouldApprove: env var prefix with allowed command", async () => {
  const patterns = ["tmux *", "grep *", "tail *"];
  assertEquals(
    await shouldApprove(
      'TMUX="" tmux capture-pane -t "%53" -p 2>/dev/null | grep -v \'^$\' | tail -3',
      patterns,
    ),
    true,
  );
});

Deno.test("shouldApprove: env var prefix with unknown command rejects", async () => {
  const patterns = ["grep *"];
  assertEquals(
    await shouldApprove('TMUX="" evil-cmd | grep foo', patterns),
    false,
  );
});

// --- basename fallback ---

Deno.test("extractCommands: path-based command with redirect", async () => {
  assertEquals(
    await extractCommands(
      "~/.claude/scripts/extract-session-history.ts 2>/dev/null",
    ),
    ["~/.claude/scripts/extract-session-history.ts"],
  );
});

Deno.test("shouldApprove: full path script with redirect (basename fallback)", async () => {
  const patterns = ["*extract-session-history.ts*"];
  assertEquals(
    await shouldApprove(
      "~/.claude/scripts/extract-session-history.ts 2>/dev/null",
      patterns,
    ),
    true,
  );
});

Deno.test("shouldApprove: unknown path-based command with redirect rejects", async () => {
  assertEquals(
    await shouldApprove("/usr/local/bin/evil-cmd 2>/dev/null", []),
    false,
  );
});

Deno.test("shouldApprove: basename fallback with custom patterns", async () => {
  const patterns = ["my-script.ts *"];
  assertEquals(await shouldApprove("/some/path/my-script.ts arg 2>&1", patterns), true);
  assertEquals(await shouldApprove("/some/path/other.ts arg 2>&1", patterns), false);
});

// --- subcommand granularity (regression tests for security fix) ---

Deno.test("shouldApprove: git push rejected when only git diff allowed", async () => {
  const patterns = ["git diff *"];
  assertEquals(
    await shouldApprove("git push --force 2>&1", patterns),
    false,
  );
});

Deno.test("shouldApprove: git diff approved when git diff allowed", async () => {
  const patterns = ["git diff *"];
  assertEquals(
    await shouldApprove("git diff HEAD 2>&1", patterns),
    true,
  );
});

Deno.test("shouldApprove: sudo rm rejected when only sudo -k allowed", async () => {
  const patterns = ["sudo -k *"];
  assertEquals(
    await shouldApprove("sudo rm -rf / 2>&1", patterns),
    false,
  );
});

Deno.test("shouldApprove: sudo -k approved when sudo -k allowed", async () => {
  const patterns = ["sudo -k *"];
  assertEquals(
    await shouldApprove("sudo -k 2>&1", patterns),
    true,
  );
});

Deno.test("shouldApprove: nix profile rejected when only nix fmt allowed", async () => {
  const patterns = ["nix fmt *"];
  assertEquals(
    await shouldApprove("nix profile wipe-history 2>&1", patterns),
    false,
  );
});

Deno.test("shouldApprove: nix fmt approved when nix fmt allowed", async () => {
  const patterns = ["nix fmt *"];
  assertEquals(
    await shouldApprove("nix fmt 2>&1", patterns),
    true,
  );
});

Deno.test("shouldApprove: gh auth rejected when only gh api and gh pr allowed", async () => {
  const patterns = ["gh api *", "gh pr *"];
  assertEquals(
    await shouldApprove("gh auth logout 2>&1", patterns),
    false,
  );
});

Deno.test("shouldApprove: compound with mixed subcommands, one not allowed", async () => {
  const patterns = ["git diff *", "git add *"];
  assertEquals(
    await shouldApprove("git add . && git push origin main", patterns),
    false,
  );
});

Deno.test("shouldApprove: compound with all subcommands allowed", async () => {
  const patterns = ["git diff *", "git add *"];
  assertEquals(
    await shouldApprove("git add . && git diff HEAD", patterns),
    true,
  );
});
