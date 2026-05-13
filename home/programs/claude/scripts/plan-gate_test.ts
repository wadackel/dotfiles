import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  activateBypassMarker,
  bypassMarkerInfo,
  canonical,
  checkGate,
  cwdHash,
  cwdMarkerPath,
  type HookInput,
  isInfraPath,
  isInsidePlansDir,
  isUnderCwd,
  plansDirPath,
} from "./plan-gate.ts";

// --- Test helpers ---

async function withTempMarker<T>(
  cwd: string,
  mtimeOffsetMs: number,
  run: () => Promise<T>,
): Promise<T> {
  const hash = await cwdHash(cwd);
  const path = cwdMarkerPath(hash);
  await Deno.mkdir(path.substring(0, path.lastIndexOf("/")), {
    recursive: true,
  });
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
    isInfraPath(
      "/Users/alice/dotfiles/home/programs/claude/scripts/nested/bar.ts",
    ),
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

Deno.test("checkGate #5b: pending marker exists + active absent + cwd 内 → block (承認待ち message)", async () => {
  const cwd = await Deno.makeTempDir({ dir: "/tmp" });
  const file = `${cwd}/a.ts`;
  await Deno.writeTextFile(file, "");
  const hash = await cwdHash(cwd);
  const home = Deno.env.get("HOME") ?? "";
  const pendingPath = `${home}/.claude/plans/.pending-${hash}`;
  await Deno.mkdir(pendingPath.substring(0, pendingPath.lastIndexOf("/")), {
    recursive: true,
  });
  await Deno.writeTextFile(pendingPath, "test-plan-path");
  try {
    const input: HookInput = {
      tool_input: { file_path: file },
      cwd,
    };
    const result = await checkGate(input);
    assertEquals(result.kind, "block");
    if (result.kind === "block") {
      assertStringIncludes(result.reason, "/impl` と打鍵");
      assertStringIncludes(result.reason, "承認");
      assertStringIncludes(result.reason, "auto mode では bypass されません");
    }
  } finally {
    try {
      await Deno.remove(pendingPath);
    } catch {
      /* already cleaned */
    }
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

// --- Bypass marker scenarios ---

async function withTempBypassHome<T>(
  setup: (
    home: string,
    cwd: string,
    file: string,
  ) => Promise<void>,
  run: (cwd: string, file: string) => Promise<T>,
): Promise<T> {
  const originalHome = Deno.env.get("HOME");
  const home = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "plan-gate-bypass-home-",
  });
  const cwd = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "plan-gate-bypass-cwd-",
  });
  const file = `${cwd}/a.ts`;
  await Deno.writeTextFile(file, "");
  await Deno.mkdir(`${home}/.claude/plans`, { recursive: true });
  Deno.env.set("HOME", home);
  try {
    await setup(home, cwd, file);
    return await run(cwd, file);
  } finally {
    if (originalHome !== undefined) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    await Deno.remove(home, { recursive: true });
    await Deno.remove(cwd, { recursive: true });
  }
}

async function setExpired(path: string): Promise<void> {
  const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await Deno.utime(path, stale, stale);
}

Deno.test("bypass #1: valid bypass marker + active absent → allow bypass-valid", async () => {
  await withTempBypassHome(
    async (_home, c) => {
      await activateBypassMarker({
        cwd: c,
        session_id: "session-1",
        prompt: "/bypass-plan-gate",
      });
    },
    async (cwd, file) => {
      const result = await checkGate({
        tool_input: { file_path: file },
        cwd,
        session_id: "session-1",
      });
      assertEquals(result.kind, "allow");
      if (result.kind === "allow") {
        assertEquals(result.reason, "bypass-valid");
      }
    },
  );
});

Deno.test("bypass #2: active valid + bypass marker → marker-valid (active 優先)", async () => {
  await withTempBypassHome(
    async (home, c) => {
      const hash = await cwdHash(c);
      const activePath = `${home}/.claude/plans/.active-${hash}`;
      await Deno.writeTextFile(activePath, "/some/plan.md");
      await activateBypassMarker({
        cwd: c,
        session_id: "session-1",
        prompt: "/bypass-plan-gate",
      });
    },
    async (cwd, file) => {
      const result = await checkGate({
        tool_input: { file_path: file },
        cwd,
        session_id: "session-1",
      });
      assertEquals(result.kind, "allow");
      if (result.kind === "allow") {
        assertEquals(result.reason, "marker-valid");
      }
    },
  );
});

Deno.test("bypass #3: bypass overrides expired active marker", async () => {
  await withTempBypassHome(
    async (home, c) => {
      const hash = await cwdHash(c);
      const activePath = `${home}/.claude/plans/.active-${hash}`;
      await Deno.writeTextFile(activePath, "/some/plan.md");
      await setExpired(activePath);
      await activateBypassMarker({
        cwd: c,
        session_id: "session-1",
        prompt: "/bypass-plan-gate",
      });
    },
    async (cwd, file) => {
      const result = await checkGate({
        tool_input: { file_path: file },
        cwd,
        session_id: "session-1",
      });
      assertEquals(result.kind, "allow");
      if (result.kind === "allow") {
        assertEquals(result.reason, "bypass-valid");
      }
    },
  );
});

Deno.test("bypass #4: bypass overrides pending-only state", async () => {
  await withTempBypassHome(
    async (home, c) => {
      const hash = await cwdHash(c);
      const pendingPath = `${home}/.claude/plans/.pending-${hash}`;
      await Deno.writeTextFile(pendingPath, "/some/plan.md");
      await activateBypassMarker({
        cwd: c,
        session_id: "session-1",
        prompt: "/bypass-plan-gate",
      });
    },
    async (cwd, file) => {
      const result = await checkGate({
        tool_input: { file_path: file },
        cwd,
        session_id: "session-1",
      });
      assertEquals(result.kind, "allow");
      if (result.kind === "allow") {
        assertEquals(result.reason, "bypass-valid");
      }
    },
  );
});

Deno.test("bypass #5: different session_id → block", async () => {
  await withTempBypassHome(
    async (_home, c) => {
      await activateBypassMarker({
        cwd: c,
        session_id: "session-1",
        prompt: "/bypass-plan-gate",
      });
    },
    async (cwd, file) => {
      const result = await checkGate({
        tool_input: { file_path: file },
        cwd,
        session_id: "session-2",
      });
      assertEquals(result.kind, "block");
    },
  );
});

Deno.test("bypass #6: missing session_id → block", async () => {
  await withTempBypassHome(
    async (_home, c) => {
      await activateBypassMarker({
        cwd: c,
        session_id: "session-1",
        prompt: "/bypass-plan-gate",
      });
    },
    async (cwd, file) => {
      const result = await checkGate({
        tool_input: { file_path: file },
        cwd,
      });
      assertEquals(result.kind, "block");
    },
  );
});

Deno.test("bypass #7: non-string session_id → block", async () => {
  await withTempBypassHome(
    async (_home, c) => {
      await activateBypassMarker({
        cwd: c,
        session_id: "session-1",
        prompt: "/bypass-plan-gate",
      });
    },
    async (cwd, file) => {
      const result = await checkGate({
        tool_input: { file_path: file },
        cwd,
        session_id: 123 as unknown as string,
      });
      assertEquals(result.kind, "block");
    },
  );
});

Deno.test("bypass #8: malformed JSON bypass marker → block", async () => {
  await withTempBypassHome(
    async (_home, c) => {
      const info = await bypassMarkerInfo(c, "session-1");
      await Deno.writeTextFile(info.path, "{not-json");
    },
    async (cwd, file) => {
      const result = await checkGate({
        tool_input: { file_path: file },
        cwd,
        session_id: "session-1",
      });
      assertEquals(result.kind, "block");
    },
  );
});

Deno.test("bypass #9: non-object bypass marker → block", async () => {
  await withTempBypassHome(
    async (_home, c) => {
      const info = await bypassMarkerInfo(c, "session-1");
      await Deno.writeTextFile(info.path, "[]");
    },
    async (cwd, file) => {
      const result = await checkGate({
        tool_input: { file_path: file },
        cwd,
        session_id: "session-1",
      });
      assertEquals(result.kind, "block");
    },
  );
});

Deno.test("bypass #10: wrong cwdHash bypass marker → block", async () => {
  await withTempBypassHome(
    async (_home, c) => {
      const info = await activateBypassMarker({
        cwd: c,
        session_id: "session-1",
        prompt: "/bypass-plan-gate",
      });
      const marker = JSON.parse(await Deno.readTextFile(info.path));
      marker.cwdHash = "wrong";
      await Deno.writeTextFile(info.path, JSON.stringify(marker));
    },
    async (cwd, file) => {
      const result = await checkGate({
        tool_input: { file_path: file },
        cwd,
        session_id: "session-1",
      });
      assertEquals(result.kind, "block");
    },
  );
});

Deno.test("bypass #11: wrong sessionHash bypass marker → block", async () => {
  await withTempBypassHome(
    async (_home, c) => {
      const info = await activateBypassMarker({
        cwd: c,
        session_id: "session-1",
        prompt: "/bypass-plan-gate",
      });
      const marker = JSON.parse(await Deno.readTextFile(info.path));
      marker.sessionHash = "wrong";
      await Deno.writeTextFile(info.path, JSON.stringify(marker));
    },
    async (cwd, file) => {
      const result = await checkGate({
        tool_input: { file_path: file },
        cwd,
        session_id: "session-1",
      });
      assertEquals(result.kind, "block");
    },
  );
});

Deno.test("bypass #12: wrong cwd field bypass marker → block", async () => {
  await withTempBypassHome(
    async (_home, c) => {
      const info = await activateBypassMarker({
        cwd: c,
        session_id: "session-1",
        prompt: "/bypass-plan-gate",
      });
      const marker = JSON.parse(await Deno.readTextFile(info.path));
      marker.cwd = "/tmp/wrong-path";
      await Deno.writeTextFile(info.path, JSON.stringify(marker));
    },
    async (cwd, file) => {
      const result = await checkGate({
        tool_input: { file_path: file },
        cwd,
        session_id: "session-1",
      });
      assertEquals(result.kind, "block");
    },
  );
});

Deno.test("bypass #13: missing createdAt or prompt → block", async () => {
  await withTempBypassHome(
    async (_home, c) => {
      const info = await activateBypassMarker({
        cwd: c,
        session_id: "session-1",
        prompt: "/bypass-plan-gate",
      });
      const marker = JSON.parse(await Deno.readTextFile(info.path));
      delete marker.createdAt;
      delete marker.prompt;
      await Deno.writeTextFile(info.path, JSON.stringify(marker));
    },
    async (cwd, file) => {
      const result = await checkGate({
        tool_input: { file_path: file },
        cwd,
        session_id: "session-1",
      });
      assertEquals(result.kind, "block");
    },
  );
});

Deno.test("bypass #14: symlink bypass marker → block", async () => {
  await withTempBypassHome(
    async (home, c) => {
      const info = await bypassMarkerInfo(c, "session-1");
      const target = `${home}/.claude/plans/bypass-target.json`;
      await Deno.writeTextFile(target, "{}");
      await Deno.symlink(target, info.path);
    },
    async (cwd, file) => {
      const result = await checkGate({
        tool_input: { file_path: file },
        cwd,
        session_id: "session-1",
      });
      assertEquals(result.kind, "block");
    },
  );
});

Deno.test("bypass #15: directory bypass marker → block", async () => {
  await withTempBypassHome(
    async (_home, c) => {
      const info = await bypassMarkerInfo(c, "session-1");
      await Deno.mkdir(info.path);
    },
    async (cwd, file) => {
      const result = await checkGate({
        tool_input: { file_path: file },
        cwd,
        session_id: "session-1",
      });
      assertEquals(result.kind, "block");
    },
  );
});

// --- Security: plans dir write block (AI cannot self-grant via Edit/Write) ---

Deno.test("isInsidePlansDir: true for paths under ~/.claude/plans/", () => {
  const dir = plansDirPath();
  assertEquals(isInsidePlansDir(`${dir}/.active-abc`), true);
  assertEquals(isInsidePlansDir(`${dir}/.bypass-plan-gate-aa-bb.json`), true);
  assertEquals(isInsidePlansDir(`${dir}/anything`), true);
});

Deno.test("isInsidePlansDir: false for paths outside ~/.claude/plans/", () => {
  const dir = plansDirPath();
  assertEquals(isInsidePlansDir(`${dir}-suffix/file`), false);
  assertEquals(isInsidePlansDir("/Users/alice/project/src.ts"), false);
});

Deno.test("security: write to ~/.claude/plans/.active-* → block", async () => {
  const originalHome = Deno.env.get("HOME");
  const home = await Deno.makeTempDir({ dir: "/tmp", prefix: "security-home-" });
  const cwd = await Deno.makeTempDir({ dir: "/tmp", prefix: "security-cwd-" });
  Deno.env.set("HOME", home);
  try {
    const hash = await cwdHash(cwd);
    const target = `${home}/.claude/plans/.active-${hash}`;
    const result = await checkGate({
      tool_input: { file_path: target },
      cwd,
      session_id: "session-1",
    });
    assertEquals(result.kind, "block");
    if (result.kind === "block") {
      assertStringIncludes(result.reason, "plan-gate");
    }
  } finally {
    if (originalHome !== undefined) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    await Deno.remove(home, { recursive: true });
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("security: write to ~/.claude/plans/.bypass-plan-gate-* → block (no Edit/Write path to forge bypass marker)", async () => {
  const originalHome = Deno.env.get("HOME");
  const home = await Deno.makeTempDir({ dir: "/tmp", prefix: "security-home-" });
  const cwd = await Deno.makeTempDir({ dir: "/tmp", prefix: "security-cwd-" });
  Deno.env.set("HOME", home);
  try {
    const info = await bypassMarkerInfo(cwd, "session-1");
    const result = await checkGate({
      tool_input: { file_path: info.path },
      cwd,
      session_id: "session-1",
    });
    assertEquals(result.kind, "block");
  } finally {
    if (originalHome !== undefined) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    await Deno.remove(home, { recursive: true });
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("security: plans dir block takes precedence over infra allowlist", async () => {
  // ~/.claude/plans/ paths must never satisfy isInfraPath, but if a future
  // regex accidentally includes them, the plans-dir block must still win.
  const originalHome = Deno.env.get("HOME");
  const home = await Deno.makeTempDir({ dir: "/tmp", prefix: "security-home-" });
  Deno.env.set("HOME", home);
  try {
    const target = `${home}/.claude/plans/.active-foo`;
    const result = await checkGate({
      tool_input: { file_path: target },
      cwd: "/tmp/anything",
      session_id: "session-1",
    });
    assertEquals(result.kind, "block");
  } finally {
    if (originalHome !== undefined) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    await Deno.remove(home, { recursive: true });
  }
});
