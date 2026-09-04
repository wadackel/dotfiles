#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run=git

// Vendor third-party SKILL.md sets from their upstream repositories into
// home/programs/agents/skills/<skill>. Per-skill atomic via staging + rename.
//
// Usage:
//   sync-vendored-skills.ts [vendor...]          sync (all vendors when omitted)
//   sync-vendored-skills.ts --check [vendor...]  read-only drift check via `git ls-remote`
//
// Symlink policy: upstream entries are copied with a hand-walked recursive
// copy that REFUSES symlinks. A compromised upstream cannot smuggle a link
// like `references/api-reference.md -> ~/.ssh/id_rsa` into the vendored
// tree (which agents would then read as "trusted documentation").

type Vendor = {
  name: string;
  upstream: string;
  skills: readonly string[];
};

const VENDORS: readonly Vendor[] = [
  {
    name: "figma",
    upstream: "https://github.com/figma/mcp-server-guide.git",
    skills: [
      "figma-use",
      "figma-generate-design",
      "figma-generate-library",
      "figma-use-slides",
    ],
  },
  {
    name: "gh-stack",
    upstream: "https://github.com/github/gh-stack.git",
    skills: ["gh-stack"],
  },
];

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname;
const SKILLS_DIR = `${REPO_ROOT}home/programs/agents/skills`;
const STAGING_DIR = `${SKILLS_DIR}/.vendor-staging`;

const decoder = new TextDecoder();

type RunResult = { code: number; stdout: string; stderr: string };

async function run(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<RunResult> {
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

async function mustRun(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<string> {
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
async function copyTreeRejectingSymlinks(
  src: string,
  dest: string,
): Promise<void> {
  const stat = await Deno.lstat(src);
  if (stat.isSymlink) {
    throw new Error(
      `Refusing to copy symlink from upstream: ${src} — vendored upstreams MUST contain only regular files and directories.`,
    );
  }
  if (stat.isDirectory) {
    await Deno.mkdir(dest, { recursive: true });
    for await (const entry of Deno.readDir(src)) {
      await copyTreeRejectingSymlinks(
        `${src}/${entry.name}`,
        `${dest}/${entry.name}`,
      );
    }
    return;
  }
  if (stat.isFile) {
    await Deno.copyFile(src, dest);
    return;
  }
  throw new Error(
    `Refusing to copy non-regular entry: ${src} (not file, dir, or symlink)`,
  );
}

function sourceFileName(vendor: Vendor): string {
  return `.${vendor.name}-source`;
}

async function readSourceCommit(vendor: Vendor): Promise<string | null> {
  const path = `${SKILLS_DIR}/${vendor.skills[0]}/${sourceFileName(vendor)}`;
  try {
    const text = await Deno.readTextFile(path);
    const match = text.match(/^commit:\s*([0-9a-f]{7,40})\s*$/m);
    return match?.[1] ?? null;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

async function upstreamHeadSha(vendor: Vendor): Promise<string> {
  const out = await mustRun("git", ["ls-remote", vendor.upstream, "HEAD"]);
  const sha = out.split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`Unexpected ls-remote output: ${out}`);
  }
  return sha;
}

async function checkVendor(vendor: Vendor): Promise<number> {
  const local = await readSourceCommit(vendor);
  if (local === null) {
    console.error(
      `[${vendor.name}] not vendored yet (${
        sourceFileName(vendor)
      } missing). ` +
        "Run without --check first to vendor.",
    );
    return 1;
  }
  const upstream = await upstreamHeadSha(vendor);
  if (local === upstream) {
    console.log(`[${vendor.name}] up to date (commit ${local})`);
    return 0;
  }
  console.log(
    `[${vendor.name}] drift detected: local=${local} upstream=${upstream}`,
  );
  return 1;
}

async function syncVendor(vendor: Vendor): Promise<void> {
  // Deno.makeTempDir reads $TMPDIR internally and produces an OS-unique
  // name — no --allow-env=TMPDIR and no PID-collision risk.
  const tmpDir = await Deno.makeTempDir({
    prefix: `vendored-skills-${vendor.name}-`,
  });

  // Hygiene: clear leftover staging from any prior interrupted run.
  if (await exists(STAGING_DIR)) {
    await Deno.remove(STAGING_DIR, { recursive: true });
  }

  try {
    console.log(
      `[${vendor.name}] cloning ${vendor.upstream} (sparse, depth 1) → ${tmpDir}`,
    );
    await mustRun("git", [
      "clone",
      "--depth",
      "1",
      "--filter=blob:none",
      "--sparse",
      vendor.upstream,
      tmpDir,
    ]);

    await mustRun(
      "git",
      ["sparse-checkout", "set", ...vendor.skills.map((s) => `skills/${s}`)],
      tmpDir,
    );

    const sha = (await mustRun("git", ["rev-parse", "HEAD"], tmpDir)).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error(`Unexpected commit SHA: ${sha}`);
    }

    await Deno.mkdir(STAGING_DIR, { recursive: true });
    for (const skill of vendor.skills) {
      const src = `${tmpDir}/skills/${skill}`;
      const dest = `${STAGING_DIR}/${skill}`;
      if (!(await exists(src))) {
        throw new Error(`upstream missing skills/${skill}`);
      }
      await copyTreeRejectingSymlinks(src, dest);
      if (!(await exists(`${dest}/SKILL.md`))) {
        throw new Error(`staged ${skill} is missing SKILL.md`);
      }
    }

    // Per-skill staged → rename swap. Not cross-skill transactional: an
    // interrupt mid-loop can leave a partial set. Re-running the script
    // recovers (staging is cleaned on entry, full re-sync follows).
    for (const skill of vendor.skills) {
      const target = `${SKILLS_DIR}/${skill}`;
      if (await exists(target)) await Deno.remove(target, { recursive: true });
      await Deno.rename(`${STAGING_DIR}/${skill}`, target);
    }

    const syncedAt = new Date().toISOString();
    for (const skill of vendor.skills) {
      const body =
        `upstream: ${vendor.upstream}\ncommit: ${sha}\nsynced_at: ${syncedAt}\n`;
      await Deno.writeTextFile(
        `${SKILLS_DIR}/${skill}/${sourceFileName(vendor)}`,
        body,
      );
    }

    console.log(
      `[${vendor.name}] vendored ${vendor.skills.length} skill(s) @ commit ${sha}`,
    );
  } finally {
    for (const dir of [STAGING_DIR, tmpDir]) {
      try {
        await Deno.remove(dir, { recursive: true });
      } catch (_) {
        // Best effort cleanup.
      }
    }
  }
}

function selectVendors(names: string[]): Vendor[] {
  if (names.length === 0) return [...VENDORS];
  return names.map((name) => {
    const vendor = VENDORS.find((v) => v.name === name);
    if (!vendor) {
      const known = VENDORS.map((v) => v.name).join(", ");
      throw new Error(`unknown vendor: ${name} (known: ${known})`);
    }
    return vendor;
  });
}

async function main(): Promise<number> {
  const check = Deno.args[0] === "--check";
  const names = check ? Deno.args.slice(1) : Deno.args;
  if (names.some((n) => n.startsWith("-"))) {
    console.error("usage: sync-vendored-skills.ts [--check] [vendor...]");
    return 2;
  }
  const vendors = selectVendors(names);

  if (check) {
    let code = 0;
    for (const vendor of vendors) {
      if ((await checkVendor(vendor)) !== 0) code = 1;
    }
    return code;
  }

  for (const vendor of vendors) await syncVendor(vendor);
  return 0;
}

try {
  Deno.exit(await main());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  Deno.exit(1);
}
