#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

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

import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../lib/proc.ts";

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
  {
    name: "typesafe-ai",
    upstream: "https://github.com/typesafe-ai/skills.git",
    skills: ["typesafe-ai"],
  },
  {
    name: "docker",
    upstream: "https://github.com/docker/skills.git",
    skills: [
      "docker-project-foundations",
      "docker-build-strategies",
      "docker-compose-patterns",
      "docker-destructive-guardrails",
    ],
  },
];

const REPO_ROOT = join(import.meta.dirname, "../../../..") + "/";
const SKILLS_DIR = `${REPO_ROOT}home/programs/agents/skills`;
const STAGING_DIR = `${SKILLS_DIR}/.vendor-staging`;

const errorCode = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code;

async function mustRun(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<string> {
  const r = await run(cmd, args, { cwd });
  if (r.code !== 0) {
    const msg = `Command failed (exit ${r.code}): ${cmd} ${args.join(" ")}`;
    if (r.stderr.trim()) throw new Error(`${msg}\n${r.stderr}`);
    throw new Error(msg);
  }
  return r.stdout;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if (errorCode(e) === "ENOENT") return false;
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
  const info = await lstat(src);
  if (info.isSymbolicLink()) {
    throw new Error(
      `Refusing to copy symlink from upstream: ${src} — vendored upstreams MUST contain only regular files and directories.`,
    );
  }
  if (info.isDirectory()) {
    await mkdir(dest, { recursive: true });
    for (const entry of await readdir(src, { withFileTypes: true })) {
      await copyTreeRejectingSymlinks(
        `${src}/${entry.name}`,
        `${dest}/${entry.name}`,
      );
    }
    return;
  }
  if (info.isFile()) {
    await copyFile(src, dest);
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
    const text = await readFile(path, "utf8");
    const match = text.match(/^commit:\s*([0-9a-f]{7,40})\s*$/m);
    return match?.[1] ?? null;
  } catch (e) {
    if (errorCode(e) === "ENOENT") return null;
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
  const tmpDir = await mkdtemp(
    join(tmpdir(), `vendored-skills-${vendor.name}-`),
  );

  // Hygiene: clear leftover staging from any prior interrupted run.
  if (await exists(STAGING_DIR)) {
    await rm(STAGING_DIR, { recursive: true });
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

    await mkdir(STAGING_DIR, { recursive: true });
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
      if (await exists(target)) await rm(target, { recursive: true });
      await rename(`${STAGING_DIR}/${skill}`, target);
    }

    const syncedAt = new Date().toISOString();
    for (const skill of vendor.skills) {
      const body =
        `upstream: ${vendor.upstream}\ncommit: ${sha}\nsynced_at: ${syncedAt}\n`;
      await writeFile(
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
        await rm(dir, { recursive: true });
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
  const args = process.argv.slice(2);
  const check = args[0] === "--check";
  const names = check ? args.slice(1) : args;
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
  process.exit(await main());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
