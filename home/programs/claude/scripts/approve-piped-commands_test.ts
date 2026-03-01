import { assertEquals } from "jsr:@std/assert";
import {
  extractCommandName,
  extractCommands,
  hasShellSyntax,
  loadAllowedCommands,
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

// --- extractCommandName ---

Deno.test("extractCommandName: simple command pattern", () => {
  assertEquals(extractCommandName("Bash(echo *)"), "echo");
});

Deno.test("extractCommandName: subcommand pattern returns first word", () => {
  assertEquals(extractCommandName("Bash(git add *)"), "git");
});

Deno.test("extractCommandName: wrapped wildcard pattern", () => {
  assertEquals(
    extractCommandName("Bash(*extract-session-history.ts*)"),
    "extract-session-history.ts",
  );
});

Deno.test("extractCommandName: generic wildcard with flags returns null", () => {
  assertEquals(extractCommandName("Bash(* --help *)"), null);
});

Deno.test("extractCommandName: version flag only returns null", () => {
  assertEquals(extractCommandName("Bash(* --version)"), null);
});

Deno.test("extractCommandName: short help flag returns null", () => {
  assertEquals(extractCommandName("Bash(* -h *)"), null);
});

Deno.test("extractCommandName: short version flag returns null", () => {
  assertEquals(extractCommandName("Bash(* -v)"), null);
});

Deno.test("extractCommandName: system path returns null", () => {
  assertEquals(extractCommandName("Bash(//dev/null)"), null);
});

Deno.test("extractCommandName: bare command no wildcard", () => {
  assertEquals(extractCommandName("Bash(env)"), "env");
});

Deno.test("extractCommandName: whoami bare command", () => {
  assertEquals(extractCommandName("Bash(whoami)"), "whoami");
});

Deno.test("extractCommandName: pwd bare command", () => {
  assertEquals(extractCommandName("Bash(pwd)"), "pwd");
});

Deno.test("extractCommandName: env var prefix is skipped", () => {
  assertEquals(extractCommandName("Bash(TMUX= tmux:*)"), "tmux");
});

Deno.test("extractCommandName: colon separator format", () => {
  assertEquals(extractCommandName("Bash(rg:*)"), "rg");
});

Deno.test("extractCommandName: colon separator with subcommand", () => {
  assertEquals(extractCommandName("Bash(nix fmt:*)"), "nix");
});

Deno.test("extractCommandName: non-Bash pattern returns null", () => {
  assertEquals(extractCommandName("Read(**)"), null);
});

Deno.test("extractCommandName: Edit pattern returns null", () => {
  assertEquals(extractCommandName("Edit(~/.claude/**)"), null);
});

Deno.test("extractCommandName: path-based command returns basename", () => {
  assertEquals(
    extractCommandName("Bash(~/.claude/scripts/foo.ts:*)"),
    "foo.ts",
  );
});

Deno.test("extractCommandName: sudo returns sudo", () => {
  assertEquals(extractCommandName("Bash(sudo -k *)"), "sudo");
});

Deno.test("extractCommandName: bracket test command", () => {
  assertEquals(extractCommandName("Bash([ *)"), "[");
});

Deno.test("extractCommandName: double bracket test command", () => {
  assertEquals(extractCommandName("Bash([[ *)"), "[[");
});

Deno.test("extractCommandName: multiple env vars then command", () => {
  assertEquals(
    extractCommandName("Bash(FOO=bar BAZ=qux git diff *)"),
    "git",
  );
});

// --- loadAllowedCommands ---

Deno.test({
  name: "loadAllowedCommands: extracts commands from Bash patterns",
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

    const allowed = await loadAllowedCommands([path]);
    assertEquals(allowed.has("echo"), true);
    assertEquals(allowed.has("git"), true);
    assertEquals(allowed.has("extract-session-history.ts"), true);
    // Non-Bash patterns are skipped
    assertEquals(allowed.has("Read(**)" as string), false);

    await Deno.remove(tmpDir, { recursive: true });
  },
});

Deno.test({
  name: "loadAllowedCommands: merges multiple files",
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

    const allowed = await loadAllowedCommands([file1, file2]);
    assertEquals(allowed.has("echo"), true);
    assertEquals(allowed.has("rg"), true);

    await Deno.remove(tmpDir, { recursive: true });
  },
});

Deno.test("loadAllowedCommands: missing file is silently skipped", async () => {
  const allowed = await loadAllowedCommands(["/nonexistent/path.json"]);
  assertEquals(allowed.size, 0);
});

Deno.test({
  name: "loadAllowedCommands: wildcard-only and system path patterns excluded",
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

    const allowed = await loadAllowedCommands([path]);
    assertEquals(allowed.size, 1);
    assertEquals(allowed.has("echo"), true);

    await Deno.remove(tmpDir, { recursive: true });
  },
});

Deno.test({
  name: "loadAllowedCommands: no permissions key returns empty set",
  permissions: { read: true, write: true },
  async fn() {
    const tmpDir = await Deno.makeTempDir();
    const path = `${tmpDir}/settings.json`;
    await Deno.writeTextFile(path, JSON.stringify({ model: "sonnet" }));

    const allowed = await loadAllowedCommands([path]);
    assertEquals(allowed.size, 0);

    await Deno.remove(tmpDir, { recursive: true });
  },
});

Deno.test({
  name: "loadAllowedCommands: deduplicates across files",
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

    const allowed = await loadAllowedCommands([file1, file2]);
    assertEquals(allowed.size, 1);

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

Deno.test("shouldApprove: pipe with allowed commands", async () => {
  const allowed = new Set(["echo", "grep"]);
  assertEquals(await shouldApprove("echo test | grep foo", allowed), true);
});

Deno.test("shouldApprove: && with allowed commands", async () => {
  const allowed = new Set(["git"]);
  assertEquals(
    await shouldApprove("git add . && git commit -m msg", allowed),
    true,
  );
});

Deno.test("shouldApprove: pipe with unknown command rejects", async () => {
  const allowed = new Set(["echo"]);
  assertEquals(await shouldApprove("echo test | evil-cmd", allowed), false);
});

Deno.test("shouldApprove: && with unknown command rejects", async () => {
  const allowed = new Set(["echo"]);
  assertEquals(
    await shouldApprove("echo test && evil-cmd --flag", allowed),
    false,
  );
});

Deno.test("shouldApprove: simple command (no shell syntax) rejects", async () => {
  const allowed = new Set(["echo"]);
  assertEquals(await shouldApprove("echo hello", allowed), false);
});

Deno.test("shouldApprove: allowed command with 2>&1", async () => {
  const allowed = new Set(["gemini"]);
  assertEquals(await shouldApprove("gemini -p 'test' 2>&1", allowed), true);
});

Deno.test("shouldApprove: allowed command with >/dev/null", async () => {
  const allowed = new Set(["npm"]);
  assertEquals(await shouldApprove("npm test >/dev/null", allowed), true);
});

Deno.test("shouldApprove: unknown command with 2>&1 rejects", async () => {
  const allowed = new Set<string>();
  assertEquals(await shouldApprove("evil-cmd 2>&1", allowed), false);
});

Deno.test("shouldApprove: pipe + redirect combined", async () => {
  const allowed = new Set(["echo", "gemini"]);
  assertEquals(
    await shouldApprove("echo test | gemini -p 'hello' 2>&1", allowed),
    true,
  );
});

Deno.test("shouldApprove: triple pipe chain", async () => {
  const allowed = new Set(["cat", "grep", "wc"]);
  assertEquals(
    await shouldApprove("cat file | grep pattern | wc -l", allowed),
    true,
  );
});

Deno.test("shouldApprove: env var prefix with allowed command", async () => {
  const allowed = new Set(["tmux", "grep", "tail"]);
  assertEquals(
    await shouldApprove(
      'TMUX="" tmux capture-pane -t "%53" -p 2>/dev/null | grep -v \'^$\' | tail -3',
      allowed,
    ),
    true,
  );
});

Deno.test("shouldApprove: env var prefix with unknown command rejects", async () => {
  const allowed = new Set(["grep"]);
  assertEquals(
    await shouldApprove('TMUX="" evil-cmd | grep foo', allowed),
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
  const allowed = new Set(["extract-session-history.ts"]);
  assertEquals(
    await shouldApprove(
      "~/.claude/scripts/extract-session-history.ts 2>/dev/null",
      allowed,
    ),
    true,
  );
});

Deno.test("shouldApprove: unknown path-based command with redirect rejects", async () => {
  const allowed = new Set<string>();
  assertEquals(
    await shouldApprove("/usr/local/bin/evil-cmd 2>/dev/null", allowed),
    false,
  );
});

Deno.test("shouldApprove: basename fallback with custom set", async () => {
  const custom = new Set(["my-script.ts"]);
  assertEquals(await shouldApprove("/some/path/my-script.ts 2>&1", custom), true);
  assertEquals(await shouldApprove("/some/path/other.ts 2>&1", custom), false);
});
