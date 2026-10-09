#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

// Checks that the changes parked in a WIP commit by the rebase skill are still
// in the working tree after the rebase was unwound.
//
// Usage:
//   rebase-guard.ts verify <wip-sha>
//
// Exit 0: every file of the WIP commit is PRESENT (or already IN_HEAD).
// Exit 1: at least one file is LOST or UNCONFIRMED.
// Exit 2: the guard could not run (bad sha, not a WIP commit, rebase in
//         progress, or an internal git failure) — never reported as a loss.
//
// The verdict comes from `git apply --reverse --check` of the per-file patch
// against the working tree rather than from comparing +/- line sets: a line
// that also exists elsewhere in the file would make a lost hunk look absorbed,
// and the reverse-apply demands the surrounding context too.

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { constants } from "node:os";

const WIP_SUBJECT = "wip: auto-commit before rebase";

type GitResult = { code: number; stdout: Uint8Array; stderr: string };

function git(
  cwd: string,
  args: string[],
  stdin?: Uint8Array,
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      // The LOST/PRESENT split reads git's English messages, so a translated
      // locale would turn a dropped mode into a false PRESENT.
      env: { ...process.env, LC_ALL: "C" },
      stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout!.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr!.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        code: code ?? 128 + (signal ? constants.signals[signal] : 0),
        stdout: Buffer.concat(out),
        stderr: new TextDecoder().decode(Buffer.concat(err)),
      });
    });
    if (child.stdin) {
      // A patch git stopped reading is a guard failure (exit 2), never a verdict.
      child.stdin.on("error", reject);
      child.stdin.end(stdin);
    }
  });
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim();
}

function fail(message: string): never {
  console.error(`rebase-guard: ${message}`);
  process.exit(2);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

type State = "PRESENT" | "IN_HEAD" | "LOST" | "UNCONFIRMED";

async function classify(
  top: string,
  wip: string,
  path: string,
): Promise<State> {
  const spec = `:(top,literal)${path}`;
  const patch = await git(top, [
    "diff",
    "--binary",
    "--no-renames",
    "--no-textconv",
    "--no-ext-diff",
    `${wip}~1`,
    wip,
    "--",
    spec,
  ]);
  if (patch.code !== 0) fail(`git diff failed for ${path}: ${patch.stderr}`);
  if (patch.stdout.length === 0) fail(`empty patch for ${path}`);

  const apply = await git(
    top,
    ["apply", "--reverse", "--check"],
    patch.stdout,
  );
  if (apply.code === 0) {
    // git only warns on a mode mismatch, so a dropped chmod would otherwise
    // pass as present.
    if (apply.stderr.includes("has type")) return "LOST";
    const clean = await git(top, ["diff", "--quiet", "HEAD", "--", spec]);
    const untracked = await git(top, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      spec,
    ]);
    return clean.code === 0 && untracked.stdout.length === 0
      ? "IN_HEAD"
      : "PRESENT";
  }
  if (apply.code === 1) {
    return apply.stderr.includes("No such file or directory")
      ? "LOST"
      : "UNCONFIRMED";
  }
  return fail(`git apply failed for ${path}: ${apply.stderr}`);
}

async function verify(wip: string): Promise<number> {
  const topResult = await git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  if (topResult.code !== 0) fail("not inside a git repository");
  // Pathspecs are cwd-relative while --name-status prints root-relative
  // paths, so every git call runs from the toplevel.
  const top = text(topResult.stdout);

  const commit = await git(top, ["cat-file", "-e", `${wip}^{commit}`]);
  if (commit.code !== 0) fail(`${wip} is not a commit`);
  const subjectResult = await git(top, ["log", "-1", "--format=%s", wip]);
  if (subjectResult.code !== 0) fail(`cannot read the subject of ${wip}`);
  const subject = text(subjectResult.stdout);
  if (subject !== WIP_SUBJECT) {
    fail(`${wip} is not a WIP commit (subject: ${subject})`);
  }
  // In a linked worktree `.git` is a file, so the rebase state lives under
  // the main repository; --git-path with absolute output resolves both.
  const gitPathsResult = await git(top, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "rebase-merge",
    "--git-path",
    "rebase-apply",
  ]);
  if (gitPathsResult.code !== 0) fail("cannot resolve the rebase state path");
  const gitPaths = text(gitPathsResult.stdout).split("\n");
  for (const p of gitPaths) {
    if (await exists(p)) fail(`rebase in progress (${p} exists)`);
  }

  // -z keeps non-ASCII paths unquoted (core.quotePath would C-escape them).
  const listing = await git(top, [
    "diff",
    "--name-status",
    "-z",
    "--no-renames",
    `${wip}~1`,
    wip,
  ]);
  if (listing.code !== 0) {
    fail(`git diff --name-status failed: ${listing.stderr}`);
  }
  const fields = new TextDecoder().decode(listing.stdout).split("\0").filter((
    f,
  ) => f.length > 0);
  const paths: string[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) paths.push(fields[i + 1]);
  if (paths.length === 0) fail(`${wip} changes no files`);

  const counts: Record<State, number> = {
    PRESENT: 0,
    IN_HEAD: 0,
    LOST: 0,
    UNCONFIRMED: 0,
  };
  const bad: string[] = [];
  for (const path of paths) {
    const state = await classify(top, wip, path);
    counts[state] += 1;
    if (state === "UNCONFIRMED") {
      console.log(
        `rebase-guard: UNCONFIRMED ${path} (patch does not reverse-apply; inspect: git show ${wip} -- ${path})`,
      );
    } else {
      console.log(`rebase-guard: ${state} ${path}`);
    }
    if (state === "LOST" || state === "UNCONFIRMED") bad.push(path);
  }
  if (bad.length === 0) {
    console.log(
      `rebase-guard: OK (${counts.PRESENT} present, ${counts.IN_HEAD} already in HEAD)`,
    );
    return 0;
  }
  console.log(
    `rebase-guard: could not confirm ${bad.length} file(s); recover with: git show ${wip} -- <path>`,
  );
  return 1;
}

if (import.meta.main) {
  const [command, sha] = process.argv.slice(2);
  if (command !== "verify" || !sha || !/^[0-9a-f]{4,64}$/i.test(sha)) {
    fail("usage: rebase-guard.ts verify <wip-sha> (hex object id)");
  }
  // An unexpected exception must not fall through to the default exit 1 of an
  // uncaught error, which the rebase skill reads as "changes could not be
  // confirmed".
  try {
    process.exit(await verify(sha));
  } catch (e) {
    fail(`internal failure: ${e instanceof Error ? e.message : String(e)}`);
  }
}
