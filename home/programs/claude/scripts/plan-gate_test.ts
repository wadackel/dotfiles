import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  canonical,
  checkGate,
  cwdHash,
  cwdMarkerPath,
  isInfraPath,
  isUnderCwd,
  type HookInput,
} from "./plan-gate.ts";

// --- Test helpers ---

async function withTempMarker<T>(
  cwd: string,
  mtimeOffsetMs: number,
  run: () => Promise<T>,
): Promise<T> {
  const hash = await cwdHash(cwd);
  const path = cwdMarkerPath(hash);
  await Deno.mkdir(path.substring(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(path, "");
  // Adjust mtime for expiry tests
  const targetMtime = new Date(Date.now() + mtimeOffsetMs);
  await Deno.utime(path, targetMtime, targetMtime);
  try {
    return await run();
  } finally {
    try {
      await Deno.remove(path);
    } catch {
      /* already cleaned */
    }
  }
}

// --- Pure helpers ---

Deno.test("isInfraPath: matches CLAUDE.md / settings.json / scripts/", () => {
  assertEquals(
    isInfraPath("/Users/alice/dotfiles/home/programs/claude/CLAUDE.md"),
    true,
  );
  assertEquals(
    isInfraPath("/Users/alice/dotfiles/home/programs/claude/settings.json"),
    true,
  );
  assertEquals(
    isInfraPath("/Users/alice/dotfiles/home/programs/claude/scripts/foo.ts"),
    true,
  );
  assertEquals(
    isInfraPath("/Users/alice/dotfiles/home/programs/claude/scripts/nested/bar.ts"),
    true,
  );
});

Deno.test("isInfraPath: rejects non-infra paths", () => {
  assertEquals(isInfraPath("/Users/alice/project/src/main.ts"), false);
  assertEquals(
    isInfraPath("/Users/alice/dotfiles/home/programs/other/file"),
    false,
  );
  assertEquals(
    isInfraPath("/Users/alice/dotfiles/home/programs/claude/skills/foo.md"),
    false,
  );
});

Deno.test("isUnderCwd: returns true for file under cwd", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  const sub = `${cwd}/subdir`;
  await Deno.mkdir(sub);
  const file = `${sub}/a.ts`;
  await Deno.writeTextFile(file, "");
  try {
    assertEquals(await isUnderCwd(file, cwd), true);
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("isUnderCwd: returns false for file outside cwd", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  const other = await Deno.makeTempDir({ dir: "/tmp" });
  const file = `${other}/a.ts`;
  await Deno.writeTextFile(file, "");
  try {
    assertEquals(await isUnderCwd(file, cwd), false);
  } finally {
    await Deno.remove(cwd, { recursive: true });
    await Deno.remove(other, { recursive: true });
  }
});

Deno.test("cwdHash: returns 16-hex-char deterministic hash", async () => {
  const hash1 = await cwdHash("/Users/alice/project");
  const hash2 = await cwdHash("/Users/alice/project");
  assertEquals(hash1, hash2);
  assertEquals(hash1.length, 16);
  assertEquals(/^[0-9a-f]{16}$/.test(hash1), true);
});

Deno.test("canonical: returns realpath for existing path", async () => {
  const dir = await Deno.makeTempDir({ dir: "/tmp" });
  try {
    const canon = await canonical(dir);
    assertEquals(canon.length > 0, true);
  } finally {
    await Deno.remove(dir);
  }
});

Deno.test("canonical: returns input for nonexistent path (fallback)", async () => {
  const nonexistent = `/tmp/plan-gate-nonexistent-${Date.now()}/foo`;
  assertEquals(await canonical(nonexistent), nonexistent);
});

// --- checkGate: the 5 scenarios from the plan ---

Deno.test("checkGate #1: missing file_path → allow (fail-open)", async () => {
  const input: HookInput = { cwd: "/Users/alice/project" };
  const result = await checkGate(input);
  assertEquals(result.kind, "allow");
  if (result.kind === "allow") assertEquals(result.reason, "missing-fields");
});

Deno.test("checkGate #1: missing cwd → allow (fail-open)", async () => {
  const input: HookInput = { tool_input: { file_path: "/some/path" } };
  const result = await checkGate(input);
  assertEquals(result.kind, "allow");
});

Deno.test("checkGate #2: infra path (CLAUDE.md) → allow", async () => {
  const input: HookInput = {
    tool_input: {
      file_path: "/Users/alice/dotfiles/home/programs/claude/CLAUDE.md",
    },
    cwd: "/Users/alice/dotfiles",
  };
  const result = await checkGate(input);
  assertEquals(result.kind, "allow");
  if (result.kind === "allow") assertEquals(result.reason, "infra");
});

Deno.test("checkGate #2: infra path (settings.json) → allow", async () => {
  const input: HookInput = {
    tool_input: {
      file_path: "/Users/alice/dotfiles/home/programs/claude/settings.json",
    },
    cwd: "/Users/alice/dotfiles",
  };
  const result = await checkGate(input);
  assertEquals(result.kind, "allow");
});

Deno.test("checkGate #2: infra path (scripts/foo.ts) → allow", async () => {
  const input: HookInput = {
    tool_input: {
      file_path: "/Users/alice/dotfiles/home/programs/claude/scripts/foo.ts",
    },
    cwd: "/Users/alice/dotfiles",
  };
  const result = await checkGate(input);
  assertEquals(result.kind, "allow");
});

Deno.test("checkGate #3: outside cwd → allow", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  const other = await Deno.makeTempDir({ dir: "/tmp" });
  try {
    const input: HookInput = {
      tool_input: { file_path: `${other}/foo.md` },
      cwd,
    };
    const result = await checkGate(input);
    assertEquals(result.kind, "allow");
    if (result.kind === "allow") assertEquals(result.reason, "outside-cwd");
  } finally {
    await Deno.remove(cwd, { recursive: true });
    await Deno.remove(other, { recursive: true });
  }
});

Deno.test("checkGate #4: cwd-hash marker valid (mtime < 24h) + cwd 内 → allow", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  const file = `${cwd}/a.ts`;
  await Deno.writeTextFile(file, "");
  try {
    await withTempMarker(cwd, -1000, async () => {
      const input: HookInput = {
        tool_input: { file_path: file },
        cwd,
      };
      const result = await checkGate(input);
      assertEquals(result.kind, "allow");
      if (result.kind === "allow") assertEquals(result.reason, "marker-valid");
    });
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("checkGate #5: marker absent + cwd 内 + infra 外 → block (未実行 message)", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  const file = `${cwd}/a.ts`;
  await Deno.writeTextFile(file, "");
  try {
    const input: HookInput = {
      tool_input: { file_path: file },
      cwd,
    };
    const result = await checkGate(input);
    assertEquals(result.kind, "block");
    if (result.kind === "block") {
      assertStringIncludes(result.reason, "まだ /plan が実行されていません");
      assertStringIncludes(result.reason, "/plan <実装したい内容>");
    }
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("checkGate #5: marker expired (mtime > 24h) + cwd 内 → block (期限切れ message)", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  const file = `${cwd}/a.ts`;
  await Deno.writeTextFile(file, "");
  try {
    // 25h 前にずらす
    await withTempMarker(cwd, -25 * 60 * 60 * 1000, async () => {
      const input: HookInput = {
        tool_input: { file_path: file },
        cwd,
      };
      const result = await checkGate(input);
      assertEquals(result.kind, "block");
      if (result.kind === "block") {
        assertStringIncludes(result.reason, "期限切れ");
        assertStringIncludes(result.reason, "/plan <実装したい内容>");
      }
    });
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
});
