#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run=git

// Vendor Figma SKILL.md content (figma-use + 3 siblings) from
// https://github.com/figma/mcp-server-guide into
// home/programs/agents/skills/figma-*. Per-skill atomic via staging + rename.
//
// Modes:
//   (no flag)  sync from upstream main, rewriting .figma-source
//   --check    read-only diff vs upstream HEAD via `git ls-remote`
//
// Symlink policy: upstream entries are copied with a hand-walked recursive
// copy that REFUSES symlinks. A compromised upstream cannot smuggle a link
// like `references/api-reference.md -> ~/.ssh/id_rsa` into the vendored
// tree (which agents would then read as "trusted documentation").

const UPSTREAM = "https://github.com/figma/mcp-server-guide.git";
const SKILLS = [
  "figma-use",
  "figma-generate-design",
  "figma-generate-library",
  "figma-use-slides",
] as const;

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname;
const SKILLS_DIR = `${REPO_ROOT}home/programs/agents/skills`;
const STAGING_DIR = `${SKILLS_DIR}/.figma-staging`;

const decoder = new TextDecoder();

type RunResult = { code: number; stdout: string; stderr: string };

async function run(cmd: string, args: string[], cwd?: string): Promise<RunResult> {
  const child = new Deno.Command(cmd, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await child.output();
  return {
    code: out.code,
    stdout: decoder.decode(out.stdout),
    stderr: decoder.decode(out.stderr),
  };
}

async function mustRun(cmd: string, args: string[], cwd?: string): Promise<string> {
  const r = await run(cmd, args, cwd);
  if (r.code !== 0) {
    const msg = `Command failed (exit ${r.code}): ${cmd} ${args.join(" ")}`;
    if (r.stderr.trim()) throw new Error(`${msg}\n${r.stderr}`);
    throw new Error(msg);
  }
  return r.stdout;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

// Recursive copy that rejects symlinks anywhere in the tree.
// Prevents a malicious upstream from smuggling `vendored/foo.md -> ~/.ssh/id_rsa`
// into the agents' skill set (a supply-chain symlink-smuggling attack).
async function copyTreeRejectingSymlinks(src: string, dest: string): Promise<void> {
  const stat = await Deno.lstat(src);
  if (stat.isSymlink) {
    throw new Error(
      `Refusing to copy symlink from upstream: ${src} — Figma upstream MUST contain only regular files and directories.`,
    );
  }
  if (stat.isDirectory) {
    await Deno.mkdir(dest, { recursive: true });
    for await (const entry of Deno.readDir(src)) {
      await copyTreeRejectingSymlinks(`${src}/${entry.name}`, `${dest}/${entry.name}`);
    }
    return;
  }
  if (stat.isFile) {
    await Deno.copyFile(src, dest);
    return;
  }
  throw new Error(`Refusing to copy non-regular entry: ${src} (not file, dir, or symlink)`);
}

async function readSourceCommit(skill: string): Promise<string | null> {
  const path = `${SKILLS_DIR}/${skill}/.figma-source`;
  try {
    const text = await Deno.readTextFile(path);
    const match = text.match(/^commit:\s*([0-9a-f]{7,40})\s*$/m);
    return match?.[1] ?? null;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

async function upstreamHeadSha(): Promise<string> {
  const out = await mustRun("git", ["ls-remote", UPSTREAM, "HEAD"]);
  const sha = out.split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`Unexpected ls-remote output: ${out}`);
  }
  return sha;
}

async function checkMode(): Promise<number> {
  const local = await readSourceCommit("figma-use");
  if (local === null) {
    console.error(
      "No vendored figma-use found (or .figma-source missing). " +
        "Run without --check first to vendor.",
    );
    return 1;
  }
  const upstream = await upstreamHeadSha();
  if (local === upstream) {
    console.log(`up to date (commit ${local})`);
    return 0;
  }
  console.log(`drift detected: local=${local} upstream=${upstream}`);
  return 1;
}

async function syncMode(): Promise<number> {
  // Deno.makeTempDir reads $TMPDIR internally and produces an OS-unique
  // name — no --allow-env=TMPDIR and no PID-collision risk.
  const tmpDir = await Deno.makeTempDir({ prefix: "figma-mcp-server-guide-sync-" });

  // Hygiene: clear leftover staging from any prior interrupted run.
  if (await exists(STAGING_DIR)) await Deno.remove(STAGING_DIR, { recursive: true });

  try {
    console.log(`cloning ${UPSTREAM} (sparse, depth 1) → ${tmpDir}`);
    await mustRun("git", [
      "clone",
      "--depth",
      "1",
      "--filter=blob:none",
      "--sparse",
      UPSTREAM,
      tmpDir,
    ]);

    const sparseArgs = ["sparse-checkout", "set", ...SKILLS.map((s) => `skills/${s}`)];
    await mustRun("git", sparseArgs, tmpDir);

    const sha = (await mustRun("git", ["rev-parse", "HEAD"], tmpDir)).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error(`Unexpected commit SHA: ${sha}`);
    }

    await Deno.mkdir(STAGING_DIR, { recursive: true });
    for (const skill of SKILLS) {
      const src = `${tmpDir}/skills/${skill}`;
      const dest = `${STAGING_DIR}/${skill}`;
      if (!(await exists(src))) {
        throw new Error(`upstream missing skills/${skill}`);
      }
      await copyTreeRejectingSymlinks(src, dest);
      const stagedSkillMd = `${dest}/SKILL.md`;
      if (!(await exists(stagedSkillMd))) {
        throw new Error(`staged ${skill} is missing SKILL.md`);
      }
    }

    // Per-skill staged → rename swap. Not cross-skill transactional: an
    // interrupt mid-loop can leave a partial set. Re-running the script
    // recovers (staging is cleaned on entry, full re-sync follows).
    for (const skill of SKILLS) {
      const target = `${SKILLS_DIR}/${skill}`;
      if (await exists(target)) await Deno.remove(target, { recursive: true });
      await Deno.rename(`${STAGING_DIR}/${skill}`, target);
    }

    // Stamp every vendored root.
    const syncedAt = new Date().toISOString();
    for (const skill of SKILLS) {
      const sourceFile = `${SKILLS_DIR}/${skill}/.figma-source`;
      const body = `upstream: ${UPSTREAM}\ncommit: ${sha}\nsynced_at: ${syncedAt}\n`;
      await Deno.writeTextFile(sourceFile, body);
    }

    console.log(`vendored ${SKILLS.length} skills @ commit ${sha}`);
    return 0;
  } finally {
    if (await exists(STAGING_DIR)) {
      try {
        await Deno.remove(STAGING_DIR, { recursive: true });
      } catch (_) {
        // Best effort cleanup.
      }
    }
    try {
      await Deno.remove(tmpDir, { recursive: true });
    } catch (_) {
      // Best effort cleanup.
    }
  }
}

async function main(): Promise<number> {
  const args = Deno.args;
  if (args.length === 0) return syncMode();
  if (args.length === 1 && args[0] === "--check") return checkMode();
  console.error("usage: sync-figma-skills.ts [--check]");
  return 2;
}

try {
  Deno.exit(await main());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  Deno.exit(1);
}
